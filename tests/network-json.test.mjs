import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { zlibSync } from "fflate";

const built = await build({ entryPoints: ["src/networkJson.ts"], bundle: true, platform: "node", format: "esm", target: "node22", write: false });
const wire = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
const packUnchecked = (text, declaredSize = Buffer.byteLength(text)) => {
  const payload = zlibSync(Buffer.from(text)), packet = new Uint8Array(payload.length + 8);
  const view = new DataView(packet.buffer); view.setUint32(0, 0x43475a45, true); view.setUint32(4, declaredSize, true); packet.set(payload, 8); return packet.buffer;
};
test("network compression preserves complete Unicode JSON and leaves small commands as strings", () => {
  const command = JSON.stringify({ type: "surface-fire-result", epoch: 2, sequence: 1, accepted: false });
  assert.equal(wire.encodeNetworkJson(command), command);
  const json = JSON.stringify({ type: "fixture", repeated: Array.from({ length: 200 }, (_, i) => ({ id: `anonymous-${i}`, color: "#959595", description: "中文 🎮 café", value: i / 3 })) });
  const packet = wire.encodeNetworkJson(json);
  assert.ok(packet instanceof ArrayBuffer); assert.ok(packet.byteLength < Buffer.byteLength(json) / 3);
  assert.equal(wire.decodeNetworkJson(packet), json);
  assert.equal(wire.compressedNetworkJson(new ArrayBuffer(3)), false);
});
test("compressed network frames reject corrupt, truncated, oversized, invalid UTF-8, and understated expansion", () => {
  const json = JSON.stringify({ repeated: "state ".repeat(1000) }), packet = wire.encodeNetworkJson(json);
  const corrupt = packet.slice(0); new Uint8Array(corrupt)[corrupt.byteLength - 1] ^= 1;
  assert.equal(wire.decodeNetworkJson(corrupt), null, "verify the zlib checksum, not just successful inflation");
  assert.equal(wire.decodeNetworkJson(packet.slice(0, -2)), null);
  const hugeHeader = packet.slice(0); new DataView(hugeHeader).setUint32(4, 512001, true);
  assert.equal(wire.decodeNetworkJson(hugeHeader), null);
  assert.equal(wire.decodeNetworkJson(packUnchecked(json, 8)), null, "a fixed output buffer detects a forged small expanded size");
  assert.equal(wire.decodeNetworkJson(packUnchecked("x".repeat(128001))), null, "decoded character limits still apply");
  assert.equal(wire.decodeNetworkJson(packUnchecked("x".repeat(128000))), "x".repeat(128000));
  assert.throws(() => wire.encodeNetworkJson("x".repeat(128001)));
  const invalidUtf8 = new Uint8Array([0xc3, 0x28]), compressed = zlibSync(invalidUtf8), invalidPacket = new Uint8Array(compressed.length + 8);
  const view = new DataView(invalidPacket.buffer); view.setUint32(0, 0x43475a45, true); view.setUint32(4, 2, true); invalidPacket.set(compressed, 8);
  assert.equal(wire.decodeNetworkJson(invalidPacket.buffer), null);
});
