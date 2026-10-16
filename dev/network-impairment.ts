// Development fixture only: replace signaled ICE candidates with loopback UDP
// forwarders. The native browser still owns ICE, encryption, SCTP, and channels.
export function proxyIceConnection(Native: typeof RTCPeerConnection, token: string, reportError: () => void): typeof RTCPeerConnection {
  return class extends Native {
    constructor(configuration?: RTCConfiguration) {
      super({ ...configuration, iceCandidatePoolSize: 0, iceServers: [], iceTransportPolicy: "all" });
      let callback: ((this: RTCPeerConnection, event: RTCPeerConnectionIceEvent) => unknown) | null = null;
      const published = new Map<string, Promise<void>>();
      Object.defineProperty(this, "onicecandidate", { get: () => callback, set: value => { callback = value; } });
      // localDescription normally incorporates gathered candidates. Suppress them
      // too, so an SDP candidate can never bypass the impaired trickle path.
      Object.defineProperty(this, "localDescription", { get: () => {
        const description = Reflect.get(Native.prototype, "localDescription", this) as RTCSessionDescription | null;
        return description ? new RTCSessionDescription({ type: description.type, sdp: description.sdp.replace(/^a=candidate:.*\r?\n/gm, "") }) : null;
      } });
      this.addEventListener("icecandidate", event => {
        const candidate = event.candidate;
        if (!candidate) return;
        const parts = candidate.candidate.split(" "), ufrag = candidate.usernameFragment;
        if (parts[1] !== "1" || parts[2]?.toLowerCase() !== "udp" || !ufrag || published.has(ufrag)) return;
        const pending = (async () => {
          const url = new URL("/udp/register", location.origin);
          url.searchParams.set("token", token); url.searchParams.set("ufrag", ufrag);
          const response = await fetch(url, { method: "POST" });
          if (!response.ok) throw new Error("Proxy registration failed");
          const value = await response.json() as { port: number };
          if (!Number.isInteger(value.port) || value.port < 1024 || value.port > 65535) throw new Error("Invalid proxy response");
          if (this.connectionState === "closed") return;
          const rewritten = new RTCIceCandidate({ ...candidate.toJSON(), candidate: `candidate:proxy 1 udp 2122260223 127.0.0.1 ${value.port} typ host ufrag ${ufrag}` });
          callback?.call(this, new RTCPeerConnectionIceEvent("icecandidate", { candidate: rewritten }));
        })();
        published.set(ufrag, pending);
        void pending.catch(() => { reportError(); this.close(); });
      });
    }
  };
}
