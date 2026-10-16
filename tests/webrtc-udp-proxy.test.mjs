import test from "node:test";
import assert from "node:assert/strict";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { WebRtcUdpProxy, stunUsername } from "../dev/webrtc-udp-proxy.mjs";

function binding(username) {
  const text = Buffer.from(username), padded = (text.length + 3) & ~3;
  const packet = Buffer.alloc(24 + padded);
  packet.writeUInt16BE(1, 0); packet.writeUInt16BE(4 + padded, 2); packet.writeUInt32BE(0x2112a442, 4);
  packet.writeUInt16BE(6, 20); packet.writeUInt16BE(text.length, 22); text.copy(packet, 24);
  return packet;
}
function receive(socket, expected) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off("message", handler); reject(new Error("UDP test timed out")); }, 3000);
    const handler = (packet, endpoint) => {
      if (!packet.equals(expected)) return;
      clearTimeout(timer); socket.off("message", handler); resolve(endpoint);
    };
    socket.on("message", handler);
  });
}
test("UDP fixture reads bounded STUN request usernames and ignores malformed or non-STUN packets", () => {
  const packet = binding("Dest1234:Source5678");
  assert.deepEqual(stunUsername(packet), ["Dest1234", "Source5678"]);
  assert.equal(stunUsername(packet.subarray(0, 23)), null);
  assert.equal(stunUsername(binding("short:x")), null);
  const wrongCookie = Buffer.from(packet); wrongCookie.writeUInt32BE(0, 4);
  assert.equal(stunUsername(wrongCookie), null);
  assert.equal(stunUsername(Buffer.from("opaque encrypted traffic")), null);
});
test("UDP fixture rejects unsupported impairment profiles", () => {
  assert.throws(() => new WebRtcUdpProxy({ rtt: 201 }));
  assert.throws(() => new WebRtcUdpProxy({ jitter: NaN }));
  assert.throws(() => new WebRtcUdpProxy({ loss: -1 }));
});
test("real UDP forwarding pairs ICE endpoints, preserves opaque bytes, and applies each one-way delay", async t => {
  const proxy = new WebRtcUdpProxy({ rtt: 200, jitter: 0, loss: 0 });
  const a = createSocket("udp4"), b = createSocket("udp4");
  t.after(() => { proxy.close(); a.close(); b.close(); });
  a.bind(0, "127.0.0.1"); b.bind(0, "127.0.0.1"); await Promise.all([once(a, "listening"), once(b, "listening")]);
  const [portA, portB] = await Promise.all([proxy.register("SourceAAAA"), proxy.register("SourceBBBB")]);
  const aBinding = binding("SourceBBBB:SourceAAAA"), bBinding = binding("SourceAAAA:SourceBBBB");
  const arrivingA = receive(a, bBinding), arrivingB = receive(b, aBinding);
  a.send(aBinding, portB, "127.0.0.1"); b.send(bBinding, portA, "127.0.0.1");
  assert.equal((await arrivingA).port, portB); assert.equal((await arrivingB).port, portA);
  const opaque = Buffer.from([23, 254, 253, 0, 99, 18]), delivered = receive(b, opaque), start = performance.now();
  a.send(opaque, portB, "127.0.0.1");
  assert.equal((await delivered).port, portA); assert.ok(performance.now() - start >= 85);
  assert.equal(proxy.stats().pairedSockets, 2); assert.equal(proxy.stats().dropped, 0); assert.equal(proxy.stats().invalid, 0);
  assert.ok(!JSON.stringify(proxy.stats()).includes("SourceAAAA"));
});
