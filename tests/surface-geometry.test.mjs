import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const built = await build({ entryPoints: ["src/surfaceGeometry.ts", "src/surfaceSpatial.ts", "src/surfacePhysics.ts", "src/surfaceCombat.ts", "src/surfaceVisuals.ts", "src/surfaceCollision.ts", "src/surfaceWorld.ts", "src/surfaceAuthority.ts", "src/surfaceSnapshotWire.ts", "src/surfaceGeometryWire.ts", "src/flight.ts", "src/sim.ts"], bundle: true, platform: "node", format: "esm", target: "node22", outdir: "test-bundles", write: false });
const load = name => import(`data:text/javascript;base64,${Buffer.from(built.outputFiles.find(file => file.path.endsWith(`${name}.js`)).text).toString("base64")}`);
const { generateDirectedSurfaceArena, surfaceRadiusForConnections } = await load("surfaceGeometry");
const { SurfaceSpatialGrid, SurfacePointSlots } = await load("surfaceSpatial");
const physics = await load("surfacePhysics"), combat = await load("surfaceCombat"), visuals = await load("surfaceVisuals"), collision = await load("surfaceCollision");
const distance = (a, b) => Math.hypot(...a.map((n, k) => n - b[k]));

test("occupied file-directed layout freezes, resamples on a later visit, and preserves consumed pickup timers", async () => {
  const { SurfaceWorld } = await load("surfaceWorld"), world = new SurfaceWorld();
  const ids = ["a", "b", "c", "d", "e", "f"];
  const topology = { revision: 1, nodes: [{ id: "hub", dockable: true, group: 0, degree: 6 }, ...ids.map(id => ({ id, dockable: false, group: 0, degree: 1 }))], links: ids.flatMap(id => [["hub", id], [id, "hub"]]).concat([["hub", "hub"]]) };
  const frame = new Float32Array([0, 0, 0, 10, 0, 0, -10, 0, 0, 0, 0, 10, 0, 0, -10, 5, 0, 5, -5, 0, -5]);
  world.setOwnerMap("owner", topology, frame);
  const key = "owner/hub";
  world.addPlayer("pilot", { position: [0, 0, 38], rotation: [0, 0, 0, 1], velocity: [0, 0, 0] });
  assert.equal(world.dock("pilot", key, 4000), true);
  const first = world.getArena(key), layout = structuredClone(first.arena);
  assert.equal(layout.walls.length, 12);
  Object.assign(world.arenas.get(key).pickups[0], { available: false, respawnAt: 25000 });
  const moving = frame.map((n, i) => n + [10, 20, 30][i % 3]);
  moving[3] = -30;
  world.setOwnerMap("owner", topology, moving);
  assert.deepEqual(world.getArena(key).arena, layout); assert.equal(world.getArena(key).revision, first.revision);
  assert.deepEqual(world.getArena(key).center, [10, 20, 30]);
  const saved = world.getPlayer("pilot").surface;
  assert.equal(Math.hypot(...saved.position), 27); assert.equal(saved.grounded, true);
  assert.equal(world.forceUndock("pilot"), true);
  world.setShipPose("pilot", { position: [10, 20, 68], rotation: [0, 0, 0, 1], velocity: [0, 0, 0] });
  assert.equal(world.dock("pilot", key, 8000), true);
  const second = world.getArena(key);
  assert.equal(second.topologyRevision, first.topologyRevision); assert.ok(second.revision > first.revision);
  assert.notEqual(second.arena.seed, first.arena.seed);
  assert.deepEqual(world.getPickups(key, 8000)[0], { id: "pickup-0", available: false, respawnAt: 25000 });
  const migration = new SurfaceWorld(); assert.equal(migration.restoreCheckpoint(world.checkpoint(8000), 12000, 4000), true);
  assert.deepEqual(migration.getArena(key).arena, second.arena);
  assert.equal(migration.getPickups(key, 12000)[0].respawnAt, 25000);
  migration.removePlayer("pilot"); assert.equal(migration.listPlayers().length, 0);
});

test("all supported degrees fit reliable 16 KiB geometry chunks and compact 32 MiB migration checkpoints", async () => {
  const { SurfaceSnapshotWire } = await load("surfaceSnapshotWire");
  const { stringifySurfaceTransfer, parseSurfaceTransfer, MAX_GEOMETRY_BYTES, MAX_CHECKPOINT_BYTES } = await load("surfaceGeometryWire");
  const owner = "11111111-1111-4111-8111-111111111111", hub = "n-22222222-2222-4222-8222-222222222222";
  for (const count of [0, 1, 2, 6, 16, 17, 1000, 19999]) {
    const ids = Array.from({ length: count }, (_, i) => `n-00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const arena = generateDirectedSurfaceArena(hub, ids);
    const view = { key: `${owner}/${hub}`, ownerId: owner, hubId: hub, revision: 7, topologyRevision: 2, center: [100, 20, -30], acceptingPlayers: true, arena };
    const snapshot = { epoch: 9, sequence: 1, hostTime: 5000, arenas: [view], players: [], projectiles: [], bots: [], botShots: [], botDrops: [], damageCues: [], hitConfirmations: [], pickups: arena.pickups.map(p => ({ id: p.id, arenaKey: view.key, available: true, respawnAt: 0 })) };
    const host = new SurfaceSnapshotWire(), guest = new SurfaceSnapshotWire(), wire = host.encode(snapshot, true);
    assert.equal(typeof wire.arenas[0].arena, "number"); assert.ok(JSON.stringify(wire).length < 4000);
    assert.equal(guest.decode(wire, 9).snapshot, null);
    const chunks = []; for (let chunk; (chunk = host.nextChunk(5000));) chunks.push(chunk);
    assert.ok(chunks.length > 0); assert.ok(chunks.every(chunk => Buffer.byteLength(JSON.stringify({ type: "surface-geometry-chunk", epoch: 9, ...chunk })) <= 16384));
    let token = null;
    for (const chunk of chunks.reverse()) { const result = guest.receiveChunk(chunk); if (result !== null) token = result; }
    assert.equal(token, wire.arenas[0].geometryId); host.acknowledge([token]);
    const decoded = guest.decode(host.encode({ ...snapshot, sequence: 2 }, true), 9).snapshot;
    assert.deepEqual(decoded.arenas[0].arena, arena);
    const checkpoint = { version: 9, arenas: [view, view, view, view] };
    const text = stringifySurfaceTransfer(checkpoint, MAX_CHECKPOINT_BYTES);
    assert.ok(Buffer.byteLength(stringifySurfaceTransfer(view, MAX_GEOMETRY_BYTES)) <= MAX_GEOMETRY_BYTES);
    assert.deepEqual(parseSurfaceTransfer(text, MAX_CHECKPOINT_BYTES), checkpoint);
    const poisoned = { ...chunks[0], token: token + 1, index: 0, total: 1, data: "{}" };
    assert.equal(guest.receiveChunk(poisoned), null); assert.equal(guest.receiveChunk({ ...poisoned, total: 1000000 }), null);
    assert.equal(guest.decode(wire, 8).snapshot, null);
  }
  assert.throws(() => parseSurfaceTransfer(JSON.stringify({ surfaceGeometry9: 2, size: MAX_GEOMETRY_BYTES + 1, data: "AAAA" }), MAX_GEOMETRY_BYTES), /Invalid compressed/);
  assert.throws(() => parseSurfaceTransfer(JSON.stringify({ surfaceGeometry9: 2, size: 20, data: "AAAA" }), MAX_GEOMETRY_BYTES), /Incomplete/);
  assert.throws(() => stringifySurfaceTransfer({ text: "x".repeat(MAX_GEOMETRY_BYTES) }, MAX_GEOMETRY_BYTES), /size limit/);
});

test("large planets retain walking speed, radial gravity and their actual planet blocker radius", () => {
  const neutral = { moveX: 0, moveY: 1, sprint: false, jump: false, crouch: false, yawDelta: 0, pitchDelta: 0, lean: 0 };
  for (const radius of [27, surfaceRadiusForConnections(17), surfaceRadiusForConnections(1000), surfaceRadiusForConnections(19999)]) {
    let state = physics.createSurfacePlayerState([0, 1, 0], [1, 0, 0], radius);
    assert.equal(physics.validSurfacePlayerState(state), true);
    for (let tick = 0; tick < 120; tick++) state = physics.stepSurfacePlayer(state, neutral, 1 / 60, []);
    assert.ok(Math.abs(Math.hypot(...state.position) - radius) < 1e-6);
    assert.ok(Math.abs(Math.hypot(...state.velocity) - 4.5) < 1e-5);
    const normal = state.position.map(n => n / radius);
    const start = normal.map(n => n * (radius + 3)), end = normal.map(n => n * (radius - 1));
    assert.equal(combat.traceSurfaceSegment(start, end, [], [], "", radius)?.kind, "planet");
    let peak = 0;
    for (let tick = 0; tick < 120; tick++) { state = physics.stepSurfacePlayer(state, { ...neutral, moveY: 0, jump: tick === 0 }, 1 / 60, []); peak = Math.max(peak, Math.hypot(...state.position) - radius); }
    assert.ok(peak > 1 && peak <= 1.2); assert.equal(state.grounded, true);
  }
});

test("dense wall broad phase agrees with direct collision and rendering uses bounded instance batches", () => {
  const ids = Array.from({ length: 1000 }, (_, i) => `n-${i}`), arena = generateDirectedSurfaceArena("indexed", ids);
  for (const wall of arena.walls.slice(0, 20)) {
    const start = wall.normal.map(n => n * (arena.radius + 3)), end = wall.normal.map(n => n * (arena.radius - 1));
    assert.deepEqual(combat.traceSurfaceSegment(start, end, arena.walls, [], "", arena.radius), combat.traceSurfaceSegment(start, end, [wall], [], "", arena.radius));
    assert.ok(collision.nearbySurfaceWalls(start, end, arena.walls, arena.radius).length < 30);
  }
  const root = visuals.createSurfaceArenaVisual(arena), opaque = root.children.find(child => child.name === "surface-wall-instances"), edges = root.children.find(child => child.name === "surface-wall-outlines");
  assert.equal(opaque.count, 2000); assert.equal(edges.geometry.instanceCount, 2000);
  assert.equal(root.userData.wallCount, 2000); assert.ok(root.children.length < 20, "one subtree per wall would grow scene traversal linearly");
  assert.equal(opaque.geometry.type, "BoxGeometry"); assert.equal(opaque.material.transparent, false);
  root.traverse(object => { object.geometry?.dispose(); if (object.material) for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose(); });
});

test("six unique incoming/outgoing Smoke Hub connections yield twelve direction-associated walls", () => {
  const ids = ["a", "b", "c", "d", "e", "f"], normals = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 0.7, 0.7], [0, -0.7, -0.7]];
  const directions = new Map(ids.map((id, i) => [id, normals[i]]));
  const arena = generateDirectedSurfaceArena("hub", [...ids, ...ids, "hub"], directions);
  assert.equal(arena.walls.length, 12); assert.equal(arena.radius, 27);
  assert.deepEqual(arena.walls.map(w => w.connectionId), ids.flatMap(id => [id,id]));
  for (const wall of arena.walls) {
    const direction = directions.get(wall.connectionId), scale = Math.hypot(...direction);
    assert.ok(distance(wall.normal, direction.map(n => n / scale)) < .11);
  }
  assert.deepEqual(arena, generateDirectedSurfaceArena("hub", [...ids].reverse(), new Map([...directions].reverse())));
  const changed = new Map(directions); changed.set("a", [1, 0.2, 0]);
  assert.notEqual(generateDirectedSurfaceArena("hub", ids, changed).seed, arena.seed, "a new sampled bearing changes geometry identity");
});

test("uncapped directional cover grows the radius and retains spacing at maximum supported degree", () => {
  for (const count of [0, 1, 2, 6, 16, 17, 1000, 19999]) {
    const ids = Array.from({ length: count }, (_, i) => `n-${String(i).padStart(5, "0")}`);
    const arena = generateDirectedSurfaceArena("dense-hub", ids, new Map(ids.map(id => [id, [1, 0, 0]])));
    assert.equal(arena.radius, 27 * Math.sqrt(Math.max(1, count / 16)));
    assert.equal(arena.radius, surfaceRadiusForConnections(count));
    assert.equal(arena.walls.length, count * 2); assert.equal(new Set(arena.walls.map(w => w.connectionId)).size, count);
    const grid = new SurfaceSpatialGrid(8);
    for (const wall of arena.walls) {
      const point = wall.normal.map(n => n * arena.radius);
      assert.ok(Math.acos(Math.abs(wall.normal[1]) / Math.hypot(...wall.normal)) * arena.radius >= 6);
      for (const previous of grid.near(point, 4.5)) assert.ok(distance(point, previous) >= 4.49, "conflicting bearings retain physical clearance");
      grid.add(point, point);
      assert.ok(wall.height === 1.3 || wall.height === 2.2); assert.equal(wall.length, 3.5);
    }
    assert.equal(arena.pickups.length, 6);
    for (const pickup of arena.pickups) assert.ok(Math.acos(Math.abs(pickup.normal[1]) / Math.hypot(...pickup.normal)) * arena.radius >= 6);
    if (!count) assert.ok(arena.pickups.every(pickup => pickup.placement === "open"));
  }
});

test("pole and coincident file bearings use deterministic accessible slots", () => {
  const ids = Array.from({ length: 17 }, (_, i) => `file-${i}`), bearings = new Map(ids.map(id => [id, [0, 1, 0]]));
  const first = generateDirectedSurfaceArena("pole-hub", ids, bearings);
  assert.deepEqual(first, generateDirectedSurfaceArena("pole-hub", [...ids].reverse(), bearings));
  assert.equal(first.walls.length, 34);
  assert.ok(first.walls.every(w => Math.acos(Math.abs(w.normal[1]) / Math.hypot(...w.normal)) * first.radius >= 6));
});

test("spatial indexing preserves negative-coordinate bounds and deterministic nearest-slot removal", () => {
  const grid = new SurfaceSpatialGrid(8); grid.add("wall", [-8, -1, 0], 2); grid.add("far", [100, 0, 0]);
  assert.deepEqual(grid.query([-10, -2, -1], [-7, 0, 1]), ["wall"]);
  const slots = new SurfacePointSlots([[-1, 0, 0], [1, 0, 0], [0, 3, 0]]);
  assert.deepEqual(slots.takeNearest([0, 0, 0]), [-1, 0, 0]);
  assert.deepEqual(slots.takeNearest([0, 0, 0]), [1, 0, 0]);
  assert.deepEqual(slots.takeNearest([0, 0, 0]), [0, 3, 0]); assert.equal(slots.takeNearest([0, 0, 0]), null);
});


test("large world spheres stop ships, block departure rays, and reserve graph clearance", async () => {
  const { StarCollisionGrid } = await load("flight"), { Simulation } = await load("sim");
  const { Vector3 } = await import("three");
  const radius = surfaceRadiusForConnections(19999) * 6 / 27, grid = new StarCollisionGrid();
  grid.rebuild([new Float32Array([0, 0, 0])], [new Float32Array([radius])]);
  const position = new Vector3(radius - 1, 0, 0), velocity = new Vector3(-5, 0, 0);
  grid.resolve(position, velocity); assert.ok(Math.abs(position.length() - radius) < 0.0001); assert.ok(velocity.x >= 0);
  const departure = grid.clearPointOnRay(new Vector3(), new Vector3(1, 0, 0), 8);
  assert.ok(departure.x > radius + 0.49);
  const simulation = new Simulation();
  const nodes = Array.from({ length: 18 }, (_, i) => ({ id: `file-${i}`, group: "A", name: `File ${i}`, deg: i ? 1 : 17 }));
  simulation.setData({ nodes, groups: [{ key: "A" }], links: nodes.slice(1).flatMap(node => [{ source: nodes[0].id, target: node.id }, { source: node.id, target: nodes[0].id }]) });
  assert.equal(simulation.collisionRadii.get(nodes[0].id), surfaceRadiusForConnections(17) * 6 / 27 + 1.5);
  simulation.setMotion("off"); simulation.settle(300);
  const main = simulation.nodes[0];
  for (const node of simulation.nodes.slice(1)) assert.ok(Math.hypot(main.x - node.x, main.y - node.y, main.z - node.z) >= simulation.collisionRadii.get(main.id) + 0.75 - 0.1);
});


test("maximum-degree occupied arenas survive late join and authoritative migration without changing geometry", async t => {
  const { SurfaceAuthority, validSurfaceNetworkSnapshot } = await load("surfaceAuthority");
  const { stringifySurfaceTransfer, parseSurfaceTransfer, MAX_CHECKPOINT_BYTES } = await load("surfaceGeometryWire");
  const owner = "11111111-1111-4111-8111-111111111111", pilot = "22222222-2222-4222-8222-222222222222", hub = "n-33333333-3333-4333-8333-333333333333";
  const { createHash } = await import("node:crypto");
  const leaves = Array.from({ length: 19999 }, (_, i) => {
    const hex = createHash("sha256").update(String(i)).digest("hex").slice(0, 32);
    return `n-${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  });
  const topology = { revision: 3, nodes: [{ id: hub, dockable: true, group: 0, degree: leaves.length }, ...leaves.map(id => ({ id, dockable: false, group: 0, degree: 1 }))], links: leaves.map(id => [hub, id]) };
  const positions = new Float32Array(topology.nodes.length * 3); for (let i = 1; i < topology.nodes.length; i++) positions[i * 3] = 10;
  const authority = new SurfaceAuthority(), radius = surfaceRadiusForConnections(leaves.length);
  authority.setOwnerMap(owner, topology, positions);
  authority.addPlayer(pilot, { position: [0, 0, (radius + 11) * 6 / 27], rotation: [0, 0, 0, 1], velocity: [0, 0, 0] });
  assert.equal(authority.dock(pilot, owner, hub, 4000), true);
  const first = authority.snapshot(9, 1, 5000); assert.equal(validSurfaceNetworkSnapshot(first, 9), true);
  assert.equal(first.players[0].surface.radius, radius); assert.equal(first.arenas[0].arena.walls.length, 39998);
  const checkpoint = authority.checkpoint(5000), serialized = stringifySurfaceTransfer(checkpoint, MAX_CHECKPOINT_BYTES);
  const aggregate = stringifySurfaceTransfer({ arenas: Array(28).fill(first.arenas[0]) }, MAX_CHECKPOINT_BYTES);
  t.diagnostic(`maximum-degree checkpoint bytes=${Buffer.byteLength(serialized)}; 28 dense geometry blocks=${Buffer.byteLength(aggregate)} / ${MAX_CHECKPOINT_BYTES}`);
  const migrated = new SurfaceAuthority(); assert.equal(migrated.restoreCheckpoint(parseSurfaceTransfer(serialized, MAX_CHECKPOINT_BYTES), 6000, 1000), true);
  const next = migrated.snapshot(10, 1, 6000); assert.equal(validSurfaceNetworkSnapshot(next, 10), true);
  assert.deepEqual(next.arenas[0].arena, first.arenas[0].arena);
  assert.deepEqual(next.players[0].surface, first.players[0].surface);
  const invalid = structuredClone(next); invalid.arenas[0].arena.walls[0].connectionId = "Private note.md";
  assert.equal(validSurfaceNetworkSnapshot(invalid, 10), false);
  migrated.ownerLeft(owner); assert.equal(migrated.world.getPlayer(pilot).mode, "ship"); assert.equal(migrated.world.listArenas().length, 0);
});

test("walking, jumping, pause/resume and both pole exits remain node-relative during graph translation", async () => {
  const { SurfaceWorld } = await load("surfaceWorld");
  const topology = { revision: 1, nodes: [{ id: "hub", dockable: true, group: 0, degree: 0 }], links: [] };
  for (const pole of [1, -1]) {
    const world = new SurfaceWorld(); world.setOwnerMap("owner", topology, new Float32Array([0, 0, 0]));
    world.addPlayer("pilot", { position: [0, 0, 38], rotation: [0, 0, 0, 1], velocity: [0, 0, 0] });
    assert.equal(world.dock("pilot", "owner/hub", 4000), true);
    const runtime = world.players.get("pilot"); runtime.surface = physics.createSurfacePlayerState([0, pole, 0], [1, 0, 0]);
    let reference = structuredClone(runtime.surface);
    const center = [0, 0, 0];
    for (let tick = 0; tick < 240; tick++) {
      if (tick < 60 || tick >= 120) { center[0] += 0.4; center[1] -= 0.1; center[2] += 0.25; }
      world.setOwnerMap("owner", topology, Float32Array.from(center));
      const input = { moveX: 0, moveY: tick < 180 ? 1 : 0, sprint: false, jump: tick === 20, crouch: false, yawDelta: 0, pitchDelta: 0, lean: 0, interact: false };
      reference = physics.stepSurfacePlayer(reference, input, 1 / 60, []);
      world.updatePlayer("pilot", input, 1 / 60, 8000 + tick * 17);
      assert.deepEqual(world.getPlayer("pilot").surface, reference);
    }
    runtime.surface = physics.createSurfacePlayerState([0, pole, 0], [1, 0, 0]);
    const neutral = { moveX: 0, moveY: 0, sprint: false, jump: false, crouch: false, yawDelta: 0, pitchDelta: 0, lean: 0, interact: true };
    let result;
    for (let tick = 0; tick < 120; tick++) { center[0] += 0.4; world.setOwnerMap("owner", topology, Float32Array.from(center)); result = world.updatePlayer("pilot", neutral, 1 / 60, 13000 + tick * 17); }
    assert.equal(result, "undock"); assert.equal(world.getPlayer("pilot").mode, "ship");
    assert.ok(Math.abs(world.getPlayer("pilot").ship.position[1] - (world.getArena("owner/hub").center[1] + pole * 35)) < 1e-6);
  }
});
