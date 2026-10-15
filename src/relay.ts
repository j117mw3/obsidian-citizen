/**
 * A thin client for a public publish/subscribe relay (ntfy, by default https://ntfy.sh). It is used only to set up
 * connections between pilots: a handful of small messages, every one of them sealed with the room code (see netcrypto.ts),
 * so the relay carries nothing it can read. After that, pilots talk to each other directly.
 *
 * Sending goes through the host's own HTTP function (Obsidian's requestUrl), and listening uses a standard event stream.
 */

export const DEFAULT_RELAY = "https://ntfy.sh";
const MAX_MESSAGE_CHARS = 3800; // ntfy's limit is 4,096 bytes

/** Sends a body to a web address and says what status came back. */
export type PostFn = (url: string, body: string) => Promise<number>;

/** A relay address must be https (http is allowed only for a relay on this computer, for testing). */
export function cleanRelayUrl(input: string): string | null {
  let u: URL;
  try { u = new URL(input.trim() || DEFAULT_RELAY); } catch { return null; }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
  if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  return u.origin + u.pathname.replace(/\/+$/, "");
}

export class RelayChannel {
  private source: EventSource | null = null;
  private stopped = true;
  private seen = new Set<string>();

  constructor(
    private base: string,
    private topic: string,
    private post: PostFn,
    private onText: (text: string) => void,
    private onProblem: (text: string) => void,
  ) {}

  /** Send one sealed message. Resolves when the relay has taken it. */
  async publish(text: string): Promise<void> {
    if (text.length > MAX_MESSAGE_CHARS) throw new Error("That connection message is too large for the relay.");
    for (let attempt = 0; attempt < 3; attempt++) {
      let status = 0;
      try { status = await this.post(`${this.base}/${this.topic}`, text); }
      catch { await new Promise(r => window.setTimeout(r, 400 * (attempt + 1))); continue; }
      if (status >= 200 && status < 300) return;
      if (status === 429) { this.onProblem("The relay is limiting requests. Wait a minute, or choose a different relay in the settings."); await new Promise(r => window.setTimeout(r, 1500 * (attempt + 1))); continue; }
      throw new Error(`The relay refused the message (${status}).`);
    }
    throw new Error("Could not reach the relay. Check your internet connection, or choose a different relay in the settings.");
  }

  /** Start listening. Messages from the last `sinceSeconds` are delivered too, so nothing sent just before is missed. */
  start(sinceSeconds = 10): void {
    if (!this.stopped) return;
    this.stopped = false;
    const es = this.source = new EventSource(`${this.base}/${this.topic}/sse?since=${sinceSeconds}s`);
    es.addEventListener("message", ev => this.handle((ev as MessageEvent<string>).data)); // the browser reconnects by itself if the connection drops
    es.onerror = () => { if (!this.stopped && es.readyState === EventSource.CLOSED) this.onProblem("The relay connection closed."); };
  }

  stop(): void { this.stopped = true; this.source?.close(); this.source = null; }

  private handle(data: string): void {
    let obj: unknown; try { obj = JSON.parse(data); } catch { return; }
    if (!obj || typeof obj !== "object") return;
    const m = obj as { id?: unknown; event?: unknown; message?: unknown };
    if (m.event !== "message" || typeof m.message !== "string" || typeof m.id !== "string") return;
    if (this.seen.has(m.id)) return;
    this.seen.add(m.id); if (this.seen.size > 500) this.seen.delete(this.seen.values().next().value as string);
    this.onText(m.message);
  }
}
