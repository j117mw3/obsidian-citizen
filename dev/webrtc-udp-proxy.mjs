// Test-only UDP forwarding. ICE/DTLS/SCTP bytes stay opaque except the STUN USERNAME
// used to associate the two local sockets (RFC 8445 section 7.2.2).
import { createSocket } from "node:dgram";

export function stunUsername(packet) {
  if (packet.length < 20 || packet.readUInt16BE(0) !== 1 || packet.readUInt32BE(4) !== 0x2112a442) return null;
  const end = 20 + packet.readUInt16BE(2);
  if (end > packet.length) return null;
  for (let offset = 20; offset + 4 <= end;) {
    const kind = packet.readUInt16BE(offset), length = packet.readUInt16BE(offset + 2);
    if (offset + 4 + length > end) return null;
    if (kind === 6) {
      const value = packet.subarray(offset + 4, offset + 4 + length).toString("ascii");
      return /^[a-zA-Z0-9+/]{4,256}:[a-zA-Z0-9+/]{4,256}$/.test(value) ? value.split(":") : null;
    }
    offset += 4 + ((length + 3) & ~3);
  }
  return null;
}

export class WebRtcUdpProxy {
  constructor({ rtt = 0, jitter = 0, loss = 0, seed = 20261015 } = {}) {
    if (![0, 50, 100, 150, 200].includes(rtt) || !Number.isFinite(jitter) || jitter < 0 || jitter > 25 || !Number.isFinite(loss) || loss < 0 || loss > 0.05) throw new Error("Invalid UDP impairment profile");
    this.profile = { rtt, jitter, loss, seed }; this.seed = seed >>> 0;
    this.records = new Map(); this.timers = new Set(); this.closed = false;
    this.counters = { received: 0, forwarded: 0, dropped: 0, queued: 0, invalid: 0, sendErrors: 0, delayTotal: 0, delayMax: 0 };
  }
  random() { this.seed = (Math.imul(1664525, this.seed) + 1013904223) >>> 0; return this.seed / 4294967296; }
  async register(ufrag) {
    if (this.closed || !/^[a-zA-Z0-9+/]{4,256}$/.test(ufrag)) throw new Error("Invalid UDP registration");
    const found = this.records.get(ufrag);
    if (found) return found.ready;
    if (this.records.size >= 64) throw new Error("UDP registration limit");
    const socket = createSocket("udp4");
    const record = { ufrag, socket, port: 0, endpoint: null, peer: null, queued: [], at: Date.now(), ready: null };
    this.records.set(ufrag, record);
    record.ready = new Promise((resolve, reject) => {
      socket.once("error", reject);
      socket.bind(0, "127.0.0.1", () => { record.port = socket.address().port; resolve(record.port); });
    });
    socket.on("error", () => { this.counters.sendErrors++; });
    socket.on("message", (packet, endpoint) => this.receive(record, packet, endpoint));
    try { return await record.ready; } catch { this.records.delete(ufrag); socket.close(); throw new Error("UDP socket unavailable"); }
  }
  receive(destination, packet, endpoint) {
    this.counters.received++; destination.at = Date.now();
    if (packet.length > 65507 || this.closed) return;
    const username = stunUsername(packet);
    let source = destination.peer;
    if (username) {
      const [remote, local] = username;
      source = this.records.get(local);
      if (remote !== destination.ufrag || !source || source === destination || (source.peer && source.peer !== destination) || (destination.peer && destination.peer !== source)) { this.counters.invalid++; return; }
      source.peer = destination; destination.peer = source;
      source.endpoint = { address: endpoint.address, port: endpoint.port }; source.at = Date.now();
    }
    if (!source?.endpoint || source.endpoint.address !== endpoint.address || source.endpoint.port !== endpoint.port) { this.counters.invalid++; return; }
    if (!destination.endpoint) {
      if (destination.queued.length < 16) { destination.queued.push({ source, packet: Buffer.from(packet) }); this.counters.queued++; }
      return;
    }
    this.forward(source, destination, packet);
    if (source.queued.length) for (const pending of source.queued.splice(0)) this.forward(pending.source, source, pending.packet);
  }
  forward(source, destination, packet) {
    if (this.random() < this.profile.loss) { this.counters.dropped++; return; }
    if (this.timers.size >= 8192) { this.counters.dropped++; return; }
    const delay = Math.max(0, this.profile.rtt / 2 + (this.random() * 2 - 1) * this.profile.jitter);
    const start = performance.now();
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      if (this.closed || !destination.endpoint || !this.records.has(source.ufrag)) return;
      const actual = performance.now() - start;
      this.counters.delayTotal += actual; this.counters.delayMax = Math.max(this.counters.delayMax, actual);
      // A -> proxy B must leave from proxy A, the address advertised for A to B.
      source.socket.send(packet, destination.endpoint.port, destination.endpoint.address, error => {
        if (error) this.counters.sendErrors++; else this.counters.forwarded++;
      });
    }, delay);
    this.timers.add(timer);
  }
  stats() {
    const { delayTotal, ...counters } = this.counters;
    return { profile: this.profile, sockets: this.records.size, pairedSockets: [...this.records.values()].filter(record => record.peer && record.endpoint).length, pending: this.timers.size, ...counters, meanDelayMs: this.counters.forwarded ? delayTotal / this.counters.forwarded : 0 };
  }
  prune() {
    for (const [key, record] of this.records) if (Date.now() - record.at > 90000) { this.records.delete(key); record.socket.close(); }
  }
  close() {
    this.closed = true;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear(); for (const record of this.records.values()) record.socket.close(); this.records.clear();
  }
}
