// Ephemeral, loopback-only ntfy-compatible signaling fixture. Sealed messages remain opaque.
// It exercises the production room protocol and real browser WebRTC without public-relay quotas.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { WebRtcUdpProxy } from "./webrtc-udp-proxy.mjs";

const port = Number(process.argv[2] ?? 8766);
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid test server port");
const udp = process.argv[3] === undefined ? null : new WebRtcUdpProxy({ rtt: Number(process.argv[3]), jitter: Number(process.argv[4] ?? 25), loss: Number(process.argv[5] ?? 0.01) });
const udpToken = udp ? randomUUID() : "";
const topics = new Map();
const ttlMs = 60000;
const prune = () => {
  udp?.prune();
  const now = Date.now();
  for (const [key, topic] of topics) {
    topic.messages = topic.messages.filter(message => now - message.at < ttlMs);
    if (!topic.clients.size && !topic.messages.length) topics.delete(key);
  }
};
const server = createServer(async (request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Cache-Control", "no-store");
  try {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
    if (request.method === "GET" && ["/", "/network-harness.html", "/surface-latency.html", "/surface-preview.html", "/surface-lifecycle.html"].includes(url.pathname)) {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      const file = ["/surface-latency.html", "/surface-preview.html", "/surface-lifecycle.html"].includes(url.pathname) ? `.${url.pathname}` : "./network-harness.html";
      response.end(await readFile(new URL(file, import.meta.url))); return;
    }
    if (url.pathname.startsWith("/udp/")) {
      if (!udp || url.searchParams.get("token") !== udpToken) { response.writeHead(404).end(); return; }
      response.setHeader("Content-Type", "application/json");
      if (request.method === "GET" && url.pathname === "/udp/stats") { response.end(JSON.stringify(udp.stats())); return; }
      if (request.method === "POST" && url.pathname === "/udp/register") {
        const proxyPort = await udp.register(url.searchParams.get("ufrag") ?? "");
        response.end(JSON.stringify({ port: proxyPort, profile: udp.profile })); return;
      }
      response.writeHead(405).end(); return;
    }
    const match = /^\/relay\/(cg-[a-f0-9]{40})(\/sse)?$/.exec(url.pathname);
    if (!match) { response.writeHead(404).end(); return; }
    prune();
    let topic = topics.get(match[1]);
    if (!topic) {
      if (topics.size >= 8) { response.writeHead(503).end(); return; }
      topic = { clients: new Set(), messages: [] }; topics.set(match[1], topic);
    }
    if (request.method === "GET" && match[2]) {
      response.writeHead(200, { "Content-Type": "text/event-stream", Connection: "keep-alive" });
      response.flushHeaders(); response.write(": open\n\n");
      const since = Math.min(60, Math.max(0, Number.parseFloat(url.searchParams.get("since") ?? "8") || 0));
      for (const message of topic.messages) if (Date.now() - message.at <= since * 1000) response.write(message.frame);
      topic.clients.add(response);
      const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 15000);
      response.on("close", () => { clearInterval(heartbeat); topic.clients.delete(response); });
      return;
    }
    if (request.method === "POST" && !match[2]) {
      let body = "", bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 4096) { response.writeHead(413).end(); return; }
        body += chunk.toString("utf8");
      }
      const message = { id: randomUUID(), event: "message", message: body };
      const frame = `data: ${JSON.stringify(message)}\n\n`;
      topic.messages.push({ at: Date.now(), frame });
      if (topic.messages.length > 512) topic.messages.splice(0, topic.messages.length - 512);
      for (const client of topic.clients) client.write(frame);
      response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ id: message.id })); return;
    }
    response.writeHead(405).end();
  } catch { if (!response.headersSent) response.writeHead(400); response.end(); }
});
server.maxConnections = 64;
server.listen(port, "127.0.0.1", () => console.log(`Loopback WebRTC smoke fixture: http://127.0.0.1:${port}/network-harness.html?relay=http://127.0.0.1:${port}/relay${udp ? `&udp=${udpToken}` : ""}`));
const timer = setInterval(prune, 30000);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => {
  clearInterval(timer); for (const topic of topics.values()) for (const client of topic.clients) client.end();
  udp?.close();
  server.close();
});
