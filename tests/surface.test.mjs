import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import * as THREE from "three";

const built = await build({
  entryPoints: ["src/surface.ts", "src/surfacePhysics.ts", "src/surfaceWorld.ts", "src/surfaceCombat.ts", "src/surfaceHistory.ts", "src/surfaceColor.ts", "src/surfaceAuthority.ts", "src/surfaceVisuals.ts", "src/surfaceInput.ts", "src/surfaceView.ts", "src/surfaceCollision.ts", "src/surfacePresentation.ts", "src/surfaceGeometry.ts", "src/renderer.ts"], bundle: true, platform: "node", format: "esm", target: "node22", outdir: "test-bundles", entryNames: "[name]", write: false,
});
const load = name => import(`data:text/javascript;base64,${Buffer.from(built.outputFiles.find(file => file.path.endsWith(`${name}.js`)).text).toString("base64")}`);
const surface = await load("surface");
const physics = await load("surfacePhysics");
const worldModule = await load("surfaceWorld");
const combat = await load("surfaceCombat");
const history = await load("surfaceHistory");
const color = await load("surfaceColor");
const authority = await load("surfaceAuthority");
const visuals = await load("surfaceVisuals");
const surfaceInput = await load("surfaceInput");
const viewModule = await load("surfaceView");
const rendering = await load("renderer");
const collision = await load("surfaceCollision");
const presentation = await load("surfacePresentation");
const geometry = await load("surfaceGeometry");

const roomBundle = await build({ entryPoints: ["src/multiplayer.ts", "src/combat.ts", "src/app.ts", "src/flight.ts"], bundle: true, platform: "node", format: "esm", target: "node22", outdir: "test-bundles", write: false });
const loadRoom = name => import(`data:text/javascript;base64,${Buffer.from(roomBundle.outputFiles.find(file => file.path.endsWith(`${name}.js`)).text).toString("base64")}`);
const roomNetwork = await loadRoom("multiplayer"), roomCombat = await loadRoom("combat");
const { ConstellationApp } = await loadRoom("app");
const flightModule = await loadRoom("flight");

const pilotBundle = await build({ entryPoints: ["src/surfacePilot.ts"], bundle: true, platform: "node", format: "esm", target: "node22", write: false });
const { SurfacePilot } = await import(`data:text/javascript;base64,${Buffer.from(pilotBundle.outputFiles[0].text).toString("base64")}`);

test("identical local topology notifications do not rebuild planets but changed owners or publications do", () => {
  const renderer = Object.create(rendering.ConstellationRenderer.prototype); let rebuilds = 0;
  Object.assign(renderer, { localPlayerId: "", localTopology: null, rebuildLocalSurfaceVisuals() { rebuilds++; } });
  const topology = { revision: 1, nodes: [], links: [] };
  renderer.setLocalTopology("owner", topology); renderer.setLocalTopology("owner", topology);
  assert.equal(rebuilds, 1);
  renderer.setLocalTopology("owner", { ...topology, revision: 2 }); assert.equal(rebuilds, 2);
  renderer.setLocalTopology("other", topology); assert.equal(rebuilds, 3);
  renderer.setLocalTopology("", null); renderer.setLocalTopology("", null); assert.equal(rebuilds, 4);
});

test("application join republishes to the renderer before its first docking attempt", async () => {
  const data = { groups: [{ key: "g", color: "#123456", count: 1 }], nodes: [{ id: "Private/Main.md", group: "g", deg: 0 }], links: [] };
  let rendered = null;
  const session = new roomNetwork.MultiplayerSession({ localTopology: (_id, topology) => { rendered = topology; } }, () => ({ nodes: [], data }));
  session.join = async () => {
    Object.assign(session, { selfId: "22222222-2222-4222-8222-222222222222", hostId: "11111111-1111-4111-8111-111111111111", revision: 1 });
    session.topology = roomNetwork.makeAnonymousTopology(data, session.ids, 1); rendered = session.localTopology;
  };
  const app = Object.create(ConstellationApp.prototype);
  Object.assign(app, { network: session, data, flat: false, updateRoomServiceInfo() {}, multiplayerConsent: { checked: true },
    multiplayerName: { value: "Guest" }, multiplayerCode: { value: "ABCD1234" },
    multiplayerStatus: { textContent: "", classList: { remove() {}, add() {} } }, host: {}, pilotProfile: () => ({}) });
  await app.startRoom("join");
  assert.equal(session.localTopology.revision, 2); assert.equal(rendered, session.localTopology);
});

test("authoritative local-room synchronization replaces the anonymous planet instead of adding a private-ID copy", () => {
  const renderer = Object.create(rendering.ConstellationRenderer.prototype), owner = "local", hub = "n-anonymous-main";
  const nodes = [{ id: "Private/Main.md", gi: 0, deg: 0, index: 0, x: 0, y: 0, z: 0 }];
  Object.assign(renderer, { multiplayer: true, localPlayerId: owner, localTopology: { revision: 1, nodes: [{ id: hub, dockable: true }], links: [] },
    sim: { nodes, srcs: [], dsts: [] }, localSurfaceGroups: new Map(), roomSurfaceArenas: new Map(), scene: new THREE.Scene() });
  renderer.rebuildLocalSurfaceVisuals();
  const previous = renderer.localSurfaceGroups.get(hub).group;
  const disposed = new Set(), resources = new Set();
  previous.traverse(object => { if (object.geometry) resources.add(object.geometry); for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) resources.add(material); });
  for (const resource of resources) resource.addEventListener("dispose", () => disposed.add(resource));
  const arena = { key: `${owner}/${hub}`, ownerId: owner, hubId: hub, revision: 1, center: [0, 0, 0], arena: geometry.generateDirectedSurfaceArena(hub, [], new Map(), true) };
  renderer.synchronizeSurfaceArenaVisual(arena, []);
  const meshes = []; renderer.scene.traverse(object => { if (object.name === "surface-planet") meshes.push(object); });
  assert.equal(meshes.length, 1, "one authoritative hub must have exactly one planet mesh");
  assert.deepEqual([...renderer.localSurfaceGroups.keys()], [hub]);
  assert.equal(previous.parent, null);
  assert.equal(disposed.size, resources.size, "replacement disposes all previous geometry and materials");
  assert.equal(renderer.surfacePlanetMesh(arena), meshes[0]);
  renderer.disposeSurfaceGroup(renderer.localSurfaceGroups.get(hub).group);
});

test("room snapshots, moving cover and topology republication retain one authoritative terrain mesh", () => {
  const renderer = Object.create(rendering.ConstellationRenderer.prototype), owner = "local", hub = "n-anonymous-main";
  const connections = Array.from({ length: 6 }, (_, i) => `n-neighbour-${i}`);
  const nodes = [hub, ...connections].map((_id, i) => ({ id: `Private/${i}.md`, gi: 0, deg: i ? 1 : 6, index: i, x: 100 + i * 5, y: 20, z: -30 }));
  const topology = { revision: 1, nodes: [hub, ...connections].map(id => ({ id, dockable: id === hub })), links: connections.map(id => [hub, id]) };
  const arena = { key: `${owner}/${hub}`, ownerId: owner, hubId: hub, revision: 1, center: [100, 20, -30], arena: geometry.generateDirectedSurfaceArena(hub, connections, new Map(), true) };
  const envelopes = [];
  Object.assign(renderer, { multiplayer: true, localPlayerId: owner, localTopology: topology, navigationTarget: null,
    sim: { nodes, srcs: [], dsts: [], setSurfaceEnvelope: (...args) => envelopes.push(args) }, worldNodes: nodes.map(node => ({ ...node })),
    localSurfaceGroups: new Map(), roomSurfaceArenas: new Map(), scene: new THREE.Scene(), roomCoverMotion: new Map(),
    roomSurfaceEpoch: 1, roomSurfaceSnapshotSequence: 0, roomSurfaceHistory: new history.SurfaceHistory(), surfacePrediction: new surfaceInput.SurfacePrediction(),
    roomSurfacePlayers: new Map(), roomSurfaceBotShots: [], networkSurfaceBolts: new Map(), surfaceDisplayCenters: new Map(),
    surfacePilot: { active: true, surfacePosition: [0, arena.arena.radius, 0] }, roomSurfaceLocalArena: null, remoteMaps: new Map(),
    syncSurfaceBotVisuals() {}, updateRemoteSurfaceAudio() {}, performanceCapture: null });
  renderer.rebuildLocalSurfaceVisuals();
  let sequence = 0;
  const receive = value => {
    const base = value.arena.walls[0].normal, angle = ++sequence * .003;
    const normal = [base[0] * Math.cos(angle) - base[2] * Math.sin(angle), base[1], base[0] * Math.sin(angle) + base[2] * Math.cos(angle)];
    const bytes = Buffer.alloc(14); bytes.writeUInt16LE(0, 0); normal.forEach((n, k) => bytes.writeFloatLE(n, 2 + k * 4));
    renderer.setSurfaceSnapshot({ epoch: 1, sequence, hostTime: 1000 + sequence * 50, players: [], bots: [], botShots: [], botDrops: [],
      arenas: [value], pickups: [], projectiles: [], damageCues: [], hitConfirmations: [], cover: [{ arenaKey: value.key, poses: bytes.toString("base64") }] }, 1000 + sequence * 50, 0);
    renderer.roomSurfaceLocalView = { arenaKey: value.key };
    renderer.moveRoomCover(1 / 60); renderer.resolveSurfaceDisplayFrames();
  };
  receive(arena);
  const root = renderer.localSurfaceGroups.get(hub).group, mesh = renderer.surfacePlanetMesh(arena), displayedGeometry = mesh.geometry;
  const cover = root.getObjectByName("surface-wall-instances"), firstWall = Array.from(cover.instanceMatrix.array.slice(0, 16));
  for (let frame = 0; frame < 30; frame++) {
    renderer.worldNodes[0].x += frame % 2 ? 2 : -3; renderer.worldNodes[0].z += .5;
    receive(arena);
    assert.equal(renderer.localSurfaceGroups.size, 1); assert.equal(renderer.localSurfaceGroups.get(hub).group, root);
    assert.equal(renderer.surfacePlanetMesh(arena), mesh); assert.equal(mesh.geometry, displayedGeometry);
    assert.deepEqual(root.position.toArray(), [renderer.worldNodes[0].x, renderer.worldNodes[0].y, renderer.worldNodes[0].z]);
    assert.deepEqual(renderer.surfaceDisplayCenter(arena), root.position.toArray());
    let planets = 0; renderer.scene.traverse(object => { if (object.name === "surface-planet") planets++; }); assert.equal(planets, 1);
  }
  assert.notDeepEqual(Array.from(cover.instanceMatrix.array.slice(0, 16)), firstWall, "linked walls continue moving on the unique group");
  const outlines = root.getObjectByName("surface-wall-outlines");
  for (let col = 0; col < 4; col++) assert.deepEqual(Array.from(outlines.geometry.getAttribute(`wallColumn${col}`).array.slice(0, 4)), Array.from(cover.instanceMatrix.array.slice(col * 4, col * 4 + 4)));
  assert.equal(renderer.localSurfaceCollisionRadius(0), arena.arena.radius * viewModule.SURFACE_WORLD_SCALE);
  assert.equal(renderer.localSurfaceCollisionRadius(1), undefined);
  assert.ok(envelopes.every(([id]) => id === nodes[0].id), "simulation envelopes use local IDs only");
  let oldGeometryDisposed = false; displayedGeometry.addEventListener("dispose", () => { oldGeometryDisposed = true; });
  const revised = { ...arena, revision: 2 }; receive(revised);
  assert.equal(oldGeometryDisposed, true); assert.equal(root.parent, null); assert.equal(renderer.localSurfaceGroups.size, 1);
  renderer.setLocalTopology(owner, { ...topology, revision: 2 }); receive(revised);
  assert.deepEqual([...renderer.localSurfaceGroups.keys()], [hub]);
  let planets = 0; renderer.scene.traverse(object => { if (object.name === "surface-planet") planets++; }); assert.equal(planets, 1);
  renderer.disposeSurfaceGroup(renderer.localSurfaceGroups.get(hub).group);
});

test("leaving and rejoining switches planet identities without retaining scene copies", () => {
  const renderer = Object.create(rendering.ConstellationRenderer.prototype), owner = "local", privateId = "Private/Main.md", hub = "n-anonymous-main";
  const nodes = [{ id: privateId, group: "g", gi: 0, deg: 0, index: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }];
  Object.assign(renderer, { multiplayer: false, localPlayerId: "", localTopology: null, localSurfaceGroups: new Map(), scene: new THREE.Scene(),
    sim: { nodes, srcs: [], dsts: [] }, worldNodes: nodes, settings: { glow: 1 }, cb: {}, pilot: { active: false, setOptions() {}, setRoomAuthority() {} },
    surfacePilot: { active: false }, remoteMaps: new Map(), remoteShips: new Map(), roomSurfaceArenas: new Map(),
    container: { classList: { toggle() {} } }, pilotCollisionGrid: { rebuild() {} }, indicatorLayer: { replaceChildren() {} },
    uniforms: { uNova: {}, uPulse: {}, uCollapse: {} }, bloom: {},
    setHover() {}, setSelected() {}, setNavigationTarget() {}, applyMapTransform() {}, refreshWorldNodes() {}, clearRoomSurfacePresentation() {} });
  for (let attempt = 1; attempt <= 3; attempt++) {
    renderer.setLocalTopology(owner, { revision: attempt, nodes: [{ id: hub, dockable: true }], links: [] });
    renderer.setMultiplayer(true);
    assert.deepEqual([...renderer.localSurfaceGroups.keys()], [hub]);
    assert.equal(renderer.localSurfaceCollisionRadius(0), renderer.localSurfaceGroups.get(hub).group.userData.radius * viewModule.SURFACE_WORLD_SCALE);
    const occupied = renderer.localSurfaceGroups.get(hub).group;
    renderer.setMultiplayer(false);
    assert.equal(occupied.parent, null); assert.deepEqual([...renderer.localSurfaceGroups.keys()], [privateId]);
    assert.equal(renderer.localSurfaceCollisionRadius(0), renderer.localSurfaceGroups.get(privateId).group.userData.radius * viewModule.SURFACE_WORLD_SCALE);
    assert.equal(renderer.localSurfaceCollisionRadius(1), undefined);
    let count = 0; renderer.scene.traverse(object => { if (object.name === "surface-planet") count++; }); assert.equal(count, 1);
  }
  renderer.disposeSurfaceGroup(renderer.localSurfaceGroups.get(privateId).group);
});

test("solo departure refreshes moving node positions and respects neighbouring large planet envelopes", () => {
  const renderer = Object.create(rendering.ConstellationRenderer.prototype), centre = [100, 0, 0], resumed = [];
  const nodes = [{ id: "Private/Main.md", x: 100, y: 0, z: 0 }, { id: "Private/Neighbour.md", x: 100, y: 10, z: 0 }];
  const neighbour = new THREE.Group(); neighbour.userData.radius = 60;
  Object.assign(renderer, { multiplayer: false, surfacePilot: { active: false }, localTopology: null,
    sim: { nodes }, worldNodes: nodes, localSurfaceGroups: new Map([[nodes[1].id, { index: 1, group: neighbour }]]),
    remoteMaps: new Map(), pilotCollisionGrid: new (flightModule.StarCollisionGrid)(), lastPilotObstacleRefresh: Infinity,
    camera: new THREE.PerspectiveCamera(), clearSurfaceCombat() {}, removeParkedSurfaceShip() {}, rebuildLocalSurfaceVisuals() {},
    controls: {}, setPilot: (_on, ship) => resumed.push(ship) });
  renderer.pilotCollisionGrid.rebuild([new Float32Array([0, 0, 0])]);
  renderer.returnToSurfaceShip(identityShip([100, 35, 0]), centre);
  const position = new THREE.Vector3(...resumed[0].position), other = new THREE.Vector3(100, 10, 0);
  assert.ok(position.distanceTo(other) > 60 * viewModule.SURFACE_WORLD_SCALE + .7, "departure must clear the neighbour's actual radius, not a stale/default sphere");
});

test("moving solo, local-room and remote-room planets share one frame center with distinct local and anonymous IDs", () => {
  for (const owner of ["solo", "local", "remote"]) for (const pole of [1, -1]) {
    const renderer = Object.create(rendering.ConstellationRenderer.prototype), pilot = Object.create(SurfacePilot.prototype);
    const privateId = "Private/Main.md", hubId = owner === "solo" ? privateId : "n-anonymous-main";
    const arena = { key: `${owner}/${hubId}`, ownerId: owner, hubId, revision: 1, center: [100, 20, -30], arena: surface.generateSurfaceArena(hubId, ["a", "b", "c", "d", "e", "f"]) };
    const root = visuals.createSurfaceArenaVisual(arena.arena), node = { id: privateId, x: 100, y: 20, z: -30 };
    const remote = { initialized: true, nodeIds: [hubId], current: new Float32Array(arena.center), surfaceGroups: new Map([[hubId, root]]) };
    Object.assign(renderer, { multiplayer: owner !== "solo", localPlayerId: "local", surfaceDisplayCenters: new Map(),
      surfaceWorld: { listArenas: () => [arena], getPlayer: () => ({ arenaKey: arena.key }) }, roomSurfaceArenas: new Map([[arena.key, arena]]),
      idIndex: new Map([[privateId, 0]]), worldNodes: [node], sim: { nodes: [node] }, localTopology: { nodes: [{ id: hubId }] },
      localSurfaceGroups: new Map([[hubId, { group: root, index: 0 }]]), remoteMaps: new Map([["remote", remote]]),
      updateParkedSurfaceShip: () => {}, roomSurfaceLocalView: null });
    const state = physics.createSurfacePlayerState([0, pole, 0], [1, 0, 0]);
    Object.assign(pilot, { state: { surface: state }, arena, callbacks: { arenaCenter: value => renderer.surfaceDisplayCenter(value) },
      settings: { surfaceHeadBob: false }, camera: new THREE.PerspectiveCamera(), viewModel: new THREE.Group(), recoil: 0,
      audio: { updateListener: () => {} } });
    for (const key of ["center", "up", "right", "look", "cameraUp", "point"]) pilot[key] = new THREE.Vector3();
    const immutableState = structuredClone(state), geometry = root.children.map(child => child.uuid);
    for (let frame = 1; frame <= 90; frame++) {
      node.x += frame % 3 + 1; node.y += frame % 2 ? 0.5 : -0.3; node.z -= 0.25;
      remote.current.set([node.x, node.y, node.z]);
      if (frame % 6 === 0) arena.center = [node.x - 2, node.y, node.z]; // Delayed authoritative center.
      renderer.resolveSurfaceDisplayFrames(); pilot.updateView([1 / 30, 1 / 60, 1 / 144][frame % 3]);
      const center = owner === "remote" ? Array.from(remote.current) : [node.x, node.y, node.z];
      assert.ok(root.position.distanceTo(new THREE.Vector3(...center)) < 1e-9);
      assert.equal(renderer.surfacePlanetMesh(arena)?.parent, root, "occupied detail protection and ground sampling select the displayed group");
      const pose = viewModule.surfaceViewPose(state), expectedEye = new THREE.Vector3(...viewModule.surfaceToWorld(pose.eye, center));
      assert.ok(pilot.camera.position.distanceTo(expectedEye) < 1e-9, `${owner}/${pole} frame ${frame}`);
      assert.ok(pilot.viewModel.position.distanceTo(expectedEye) < 1e-9);
      assert.deepEqual(renderer.surfaceScenePosition([0, pole * 27, 0], arena), viewModule.surfaceToWorld([0, pole * 27, 0], center));
      assert.deepEqual(state, immutableState, "graph translation cannot change gravity or player state");
      assert.deepEqual(root.children.map(child => child.uuid), geometry, "movement does not rebuild geometry");
    }
    if (owner === "remote") { remote.initialized = false; const held = [...root.position.toArray()]; renderer.resolveSurfaceDisplayFrames(); assert.deepEqual(renderer.surfaceDisplayCenter(arena), held); }
    renderer.disposeSurfaceGroup(root);
  }
});

test("surface HUD and vent audio use host deadlines despite client wall-clock skew", () => {
  for (const offset of [-3_600_000, 3_600_000]) {
    const hostNow = Date.now() + offset, sounds = [], pilot = Object.create(SurfacePilot.prototype);
    const state = { id: "pilot", lifeId: 1, mode: "surface", arenaKey: "arena", surface: physics.createSurfacePlayerState([0, 1, 0], [0, 0, -1]), health: 100, armor: 0, heat: 100, ventUntil: hostNow + 1500, protectedUntil: hostNow + 2500, respawnAt: 0, exitProgress: 0, kills: 0 };
    Object.assign(pilot, { state, callbacks: { hostTime: () => hostNow }, settings: { surfaceInteractKey: "KeyF", surfaceCrouchKey: "KeyC", surfaceLeanLeftKey: "KeyQ", surfaceLeanRightKey: "KeyE" },
      audio: { play: sound => sounds.push(sound) }, updatePoleCompass: () => {}, updateEnemyCue: () => {} });
    for (const key of ["healthText", "armorText", "healthFill", "armorFill", "heatText", "heatFill", "stanceStatus", "connectionStatus", "hitMarker", "damageIndicator", "prompt"]) pilot[key] = { style: {} };
    pilot.updateHud();
    assert.equal(pilot.heatText.textContent, "VENT 1.5s");
    assert.match(pilot.prompt.textContent, /Protected 3s/);
    pilot.state = { ...state, health: 0, respawnAt: hostNow + 4500 };
    pilot.updateHud(); assert.equal(pilot.prompt.textContent, "Respawn in 5s");
    Object.assign(pilot, { active: true, playerId: "pilot", state: { ...state, ventUntil: 0 }, updateHud: () => {}, updateView: () => {} });
    pilot.applyAuthoritativeState(state, { key: "arena" });
    assert.deepEqual(sounds, ["vent"]);
  }
  const renderer = Object.create(rendering.ConstellationRenderer.prototype), localNow = Date.now();
  Object.assign(renderer, { multiplayer: true, roomSurfaceReceivedAt: localNow - 250, roomSurfaceHostTime: localNow + 3_600_000, roomSurfaceRepresentedTime: localNow + 3_599_925 });
  assert.ok(Math.abs(renderer.currentSurfaceHostTime() - (localNow + 3_600_250)) < 100);
  assert.equal(renderer.currentSurfaceViewTime(), localNow + 3_599_925, "fire still uses the represented view, not the HUD clock");
});

test("delayed combat feedback retains its original lifetime and duplicate snapshots cannot restart it", () => {
  const pilot = Object.create(SurfacePilot.prototype), sounds = [], shown = [], now = Date.now();
  Object.assign(pilot, { active: true, playerId: "pilot", seenCombatEvents: new Set(), hitMarkerUntil: 0, audio: { play: sound => sounds.push(sound) }, updateHud: () => {}, showDamageCue: cue => shown.push(cue.id) });
  const hit = (id, age) => ({ id, ownerId: "pilot", targetId: "target", sequence: 1, at: 10_000 - age });
  const damage = (id, age) => ({ id, targetId: "pilot", at: 10_000 - age, direction: [1, 0, 0] });
  const hits = [hit("old", 1000), hit("fresh", 50)], cues = [damage("expired", 1200), damage("recent", 250)];
  pilot.applyCombatEvents(cues, hits, "pilot", 10_000);
  assert.deepEqual(sounds, ["hit"]); assert.deepEqual(shown, ["recent"]);
  assert.ok(pilot.hitMarkerUntil >= now + 400 && pilot.hitMarkerUntil <= Date.now() + 400);
  const expires = pilot.hitMarkerUntil;
  pilot.applyCombatEvents(cues, hits, "pilot", 10_050);
  assert.equal(pilot.hitMarkerUntil, expires); assert.deepEqual(sounds, ["hit"]); assert.deepEqual(shown, ["recent"]);
});

test("replicated damage plays once from its confirmed cue, not again from health and armor deltas", () => {
  const renderer = Object.create(rendering.ConstellationRenderer.prototype), sounds = [];
  const state = physics.createSurfacePlayerState([0, 1, 0], [0, 0, -1]);
  const before = { id: "remote", mode: "surface", arenaKey: "arena", lifeId: 1, surface: state, health: 100, armor: 5, kills: 0, ventUntil: 0 };
  const after = { ...before, health: 95, armor: 0 };
  Object.assign(renderer, { localPlayerId: "local", remoteSurfaceAudioEvents: new Set(), remoteSurfaceAudioStates: new Map(),
    roomSurfacePlayers: new Map([[after.id, after]]), roomSurfaceArenas: new Map([["arena", { center: [100, -20, 50] }]]),
    surfaceAudio: { play: (kind, position) => sounds.push({ kind, position }) } });
  const cues = [{ id: "hit", targetId: "remote", at: 10000, direction: [1, 0, 0] },
    { id: "local-hit", targetId: "local", at: 10000, direction: [1, 0, 0] },
    { id: "expired", targetId: "remote", at: 8800, direction: [1, 0, 0] }];
  renderer.updateRemoteSurfaceAudio(new Map([[before.id, before]]), [after], 10000, 10000, cues);
  assert.deepEqual(sounds, [{ kind: "damage", position: [100, -14, 50] }], "one positional effect for the one fresh remote hit");
  renderer.updateRemoteSurfaceAudio(new Map([[after.id, after]]), [after], 10050, 10050, cues);
  assert.equal(sounds.length, 1, "repeated snapshots do not replay damage");
  sounds.length = 0;
  renderer.remoteSurfaceAudioEvents.clear();
  renderer.updateRemoteSurfaceAudio(new Map([[before.id, before]]), [after], 10060, 10060);
  assert.equal(sounds.length, 0, "resource reconciliation alone cannot duplicate a later confirmed effect");
  renderer.updateRemoteSurfaceAudio(new Map([[after.id, after]]), [after], 10070, 10070, cues);
  assert.equal(sounds.length, 1, "a fresh delayed confirmation plays once without requiring another HP change");
  renderer.roomSurfacePlayers.set(after.id, { ...after, mode: "ship", arenaKey: null, surface: null });
  renderer.updateRemoteSurfaceAudio(new Map(), [], 10100, 10100, [{ ...cues[0], id: "after-exit" }]);
  assert.equal(sounds.length, 1, "an evacuated body cannot emit surface damage audio");
});

test("an offset pistol zeroed to the reticle hits centered bodies at arena fighting distances and still respects cover", () => {
  for (const crouched of [false, true]) for (const lean of [-0.35, 0, 0.35]) for (const distance of [3, 5, 10, 15]) {
    const shooter = { ...physics.createSurfacePlayerState([0, 1, 0], [0, 0, -1]), crouched, lean };
    const normal = new THREE.Vector3(0, Math.cos(distance / 27), -Math.sin(distance / 27));
    const target = { ...physics.createSurfacePlayerState(normal.toArray(), [0, 0, -1]), crouched };
    const center = new THREE.Vector3(...target.position).addScaledVector(normal, crouched ? 0.7 : 1.1);
    for (let i = 0; i < 6; i++) {
      const pose = viewModule.surfaceViewPose(shooter), aim = center.clone().sub(new THREE.Vector3(...pose.eye)).normalize();
      shooter.pitch = Math.asin(aim.y); shooter.forward = aim.clone().projectOnPlane(new THREE.Vector3(0, 1, 0)).normalize().toArray();
    }
    const pose = viewModule.surfaceViewPose(shooter), targets = [{ id: "target", state: target, health: 100, protected: false }];
    const end = (start, direction) => new THREE.Vector3(...start).addScaledVector(new THREE.Vector3(...direction), 30).toArray();
    const eyeHit = combat.traceSurfaceSegment(pose.eye, end(pose.eye, pose.look), [], targets);
    const direction = viewModule.surfaceBlasterDirection(shooter), muzzleEnd = end(pose.muzzle, direction);
    const hit = combat.traceSurfaceSegment(pose.muzzle, muzzleEnd, [], targets);
    if (eyeHit?.kind === "player") assert.equal(hit?.kind, "player", `${distance}u crouched=${crouched} lean=${lean}`);
    else assert.notEqual(hit?.kind, "player", "zeroing cannot turn a hidden target into a planet-penetrating shot");
    if (!crouched && lean === 0 && distance === 5) {
      const oldMuzzle = new THREE.Vector3(0.32, -0.235, -0.985).applyQuaternion(new THREE.Quaternion(...pose.rotation)).add(new THREE.Vector3(...pose.eye)).toArray();
      assert.notEqual(combat.traceSurfaceSegment(oldMuzzle, end(oldMuzzle, pose.look), [], targets)?.kind, "player", "the former parallel muzzle ray misses a centered body");
      const wall = { id: "wall-0", normal: [0, Math.cos(2 / 27), -Math.sin(2 / 27)], tangent: [1, 0, 0], height: 2.2, length: 5 };
      assert.equal(combat.traceSurfaceSegment(pose.muzzle, muzzleEnd, [wall], targets)?.kind, "wall");
    }
  }
});

test("solo main-node meshes and docking eligibility do not depend on a multiplayer topology", () => {
  const renderer = Object.create(rendering.ConstellationRenderer.prototype);
  const nodes = [
    { id: "A/Main.md", group: "A", gi: 0, deg: 4, index: 0 },
    { id: "A/Leaf.md", group: "A", gi: 0, deg: 1, index: 1 },
    { id: "B/Main.md", group: "B", gi: 1, deg: 0, index: 2 },
  ];
  Object.assign(renderer, { multiplayer: false, localTopology: null, localSurfaceGroups: new Map(), scene: new THREE.Scene(), sim: { nodes, srcs: [nodes[0]], dsts: [nodes[1]] } });
  renderer.rebuildLocalSurfaceVisuals();
  assert.deepEqual([...renderer.localSurfaceGroups.keys()], ["A/Main.md", "B/Main.md"]);
  assert.equal(renderer.localSurfaceGroups.get("A/Main.md").group.userData.arenaSeed, surface.generateSurfaceArena("A/Main.md", ["A/Leaf.md"]).seed);
  assert.deepEqual(renderer.soloSurfaceTopology().nodes.map(node => node.dockable), [true, false, true]);
  renderer.multiplayer = true;
  renderer.localTopology = { nodes: [{ id: "anonymous-leaf", dockable: false }, { id: "anonymous-main", dockable: true }], links: [["anonymous-leaf", "anonymous-main"]] };
  renderer.rebuildLocalSurfaceVisuals();
  assert.deepEqual([...renderer.localSurfaceGroups.keys()], ["anonymous-main"], "room geometry keeps anonymous identities and host-published eligibility");
  for (const entry of renderer.localSurfaceGroups.values()) renderer.disposeSurfaceGroup(entry.group);
});

test("complete fresh-room startup republishes topology and docks on the first request", async () => {
  const renderer = Object.create(rendering.ConstellationRenderer.prototype), requests = [];
  const owner = "11111111-1111-4111-8111-111111111111", hub = "n-33333333-3333-4333-8333-333333333333";
  const nodes = [{ id: "Private/Main.md", gi: 0, deg: 0, index: 0, x: 0, y: 0, z: 0 }];
  Object.assign(renderer, { multiplayer: false, localPlayerId: "", localTopology: null, localSurfaceGroups: new Map(), scene: new THREE.Scene(),
    sim: { nodes, srcs: [], dsts: [] }, worldNodes: nodes, settings: {}, cb: { onSurfaceDock: target => requests.push(target), onPilot() {} },
    pilot: { active: true, shipSnapshot: () => identityShip([0, 0, 12]), setOptions() {}, showDockMessage() {} }, surfacePilot: { active: false },
    remoteMaps: new Map(), remoteShips: new Map(), container: { classList: { toggle() {} } },
    setHover() {}, setSelected() {}, applyMapTransform() {}, refreshWorldNodes() {},
  });
  // ConstellationApp.onMembers publishes topology before switching game mode.
  renderer.setLocalTopology(owner, { revision: 1, nodes: [{ id: hub, dockable: true }], links: [] });
  renderer.setMultiplayer(true);
  renderer.requestSurfaceDock(null, -1);
  assert.deepEqual(requests, [{ ownerId: owner, starId: hub, revision: 1 }]);
  assert.deepEqual([...renderer.localSurfaceGroups.keys()], [hub]);

  // Continue through actual host validation and snapshot presentation. Only
  // GPU/audio/DOM effects are stubbed; room admission and controller switching run.
  const dockResults = [], world = new roomCombat.CombatWorld(1), surfaceHost = new authority.SurfaceAuthority({ terrain: true });
  const data = { groups: [{ key: "g", color: "#123456", count: 1 }], nodes: [{ id: nodes[0].id, name: "Private", group: "g", deg: 0 }], links: [] };
  const host = new roomNetwork.MultiplayerSession({ surfaceDockResult: (...args) => dockResults.push(args),
    localTopology: (id, topology) => renderer.setLocalTopology(id, topology),
    surfaceState: (snapshot, now, rtt) => renderer.setSurfaceSnapshot(snapshot, now, rtt) }, () => ({ nodes, data: {} }));
  Object.assign(host, { selfId: owner, hostId: owner, epoch: 1, authorityReady: true, world, surfaceAuthority: surfaceHost, surfaceRoundId: world.currentRoundId,
    topology: renderer.localTopology, roster: [{ id: owner, name: "Host", slot: 0 }] });
  world.add(host.roster[0]); world.players.get(owner).active = true; world.players.get(owner).pos.set(0, 0, 12);
  surfaceHost.addPlayer(owner, identityShip([0, 0, 12]));
  surfaceHost.setOwnerMap(owner, { ...renderer.localTopology, nodes: [{ id: hub, group: 0, degree: 0, dockable: true }] }, new Float32Array([0, 0, 0]));
  // The room transport and initial onMembers transition are already represented
  // above. Exercise the real post-create application path that the old test omitted.
  Object.assign(host, { revision: 1, ids: new Map([[nodes[0].id, hub]]), roomCode: "ABCD1234", graph: () => ({ nodes, data }), create: async () => {} });
  const app = Object.create(ConstellationApp.prototype);
  Object.assign(app, { network: host, renderer, data, flat: false, updateRoomServiceInfo() {},
    multiplayerConsent: { checked: true }, multiplayerName: { value: "Host" }, multiplayerCode: { value: "" },
    multiplayerStatus: { textContent: "", classList: { remove() {}, add() {} } }, host: {}, pilotProfile: () => ({}) });
  await app.startRoom("create");
  assert.equal(host.localTopology.revision, 2);
  assert.equal(renderer.localTopology, host.localTopology, "renderer receives the actual post-create publication");
  let entered = 0, returned = 0;
  Object.assign(renderer, { roomSurfaceEpoch: 0, roomSurfaceSnapshotSequence: 0, roomSurfacePlayers: new Map(), roomSurfaceBotShots: [], roomCoverMotion: new Map(),
    roomSurfaceHistory: new history.SurfaceHistory(), surfacePrediction: new surfaceInput.SurfacePrediction(), networkSurfaceBolts: new Map(),
    controls: {}, parkedNormal: new THREE.Vector3(), parkedRotation: new THREE.Quaternion(), surfaceDisplayCenters: new Map(),
    applyRoomCover: arena => arena, synchronizeSurfaceArenaVisual() {}, syncSurfaceBotVisuals() {}, updateRemoteSurfaceAudio() {},
    createParkedSurfaceShip() {}, placeLocalParkedSurfaceShip() {}, removeParkedSurfaceShip() {},
  });
  Object.assign(renderer.surfacePilot, { clearHeldInputs() {}, applyCombatEvents() {},
    enter(id, player, arena) { assert.equal(id, owner); assert.equal(arena.key, player.arenaKey); this.active = true; entered++; },
    completeExit(ship) { this.active = false; renderer.pilot.active = true; returned++; assert.ok(ship.position.every(Number.isFinite)); },
  });
  renderer.pilot.exit = () => { renderer.pilot.active = false; };
  renderer.cb.onSurfaceDock = target => host.requestSurfaceDock(target);
  renderer.requestSurfaceDock(null, -1); host.publishSurfaceState(Date.now());
  assert.deepEqual(dockResults, [[1, true, undefined]]); assert.equal(entered, 1); assert.equal(renderer.surfacePilot.active, true);
  assert.equal(host.pendingSurfaceDock, null); assert.equal(renderer.controls.enabled, false);
  const now = Date.now(), controls = { ...surfaceInput.neutralSurfaceInput(), interact: true };
  const local = surfaceHost.world.players.get(owner), arena = surfaceHost.world.getArena(local.arenaKey);
  local.surface = physics.createSurfacePlayerState([0, 1, 0], [1, 0, 0], arena.arena.radius, arena.arena.terrain);
  for (let tick = 1; tick <= 120; tick++) {
    const at = now + Math.round(tick * 1000 / 60);
    assert.equal(surfaceHost.setInput(owner, tick, controls, at), true);
    host.stepSurfaceAuthority(1 / 60, at);
  }
  host.publishSurfaceState(now + 2000);
  assert.equal(returned, 1); assert.equal(world.isSurfaceDocked(owner), false); assert.equal(renderer.pilot.active, true);
  for (const entry of renderer.localSurfaceGroups.values()) renderer.disposeSurfaceGroup(entry.group);
});

test("J docks solo on an off-center planet surface without a sprite selection, preserving admission limits", () => {
  const renderer = Object.create(rendering.ConstellationRenderer.prototype), world = new worldModule.SurfaceWorld();
  const nodes = [{ id: "Main.md", gi: 0, deg: 2, index: 0, x: 100, y: -20, z: 50 }, { id: "Leaf.md", gi: 0, deg: 1, index: 1, x: 105, y: -20, z: 55 }];
  let ship = identityShip([105, -20, 62]), entered = 0, parked = 0;
  const messages = [];
  Object.assign(renderer, {
    multiplayer: false, sim: { nodes, srcs: [nodes[0]], dsts: [nodes[1]] }, surfaceTopologyRevision: 1,
    localSurfaceGroups: new Map([["Main.md", { index: 0 }]]), surfaceWorld: world,
    pilot: { active: true, shipSnapshot: () => ship, exit: () => {}, showDockMessage: () => {} },
    surfacePilot: { active: false, enter: () => entered++ }, cb: { onPilot: (_active, message) => messages.push(message) },
    parkedNormal: new THREE.Vector3(), parkedRotation: new THREE.Quaternion(), controls: {},
    createParkedSurfaceShip: () => parked++, createTrainingDummy: () => {}, synchronizeSurfaceArenaVisual: () => {},
  });
  ship.velocity = [11, 0, 0]; renderer.requestSurfaceDock(null, -1);
  assert.equal(entered, 0, "speed gate is still enforced");
  ship = identityShip([105, -20, 70]); renderer.requestSurfaceDock(null, -1);
  assert.equal(entered, 0, "surface range gate is still enforced");
  ship = identityShip([107, -20, 62]); renderer.requestSurfaceDock(null, 0);
  assert.equal(entered, 0, "a stale sprite selection cannot dock when the nose misses the sphere");
  ship = identityShip([105, -20, 62]); renderer.requestSurfaceDock(null, -1);
  assert.equal(entered, 1); assert.equal(parked, 1);
  assert.equal(world.getPlayer("solo").mode, "surface");
  assert.equal(world.getPlayer("solo").arenaKey, "solo/Main.md", "ordinary node in front of the hub is never selected for docking");
});

test("room docking picks the nearest anonymous main sphere from the ship pose", () => {
  const renderer = Object.create(rendering.ConstellationRenderer.prototype), requests = [];
  const remote = { initialized: true, playerId: "remote", revision: 7, topology: { nodes: [{ id: "leaf", dockable: false }, { id: "hub", dockable: true }] }, current: new Float32Array([5, 0, 10, 0, 0, 0]) };
  Object.assign(renderer, {
    multiplayer: true, localPlayerId: "self", localTopology: { revision: 2, nodes: [{ id: "own-hub", dockable: true }] },
    localSurfaceGroups: new Map([["own-hub", { index: 0 }]]), worldNodes: [{ x: 0, y: 0, z: -20 }], remoteMaps: new Map([["remote", remote]]),
    pilot: { active: true, shipSnapshot: () => identityShip([5, 0, 12]) }, surfacePilot: { active: false },
    cb: { onSurfaceDock: target => requests.push(target), onPilot: () => {} },
  });
  renderer.requestSurfaceDock(null, -1);
  assert.deepEqual(requests, [{ ownerId: "remote", starId: "hub", revision: 7 }]);
  remote.topology.nodes[1].dockable = false;
  renderer.requestSurfaceDock(null, -1);
  assert.deepEqual(requests[1], { ownerId: "self", starId: "own-hub", revision: 2 });
});

test("renderer and network fixture share bounded represented time without cross-life, cross-arena, or dead-target timestamp contamination", () => {
  const ring = new history.SurfaceHistory(), state = physics.createSurfacePlayerState([0, 1, 0], [0, 0, -1]);
  const player = (id, arenaKey = "arena", health = 100) => ({ id, arenaKey, health, mode: "surface", lifeId: 1, surface: state });
  const record = (id, at, arenaKey = "arena") => ring.record({ playerId: id, arenaKey, arenaRevision: 1, lifeId: 1, at, state, protected: false });
  const arenas = new Map([["arena", { key: "arena", revision: 1 }], ["other", { key: "other", revision: 1 }]]);
  record("target", 1000); record("target", 1050); record("elsewhere", 800, "other"); record("dead", 800);
  let displayed = presentation.presentSurfacePlayers(ring, [player("self"), player("target"), player("elsewhere", "other"), player("dead", "arena", 0)], arenas, "self", "arena", 1100, 1050);
  assert.equal(displayed.representedAt, 1025); assert.equal(displayed.exhausted, false);
  assert.equal(displayed.samples.length, 3, "other arenas and corpses may render without changing the local firing time");
  displayed = presentation.presentSurfacePlayers(ring, [player("target")], arenas, "self", "arena", 1400, 1050);
  assert.equal(displayed.representedAt, 1100, "a missing update cannot extrapolate beyond the latest pose plus 50 ms");
  assert.equal(displayed.exhausted, true);
  record("slower", 1020);
  displayed = presentation.presentSurfacePlayers(ring, [player("target"), player("slower")], arenas, "self", "arena", 1400, 1050);
  assert.equal(displayed.representedAt, 1070, "firing uses the oldest represented living opponent in this arena");
  assert.equal(presentation.presentSurfacePlayers(ring, [{ ...player("target"), lifeId: 2 }], arenas, "self", "arena", 1400, 1050).representedAt, 1050);
  arenas.set("arena", { key: "arena", revision: 2 });
  assert.equal(presentation.presentSurfacePlayers(ring, [player("target")], arenas, "self", "arena", 1400, 1050).samples.length, 0);
});

test("migration retains pickup timers from more than four visited arenas and omits expired idle state", () => {
  const room = new authority.SurfaceAuthority(), owner = "11111111-1111-4111-8111-111111111111";
  const nodes = Array.from({ length: 6 }, (_, index) => ({ id: `n-00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, group: index, degree: 0, dockable: true }));
  room.setOwnerMap(owner, { revision: 1, nodes, links: [] }, new Float32Array(nodes.length * 3));
  for (const arena of room.world.arenas.values()) Object.assign(arena.pickups[0], { available: false, respawnAt: 20000 });
  const checkpoint = room.checkpoint(10000);
  assert.equal(checkpoint.world.arenas.length, 6);
  const restored = new authority.SurfaceAuthority();
  assert.equal(restored.restoreCheckpoint(checkpoint, 11000, 1000), true);
  for (const arena of restored.world.listArenas()) {
    const pickup = restored.world.getPickups(arena.key, 11000)[0];
    assert.equal(pickup.available, false); assert.equal(pickup.respawnAt, 20000);
  }
  assert.equal(restored.checkpoint(20000).world.arenas.length, 0, "expired unoccupied arenas need no dynamic checkpoint state");
});

test("surface laser colors reject malformed input and brighten dark sRGB colors to the shared luminance floor", () => {
  for (const malformed of ["black", "#000", "#00000000", "#GG0000", "#000000;", 0, null]) {
    assert.equal(color.normalizeSurfaceLaserColor(malformed), null);
  }
  for (const input of ["#000000", "#21040F", "#7F0000", "#8cecFF", "#FFFFFF"]) {
    const normalized = color.normalizeSurfaceLaserColor(input);
    assert.match(normalized, /^#[0-9A-F]{6}$/);
    assert.ok(color.surfaceLaserLuminance(normalized) >= color.MIN_SURFACE_LASER_LUMINANCE, `${input} -> ${normalized}`);
  }
  assert.equal(color.normalizeSurfaceLaserColor("#8cecFF"), "#8CECFF");
  assert.equal(color.savedSurfaceLaserColor("not a color"), color.DEFAULT_SURFACE_LASER_COLOR);
  assert.equal(color.isApprovedSurfaceLaserColor("#FFFFFF"), true);
  assert.equal(color.isApprovedSurfaceLaserColor("#ffffff"), false);
});

test("surface rewind samples bounded same-life poses and rejects unissued, future, stale, or boundary-crossing times", () => {
  const buffer = new history.SurfaceHistory();
  const stateA = physics.createSurfacePlayerState([0, 1, 0], [0, 0, -1]);
  const stateB = { ...stateA, position: [0, 27 * Math.cos(0.1), -27 * Math.sin(0.1)], crouched: true };
  const frame = (at, state, patch = {}) => ({ playerId: "p", arenaKey: "owner/hub", lifeId: 1, at, state, protected: false, ...patch });
  assert.equal(buffer.record(frame(1000, stateA)), true);
  assert.equal(buffer.record(frame(1017, stateB)), true);
  const sampled = buffer.sample("p", 1004, "owner/hub", 1);
  assert.ok(sampled);
  assert.equal(sampled.state.crouched, false);
  assert.ok(Math.abs(Math.hypot(...sampled.state.position) - 27) < 1e-6);
  assert.equal(buffer.sample("p", 1004, "other/hub", 1), null);
  assert.equal(buffer.sample("p", 1004, "owner/hub", 2), null);

  assert.equal(buffer.record(frame(1034, stateB, { protected: true })), true);
  assert.equal(buffer.sample("p", 1025, "owner/hub", 1), null, "do not interpolate across a protection boundary");
  const issued = [900, 950, 1000];
  assert.deepEqual(history.validateSurfaceViewTime(950, 1000, issued, 0), { accepted: true, rewindMs: 50 });
  assert.deepEqual(history.validateSurfaceViewTime(975, 1000, issued, 0), { accepted: true, rewindMs: 25 }, "interpolated view times must be bracketed by issued snapshots");
  assert.deepEqual(history.validateSurfaceViewTime(900, 1100, issued, 200), { accepted: true, rewindMs: 150 });
  assert.equal(history.validateSurfaceViewTime(899, 1000, issued).accepted, false);
  assert.equal(history.validateSurfaceViewTime(1001, 1000, issued).accepted, false);
  assert.equal(history.validateSurfaceViewTime(700, 1000, [700]).accepted, false);
  assert.equal(history.validateSurfaceViewTime(975, 1000, [900, 1001]).accepted, false, "an unbracketed view time is rejected");
});

test("surface host clock uses measured RTT and rejects impossible ping samples", () => {
  const clock = new history.SurfaceHostClock();
  assert.equal(clock.observePing(1000, 1250, 1251, 1101), true);
  assert.equal(clock.roundTripMs, 100);
  assert.equal(clock.estimateHostTime(1101), 1301);
  assert.equal(clock.observePing(2000, 9000, 9001, 2100), false);
  clock.reset();
  assert.equal(clock.estimateHostTime(500), 500);
});

test("surface authority stamps validated colors, consumes sequenced heat, and publishes only bounded anonymous state", () => {
  const room = new authority.SurfaceAuthority();
  const owner = "11111111-1111-4111-8111-111111111111", pilot = "22222222-2222-4222-8222-222222222222";
  const hub = "n-33333333-3333-4333-8333-333333333333";
  room.setOwnerMap(owner, {
    revision: 1, nodes: [{ id: hub, group: 0, degree: 1, dockable: true }, { id: "n-44444444-4444-4444-8444-444444444444", group: 0, degree: 1, dockable: false }],
    links: [[hub, "n-44444444-4444-4444-8444-444444444444"]],
  }, new Float32Array([0, 0, 0, 8, 0, 0]));
  room.addPlayer(pilot, identityShip([0, 0, (surface.SURFACE.radius + 11) * 6 / surface.SURFACE.radius]));
  assert.equal(room.dock(pilot, owner, hub, 4000), true);
  assert.equal(room.setColor(pilot, "#000000"), "#959595");
  assert.equal(room.setColor(pilot, "rgba(0,0,0,0)"), null);
  const first = room.fire(pilot, 1, 10_000, [0, 0, -1], [10_000], 10_000, `${owner}/${hub}`, room.world.getPlayer(pilot).lifeId);
  assert.equal(first.accepted, true);
  assert.equal(first.projectile.color, "#959595");
  assert.equal(room.fire(pilot, 2, 10_000, [0, 0, -1], [10_000], 10_000, "other/arena", room.world.getPlayer(pilot).lifeId).reason, "state");
  assert.equal(room.fire(pilot, 1, 10_000, [0, 0, -1], [10_000], 10_000, `${owner}/${hub}`, room.world.getPlayer(pilot).lifeId).reason, "sequence");
  room.step(1 / 60, 10_017);
  const snapshot = room.snapshot(8, 1, 10_017);
  assert.equal(authority.validSurfaceNetworkSnapshot(snapshot, 8), true);
  assert.equal(authority.validSurfaceNetworkSnapshot({ ...snapshot, players: [{ ...snapshot.players[0], laserColor: "#000000" }] }, 8), false);
  const malformedPose = structuredClone(snapshot); malformedPose.players[0].surface.position = null;
  assert.equal(authority.validSurfaceNetworkSnapshot(malformedPose, 8), false, "malformed nested poses are rejected before rendering");
  const malformedWall = structuredClone(snapshot); malformedWall.arenas[0].arena.walls[0].normal = {};
  assert.equal(authority.validSurfaceNetworkSnapshot(malformedWall, 8), false, "malformed cover vectors cannot reach collision/render code");
  assert.deepEqual(snapshot.damageCues, []);
  assert.deepEqual(snapshot.hitConfirmations, []);
  assert.deepEqual(Object.keys(snapshot.players[0]).sort(), ["arenaKey", "armor", "deaths", "exitProgress", "heat", "health", "id", "inputSequence", "kills", "laserColor", "lifeId", "mode", "protectedUntil", "respawnAt", "ship", "surface", "ventUntil"].sort());
});

test("surface checkpoints preserve pickup timers, player resources, and pending arena state across elapsed time", () => {
  const world = new worldModule.SurfaceWorld(), owner = "owner", pilot = "pilot";
  world.setOwnerMap(owner, surfaceFixture(), new Float32Array([0, 0, 0, 8, 0, 0]));
  const arena = world.listArenas()[0];
  world.addPlayer(pilot, identityShip([0, 0, 38]));
  assert.equal(world.dock(pilot, arena.key, 4000), true);
  const pickupIndex = arena.arena.pickups.findIndex(pickup => pickup.kind === "small-health");
  const pickup = arena.arena.pickups[pickupIndex];
  const runtime = world.players.get(pilot);
  runtime.health = 80;
  runtime.armor = 10;
  runtime.surface.position = pickup.normal.map(component => component * surface.SURFACE.radius);
  const neutral = { moveX: 0, moveY: 0, sprint: false, jump: false, crouch: false, yawDelta: 0, pitchDelta: 0, interact: false };
  assert.equal(world.updatePlayer(pilot, neutral, 1 / 60, 10_000), "pickup");
  world.setOwnerMap(owner, surfaceFixture(2), new Float32Array([1, 0, 0, 8, 0, 0]));
  const checkpoint = world.checkpoint(10_000);
  assert.equal(checkpoint.arenas[0].pickups[pickupIndex].available, false);
  assert.equal(checkpoint.arenas[0].pickups[pickupIndex].respawnRemainingMs, 15_000);

  const restored = new worldModule.SurfaceWorld();
  restored.setOwnerMap(owner, surfaceFixture(), new Float32Array([0, 0, 0, 8, 0, 0]));
  assert.equal(restored.restoreCheckpoint(checkpoint, 20_000, 5000, true), true);
  assert.equal(restored.getPlayer(pilot).health, 100);
  assert.equal(restored.getPlayer(pilot).armor, 10);
  assert.equal(restored.getArena(arena.key).acceptingPlayers, false);
  assert.equal(restored.arenas.get(arena.key).pending.value.topologyRevision, 2, "queued topology survives migration until the arena empties");
  assert.equal(restored.arenas.get(arena.key).pickups[pickupIndex].available, false);
  restored.updatePlayer(pilot, neutral, 1 / 60, 29_999);
  assert.equal(restored.arenas.get(arena.key).pickups[pickupIndex].available, false);
  restored.updatePlayer(pilot, neutral, 1 / 60, 30_000);
  assert.equal(restored.arenas.get(arena.key).pickups[pickupIndex].available, true, "the respawn timer is reduced by checkpoint age");
});

test("surface authority checkpoints retain approved colors, resources, and live bolts while clearing old rewind history", () => {
  const room = new authority.SurfaceAuthority(), owner = "11111111-1111-4111-8111-111111111111";
  const pilot = "22222222-2222-4222-8222-222222222222", hub = "n-33333333-3333-4333-8333-333333333333";
  const topology = {
    revision: 1,
    nodes: [{ id: hub, group: 0, degree: 1, dockable: true }, { id: "n-44444444-4444-4444-8444-444444444444", group: 0, degree: 1, dockable: false }],
    links: [[hub, "n-44444444-4444-4444-8444-444444444444"]],
  };
  const positions = new Float32Array([0, 0, 0, 8, 0, 0]);
  room.setOwnerMap(owner, topology, positions);
  room.addPlayer(pilot, identityShip([0, 0, 38 * 6 / 27]));
  assert.equal(room.dock(pilot, owner, hub, 4000), true);
  assert.equal(room.setColor(pilot, "#21040F"), "#979595");
  const input = { moveX: 0, moveY: 0, sprint: false, jump: false, crouch: false, yawDelta: 0, pitchDelta: 0, lean: 0, interact: false };
  assert.equal(room.setInput(pilot, 4, input), true);
  const key = `${owner}/${hub}`, lifeId = room.world.getPlayer(pilot).lifeId;
  assert.equal(room.fire(pilot, 1, 10_000, [0, 0, -1], [10_000], 10_000, key, lifeId).accepted, true);
  room.step(1 / 60, 10_017);
  const checkpoint = room.checkpoint(10_017);
  const restored = new authority.SurfaceAuthority();
  restored.setOwnerMap(owner, topology, positions);
  assert.equal(restored.restoreCheckpoint(checkpoint, 10_100, 50), true);
  const snapshot = restored.snapshot(9, 1, 10_100);
  assert.equal(snapshot.players[0].laserColor, "#979595");
  assert.equal(snapshot.players[0].heat, 7);
  assert.equal(snapshot.projectiles.length, 1);
  assert.equal(snapshot.projectiles[0].color, "#979595");
  assert.equal(snapshot.projectiles[0].startedAt, 10_033, "bolt age includes time elapsed since the checkpoint");
  assert.equal(restored.setInput(pilot, 4, input), false, "checkpointed input sequences cannot be replayed");
  assert.equal(restored.setInput(pilot, 5, input), true);
  assert.equal(restored.fire(pilot, 1, 10_100, [0, 0, -1], [10_100], 10_100, key, lifeId).reason, "sequence");
  assert.equal(restored.history.earliest(pilot), null, "host transfer starts without old-epoch rewind frames");

  const malformed = structuredClone(checkpoint);
  malformed.colors[0][1] = "#000000";
  assert.equal(new authority.SurfaceAuthority().restoreCheckpoint(malformed, 10_100, 0), false, "checkpoint colors are revalidated");
});

test("main node selection chooses one highest-degree node per group and breaks ties by local path", () => {
  const selected = surface.selectMainNodeIds([
    { id: "zeta.md", group: "A", deg: 3 }, { id: "beta.md", group: "A", deg: 4 }, { id: "alpha.md", group: "A", deg: 4 },
    { id: "unrelated.md", group: "B", deg: 0 }, { id: "gamma.md", group: "B", deg: 9 },
  ]);
  assert.deepEqual([...selected].sort(), ["alpha.md", "gamma.md"]);
});

test("surface dimensions and spherical horizon leave the planned close-quarters scale internally consistent", () => {
  const { radius, standingEyeHeight, poleClearance, jumpHeight, lowWallHeight } = surface.SURFACE;
  assert.equal(radius, 27);
  assert.ok(Math.abs(Math.sqrt(2 * radius * standingEyeHeight + standingEyeHeight ** 2) * 2 - 19.1648) < 0.001);
  assert.ok(jumpHeight < lowWallHeight, "a standing jump intentionally cannot clear a crouch-height wall");
  assert.ok(poleClearance > surface.SURFACE.playerRadius);
});

test("ray tracing measures the spherical line-of-sight limits for standing, crouched, and jumping players", () => {
  const radius = surface.SURFACE.radius;
  const visible = (angle, fromHeight, toHeight) => {
    const start = [0, radius + fromHeight, 0];
    const end = [(radius + toHeight) * Math.sin(angle), (radius + toHeight) * Math.cos(angle), 0];
    return combat.traceSurfaceSegment(start, end, [], []) === null;
  };
  const maximumAngle = (fromHeight, toHeight) => {
    let low = 0, high = Math.PI / 2;
    for (let iteration = 0; iteration < 50; iteration++) {
      const middle = (low + high) / 2;
      if (visible(middle, fromHeight, toHeight)) low = middle; else high = middle;
    }
    return low;
  };
  const range = (fromHeight, toHeight) => {
    const angle = maximumAngle(fromHeight, toHeight);
    const start = [0, radius + fromHeight, 0];
    const end = [(radius + toHeight) * Math.sin(angle), (radius + toHeight) * Math.cos(angle), 0];
    return { surface: radius * angle, straight: Math.hypot(...start.map((value, axis) => value - end[axis])) };
  };

  const standing = range(surface.SURFACE.standingEyeHeight, surface.SURFACE.standingEyeHeight);
  const crouched = range(surface.SURFACE.crouchedEyeHeight, surface.SURFACE.crouchedEyeHeight);
  const jumping = range(surface.SURFACE.standingEyeHeight + surface.SURFACE.jumpHeight, surface.SURFACE.standingEyeHeight + surface.SURFACE.jumpHeight);
  const partial = range(surface.SURFACE.standingEyeHeight, surface.SURFACE.standingEyeHeight + surface.SURFACE.jumpHeight);
  const expectedStandingChord = 2 * Math.sqrt(2 * radius * surface.SURFACE.standingEyeHeight + surface.SURFACE.standingEyeHeight ** 2);
  assert.ok(Math.abs(standing.straight - expectedStandingChord) < 0.02, `standing eye-to-eye ray limit was ${standing.straight}`);
  assert.ok(Math.abs(standing.straight - 19.16) < 0.05);
  assert.ok(crouched.surface < standing.surface, "crouching shortens the unobstructed surface arc");
  assert.ok(jumping.surface > standing.surface, "jumping raises both eyes and extends sight over the horizon");
  assert.ok(partial.surface > standing.surface && partial.surface < jumping.surface, "a raised target can be seen before its feet clear the horizon");
});

test("arena walls and pickups are repeatable when anonymous connection order changes", () => {
  const first = surface.generateSurfaceArena("hub-1", ["neighbor-c", "neighbor-a", "neighbor-b", "neighbor-a"]);
  const second = surface.generateSurfaceArena("hub-1", ["neighbor-b", "neighbor-a", "neighbor-c"]);
  assert.deepEqual(first, second);
  assert.equal(first.seed, second.seed);
  assert.equal(first.walls.length, 6);
  assert.deepEqual(first.pickups.map(pickup => pickup.kind), ["small-health", "small-health", "large-health", "large-health", "armor", "armor"]);
});

test("arena wall count follows unique connected files without a wall cap", () => {
  assert.equal(surface.generateSurfaceArena("hub", []).walls.length, 0);
  assert.equal(surface.generateSurfaceArena("hub", Array.from({ length: 7 }, (_, i) => `n-${i}`)).walls.length, 14);
  assert.equal(surface.generateSurfaceArena("hub", Array.from({ length: 25 }, (_, i) => `n-${i}`)).walls.length, 50);
});

test("walls and pickups stay outside pole clearances and pickup risk classes match their placements", () => {
  const arena = surface.generateSurfaceArena("hub", Array.from({ length: 12 }, (_, i) => `n-${i}`));
  const { radius, poleClearance } = surface.SURFACE;
  const poleBoundary = Math.cos(poleClearance / radius);
  const distance = (a, b) => radius * Math.acos(Math.max(-1, Math.min(1, a.reduce((sum, value, i) => sum + value * b[i], 0))));
  for (const item of [...arena.walls, ...arena.pickups]) assert.ok(Math.abs(item.normal[1]) <= poleBoundary + 1e-6);
  assert.equal(arena.pickups.filter(item => item.placement === "cover").length, 3);
  assert.equal(arena.pickups.filter(item => item.placement === "open").length, 3);
  for (const pickup of arena.pickups) {
    const nearestWall = Math.min(...arena.walls.map(wall => Math.max(0, distance(wall.normal, pickup.normal) - wall.length / 2)));
    if (pickup.placement === "cover") assert.ok(nearestWall >= 0.8 && nearestWall <= 4.0);
    else assert.ok(nearestWall >= 7.5);
  }
});

test("different anonymous graph connections produce distinct arena seeds", () => {
  const a = surface.generateSurfaceArena("hub-1", ["neighbor-a", "neighbor-b"]);
  const b = surface.generateSurfaceArena("hub-1", ["neighbor-a", "neighbor-c"]);
  assert.notEqual(a.seed, b.seed);
  assert.notDeepEqual(a, b);
});

test("pickup generation remains deterministic, separated and accessible across sparse and dense anonymous graphs", () => {
  for (let seed = 0; seed < 64; seed++) for (const degree of [0, 7, 16]) {
    const connections = Array.from({ length: degree }, (_, index) => `n-${seed}-${index}`);
    const arena = surface.generateSurfaceArena(`hub-${seed}`, connections);
    assert.deepEqual(surface.generateSurfaceArena(`hub-${seed}`, [...connections].reverse()), arena);
    assert.equal(arena.pickups.length, 6);
    for (let index = 0; index < arena.pickups.length; index++) {
      const pickup = arena.pickups[index], normal = new THREE.Vector3(...pickup.normal).normalize();
      assert.ok(Math.acos(Math.abs(normal.y)) * 27 >= 6 - 0.001, "pickup stays clear of preferred spawns");
      assert.equal(physics.surfacePoseClear(normal.clone().multiplyScalar(27).toArray(), 1.8, arena.walls), true, `standing player can reach ${seed}/${degree}/${pickup.id}`);
      for (const other of arena.pickups.slice(0, index)) {
        const distance = normal.angleTo(new THREE.Vector3(...other.normal).normalize()) * 27;
        assert.ok(distance >= 2.5 - 0.001, "collection areas do not overlap");
      }
      const nearestWall = Math.min(...arena.walls.map(wall => Math.max(0, normal.angleTo(new THREE.Vector3(...wall.normal).normalize()) * 27 - wall.length / 2)));
      assert.ok(pickup.placement === "cover" ? nearestWall >= 0.8 - 0.001 && nearestWall <= 4 + 0.001 : nearestWall >= 7.5 - 0.001);
    }
  }
});

test("surface bolts hit targets only when they are the earliest unobstructed collision", () => {
  const state = physics.createSurfacePlayerState([0, 1, 0], [0, 0, -1]);
  const target = { id: "target", state, health: 100, protected: false };
  const start = [0, 30, 0], end = [0, 26, 0];
  assert.equal(combat.traceSurfaceSegment(start, end, [], [target]).kind, "player");
  const wall = { id: "wall", normal: [0, 1, 0], tangent: [1, 0, 0], height: 2.2, length: 3.5 };
  assert.equal(combat.traceSurfaceSegment(start, end, [wall], [target]).kind, "wall");
  assert.equal(combat.traceSurfaceSegment(start, end, [], [{ ...target, protected: true }]).kind, "planet");
});

test("surface pistol time-to-kill matches heat, cadence, armor spillover, and shot-15 vent", () => {
  assert.equal(combat.surfaceShotsToKill(100, 0), 10);
  assert.equal(combat.surfaceTimeToKillMs(100, 0), 1800);
  assert.equal(combat.surfaceShotsToKill(100, 50), 15);
  assert.equal(combat.surfaceTimeToKillMs(100, 50), 2800);

  const world = new worldModule.SurfaceWorld();
  world.setOwnerMap("owner", surfaceFixture(), new Float32Array([0, 0, 0, 8, 0, 0]));
  world.addPlayer("pilot", identityShip([0, 0, 38]));
  assert.equal(world.dock("pilot", world.listArenas()[0].key, 4000), true);
  let last;
  for (let sequence = 1; sequence <= 15; sequence++) {
    last = world.tryFire("pilot", sequence, 10_000 + (sequence - 1) * 200);
    if (sequence === 10) { assert.equal(last.heat,70); assert.equal(last.ventUntil,0); }
    if (sequence === 14) { assert.equal(last.heat,98); assert.equal(last.ventUntil,0); }
  }
  assert.equal(last.accepted, true, "the fifteenth shot fires before venting");
  assert.equal(last.heat, 100);
  assert.equal(last.ventUntil, 14_800);
  assert.equal(world.tryFire("pilot", 16, 13_000).accepted, false);
  assert.equal(world.getPlayer("pilot").heat, 100);
});

test("spherical walking stays on the surface and has stable speed at common update rates", () => {
  const run = fps => {
    let state = physics.createSurfacePlayerState();
    const input = { moveX: 0, moveY: 1, sprint: false, jump: false, crouch: false, yawDelta: 0, pitchDelta: 0 };
    for (let i = 0; i < fps; i++) state = physics.stepSurfacePlayer(state, input, 1 / fps);
    return { travel: 27 * Math.acos(Math.max(-1, Math.min(1, state.position[1] / 27))), radius: Math.hypot(...state.position), state };
  };
  const results = [30, 60, 144].map(run);
  assert.ok(results.every(result => Math.abs(result.radius - 27) < 1e-6));
  assert.ok(results.every(result => result.travel > 3.8 && result.travel < 4.7), results.map(result => result.travel).join(", "));
  assert.ok(Math.max(...results.map(result => result.travel)) - Math.min(...results.map(result => result.travel)) < 0.35);
});

test("jump follows radial gravity and lands back on the spherical surface", () => {
  let state = physics.createSurfacePlayerState();
  const input = { moveX: 0, moveY: 0, sprint: false, jump: false, crouch: false, yawDelta: 0, pitchDelta: 0 };
  let peak = 0;
  state = physics.stepSurfacePlayer(state, { ...input, jump: true }, 1 / 60);
  for (let i = 0; i < 120; i++) {
    state = physics.stepSurfacePlayer(state, input, 1 / 60);
    peak = Math.max(peak, Math.hypot(...state.position) - surface.SURFACE.radius);
  }
  assert.ok(Math.abs(peak - surface.SURFACE.jumpHeight) < 0.06, `jump apex was ${peak}`);
  assert.ok(state.grounded);
  assert.ok(Math.abs(Math.hypot(...state.position) - surface.SURFACE.radius) < 1e-6);
});

test("crouching halves walk speed and pitching remains clamped", () => {
  const run = crouch => {
    let state = physics.createSurfacePlayerState();
    const input = { moveX: 0, moveY: 1, sprint: true, jump: false, crouch, yawDelta: 0, pitchDelta: Math.PI };
    for (let i = 0; i < 60; i++) state = physics.stepSurfacePlayer(state, input, 1 / 60);
    return { state, distance: 27 * Math.acos(Math.max(-1, Math.min(1, state.position[1] / 27))) };
  };
  const standing = run(false), crouched = run(true);
  assert.equal(crouched.state.crouched, true);
  assert.ok(standing.distance > crouched.distance * 2.5);
  assert.ok(Math.abs(standing.state.pitch - 85 * Math.PI / 180) < 1e-8);
});

test("lean eases to a bounded side peek on the ground and returns toward neutral in the air", () => {
  let state = physics.createSurfacePlayerState();
  const input = { moveX: 0, moveY: 0, sprint: false, jump: false, crouch: true, yawDelta: 0, pitchDelta: 0, lean: 1 };
  for (let i = 0; i < 30; i++) state = physics.stepSurfacePlayer(state, input, 1 / 60);
  assert.ok(state.lean > 0.3 && state.lean <= 0.35);
  state = physics.stepSurfacePlayer(state, { ...input, jump: true }, 1 / 60);
  assert.equal(state.grounded, false);
  assert.ok(state.lean >= 0 && state.lean < 0.35, "airborne lean eases back rather than snapping");
});

test("wall collision blocks a capsule and prevents standing through low cover", () => {
  const wall = { id: "wall", normal: [1, 0, 0], tangent: [0, 1, 0], height: surface.SURFACE.lowWallHeight, length: surface.SURFACE.wallLength };
  const position = [surface.SURFACE.radius, 0, 0];
  assert.equal(physics.surfacePoseClear(position, surface.SURFACE.standingHeight, [wall]), false);
  assert.equal(physics.surfacePoseClear(position, surface.SURFACE.crouchedHeight, [wall]), false);
  const resolved = physics.resolveSurfaceWalls(position, surface.SURFACE.standingHeight, [wall]);
  assert.ok(Math.hypot(...resolved.correction) >= surface.SURFACE.playerRadius - 1e-3);
  assert.equal(physics.surfacePoseClear(resolved.position, surface.SURFACE.standingHeight, [wall]), true);
});

test("surface collision sweep stops a fast traversal before the capsule can cross a wall", () => {
  const radius = surface.SURFACE.radius;
  const wall = { id: "wall", normal: [1, 0, 0], tangent: [0, 1, 0], height: surface.SURFACE.tallWallHeight, length: surface.SURFACE.wallLength };
  const startZ = -2, endZ = 2;
  const start = [Math.sqrt(radius ** 2 - startZ ** 2), 0, startZ];
  const end = [Math.sqrt(radius ** 2 - endZ ** 2), 0, endZ];
  const result = physics.sweepSurfaceWalls(start, end, surface.SURFACE.standingHeight, [wall], true);
  assert.ok(result.position[2] < 0, `sweep crossed to the far side at z=${result.position[2]}`);
  assert.ok(Math.abs(Math.hypot(...result.position) - radius) < 1e-6);
  assert.equal(physics.surfacePoseClear(result.position, surface.SURFACE.standingHeight, [wall]), true);
  assert.ok(Math.hypot(...result.correction) > 0, "a contact correction was produced");
});

test("pole movement transports heading smoothly without singular orientation", () => {
  let state = physics.createSurfacePlayerState([0, 0.99, 0.1], [1, 0, 0]);
  const input = { moveX: 0, moveY: 1, sprint: false, jump: false, crouch: false, yawDelta: 0.02, pitchDelta: 0 };
  for (let i = 0; i < 100; i++) state = physics.stepSurfacePlayer(state, input, 1 / 60);
  assert.ok(state.position.every(Number.isFinite));
  assert.ok(state.forward.every(Number.isFinite));
  assert.ok(Math.abs(Math.hypot(...state.position) - surface.SURFACE.radius) < 1e-6);
});

function surfaceFixture(revision = 1) {
  return {
    revision,
    nodes: [{ id: "hub", group: 0, degree: 1, dockable: true }, { id: "neighbor", group: 0, degree: 1, dockable: false }],
    links: [["hub", "neighbor"]],
  };
}
const identityShip = position => ({ position, rotation: [0, 0, 0, 1], velocity: [0, 0, 0] });

test("authoritative docking checks hub, aim, range, speed, and the recent-damage lock", () => {
  const world = new worldModule.SurfaceWorld(), owner = "owner", pilot = "pilot";
  world.setOwnerMap(owner, surfaceFixture(), new Float32Array([0, 0, 0, 8, 0, 0]));
  world.addPlayer(pilot, identityShip([0, 0, 38]));
  const arena = world.listArenas()[0];
  assert.ok(arena);
  world.markShipDamage(pilot, 2500);
  assert.equal(world.dock(pilot, arena.key, 4000), false, "cannot dock within three seconds of ship damage");
  assert.equal(world.dock(pilot, "owner/neighbor", 6000), false, "ordinary nodes never become arenas");
  world.setShipPose(pilot, identityShip([0, 0, 42]));
  assert.equal(world.dock(pilot, arena.key, 6000), false, "must be within fourteen units of the surface");
  world.setShipPose(pilot, { ...identityShip([0, 0, 38]), velocity: [11, 0, 0] });
  assert.equal(world.dock(pilot, arena.key, 6000), false, "approach speed is bounded");
  world.setShipPose(pilot, { ...identityShip([0, 0, 38]), rotation: [0, 1, 0, 0] });
  assert.equal(world.dock(pilot, arena.key, 6000), false, "the ship must point at the hub");
  world.setShipPose(pilot, identityShip([0, 0, 41]));
  assert.equal(world.dock(pilot, arena.key, 6000), true);
  assert.equal(world.getPlayer(pilot).mode, "surface");
});

test("surface damage consumes armor first, kills once, heals the winner, and respawns safely", () => {
  const world = new worldModule.SurfaceWorld(), owner = "owner", victim = "victim", attacker = "attacker";
  world.setOwnerMap(owner, surfaceFixture(), new Float32Array([0, 0, 0, 8, 0, 0]));
  world.addPlayer(victim, identityShip([0, 0, 38])); world.addPlayer(attacker, identityShip([0, 0, 38]));
  const arena = world.listArenas()[0];
  assert.equal(world.dock(victim, arena.key, 4000), true);
  assert.equal(world.dock(attacker, arena.key, 4000), true);
  assert.notEqual(world.getPlayer(victim).surface.position.toString(), world.getPlayer(attacker).surface.position.toString());
  const armorState = world.getPlayer(victim);
  assert.equal(armorState.armor, 0);
  const first = world.damage(victim, attacker, 10, 8000);
  assert.deepEqual([first.applied, first.killed], [10, false]);
  for (let shot = 1; shot < 9; shot++) world.damage(victim, attacker, 10, 8000 + shot * 200);
  const kill = world.damage(victim, attacker, 10, 10_000);
  assert.equal(kill.killed, true);
  assert.equal(kill.attackerHealth, 100);
  assert.equal(world.getPlayer(victim).health, 0);
  assert.equal(world.updatePlayer(victim, { moveX: 0, moveY: 0, sprint: false, jump: false, crouch: false, yawDelta: 0, pitchDelta: 0, interact: false }, 1 / 60, 14_999), "none");
  assert.equal(world.updatePlayer(victim, { moveX: 0, moveY: 0, sprint: false, jump: false, crouch: false, yawDelta: 0, pitchDelta: 0, interact: false }, 1 / 60, 15_000), "respawn");
  assert.equal(world.getPlayer(victim).health, 100);
  assert.equal(world.getPlayer(victim).armor, 0);
});

test("pole exit requires a continuous two-second F hold and docking preserves surface health", () => {
  const world = new worldModule.SurfaceWorld(), owner = "owner", pilot = "pilot";
  world.setOwnerMap(owner, surfaceFixture(), new Float32Array([0, 0, 0, 8, 0, 0]));
  world.addPlayer(pilot, identityShip([0, 0, 38]));
  const arena = world.listArenas()[0];
  assert.equal(world.dock(pilot, arena.key, 4000), true);
  assert.equal(world.damage(pilot, pilot, 10, 8000).applied, 10);
  const input = { moveX: 0, moveY: 0, sprint: false, jump: false, crouch: false, yawDelta: 0, pitchDelta: 0, interact: true };
  for (let i = 0; i < 60; i++) assert.equal(world.updatePlayer(pilot, input, 1 / 60, 9000 + i * 1000 / 60), "none", "damage delays exit progress");
  for (let i = 0; i < 120; i++) {
    const result = world.updatePlayer(pilot, input, 1 / 60, 11_000 + i * 1000 / 60);
    if (i < 119) assert.equal(result, "none"); else assert.equal(result, "undock");
  }
  assert.equal(world.getPlayer(pilot).health, 90);
  assert.equal(world.getPlayer(pilot).mode, "ship");
  world.setShipPose(pilot, identityShip([0, 0, 38]));
  assert.equal(world.dock(pilot, arena.key, 14_000), true);
  assert.equal(world.getPlayer(pilot).health, 90);
});

test("occupied arena topology changes are queued and stop new docking until the arena empties", () => {
  const world = new worldModule.SurfaceWorld(), owner = "owner";
  world.setOwnerMap(owner, surfaceFixture(1), new Float32Array([0, 0, 0, 8, 0, 0]));
  const arenaKey = world.listArenas()[0].key;
  world.addPlayer("occupant", identityShip([0, 0, 38]));
  assert.equal(world.dock("occupant", arenaKey, 4000), true);
  world.addPlayer("newcomer", identityShip([0, 0, 38]));
  world.setOwnerMap(owner, surfaceFixture(2), new Float32Array([1, 0, 0, 8, 0, 0]));
  assert.equal(world.getArena(arenaKey).acceptingPlayers, false);
  assert.equal(world.dock("newcomer", arenaKey, 8000), false);
  assert.equal(world.getArena(arenaKey).topologyRevision, 1, "occupied geometry remains stable for current occupants");
});

test("standing and crouched damage capsules cover the specified body heights and report first surface entry", () => {
  const state = physics.createSurfacePlayerState();
  const target = { id: "body", state, health: 100, protected: false };
  assert.equal(combat.traceSurfaceSegment([-1, 28.65, 0], [1, 28.65, 0], [], [target])?.kind, "player", "the standing upper body reaches 1.8 units");
  assert.equal(combat.traceSurfaceSegment([-1, 28.05, 0], [1, 28.05, 0], [], [{ ...target, state: { ...state, crouched: true } }])?.kind, "player", "the crouched upper cap reaches 1.1 units");
  assert.equal(combat.traceSurfaceSegment([-1, 28.2, 0], [1, 28.2, 0], [], [{ ...target, state: { ...state, crouched: true } }]), null);
  const first = combat.traceSurfaceSegment([-1, 27.6, 0], [1, 27.6, 0], [], [target]);
  assert.ok(Math.abs(first.t - 0.35) < 1e-6, `entry fraction was ${first.t}`);
  const wall = { id: "edge", normal: [0, 1, 0], tangent: [0, 0, 1], height: 2.2, length: 3.5 };
  assert.equal(combat.traceSurfaceSegment([-1, 27.6, 0], [1, 27.6, 0], [wall], [target])?.kind, "player", "an exposed capsule is hit before a wall behind its entry surface");
});

test("jump altitude survives network validation, rewind interpolation, and migration checkpoints", () => {
  const normal = physics.createSurfacePlayerState();
  const airborne = { ...normal, position: [0, 28.15, 0], grounded: false, velocity: [0, 0.2, 0] };
  assert.equal(physics.validSurfacePlayerState(airborne), true);
  assert.equal(physics.validSurfacePlayerState({ ...airborne, grounded: true }), false);
  assert.equal(physics.validSurfacePlayerState({ ...airborne, position: [0, 32, 0] }), false);
  const buffer = new history.SurfaceHistory();
  for (const [at, altitude] of [[1000, 1], [1017, 1.2]]) buffer.record({ playerId: "jump", arenaKey: "a", lifeId: 1, at,
    state: { ...airborne, position: [0, 27 + altitude, 0] }, protected: false });
  assert.ok(Math.abs(Math.hypot(...buffer.sample("jump", 1008.5, "a", 1).state.position) - 28.1) < 1e-6, "rewind must not flatten airborne targets");

  const room = new authority.SurfaceAuthority(), owner = "11111111-1111-4111-8111-111111111111";
  const hub = "n-33333333-3333-4333-8333-333333333333", pilot = "22222222-2222-4222-8222-222222222222";
  room.setOwnerMap(owner, { revision: 1, nodes: [{ id: hub, group: 0, degree: 0, dockable: true }], links: [] }, new Float32Array([0, 0, 0]));
  room.addPlayer(pilot, identityShip([0, 0, 38 * 6 / 27]));
  assert.equal(room.dock(pilot, owner, hub, 4000), true);
  room.world.players.get(pilot).surface = airborne;
  assert.equal(authority.validSurfaceNetworkSnapshot(room.snapshot(1, 1, 5000), 1), true, "peers accept a valid jumping avatar");
  const restored = new authority.SurfaceAuthority();
  assert.equal(restored.restoreCheckpoint(room.checkpoint(5000), 5100, 100), true);
  assert.equal(restored.world.getPlayer(pilot).surface.position[1], 28.15);
});

test("wall contacts use the visible thickness, ignore antipodal cover, and preserve airborne height", () => {
  const wall = { id: "wall", normal: [0, 1, 0], tangent: [1, 0, 0], height: 2.2, length: 3.5 };
  assert.equal(physics.surfacePoseClear([0, -27, 0], 1.8, [wall]), true, "a wall on the other hemisphere is not an obstacle");
  assert.equal(physics.surfacePoseClear([0, Math.sqrt(27 ** 2 - 0.5 ** 2), 0.5], 1.8, [wall]), false, "0.55-unit cover has matching body and bolt collision width");
  const result = physics.resolveSurfaceWalls([0, 27.6, 0], 1.8, [wall]);
  assert.ok(Math.abs(Math.hypot(...result.position) - 27.6) < 1e-6, "lateral wall resolution cannot teleport a jumping player onto the ground");
});

test("sprinting eases a standing lean back to neutral", () => {
  let state = { ...physics.createSurfacePlayerState(), lean: 0.35 };
  const input = { moveX: 0, moveY: 1, sprint: true, jump: false, crouch: false, yawDelta: 0, pitchDelta: 0, lean: 1 };
  for (let tick = 0; tick < 60; tick++) state = physics.stepSurfacePlayer(state, input, 1 / 60);
  assert.ok(Math.abs(state.lean) < 0.001);
});

function surfaceRoomPair() {
  const room = new authority.SurfaceAuthority(), owner = "11111111-1111-4111-8111-111111111111";
  const pilot = "22222222-2222-4222-8222-222222222222", target = "44444444-4444-4444-8444-444444444444";
  const hub = "n-33333333-3333-4333-8333-333333333333", key = `${owner}/${hub}`;
  room.setOwnerMap(owner, { revision: 1, nodes: [{ id: hub, group: 0, degree: 0, dockable: true }], links: [] }, new Float32Array([0, 0, 0]));
  for (const id of [pilot, target]) {
    room.addPlayer(id, identityShip([0, 0, 38 * 6 / 27]));
    assert.equal(room.dock(id, owner, hub, 4000), true);
  }
  return { room, owner, hub, key, pilot, target };
}
const neutralSurfaceInput = { moveX: 0, moveY: 0, sprint: false, jump: false, crouch: false, yawDelta: 0, pitchDelta: 0, lean: 0, interact: false };

test("one traveling bolt commits exactly one ten-damage hit while its stopped visual remains", () => {
  const { room, key, pilot, target } = surfaceRoomPair();
  const angle = 5 / 27;
  room.world.players.get(pilot).surface = physics.createSurfacePlayerState();
  room.world.players.get(target).surface = physics.createSurfacePlayerState([0, Math.cos(angle), -Math.sin(angle)]);
  room.world.arenas.get(key).arena.walls = [];
  room.step(1 / 60, 8000);
  const muzzle = viewModule.surfaceViewPose(room.world.getPlayer(pilot).surface).muzzle;
  const targetCenter = [0, 28.2 * Math.cos(angle), -28.2 * Math.sin(angle)];
  const direction = targetCenter.map((value, axis) => value - muzzle[axis]);
  const length = Math.hypot(...direction);
  assert.equal(room.fire(pilot, 1, 8000, direction.map(value => value / length), [8000], 8000, key, room.world.getPlayer(pilot).lifeId).accepted, true);
  for (let tick = 1; tick <= 30; tick++) room.step(1 / 60, 8000 + tick * 17);
  assert.equal(room.world.getPlayer(target).health, 90, "a stopped impact cannot damage again on the next tick");
  assert.equal(room.snapshot(1, 1, 8510).hitConfirmations.length, 1);
  assert.equal(room.snapshot(1, 2, 8510).projectiles.length, 0);
});

test("firing ends protection and a completed two-second vent permits a fresh seven-heat shot", () => {
  const { room, pilot } = surfaceRoomPair();
  assert.equal(room.world.getPlayer(pilot).protectedUntil, 7000);
  assert.equal(room.world.tryFire(pilot, 1, 4100).accepted, true);
  assert.equal(room.world.getPlayer(pilot).protectedUntil, 0);
  assert.equal(room.world.damage(pilot, pilot, 10, 4101).applied, 10);
  for (let shot = 2; shot <= 15; shot++) assert.equal(room.world.tryFire(pilot, shot, 4100 + (shot - 1) * 200).accepted, true);
  assert.equal(room.world.tryFire(pilot, 16, 8899).accepted, false);
  const fresh = room.world.tryFire(pilot, 17, 8900);
  assert.equal(fresh.accepted, true);
  assert.equal(fresh.heat, 7);
});

test("an in-flight elimination cannot heal a dead shooter or bypass the five-second respawn", () => {
  const { room, key, pilot, target } = surfaceRoomPair(), angle = 5 / 27;
  room.world.players.get(pilot).surface = physics.createSurfacePlayerState();
  const victim = room.world.players.get(target);
  victim.surface = physics.createSurfacePlayerState([0, Math.cos(angle), -Math.sin(angle)]); victim.health = 10;
  room.world.arenas.get(key).arena.walls = [];
  room.step(1 / 60, 8000);
  const muzzle = viewModule.surfaceViewPose(room.world.getPlayer(pilot).surface).muzzle;
  const direction = new THREE.Vector3(0, 28.2 * Math.cos(angle), -28.2 * Math.sin(angle)).sub(new THREE.Vector3(...muzzle)).normalize().toArray();
  assert.equal(room.fire(pilot, 1, 8000, direction, [8000], 8000, key, room.world.getPlayer(pilot).lifeId).accepted, true);
  assert.equal(room.world.damage(pilot, pilot, 100, 8001).killed, true);
  const dead = room.world.getPlayer(pilot);
  for (let tick = 1; tick <= 30; tick++) room.step(1 / 60, 8000 + tick * 17);
  assert.equal(room.world.getPlayer(target).health, 0, "the already-traveling bolt still resolves once");
  const after = room.world.getPlayer(pilot);
  assert.equal(after.kills, 1); assert.equal(after.deaths, 1);
  assert.equal(after.health, 0, "kill healing cannot revive a dead shooter");
  assert.equal(after.lifeId, dead.lifeId); assert.equal(after.respawnAt, 13001);
  room.step(1 / 60, 13000); assert.equal(room.world.getPlayer(pilot).health, 0);
  room.step(1 / 60, 13001); assert.equal(room.world.getPlayer(pilot).health, 100);
  assert.equal(room.world.getPlayer(pilot).lifeId, dead.lifeId + 1);
});

test("one host collection hides a pickup for every peer and late join until its exact respawn time", () => {
  const { room, key, pilot, target } = surfaceRoomPair();
  const arena = room.world.getArena(key), pickup = arena.arena.pickups.find(item => item.kind === "small-health");
  for (const id of [pilot, target]) {
    const player = room.world.players.get(id);
    player.health = 99; player.surface = physics.createSurfacePlayerState(pickup.normal);
  }
  assert.equal(room.world.updatePlayer(pilot, neutralSurfaceInput, 1 / 60, 8000), "pickup");
  assert.equal(room.world.updatePlayer(target, neutralSurfaceInput, 1 / 60, 8000), "none");
  assert.equal(room.world.getPlayer(pilot).health, 100);
  assert.equal(room.world.getPlayer(target).health, 99);
  const snapshot = room.snapshot(1, 1, 8000);
  assert.equal(authority.validSurfaceNetworkSnapshot(snapshot, 1), true);
  const unavailable = snapshot.pickups.find(item => item.id === pickup.id);
  assert.deepEqual(unavailable, { arenaKey: key, id: pickup.id, available: false, respawnAt: 23000 });
  const root = visuals.createSurfaceArenaVisual(arena.arena);
  visuals.setSurfacePickupVisibility(root, snapshot.pickups);
  assert.equal(root.getObjectByName(`surface-pickup:${pickup.id}`).visible, false);
  const forged = structuredClone(snapshot); forged.pickups[1] = forged.pickups[0];
  assert.equal(authority.validSurfaceNetworkSnapshot(forged), false, "duplicate pickup identities are rejected");
  assert.equal(room.world.getPickups(key, 22999).find(item => item.id === pickup.id).available, false);
  const respawned = room.world.getPickups(key, 23000);
  visuals.setSurfacePickupVisibility(root, respawned);
  assert.equal(root.getObjectByName(`surface-pickup:${pickup.id}`).visible, true);
  root.traverse(object => { object.geometry?.dispose(); if (object.material) for (const material of [object.material].flat()) material.dispose(); });
});

test("health, armor, and bot-drop pickups render recognizable silhouettes and visible amounts",()=>{
 const arena=surface.generateSurfaceArena("pickup-icons",["a","b","c","d"]),root=visuals.createSurfaceArenaVisual(arena);
 const get=kind=>root.getObjectByName(`surface-pickup:${arena.pickups.find(pickup=>pickup.kind===kind).id}`);
 const small=get("small-health"),large=get("large-health"),shield=get("armor");
 assert.equal(small.userData.label,"+25");assert.equal(large.userData.label,"+50");assert.equal(shield.userData.label,"ARMOR");
 assert.equal(small.children[0].children.length,2,"health pickups use the two-part medical cross silhouette");
 assert.ok(large.children[0].children[0].geometry.parameters.depth>small.children[0].children[0].geometry.parameters.depth,"large health uses a visibly larger cross");
 assert.equal(shield.children[0].children[0].geometry.type,"ShapeGeometry","armor uses a shield silhouette");
 const drop=visuals.createSurfaceBotDropVisual({id:"bot-drop-1",arenaKey:"solo/hub",position:[0,27,0],heal:30,available:true,expiresAt:30000});
 assert.equal(drop.userData.label,"+30");assert.equal(drop.children[0].children.length,2);
 root.traverse(object=>{object.geometry?.dispose();if(object.material)for(const material of [object.material].flat()){material.map?.dispose();material.dispose();}});
 drop.traverse(object=>{object.geometry?.dispose();if(object.material)for(const material of [object.material].flat()){material.map?.dispose();material.dispose();}});
});

test("a hub that loses eligibility keeps occupied geometry until exit, while deletion evacuates", () => {
  const world = new worldModule.SurfaceWorld();
  world.setOwnerMap("owner", surfaceFixture(1), new Float32Array([0, 0, 0, 8, 0, 0]));
  world.addPlayer("pilot", identityShip([0, 0, 38]));
  assert.equal(world.dock("pilot", "owner/hub", 4000), true);
  const changed = surfaceFixture(2); changed.nodes[0].dockable = false; changed.nodes[1].dockable = true;
  world.setOwnerMap("owner", changed, new Float32Array([0, 0, 0, 8, 0, 0]));
  assert.equal(world.getPlayer("pilot").mode, "surface");
  assert.equal(world.getArena("owner/hub").acceptingPlayers, false);
  assert.equal(world.forceUndock("pilot"), true);
  assert.equal(world.getArena("owner/hub"), null);

  world.setOwnerMap("owner", surfaceFixture(3), new Float32Array([0, 0, 0, 8, 0, 0]));
  world.setShipPose("pilot", identityShip([0, 0, 38]));
  assert.equal(world.dock("pilot", "owner/hub", 8000), true);
  world.damage("pilot", "pilot", 10, 12000);
  world.setOwnerMap("owner", { revision: 4, nodes: [], links: [] }, new Float32Array());
  assert.equal(world.getPlayer("pilot").mode, "ship");
  assert.equal(world.getPlayer("pilot").health, 90);
});

test("surface presentation holds its actual represented time after fifty milliseconds of extrapolation", () => {
  const buffer = new history.SurfaceHistory();
  const state = { ...physics.createSurfacePlayerState(), velocity: [4.5, 0, 0] };
  buffer.record({ playerId: "p", arenaKey: "arena", arenaRevision: 1, lifeId: 1, at: 1000, state, protected: false });
  const predicted = buffer.present("p", 1040, "arena", 1, 1);
  assert.equal(predicted.frame.at, 1040);
  assert.equal(predicted.exhausted, false);
  assert.ok(predicted.frame.state.position[0] > 0);
  const held = buffer.present("p", 1300, "arena", 1, 1);
  const stillHeld = buffer.present("p", 1500, "arena", 1, 1);
  assert.equal(held.frame.at, 1050, "firing must report the held pose time, not the current render clock");
  assert.equal(held.exhausted, true);
  assert.deepEqual(held, stillHeld);
  assert.equal(buffer.present("p", 1300, "arena", 2, 1), null);
  assert.equal(buffer.present("p", 1300, "arena", 1, 2), null);
});

test("rewind cannot interpolate across an arena geometry revision", () => {
  const buffer = new history.SurfaceHistory(), state = physics.createSurfacePlayerState();
  for (const [at, arenaRevision] of [[1000, 1], [1017, 2]]) buffer.record({ playerId: "p", arenaKey: "arena", arenaRevision, lifeId: 1, at, state, protected: false });
  assert.equal(buffer.sample("p", 1008, "arena", 1), null);
  assert.equal(buffer.sample("p", 1000, "arena", 1, 2), null);
});

test("one surface input turns the player once even when the following live packet is lost", () => {
  const { room, pilot } = surfaceRoomPair();
  room.world.players.get(pilot).surface = physics.createSurfacePlayerState();
  assert.equal(room.setInput(pilot, 1, { ...neutralSurfaceInput, yawDelta: 0.1, pitchDelta: 0.05 }), true);
  room.step(1 / 60, 8000);
  const first = room.world.getPlayer(pilot).surface;
  for (let tick = 1; tick <= 8; tick++) room.step(1 / 60, 8000 + tick * 17);
  const afterLoss = room.world.getPlayer(pilot).surface;
  assert.deepEqual(afterLoss.forward, first.forward);
  assert.equal(afterLoss.pitch, first.pitch);
});

test("all four docked pilots receive distinct reserved exterior ship positions", () => {
  const world = new worldModule.SurfaceWorld();
  world.setOwnerMap("owner", surfaceFixture(), new Float32Array([0, 0, 0, 8, 0, 0]));
  for (let slot = 0; slot < 4; slot++) {
    world.addPlayer(`p${slot}`, identityShip([0, 0, 38]));
    assert.equal(world.dock(`p${slot}`, "owner/hub", 4000), true);
  }
  const positions = world.listPlayers().map(player => player.ship.position);
  assert.equal(new Set(positions.map(position => position.join(","))).size, 4);
  assert.ok(positions.every(position => Math.abs(Math.hypot(...position) - 32.4) < 1e-6));
  for (const player of world.listPlayers()) assert.deepEqual(player.ship.velocity, [0, 0, 0]);
});

test("camped poles preserve six-unit enemy separation and clear four-player admission across generated arenas", () => {
  for (let seed = 0; seed < 24; seed++) {
    const world = new worldModule.SurfaceWorld(), hub = `camped-hub-${seed}`;
    const leaves = Array.from({ length: seed % 17 }, (_, index) => `neighbor-${index}`);
    const topology = { revision: 1, nodes: [{ id: hub, group: 0, degree: leaves.length, dockable: true }, ...leaves.map(id => ({ id, group: 0, degree: 1, dockable: false }))], links: leaves.map(id => [hub, id]) };
    world.setOwnerMap("owner", topology, new Float32Array(topology.nodes.length * 3));
    const key = `owner/${hub}`;
    for (let index = 0; index < 3; index++) {
      world.addPlayer(`camper-${index}`, identityShip([0, 0, 38]));
      assert.equal(world.dock(`camper-${index}`, key, 4000), true);
    }
    const normals = [[0, 1, 0], [0, -1, 0], [Math.sin(3 / 27), Math.cos(3 / 27), 0]];
    normals.forEach((normal, index) => { world.players.get(`camper-${index}`).surface = physics.createSurfacePlayerState(normal); });
    world.addPlayer("arrival", identityShip([0, 0, 38]));
    assert.equal(world.dock("arrival", key, 8000), true);
    const arrival = world.getPlayer("arrival"), arena = world.getArena(key);
    for (const normal of normals) assert.ok(new THREE.Vector3(...arrival.surface.position).angleTo(new THREE.Vector3(...normal)) * 27 >= 6 - 1e-6);
    assert.equal(physics.surfacePoseClear(arrival.surface.position, 1.8, arena.arena.walls), true);
    assert.equal(arrival.protectedUntil, 11000);
    world.addPlayer("fifth", identityShip([0, 0, 38]));
    assert.equal(world.dock("fifth", key, 8000), false);
    assert.equal(world.damage("arrival", "arrival", 100, 12000).killed, true);
    assert.equal(world.updatePlayer("arrival", neutralSurfaceInput, 1 / 60, 16999), "none");
    assert.equal(world.updatePlayer("arrival", neutralSurfaceInput, 1 / 60, 17000), "respawn");
    const respawn = world.getPlayer("arrival");
    for (const normal of normals) assert.ok(new THREE.Vector3(...respawn.surface.position).angleTo(new THREE.Vector3(...normal)) * 27 >= 6 - 1e-6);
    assert.equal(physics.surfacePoseClear(respawn.surface.position, 1.8, arena.arena.walls), true);
    assert.equal(respawn.protectedUntil, 20000);
  }
});

test("owner departure preserves a dead surface life until the original five-second timer expires", () => {
  const world = new worldModule.SurfaceWorld();
  world.setOwnerMap("owner", surfaceFixture(), new Float32Array([0, 0, 0, 8, 0, 0]));
  world.addPlayer("pilot", identityShip([0, 0, 38]));
  assert.equal(world.dock("pilot", "owner/hub", 4000), true);
  world.damage("pilot", "pilot", 100, 8000);
  world.ownerLeft("owner");
  assert.equal(world.getPlayer("pilot").health, 0);
  assert.equal(world.getPlayer("pilot").respawnAt, 13000);
  world.setOwnerMap("owner", surfaceFixture(2), new Float32Array([0, 0, 0, 8, 0, 0]));
  world.setShipPose("pilot", identityShip([0, 0, 38]));
  assert.equal(world.dock("pilot", "owner/hub", 12999), false);
  assert.equal(world.getPlayer("pilot").health, 0);
  assert.equal(world.dock("pilot", "owner/hub", 13000), true);
  assert.equal(world.getPlayer("pilot").health, 100);
  assert.equal(world.getPlayer("pilot").armor, 0);
});

test("shared round reset clears surface combat resources and pickup timers while preserving approved color", () => {
  const { room, key, pilot, target } = surfaceRoomPair();
  room.removePlayer(target);
  const colorBefore = room.setColor(pilot, "#0088FF");
  const player = room.world.players.get(pilot);
  player.health = 0; player.armor = 25; player.kills = 3; player.deaths = 2; player.heat = 80; player.respawnAt = 13_000;
  player.surface = physics.createSurfacePlayerState([0, Math.cos(7 / 27), -Math.sin(7 / 27)], [1, 0, 0]);
  const beforePose = structuredClone(player.surface), arenaKey = player.arenaKey;
  const pickup = room.world.arenas.get(key).pickups[0]; pickup.available = false; pickup.respawnAt = 30000;
  room.world.damageBot(`${key}/bot-0`, pilot, 100, 8000);
  room.resetRound(12_000);
  const reset = room.world.getPlayer(pilot);
  assert.deepEqual([reset.mode, reset.arenaKey, reset.health, reset.armor, reset.kills, reset.deaths, reset.heat, reset.ventUntil, reset.respawnAt, reset.protectedUntil], ["surface", arenaKey, 100, 0, 0, 0, 0, 0, 0, 15_000]);
  assert.deepEqual(reset.surface, beforePose, "dock, surface position and facing survive the round boundary");
  assert.equal(room.getColor(pilot), colorBefore);
  assert.ok(room.world.getPickups(key, 8000).every(item => item.available && item.respawnAt === 0));
  assert.equal(room.world.listBotDrops(12_000).length, 0, "round reset removes bot drops");
  assert.equal(room.world.listBots().length, 4, "the occupied arena starts the new round with four bots");
  assert.ok(room.world.listBots().every(bot => bot.health === 100 && !bot.aggressive), "bots return to their initial state");
  assert.deepEqual(room.snapshot(1, 1, 8000).projectiles, []);
});

test("surface input resends recover a missing tick, deduplicate overlap, and acknowledge only consumed controls", () => {
  const buffer = new surfaceInput.SurfaceInputBuffer();
  const frame = sequence => ({ sequence, arenaKey: "a", lifeId: 1, input: { ...neutralSurfaceInput, moveY: 1, yawDelta: sequence / 100 } });
  assert.equal(buffer.accept([frame(1), frame(3)], "a", 1, 1000), true);
  assert.equal(buffer.acknowledgedSequence, 0);
  assert.equal(buffer.advance("a", 1, 1017).yawDelta, 0.01);
  assert.equal(buffer.acknowledgedSequence, 1);
  assert.equal(buffer.advance("a", 1, 1034).yawDelta, 0, "waiting for a missing tick cannot repeat mouse deltas");
  assert.equal(buffer.acknowledgedSequence, 1);
  assert.equal(buffer.accept([frame(2), frame(3), frame(4)], "a", 1, 1035), true);
  for (const sequence of [2, 3, 4]) {
    assert.equal(buffer.advance("a", 1, 1050 + sequence * 17).yawDelta, sequence / 100);
    assert.equal(buffer.acknowledgedSequence, sequence);
  }
  assert.equal(buffer.queuedCount, 0);
  assert.equal(buffer.accept([frame(3), frame(4)], "a", 1, 1130), false);
});

test("surface movement reconciliation replays unacknowledged inputs without replaying gameplay resources", () => {
  const { room, pilot, key } = surfaceRoomPair();
  const prediction = new surfaceInput.SurfacePrediction(), initial = room.snapshot(1, 1, 8000).players.find(player => player.id === pilot);
  const frames = Array.from({ length: 6 }, (_, index) => ({ sequence: index + 1, arenaKey: key, lifeId: initial.lifeId,
    input: { ...neutralSurfaceInput, moveY: 1, yawDelta: 0.02, crouch: index >= 4, interact: true } }));
  prediction.reconcile(initial, 1, []);
  let expected = initial.surface, acknowledged = initial.surface;
  for (const frame of frames) {
    prediction.record(frame, 1);
    expected = physics.stepSurfacePlayer(expected, frame.input, 1 / 60, []);
    if (frame.sequence <= 3) acknowledged = physics.stepSurfacePlayer(acknowledged, frame.input, 1 / 60, []);
  }
  const host = { ...initial, inputSequence: 3, surface: acknowledged, health: 73, armor: 21, heat: 48, exitProgress: 0.4 };
  const replayed = prediction.reconcile(host, 1, []);
  assert.deepEqual(replayed.surface, expected);
  assert.equal(prediction.pendingCount, 3);
  assert.deepEqual([replayed.health, replayed.armor, replayed.heat, replayed.exitProgress], [73, 21, 48, 0.4]);
  const respawn = { ...host, lifeId: host.lifeId + 1, surface: physics.createSurfacePlayerState(), inputSequence: 3 };
  assert.deepEqual(prediction.reconcile(respawn, 1, []).surface, respawn.surface);
  assert.equal(prediction.pendingCount, 0, "respawn cancels input from the previous life");
  prediction.record({ ...frames[5], lifeId: respawn.lifeId, sequence: 7 }, 1);
  assert.equal(prediction.pendingCount, 1);
  assert.deepEqual(prediction.reconcile(respawn, 2, []).surface, respawn.surface);
  assert.equal(prediction.pendingCount, 0, "a new authority epoch cannot replay prior held actions");
});

test("surface authority consumes one queued input per fixed tick and rejects stale life batches", () => {
  const { room, pilot, key } = surfaceRoomPair();
  room.world.arenas.get(key).arena.walls = [];
  const lifeId = room.world.getPlayer(pilot).lifeId;
  const frame = sequence => ({ sequence, arenaKey: key, lifeId, input: { ...neutralSurfaceInput, yawDelta: 0.1 } });
  assert.equal(room.setInputFrames(pilot, [frame(1), frame(2), frame(3)], 8000), true);
  assert.equal(room.snapshot(1, 1, 8000).players.find(player => player.id === pilot).inputSequence, 0);
  room.step(1 / 60, 8017);
  assert.equal(room.snapshot(1, 2, 8017).players.find(player => player.id === pilot).inputSequence, 1);
  assert.equal(room.setInputFrames(pilot, [frame(2), frame(3), frame(4)], 8018), true);
  for (let tick = 2; tick <= 4; tick++) room.step(1 / 60, 8000 + tick * 17);
  assert.equal(room.snapshot(1, 3, 8068).players.find(player => player.id === pilot).inputSequence, 4);
  assert.equal(room.setInputFrames(pilot, [{ ...frame(5), lifeId: lifeId - 1 }], 8070), false);
  assert.equal(room.setInputFrames(pilot, [{ ...frame(5), arenaKey: "other" }], 8070), false);
  assert.equal(room.setInputFrames(pilot, Array.from({ length: 13 }, (_, index) => frame(index + 5)), 8070), false);
});

test("surface input timeout neutralizes movement and migration retires queued actions", () => {
  const buffer = new surfaceInput.SurfaceInputBuffer();
  const frame = sequence => ({ sequence, arenaKey: "a", lifeId: 1, input: { ...neutralSurfaceInput, moveY: 1, interact: true } });
  buffer.accept([frame(1)], "a", 1, 1000);
  assert.equal(buffer.advance("a", 1, 1017).moveY, 1);
  const expired = buffer.advance("a", 1, 1251);
  assert.deepEqual(expired, neutralSurfaceInput);
  assert.equal(buffer.accept([frame(20)], "a", 1, 1300), true);
  assert.equal(buffer.advance("a", 1, 1317).moveY, 1, "a gap beyond the resend window recovers from a neutral state");
  const { room, pilot, key } = surfaceRoomPair();
  const lifeId = room.world.getPlayer(pilot).lifeId;
  const controls = sequence => ({ ...frame(sequence), arenaKey: key, lifeId });
  room.setInputFrames(pilot, [controls(1), controls(2), controls(3)], 8000);
  room.step(1 / 60, 8017);
  const restored = new authority.SurfaceAuthority();
  assert.equal(restored.restoreCheckpoint(room.checkpoint(8017), 8100, 50), true);
  assert.equal(restored.snapshot(2, 1, 8100).players.find(player => player.id === pilot).inputSequence, 3);
  assert.equal(restored.setInputFrames(pilot, [controls(2), controls(3)], 8100), false);
  assert.equal(restored.setInputFrames(pilot, [controls(4)], 8100), true);
  restored.step(1 / 60, 8117);
  assert.equal(restored.snapshot(2, 2, 8117).players.find(player => player.id === pilot).inputSequence, 4);
});

test("firing-view validation uses fresh host transport timing and cannot enlarge the rewind allowance", () => {
  const timing = new history.SurfaceConnectionTiming();
  assert.equal(timing.measuredRtt(1000), null);
  assert.equal(timing.observe(100, 1000), true);
  assert.equal(timing.observe(-1, 1001), false);
  assert.equal(timing.observe(200, 999), false);
  assert.equal(timing.measuredRtt(1001), 100);
  assert.equal(timing.measuredRtt(6001), null);
  const issued = [800, 850, 900, 950, 1000];
  assert.equal(history.validateSurfaceViewTime(900, 1000, issued, null).accepted, false, "no transport sample means no historical compensation");
  assert.equal(history.validateSurfaceViewTime(800, 1000, issued, 0).accepted, false, "an old issued timestamp cannot create high-latency compensation on a fast connection");
  assert.equal(history.validateSurfaceViewTime(800, 1000, issued, 100).accepted, false);
  assert.deepEqual(history.validateSurfaceViewTime(800, 1000, issued, 200), { accepted: true, rewindMs: 150 });
  assert.equal(history.validateSurfaceViewTime(1000, 1000, issued, 200).accepted, false, "a purportedly fresh view is inconsistent with measured high latency");
});

test("historical fire fails closed before consuming heat when target history is unavailable", () => {
  const { room, pilot, key } = surfaceRoomPair();
  const life = room.world.getPlayer(pilot).lifeId, issued = [7800, 7850, 7900, 7950, 8000];
  room.observeConnectionTiming(pilot, 100, 8000);
  const cold = room.fire(pilot, 1, 7880, [0, 0, -1], issued, 8000, key, life);
  assert.equal(cold.reason, "history");
  assert.equal(room.world.getPlayer(pilot).heat, 0);
  for (let at = 7800; at <= 8000; at += 10) room.step(1 / 60, at);
  assert.equal(room.fire(pilot, 2, 7880, [0, 0, -1], issued, 8000, key, life).accepted, true);
  assert.equal(room.projectiles[0].rewindMs, 120);
  assert.equal(room.fire(pilot, 3, 7800, [0, 0, -1], issued, 8000, key, life).reason, "view-time");

  const high = surfaceRoomPair();
  high.room.observeConnectionTiming(high.pilot, 200, 8000);
  for (let at = 7800; at <= 8000; at += 10) high.room.step(1 / 60, at);
  assert.equal(high.room.fire(high.pilot, 1, 7800, [0, 0, -1], issued, 8000, high.key, high.room.world.getPlayer(high.pilot).lifeId).accepted, true);
  assert.equal(high.room.projectiles[0].rewindMs, 150);
});

test("surface bolts move only for elapsed time after birth and terminate at exactly thirty units", () => {
  const { room, pilot, target, key } = surfaceRoomPair();
  room.removePlayer(target); room.world.arenas.get(key).arena.walls = [];
  room.world.players.get(pilot).surface = physics.createSurfacePlayerState();
  assert.equal(room.fire(pilot, 1, 8000, [0, 1, 0], [8000], 8000, key, room.world.getPlayer(pilot).lifeId).accepted, true);
  const bolt = room.projectiles[0];
  room.step(1 / 60, 7999);
  assert.equal(bolt.travelled, 0, "a catch-up tick before firing cannot advance the projectile");
  room.step(1 / 60, 8005);
  assert.ok(Math.abs(bolt.travelled - 0.6) < 1e-9, "the first partial tick covers only five milliseconds");
  room.step(1 / 60, 8005);
  assert.ok(Math.abs(bolt.travelled - 0.6) < 1e-9, "repeated clock values cannot advance a bolt twice");
  for (let at = 8020; at <= 8240; at += 20) room.step(1 / 60, at);
  room.step(1 / 60, 8249);
  assert.ok(Math.abs(bolt.travelled - 29.88) < 1e-8);
  room.step(1 / 60, 8250);
  assert.ok(Math.abs(bolt.travelled - 30) < 1e-8);
  assert.equal(room.snapshot(1, 1, 8250).projectiles.length, 0);
});

test("rolled camera and physical muzzle share one transform at either pole and in both stances", () => {
  const center = [2300, -100, 1992];
  for (const normal of [[0, 1, 0], [0, -1, 0], [1, 0, 0]]) for (const crouched of [false, true]) for (const lean of [-0.35, 0, 0.35]) {
    const state = { ...physics.createSurfacePlayerState(normal), pitch: 0.4, lean, crouched };
    const pose = viewModule.surfaceViewPose(state), rotation = new THREE.Quaternion(...pose.rotation);
    const offset = new THREE.Vector3(...viewModule.SURFACE_MUZZLE_OFFSET).applyQuaternion(rotation);
    assert.ok(new THREE.Vector3(...pose.muzzle).sub(new THREE.Vector3(...pose.eye)).distanceTo(offset) < 1e-9);
    assert.ok(new THREE.Vector3(...pose.look).distanceTo(new THREE.Vector3(0, 0, -1).applyQuaternion(rotation)) < 1e-9);
    const worldMuzzle = viewModule.surfaceToWorld(pose.muzzle, center);
    const roundTrip = viewModule.worldToSurface(worldMuzzle, center);
    assert.ok(new THREE.Vector3(...roundTrip).distanceTo(new THREE.Vector3(...pose.muzzle)) < 1e-9);
  }
});

test("surface bolt graphics retain an opaque white core and identical dimensions for every approved tint", () => {
  const graphic = new visuals.SurfaceBoltGraphic("#959595");
  graphic.setSegment(new THREE.Vector3(1, 2, 3), new THREE.Vector3(1, 3, 3));
  const coreScale = graphic.core.scale.clone(), tintScale = graphic.tint.scale.clone();
  for (const tint of ["#959595", "#FFFFFF", "#8CECFF", color.normalizeSurfaceLaserColor("#0000FF")]) {
    graphic.setColor(tint);
    assert.equal(graphic.core.material.color.getHex(), 0xffffff);
    assert.equal(graphic.core.material.opacity, 1);
    assert.equal(graphic.core.material.transparent, false);
    assert.equal(graphic.tint.material.opacity, 0.65);
    assert.deepEqual(graphic.core.scale, coreScale);
    assert.deepEqual(graphic.tint.scale, tintScale);
  }
  graphic.dispose();
});

test("the viewmodel pass clears only depth after world rendering and restores renderer state", () => {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(), calls = [];
  const renderer = { autoClear: true, clearDepth() { calls.push("depth"); }, render(value, view) { calls.push("viewmodel"); assert.equal(this.autoClear, false); assert.equal(value, scene); assert.equal(view, camera); } };
  visuals.renderSurfaceViewmodel(renderer, scene, camera);
  assert.deepEqual(calls, ["depth", "viewmodel"]);
  assert.equal(renderer.autoClear, true);
  renderer.render = () => { throw new Error("render failed"); };
  assert.throws(() => visuals.renderSurfaceViewmodel(renderer, scene, camera), /render failed/);
  assert.equal(renderer.autoClear, true);
});

test("the room prediction path keeps a non-origin arena muzzle relative and starts the bolt at firing time", () => {
  const { room, pilot, key } = surfaceRoomPair(), player = room.snapshot(1, 1, 8000).players.find(item => item.id === pilot);
  const arena = { ...room.world.getArena(key), center: [2300, 100, 1992] };
  arena.arena.walls = [];
  const renderer = Object.create(rendering.ConstellationRenderer.prototype), captured = [];
  Object.assign(renderer, { multiplayer: true, roomCombatEnabled:true, roomSurfaceLocalView: player, roomSurfaceLocalArena: arena, roomSurfaceHostTime: 10000,
    roomSurfaceReceivedAt: Date.now(), cb: { onSurfaceFire() {} }, upsertNetworkSurfaceBolt: (shot, at) => captured.push({ shot, at }) });
  const pose = viewModule.surfaceViewPose(player.surface);
  renderer.onSurfaceFire(viewModule.surfaceToWorld(pose.muzzle, arena.center), pose.look, 1, 9800);
  assert.equal(captured.length, 1);
  assert.ok(new THREE.Vector3(...captured[0].shot.position).distanceTo(new THREE.Vector3(...pose.muzzle)) < 1e-9);
  assert.ok(captured[0].at >= 10000 && captured[0].at < 10050, "the displayed target timestamp is not the projectile birth timestamp");
});

test("solo bolts damage the shared patrol simulation and training armor remains an explicit override", () => {
  const capturedHits = [];
  const previousNow = Date.now; let now = 8000; Date.now = () => now;
  try {
    const world = new worldModule.SurfaceWorld(), center = [1000, 0, 0];
    world.setOwnerMap("solo", surfaceFixture(), new Float32Array([...center, 1008, 0, 0]));
    world.addPlayer("solo", identityShip([1000, 0, 38])); assert.equal(world.dock("solo", "solo/hub", 4000), true);
    world.players.get("solo").surface = physics.createSurfacePlayerState(); world.arenas.get("solo/hub").arena.walls = [];
    const angle = 5 / 27, bot = world.bots.get("solo/hub/bot-0");
    bot.patrol.state = physics.createSurfacePlayerState([0, Math.cos(angle), -Math.sin(angle)], [0, 0, -1]);
    const renderer = Object.create(rendering.ConstellationRenderer.prototype);
    Object.assign(renderer, { multiplayer: false, roomCombatEnabled:true, surfaceWorld: world, surfaceBolts: [], surfaceBotVisuals: new Map(), surfaceBotShotVisuals: new Map(), surfaceBotDropVisuals: new Map(),
      surfaceDisplayCenters: new Map(), scene: new THREE.Scene(), roomSurfaceLaserColor: "#8CECFF", surfaceAudio: { play() {} }, surfacePilot: { confirmTrainingHit: id => capturedHits.push(id) } });
    const pose = viewModule.surfaceViewPose(world.getPlayer("solo").surface), targetCenter = viewModule.surfaceViewPose(bot.patrol.state).eye;
    const direction = new THREE.Vector3(...targetCenter).sub(new THREE.Vector3(...pose.muzzle)).normalize();
    renderer.onSurfaceFire(viewModule.surfaceToWorld(pose.muzzle, center), direction.toArray(), 1, now);
    for (let tick = 1; tick <= 20; tick++) { now = 8000 + tick * 17; renderer.updateSurfaceCombat(1 / 60, now); }
    assert.equal(bot.health, 90);
    assert.equal(bot.targetId, "solo", "being hit starts pursuit of the attacker");
    assert.equal(world.getPlayer("solo").kills, 0, "a bot is not a player score");
    assert.equal(capturedHits.length, 1, "actual bot damage confirms one hit");
    const moved = [1100, 20, -50]; world.setOwnerMap("solo", surfaceFixture(), new Float32Array([...moved, 1108, 20, -50]));
    renderer.updateSurfaceCombat(1 / 60, now + 17);
    const visual = renderer.surfaceBotVisuals.get(bot.id);
    assert.ok(visual.group.position.distanceTo(new THREE.Vector3(...viewModule.surfaceToWorld(visual.displayed.position, moved))) < 1e-9);
    assert.deepEqual(bot.patrol.state.position, visual.target.position, "presentation grounding does not modify authoritative patrol state");
    renderer.resetTrainingDummy(150);
    assert.deepEqual(world.listBots().map(view => view.armor), [50, 50, 50, 50], "the legacy training selector explicitly adds armor to solo bots");
    renderer.clearSurfaceCombat();
    assert.equal(renderer.surfaceBotVisuals.size, 0);
  } finally { Date.now = previousNow; }
});

test("moving nodes transport reserved parked-ship offsets without shifting the surface body", () => {
  const { room, owner, hub, key, pilot } = surfaceRoomPair();
  const before = room.world.getPlayer(pilot), beforeOffset = [...before.ship.position];
  room.setOwnerMap(owner, { revision: 1, nodes: [{ id: hub, group: 0, degree: 0, dockable: true }], links: [] }, new Float32Array([50, 10, -20]));
  const after = room.world.getPlayer(pilot), center = room.world.getArena(key).center;
  assert.deepEqual(after.surface.position, before.surface.position);
  assert.ok(new THREE.Vector3(...after.ship.position).sub(new THREE.Vector3(...center)).distanceTo(new THREE.Vector3(...beforeOffset)) < 1e-9);
});

test("surface undocking chooses a collision-free pole departure among ordinary neighbouring nodes", () => {
  const { room, pilot } = surfaceRoomPair();
  room.setOwnerMap("55555555-5555-4555-8555-555555555555", { revision: 1,
    nodes: [{ id: "n-66666666-6666-4666-8666-666666666666", group: 0, degree: 0, dockable: false }], links: [] }, new Float32Array([0, 8, 0]));
  room.world.players.get(pilot).health = 73;
  assert.equal(room.forceUndock(pilot), true);
  const player = room.world.getPlayer(pilot);
  assert.ok(new THREE.Vector3(...player.ship.position).distanceTo(new THREE.Vector3(0, 8, 0)) > 6.5);
  assert.equal(player.health, 73);
  assert.deepEqual(player.ship.velocity, [0, 0, 0]);
});

test("room departures at both poles clear moving large neighbours for forced and held-key exits", () => {
  for (const pole of [-1, 1]) for (const forced of [false, true]) {
    const { room, pilot } = surfaceRoomPair(), neighbourOwner = "55555555-5555-4555-8555-555555555555", hub = "n-66666666-6666-4666-8666-666666666666";
    const satellites = Array.from({ length: 32 }, (_, i) => `n-neighbour-${i}`);
    const topology = { revision: 1, nodes: [hub, ...satellites].map((id, i) => ({ id, group: 0, degree: i ? 1 : 32, dockable: !i })), links: satellites.map(id => [hub, id]) };
    const positions = new Float32Array(topology.nodes.flatMap((_node, i) => i ? [100 + i * 20, 100, 100] : [0, pole * 80, 0]));
    room.setOwnerMap(neighbourOwner, topology, positions);
    positions[1] = pole * 8; room.setOwnerMap(neighbourOwner, topology, positions);
    const player = room.world.players.get(pilot); player.health = 73; player.exitPole = pole;
    if (forced) assert.equal(room.forceUndock(pilot), true);
    else {
      const arena = room.world.getArena(player.arenaKey);
      player.surface = physics.createSurfacePlayerState([0, pole, 0], [1, 0, 0], arena.arena.radius, arena.arena.terrain);
      for (let tick = 1; tick <= 120; tick++) {
        const now = 4000 + Math.round(tick * 1000 / 60);
        assert.equal(room.setInput(pilot, tick, { ...neutralSurfaceInput, interact: true }, now), true); room.step(1 / 60, now);
      }
    }
    const returned = room.world.getPlayer(pilot); assert.equal(returned.mode, "ship"); assert.equal(returned.health, 73);
    const location = new THREE.Vector3(...returned.ship.position), radius = geometry.surfaceRadiusForConnections(32) * viewModule.SURFACE_WORLD_SCALE;
    assert.ok(location.distanceTo(new THREE.Vector3(0, pole * 8, 0)) > radius + .7);
    const before = location.clone(); room.departureGrid.resolve(location, new THREE.Vector3());
    assert.ok(location.distanceTo(before) < 1e-8, "the first collision update requires no manual escape");
    assert.deepEqual(returned.ship.velocity, [0, 0, 0]);
  }
});

test("capsule clearance includes rounded caps and distinguishes standing from crouched overhead volume", () => {
  const ceiling = { center: [0, 28.7, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], half: [2, 0.1, 2] };
  assert.ok(collision.capsuleBoxContact([0, 27.3, 0], [0, 28.5, 0], 0.3, ceiling));
  assert.equal(collision.capsuleBoxContact([0, 27.3, 0], [0, 27.8, 0], 0.3, ceiling), null);
  assert.equal(collision.capsuleBoxContact([2.2, 28.35, 0], [2.2, 28.35, 0], 0.3, ceiling), null, "the rounded cap clears a diagonal box corner");
  assert.ok(collision.capsuleBoxContact([2.15, 28.35, 0], [2.15, 28.35, 0], 0.3, ceiling), "moving the cap closer contacts the corner");
});

test("standing, sprinting, and crouch-jumping are blocked when the full standing capsule meets an overhang", () => {
  const position = [8, Math.sqrt(27 ** 2 - 8 ** 2), 0];
  const overhang = { id: "overhang", normal: [0, 1, 0], tangent: [1, 0, 0], height: 2.2, length: 20 };
  assert.equal(physics.surfacePoseClear(position, 1.1, [overhang]), true);
  assert.equal(physics.surfacePoseClear(position, 1.8, [overhang]), false);
  const state = { ...physics.createSurfacePlayerState(position), crouched: true };
  const jumping = physics.stepSurfacePlayer(state, { ...neutralSurfaceInput, crouch: true, jump: true }, 1 / 60, [overhang]);
  assert.equal(jumping.crouched, true);
  assert.equal(jumping.grounded, true);
  const sprinting = physics.stepSurfacePlayer(state, { ...neutralSurfaceInput, crouch: false, sprint: true, moveY: 1 }, 1 / 60, [overhang]);
  assert.equal(sprinting.crouched, true);
  assert.ok(Math.hypot(...sprinting.velocity) <= 2.25);
});

test("automatic stepping climbs a small ledge but cannot climb an obstacle above the 0.2-unit limit", () => {
  const run = height => {
    const wall = { id: "step", normal: [0, 1, 0], tangent: [1, 0, 0], height, length: 3.5 };
    let state = physics.createSurfacePlayerState([0, Math.sqrt(27 ** 2 - 1.5 ** 2), -1.5], [0, 0, 1]), peak = 0;
    for (let tick = 0; tick < 60; tick++) {
      state = physics.stepSurfacePlayer(state, { ...neutralSurfaceInput, moveY: 1 }, 1 / 60, [wall]);
      peak = Math.max(peak, Math.hypot(...state.position) - 27);
    }
    return { state, peak };
  };
  const low = run(0.15), high = run(0.25);
  assert.ok(low.state.position[2] > 0.8, `small step stopped at ${low.state.position[2]}`);
  assert.ok(low.peak > 0.14 && low.peak <= 0.2 + 1e-3, `small-step height was ${low.peak}`);
  assert.ok(high.state.position[2] < 0, `larger step was crossed at ${high.state.position[2]}`);
  assert.ok(high.peak < 0.01, `collision silently lifted the player ${high.peak}`);
});

test("a 1.2-unit jump cannot be lifted by capsule resolution over a 1.3-unit low wall", () => {
  const wall = { id: "cover", normal: [0, 1, 0], tangent: [1, 0, 0], height: 1.3, length: 3.5 };
  let state = physics.createSurfacePlayerState([0, Math.sqrt(27 ** 2 - 1.5 ** 2), -1.5], [0, 0, 1]), peak = 0, furthest = -Infinity;
  for (let tick = 0; tick < 180; tick++) {
    state = physics.stepSurfacePlayer(state, { ...neutralSurfaceInput, moveY: 1, jump: tick === 0 }, 1 / 60, [wall]);
    peak = Math.max(peak, Math.hypot(...state.position) - 27); furthest = Math.max(furthest, state.position[2]);
  }
  assert.ok(peak < 1.3, `collision raised the jump to ${peak}`);
  assert.ok(furthest < 0, `the jump crossed the low wall to ${furthest}`);
});

test("surface presentation interpolates normal publication jitter without loosening authoritative rewind gaps", () => {
  const buffer = new history.SurfaceHistory(), first = physics.createSurfacePlayerState();
  const second = physics.stepSurfacePlayer(first, { ...neutralSurfaceInput, moveY: 1 }, 0.056);
  for (const [at, state] of [[1000, first], [1056, second]]) buffer.record({ playerId: "p", arenaKey: "a", arenaRevision: 1, lifeId: 1, at, state, protected: false });
  assert.equal(buffer.sample("p", 1025, "a", 1, 1), null, "host rewind still fails closed over a missing 60 Hz history interval");
  const presentation = buffer.present("p", 1025, "a", 1, 1);
  assert.equal(presentation.frame.at, 1025);
  assert.equal(presentation.exhausted, false);
  assert.notDeepEqual(presentation.frame.state.position, first.position);
  assert.notDeepEqual(presentation.frame.state.position, second.position);
});


test("surface world depth-occludes local/remote graph overlays in direct and bloom draws and restores flight style", () => {
 for (const bloom of [false,true]) {
  const scene=new THREE.Scene(), shared=new THREE.LineBasicMaterial({depthTest:false,depthWrite:false,transparent:true});
  const stars=new THREE.Points(new THREE.BufferGeometry(),new THREE.ShaderMaterial({depthTest:false,depthWrite:false,transparent:true}));
  const localLinks=new THREE.LineSegments(new THREE.BufferGeometry(),shared), remoteLinks=new THREE.LineSegments(new THREE.BufferGeometry(),shared);
  const remoteStars=new THREE.Points(new THREE.BufferGeometry(),new THREE.ShaderMaterial({depthTest:false,depthWrite:false}));
  const marker=new THREE.Mesh(new THREE.RingGeometry(),new THREE.MeshBasicMaterial({depthTest:false}));
  const arena=visuals.createSurfaceArenaVisual(surface.generateSurfaceArena("occlusion",["a","b"]));
  const planet=arena.getObjectByName("surface-planet");scene.add(stars,localLinks,remoteLinks,remoteStars,marker,arena);
  const original=[stars.material,shared,remoteStars.material,marker.material].map(m=>({m,depthTest:m.depthTest,depthWrite:m.depthWrite}));
  let calls=0;
  const renderer={render(){calls++;for(const item of original)assert.equal(item.m.depthTest,true);assert.equal(planet.material.depthTest,true);assert.equal(planet.material.depthWrite,true);assert.equal(planet.material.transparent,false);assert.equal(planet.material.side,THREE.FrontSide);}};
  const composer={render(){renderer.render();renderer.render();}};
  visuals.renderOccludedSurfaceWorld(scene,true,()=>bloom?composer.render():renderer.render());assert.equal(calls,bloom?2:1);
  for(const item of original){assert.equal(item.m.depthTest,item.depthTest);assert.equal(item.m.depthWrite,item.depthWrite);}
  visuals.renderOccludedSurfaceWorld(scene,false,()=>{for(const item of original)assert.equal(item.m.depthTest,false);});
  assert.throws(()=>visuals.renderOccludedSurfaceWorld(scene,true,()=>{throw new Error("draw failed")}),/draw failed/);
  for(const item of original)assert.equal(item.m.depthTest,false);
  scene.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();});
 }
});

test("surface label visibility follows the opaque sphere at both poles, horizon and moving centers", () => {
 for(const pole of [-1,1])for(const radius of [6,60])for(const center of [[0,0,0],[100,-30,70]]) {
  const origin=new THREE.Vector3(...center),eye=origin.clone().add(new THREE.Vector3(0,pole*(radius+.36),0));
  assert.equal(visuals.surfaceSphereOccludes(eye,origin,center,radius),true,"the original graph node is inside the opaque floor");
  assert.equal(visuals.surfaceSphereOccludes(eye,origin.clone().add(new THREE.Vector3(0,-pole*(radius+10),0)),center,radius),true);
  assert.equal(visuals.surfaceSphereOccludes(eye,origin.clone().add(new THREE.Vector3(0,pole*(radius+10),0)),center,radius),false,"sky and exterior objects stay visible");
  assert.equal(visuals.surfaceSphereOccludes(eye,eye.clone().add(new THREE.Vector3(10,0,0)),center,radius),false,"objects along the unobstructed tangent stay visible");
  assert.equal(visuals.surfaceSphereOccludes(eye,eye,center,radius),false);
  const renderer=Object.create(rendering.ConstellationRenderer.prototype);
  const arena={key:"solo/occlusion",center,arena:{radius:radius*27/6,walls:[]}};
  Object.assign(renderer,{surfacePilot:{active:true},multiplayer:false,camera:{position:eye},surfaceWorld:{listArenas:()=>[arena]},surfaceDisplayCenters:new Map([[arena.key,center]])});
  assert.equal(renderer.isSurfacePointOccluded(origin),true);
  assert.equal(renderer.isSurfacePointOccluded(origin.clone().add(new THREE.Vector3(0,pole*(radius+10000),0))),false);
  assert.equal(renderer.isSurfacePointOccluded(eye.clone().add(new THREE.Vector3(10,0,0))),false);
  renderer.surfacePilot.active=false;assert.equal(renderer.isSurfacePointOccluded(origin),false);
 }
});


test("solo wall and floor impacts never generate character-hit feedback",()=>{
 for(const kind of ["wall","planet"]) {
  const hits=[],renderer=Object.create(rendering.ConstellationRenderer.prototype);
  const wall={id:"wall",normal:[0,1,0],tangent:[1,0,0],height:2.2,length:3.5};
  const arena={key:"solo/hub",center:[0,0,0],arena:{radius:27,walls:kind==="wall"?[wall]:[]}};
  const graphic=new visuals.SurfaceBoltGraphic("#FFFFFF"),position=new THREE.Vector3(0,kind==="wall"?28:30,kind==="wall"?2:0),direction=kind==="wall"?new THREE.Vector3(0,0,-1):new THREE.Vector3(0,-1,0);
  const bolt={graphic,arenaKey:arena.key,ownerId:"solo",position,direction,travelled:0,startedAt:8000,simulatedAt:8000,stoppedAt:0};
  Object.assign(renderer,{multiplayer:false,surfaceWorld:{getArena:()=>arena,listBots:()=>[],stepBots(){},listBotShots:()=>[],listBotDrops:()=>[]},surfaceBotVisuals:new Map(),surfaceBotShotVisuals:new Map(),surfaceBotDropVisuals:new Map(),surfaceDisplayCenters:new Map(),surfaceBolts:[bolt],surfaceAudio:{play(){}},surfacePilot:{confirmTrainingHit:id=>hits.push(id)}});
  renderer.updateSurfaceCombat(.05,8050);assert.ok(bolt.stoppedAt>0);assert.deepEqual(hits,[]);renderer.surfaceBolts.forEach(b=>b.graphic.dispose());
 }
});

test("surface nameplates use roster names, authoritative HP and displayed poses only for visible same-arena opponents",()=>{
 const renderer=Object.create(rendering.ConstellationRenderer.prototype),state=physics.createSurfacePlayerState(),arena={key:"arena",center:[0,0,0]},updates=[];
  Object.assign(renderer,{multiplayer:true,surfacePilot:{active:true},surfaceBotVisuals:new Map(),surfaceDisplayCenters:new Map(),roomSurfaceLocalView:{id:"self",health:100,arenaKey:"arena"},roomSurfaceArenas:new Map([["arena",arena]]),remoteShips:new Map(),
 remoteSurfaceAvatars:new Map([["other",{group:{visible:true},state,arenaKey:"arena"}],["elsewhere",{group:{visible:true},state,arenaKey:"other-arena"}]]),
 roomSurfacePlayers:new Map([["other",{health:45}],["elsewhere",{health:100}]]),camera:{},canvas:{clientWidth:500,clientHeight:400},surfaceNameplates:{update:(...args)=>updates.push(args)}});
 renderer.setPlayerNames(new Map([["other","Public pilot"]]));renderer.updateSurfaceNameplates();
 assert.deepEqual(updates[0][5],[{id:"other",name:"Public pilot",health:45,arenaKey:"arena",state}]);
 renderer.roomSurfaceLocalView.health=0;renderer.updateSurfaceNameplates();assert.deepEqual(updates[1][5],[]);assert.equal(updates[1][3],null);
});


test("bots acquire within their forward cone, wait one second, fire inaccurately, and stop firing behind cover",()=>{
 const {room,pilot,target,key}=surfaceRoomPair(),world=room.world,arena=world.arenas.get(key),bot=world.bots.get(`${key}/bot-0`);
  const other=world.players.get(target);other.health=0;other.respawnAt=30_000;arena.arena.walls=[];
 const player=world.players.get(pilot),angle=6/27;
 player.surface=physics.createSurfacePlayerState([0,Math.cos(angle),-Math.sin(angle)],[0,0,-1]);player.protectedUntil=0;
 bot.patrol.state=physics.createSurfacePlayerState([0,1,0],[0,0,-1]);bot.patrol.home=[0,1,0];bot.patrol.goal=[0,1,0];bot.patrol.wait=0;bot.patrol.repath=0;
 const wallAngle=3/27,wall={id:"moving-cover",normal:[0,Math.cos(wallAngle),-Math.sin(wallAngle)],tangent:[1,0,0],height:2.2,length:8};
 arena.arena.walls=[wall];room.world.stepBots(1/60,8000);assert.equal(bot.targetId,"");assert.equal(world.listBotShots().length,0,"solid cover blocks initial sight");
 arena.arena.walls=[];room.world.stepBots(1/60,8050);assert.equal(bot.targetId,pilot);assert.equal(bot.nextShotAt,9050,"acquisition starts a one-second firing delay");
 room.world.stepBots(.05,9049);assert.equal(bot.shotSequence,0,"no bolt before the acquisition delay");
 room.world.stepBots(1/60,9050);assert.equal(bot.shotSequence,1,"the bot fires as soon as the delay expires with clear sight");
 const shot=world.listBotShots()[0],origin=viewModule.surfaceViewPose(bot.patrol.state).muzzle,targetEye=viewModule.surfaceViewPose(player.surface).eye;
 const aim=new THREE.Vector3(...targetEye).sub(new THREE.Vector3(...origin)).normalize(),fired=new THREE.Vector3(...shot.direction);
 const spread=Math.acos(Math.max(-1,Math.min(1,aim.dot(fired))))*180/Math.PI;
 assert.ok(spread>0.01&&spread<=10.01,`bot aim spread was ${spread} degrees`);
 arena.arena.walls=[wall];const nextShotAt=bot.nextShotAt;room.world.stepBots(1/60,nextShotAt);assert.equal(bot.shotSequence,1,"the bot immediately stops shooting when moving cover blocks sight");
});

test("bot pursuit loses interest after occlusion, waits before reacquiring, and ends after ten seconds",()=>{
 const {room,pilot,target,key}=surfaceRoomPair(),world=room.world,arena=world.arenas.get(key),bot=world.bots.get(`${key}/bot-0`);
 const other=world.players.get(target);other.health=0;other.respawnAt=30_000;arena.arena.walls=[];
 const player=world.players.get(pilot),angle=6/27;player.surface=physics.createSurfacePlayerState([0,Math.cos(angle),-Math.sin(angle)]);player.protectedUntil=0;
 bot.patrol.state=physics.createSurfacePlayerState([0,1,0],[0,0,-1]);
 world.damageBot(bot.id,pilot,10,8000);assert.equal(bot.targetId,pilot);
 const wallAngle=3/27;arena.arena.walls=[{id:"cover",normal:[0,Math.cos(wallAngle),-Math.sin(wallAngle)],tangent:[1,0,0],height:2.2,length:8}];
 room.world.stepBots(.01,11999);assert.equal(bot.targetId,pilot,"pursuit continues before four seconds unseen");
 room.world.stepBots(.01,12000);assert.equal(bot.targetId,"");assert.equal(bot.reacquireUntil,15000,"four seconds without sight trigger a three-second delay");
 arena.arena.walls=[];room.world.stepBots(.01,14999);assert.equal(bot.targetId,"");
 room.world.stepBots(.01,15000);assert.equal(bot.targetId,pilot,"a visible player is reacquired when the delay expires");
 room.world.stepBots(.01,25000);assert.equal(bot.targetId,"");assert.equal(bot.reacquireUntil,28000,"pursuit is bounded to ten seconds");
 world.damageBot(bot.id,pilot,1,25100);assert.equal(bot.targetId,pilot);
 world.forceUndock(pilot);room.world.stepBots(.01,25101);assert.equal(bot.targetId,"");assert.equal(bot.reacquireUntil,28101,"leaving the arena ends the chase");
 assert.ok(bot.patrol.returningHome || Math.acos(Math.max(-1,Math.min(1,bot.patrol.goal.reduce((sum,value,index)=>sum+value*bot.patrol.home[index],0))))*27<=bot.patrol.leash,
  "a bot that loses interest returns home or resumes a patrol route within its leash");
});

test("bot deaths create one host-transfer-safe health drop, award no kill, and respawn after fifteen seconds",()=>{
 const {room,pilot,key}=surfaceRoomPair(),world=room.world,now=8000,bot=world.bots.get(`${key}/bot-0`);
 const first=world.damageBot(bot.id,pilot,100,now);assert.deepEqual([first.applied,first.killed],[100,true]);
 assert.deepEqual([world.getPlayer(pilot).kills,world.getPlayer(pilot).deaths],[0,0]);assert.equal(room.drainEliminations().length,0,"bot deaths create no player elimination event");
 assert.equal(world.listBotDrops(now).length,1);assert.equal(world.damageBot(bot.id,pilot,100,now+1).applied,0);assert.equal(world.listBotDrops(now+1).length,1,"repeated damage cannot duplicate the drop");
 const checkpoint=room.checkpoint(now+10),restored=new authority.SurfaceAuthority();
 assert.equal(restored.restoreCheckpoint(checkpoint,now+100,90),true);
 const snapshot=restored.snapshot(1,1,now+100);assert.equal(authority.validSurfaceNetworkSnapshot(snapshot,1),true);assert.equal(snapshot.botDrops.length,1);assert.equal(snapshot.botDrops[0].heal,30);
 const restoredBot=restored.world.bots.get(bot.id),oldLife=restoredBot.lifeId;
 restored.step(.01,now+14_999);assert.equal(restoredBot.lifeId,oldLife);
 restored.step(.01,now+15_001);assert.equal(restored.world.bots.get(bot.id).lifeId,oldLife+1,"the dead bot returns at its patrol spawn");
 assert.equal(restored.world.listBotDrops(now+15_001).length,1,"respawning cannot delete a nearby health drop");
 assert.equal(restored.world.listBotDrops(now+30_100).length,0,"drops expire after thirty seconds");
});

test("bot drops stay available at full health, heal one injured claimant once, and respect the cap",()=>{
 const {room,pilot,target,key}=surfaceRoomPair(),world=room.world,now=8000,arena=world.arenas.get(key),bot=world.bots.get(`${key}/bot-0`);
 for(const pickup of arena.pickups){pickup.available=false;pickup.respawnAt=now+60_000;}
 world.damageBot(bot.id,pilot,100,now);const drop=world.listBotDrops(now)[0];assert.ok(drop);
 for(const id of [pilot,target])world.players.get(id).surface=physics.createSurfacePlayerState(drop.position);
 world.players.get(pilot).health=100;world.players.get(target).health=80;
 assert.equal(world.updatePlayer(pilot,neutralSurfaceInput,1/60,now+1),"none","full-health players leave the collectible alone");
 assert.equal(world.listBotDrops(now+1).length,1);
 assert.equal(world.updatePlayer(target,neutralSurfaceInput,1/60,now+1),"pickup");
 assert.equal(world.getPlayer(target).health,100,"+30 is capped at 100 health");
 assert.equal(world.listBotDrops(now+1).length,0,"the first successful injured pickup consumes the drop");
 world.players.get(target).health=80;
 assert.equal(world.updatePlayer(target,neutralSurfaceInput,1/60,now+2),"none","a drop cannot pay out twice");
});

test("bot bolts obey player protection and player deaths count without awarding a kill",()=>{
 const {room,pilot,target,key}=surfaceRoomPair(),world=room.world,arena=world.arenas.get(key),bot=world.bots.get(`${key}/bot-0`),player=world.players.get(pilot);
 world.forceUndock(target);
 const targetAngle=2/27;player.surface=physics.createSurfacePlayerState();player.health=10;player.protectedUntil=8100;
 bot.patrol.state=physics.createSurfacePlayerState([0,Math.cos(targetAngle),-Math.sin(targetAngle)],[0,0,1]);
 const makeShot=(sequence,at)=>{
  const muzzle=viewModule.surfaceViewPose(bot.patrol.state).muzzle,targetEye=viewModule.surfaceViewPose(player.surface).eye;
  const direction=new THREE.Vector3(...targetEye).sub(new THREE.Vector3(...muzzle)).normalize().toArray();bot.shotSequence=sequence;
  world.botShots.push({id:`${bot.id}:${bot.lifeId}:${sequence}`,botId:bot.id,arenaKey:key,sequence,position:muzzle,direction,travelled:0,startedAt:at,stoppedAt:0,simulatedAt:at});
 };
 arena.arena.walls=[];makeShot(1,8000);world.stepBots(.05,8050);assert.equal(player.health,10,"spawn protection blocks bot fire");
 makeShot(2,9000);world.stepBots(.05,9050);
 assert.equal(player.health,0);assert.equal(player.deaths,1);assert.equal(player.kills,0);assert.equal(player.respawnAt,14050);
 assert.equal(room.drainEliminations().length,0,"a bot-caused death creates no kill feed event");
 assert.equal(world.updatePlayer(pilot,neutralSurfaceInput,1/60,14049),"none");assert.equal(world.updatePlayer(pilot,neutralSurfaceInput,1/60,14050),"respawn");
 assert.equal(world.getPlayer(pilot).health,100);assert.equal(world.getPlayer(pilot).mode,"surface");
});

test("charged shots require host time, lock normal fire, preserve heat during charge and vent on the second shot", () => {
  const {room,pilot,key}=surfaceRoomPair(),world=room.world,life=world.getPlayer(pilot).lifeId;
  assert.equal(world.tryFire(pilot,1,8000,"charged").accepted,false,"cannot claim a charge without starting one");
  assert.equal(world.setCharge(pilot,true,8000,key,life),true);
  assert.equal(world.setCharge(pilot,true,8500,key,life),false,"duplicates must not reset the clock");
  assert.equal(world.tryFire(pilot,2,8500).accepted,false,"no primary fire while charging");
  const first=world.tryFire(pilot,3,9000,"charged");assert.equal(first.accepted,true);assert.equal(first.heat,55);
  assert.equal(world.setCharge(pilot,true,9199,key,life),false,"same firing cooldown");
  assert.equal(world.setCharge(pilot,true,9200,key,life),true);
  for(let at=9217;at<10200;at+=17)world.updatePlayer(pilot,neutralSurfaceInput,1/60,at);
  assert.equal(world.getPlayer(pilot).heat,55,"charging cannot cool away the second-shot vent");
  const second=world.tryFire(pilot,4,10200,"charged");assert.equal(second.accepted,true);assert.equal(second.heat,100);assert.equal(second.ventUntil,12200);
  assert.equal(world.setCharge(pilot,true,11000,key,life),false);
  assert.equal(world.tryFire(pilot,5,11000).accepted,false);
  assert.equal(world.tryFire(pilot,6,12200).heat,7);
});

test("partial, expired, cancelled and migrated charges cannot be fired or reused across lives",()=>{
 const {room,pilot,key}=surfaceRoomPair(),world=room.world,life=world.getPlayer(pilot).lifeId;
 assert.equal(world.setCharge(pilot,true,8000,"wrong",life),false);
 assert.equal(world.setCharge(pilot,true,8000,key,life+1),false);
 world.setCharge(pilot,true,8000,key,life);assert.equal(world.tryFire(pilot,1,8999,"charged").accepted,false);assert.equal(world.getPlayer(pilot).heat,0);
 world.setCharge(pilot,true,9000,key,life);world.setCharge(pilot,false,10000,key,life);assert.equal(world.tryFire(pilot,2,10001,"charged").accepted,false);
 world.setCharge(pilot,true,11000,key,life);assert.equal(world.tryFire(pilot,3,16001,"charged").accepted,false);
 world.setCharge(pilot,true,17000,key,life);const checkpoint=room.checkpoint(18000),restored=new authority.SurfaceAuthority();assert.equal(restored.restoreCheckpoint(checkpoint,18000),true);
 assert.equal(restored.world.tryFire(pilot,4,18000,"charged").accepted,false,"host migration cancels unfinished charges");
 world.damage(pilot,pilot,100,18001);assert.equal(world.tryFire(pilot,4,18002,"charged").accepted,false);
 world.updatePlayer(pilot,neutralSurfaceInput,1/60,23002);assert.notEqual(world.getPlayer(pilot).lifeId,life);
 assert.equal(world.tryFire(pilot,5,23003,"charged").accepted,false);
 world.setCharge(pilot,true,24000,key,world.getPlayer(pilot).lifeId);world.forceUndock(pilot);assert.equal(world.charges.has(pilot),false);
});

test("host charged bolts apply fifty damage once, consume armor first and survive validated checkpoint transport",()=>{
 for(const armor of [0,50]){
  const {room,key,pilot,target}=surfaceRoomPair(),angle=5/27;
  room.world.players.get(pilot).surface=physics.createSurfacePlayerState();
  Object.assign(room.world.players.get(target),{surface:physics.createSurfacePlayerState([0,Math.cos(angle),-Math.sin(angle)]),armor});
  const life=room.world.getPlayer(pilot).lifeId;room.world.setCharge(pilot,true,7000,key,life);room.step(1/60,8000);
  const muzzle=viewModule.surfaceViewPose(room.world.getPlayer(pilot).surface).muzzle;
  const aim=new THREE.Vector3(0,28.2*Math.cos(angle),-28.2*Math.sin(angle)).sub(new THREE.Vector3(...muzzle)).normalize().toArray();
  const fired=room.fire(pilot,1,8000,aim,[8000],8000,key,life,"charged");assert.equal(fired.accepted,true);assert.equal(fired.projectile.kind,"charged");assert.equal(fired.player.heat,55);
  const snapshot=room.snapshot(1,1,8000);assert.equal(authority.validSurfaceNetworkSnapshot(snapshot,1),true);
  const malformed=structuredClone(snapshot);malformed.projectiles[0].kind="instant-kill";assert.equal(authority.validSurfaceNetworkSnapshot(malformed,1),false);
  const cp=room.checkpoint(8000),restored=new authority.SurfaceAuthority();assert.equal(restored.restoreCheckpoint(cp,8000),true);assert.equal(restored.snapshot(1,1,8000).projectiles[0].kind,"charged");
  cp.projectiles[0].shot.kind="instant-kill";assert.equal(new authority.SurfaceAuthority().restoreCheckpoint(cp,8000),false);
  for(let tick=1;tick<=25;tick++)room.step(1/60,8000+tick*17);
  assert.equal(room.world.getPlayer(target).health,armor?100:50);assert.equal(room.world.getPlayer(target).armor,0);
  assert.equal(room.snapshot(1,2,8425).hitConfirmations.length,1);
 }
});

test("solo charged bolts damage a shared-simulation bot once and keep their wider visual",()=>{
 const previousNow=Date.now;let now=9000;Date.now=()=>now;
 try {
 const world=new worldModule.SurfaceWorld();world.setOwnerMap("solo",surfaceFixture(),new Float32Array([0,0,0,8,0,0]));
 world.addPlayer("solo",identityShip([0,0,38]));assert.equal(world.dock("solo","solo/hub",4000),true);
 const arena=world.arenas.get("solo/hub");arena.arena.walls=[];world.players.get("solo").surface=physics.createSurfacePlayerState();
 const angle=5/27,bot=world.bots.get("solo/hub/bot-0");bot.patrol.state=physics.createSurfacePlayerState([0,Math.cos(angle),-Math.sin(angle)],[0,0,-1]);
 assert.equal(world.setCharge("solo",true,now-1000,"solo/hub",world.getPlayer("solo").lifeId),true);
 const hits=[],renderer=Object.create(rendering.ConstellationRenderer.prototype);
 Object.assign(renderer,{scene:new THREE.Scene(),roomCombatEnabled:true,surfaceBotVisuals:new Map(),surfaceBotShotVisuals:new Map(),surfaceBotDropVisuals:new Map(),surfaceDisplayCenters:new Map(),surfaceBolts:[],surfaceWorld:world,multiplayer:false,surfaceAudio:{play(){}},surfacePilot:{confirmTrainingHit:id=>hits.push(id)},roomSurfaceLaserColor:"#8CECFF"});
 const pose=viewModule.surfaceViewPose(world.getPlayer("solo").surface),aim=new THREE.Vector3(...viewModule.surfaceViewPose(bot.patrol.state).eye).sub(new THREE.Vector3(...pose.muzzle)).normalize();
 const graphic=new visuals.SurfaceBoltGraphic("#FF8800",true),normal=new visuals.SurfaceBoltGraphic("#FF8800");
 graphic.setSegment(new THREE.Vector3(),new THREE.Vector3(0,1,0));normal.setSegment(new THREE.Vector3(),new THREE.Vector3(0,1,0));assert.ok(graphic.core.scale.x>normal.core.scale.x*2);normal.dispose();renderer.scene.add(graphic);
 renderer.onSurfaceFire(viewModule.surfaceToWorld(pose.muzzle,[0,0,0]),aim.toArray(),1,now,"charged");
 for(let tick=1;tick<=10;tick++){now=9000+tick*17;renderer.updateSurfaceCombat(1/60,now);}
 assert.equal(bot.health,50);assert.equal(bot.armor,0);assert.equal(hits.length,1);
 renderer.updateSurfaceCombat(1/60,now+17);assert.equal(bot.health,50,"stopped charged bolt cannot hit twice");
 renderer.scene.remove(graphic);graphic.dispose();renderer.clearSurfaceCombat();assert.equal(renderer.scene.children.length,0);
 } finally { Date.now=previousNow; }
});
