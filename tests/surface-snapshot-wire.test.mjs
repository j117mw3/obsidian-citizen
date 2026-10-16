import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { basename } from "node:path";
const built = await build({ entryPoints: ["src/surfaceSnapshotWire.ts", "src/surfaceAuthority.ts"], bundle: true, platform: "node", format: "esm", target: "node22", outdir: "bundles", write: false });
const load = async name => import(`data:text/javascript;base64,${Buffer.from(built.outputFiles.find(file => basename(file.path) === `${name}.js`).text).toString("base64")}`);
const { SurfaceSnapshotWire } = await load("surfaceSnapshotWire"), { SurfaceAuthority } = await load("surfaceAuthority");
function fixture() {
  const authority = new SurfaceAuthority(), owner = "11111111-1111-4111-8111-111111111111", pilot = "22222222-2222-4222-8222-222222222222", hub = "n-33333333-3333-4333-8333-333333333333";
  authority.setOwnerMap(owner, { revision: 1, nodes: [{ id: hub, group: 0, degree: 1, dockable: true }, { id: "n-44444444-4444-4444-8444-444444444444", group: 0, degree: 1, dockable: false }], links: [[hub, "n-44444444-4444-4444-8444-444444444444"]] }, new Float32Array([0, 0, 0, 10, 0, 0]));
  authority.addPlayer(pilot, { position: [0, 0, 38 * 6 / 27], rotation: [0, 0, 0, 1], velocity: [0, 0, 0], lastDamageAt: 0 });
  assert.equal(authority.dock(pilot, owner, hub, 4000), true);
  return authority.snapshot(1, 1, 5000);
}
test("geometry is omitted only after validated acknowledgement; dynamic state and moving centers remain complete", () => {
  const host = new SurfaceSnapshotWire(), guest = new SurfaceSnapshotWire(), original = fixture();
  const first = host.encode(original), lost = host.encode({ ...original, sequence: 2 });
  assert.equal(typeof lost.arenas[0].arena, "object", "loss before acknowledgement cannot strand the next snapshot");
  const decoded = guest.decode(first, 1);
  assert.ok(decoded.snapshot); assert.equal(decoded.acknowledge.length, 1); assert.deepEqual(decoded.snapshot.players, original.players);
  host.acknowledge(decoded.acknowledge);
  const next = { ...original, sequence: 3, hostTime: 5050, players: original.players.map(player => ({ ...player, health: 70, heat: 6 })), arenas: original.arenas.map(arena => ({ ...arena, center: [10, 20, 30] })), pickups: original.pickups.map((pickup, i) => i ? pickup : { ...pickup, available: false, respawnAt: 20000 }) };
  const compact = host.encode(next); assert.equal(typeof compact.arenas[0].arena, "number");
  assert.ok(JSON.stringify(compact).length < JSON.stringify(next).length * 0.8);
  const restored = guest.decode(compact, 1).snapshot;
  assert.deepEqual(restored.players, next.players); assert.deepEqual(restored.pickups, next.pickups);
  assert.deepEqual(restored.arenas[0].center, [10, 20, 30]); assert.deepEqual(restored.arenas[0].arena, original.arenas[0].arena);
});
test("missing geometry fails closed and requests a full repair; resets do not reuse connection IDs", () => {
  const host = new SurfaceSnapshotWire(), guest = new SurfaceSnapshotWire(), snapshot = fixture();
  const first = host.encode(snapshot), id = first.arenas[0].geometryId;
  host.acknowledge([id + 999]); assert.equal(typeof host.encode(snapshot).arenas[0].arena, "object", "an unoffered token cannot suppress geometry");
  host.acknowledge(guest.decode(first, 1).acknowledge);
  guest.clear(); const compact = host.encode(snapshot), missing = guest.decode(compact, 1);
  assert.equal(missing.snapshot, null); assert.deepEqual(missing.missing, [id]);
  host.acknowledge(missing.missing, true); const repaired = host.encode(snapshot);
  assert.equal(typeof repaired.arenas[0].arena, "object"); assert.ok(guest.decode(repaired, 1).snapshot);
  host.clear(); assert.notEqual(host.encode(snapshot).arenas[0].geometryId, id);
  assert.equal(guest.decode(repaired, 2).snapshot, null, "old-epoch geometry cannot populate a fresh authority");
});
test("invalid full snapshots cannot poison the geometry cache and changed geometry needs a fresh acknowledgement", () => {
  const host = new SurfaceSnapshotWire(), guest = new SurfaceSnapshotWire(), snapshot = fixture(), first = host.encode(snapshot);
  const bad = structuredClone(first); bad.arenas[0].arena.walls[0].height = 99;
  assert.equal(guest.decode(bad, 1).snapshot, null);
  assert.ok(guest.decode(first, 1).snapshot);
  host.acknowledge([first.arenas[0].geometryId]);
  const changed = structuredClone(snapshot); changed.arenas[0].arena.walls[0].length += 0.1;
  const newGeometry = host.encode(changed);
  assert.notEqual(newGeometry.arenas[0].geometryId, first.arenas[0].geometryId);
  assert.equal(typeof newGeometry.arenas[0].arena, "object");
  assert.ok(guest.decode(newGeometry, 1).snapshot);
});
