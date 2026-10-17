import test from "node:test";
import assert from "node:assert/strict";
import { basename } from "node:path";
import { build } from "esbuild";

const built = await build({
  entryPoints: ["src/multiplayer.ts", "src/combat.ts", "src/sim.ts", "src/interpolation.ts", "src/surfaceAuthority.ts", "src/networkJson.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outdir: "test-bundles",
  entryNames: "[name]",
  write: false,
});
async function loadBundle(name) {
  const file = built.outputFiles.find(f => basename(f.path) === `${name}.js`);
  assert.ok(file, `missing ${name} bundle`);
  return import(`data:text/javascript;base64,${Buffer.from(file.text).toString("base64")}`);
}
const network = await loadBundle("multiplayer");
const combat = await loadBundle("combat");
const sim = await loadBundle("sim");
const interpolation = await loadBundle("interpolation");
const surfaceAuthority = await loadBundle("surfaceAuthority");
const wire = await loadBundle("networkJson");
const jsonPacket = packet => packet instanceof ArrayBuffer && wire.compressedNetworkJson(packet) ? wire.decodeNetworkJson(packet) : packet;

const dockOwner = "11111111-1111-4111-8111-111111111111", dockGuest = "22222222-2222-4222-8222-222222222222";
const dockHub = "n-33333333-3333-4333-8333-333333333333";
const dockTarget = { ownerId: dockOwner, starId: dockHub, revision: 1 };

test("local publications notify the renderer across graph refresh, layout republication and rejoin", () => {
  const publications = [], rendered = { owner: "", topology: null };
  const session = new network.MultiplayerSession(callbacks({
    localTopology(owner, topology) { rendered.owner = owner; rendered.topology = topology; publications.push(topology); },
    members(_members, owner) { if (!owner) { rendered.owner = ""; rendered.topology = null; } },
  }), () => ({ data: fixture(), nodes: [] }));
  Object.assign(session, { selfId: dockOwner, hostId: dockGuest });
  session.setLocalGraph(fixture());
  const hub = session.localTopology.nodes[0].id;
  session.setLocalGraph(fixture()); session.republishLocalLayout();
  assert.deepEqual(publications.map(topology => topology.revision), [1, 2, 3]);
  assert.equal(rendered.topology, session.localTopology); assert.equal(rendered.owner, dockOwner);
  assert.ok(publications.every(topology => topology.nodes[0].id === hub));
  assert.ok(privateMarkers.every(marker => !JSON.stringify(publications).includes(marker)));
  const previousWindow = globalThis.window; globalThis.window = globalThis;
  try { session.leave(); } finally { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; }
  assert.equal(rendered.topology, null);
  session.setLocalGraph(fixture()); assert.equal(publications.length, 3, "closed sessions do not publish");
  Object.assign(session, { selfId: dockGuest, hostId: dockOwner, closed: false });
  session.setLocalGraph(fixture());
  assert.equal(rendered.owner, dockGuest); assert.equal(rendered.topology.revision, 1);
  assert.notEqual(rendered.topology.nodes[0].id, hub, "rejoining does not revive the previous session IDs");
});

test("failed graph generation preserves publication state and later errors cannot roll its revision back", () => {
  const publications = [], errors = [];
  const session = new network.MultiplayerSession(callbacks({ localTopology: (_owner, topology) => publications.push(topology), status: text => errors.push(text) }), () => ({ data: fixture(), nodes: [] }));
  Object.assign(session, { selfId: dockOwner, hostId: dockGuest });
  session.setLocalGraph(fixture());
  const previous = session.localTopology, ids = [...session.ids];
  const broken = { nodes: [{ id: "new-private-file", group: "g", deg: 0 }], links: [], get groups() { throw new Error("generation failed"); } };
  session.setLocalGraph(broken);
  assert.equal(session.localTopology, previous); assert.equal(session.revision, 1);
  assert.deepEqual([...session.ids], ids); assert.equal(publications.length, 1);
  session.refreshSurfaceMap = () => { throw new Error("surface refresh failed"); };
  session.setLocalGraph(fixture());
  assert.equal(session.revision, 2); assert.equal(session.localTopology.revision, 2);
  assert.equal(publications.at(-1), session.localTopology);
  assert.deepEqual(errors, ["generation failed", "surface refresh failed"]);
});

function dockingHost(overrides = {}) {
  const topology = { revision: 1, nodes: [{ id: dockHub, group: 0, degree: 0, dockable: true }], links: [] };
  const host = new network.MultiplayerSession(callbacks(overrides), () => ({ data: fixture(), nodes: [{ x: 0, y: 0, z: 0 }] }));
  const world = new combat.CombatWorld(1), authority = new surfaceAuthority.SurfaceAuthority();
  Object.assign(host, { selfId: dockOwner, hostId: dockOwner, epoch: 1, authorityReady: true, topology, world, surfaceAuthority: authority,
    surfaceRoundId: world.currentRoundId, roster: [{ id: dockOwner, name: "Host", slot: 0 }] });
  world.add(host.roster[0]);
  Object.assign(world.players.get(dockOwner), { active: true }); world.players.get(dockOwner).pos.set(0, 0, 12);
  authority.addPlayer(dockOwner, { position: [0, 0, 12], rotation: [0, 0, 0, 1], velocity: [0, 0, 0] });
  authority.setOwnerMap(dockOwner, topology, new Float32Array([0, 0, 0]));
  return host;
}

test("host-only docking publishes the surface entry and synchronizes the return to its ship", () => {
  const results = [], states = [], host = dockingHost({ surfaceDockResult: (...args) => results.push(args), surfaceState: state => states.push(state) });
  host.requestSurfaceDock(dockTarget);
  assert.deepEqual(results, [[1, true, undefined]]);
  assert.equal(host.world.isSurfaceDocked(dockOwner), true);
  assert.equal(host.pendingSurfaceDock.accepted, true, "acceptance still waits for surface state");
  host.publishSurfaceState(Date.now());
  assert.equal(host.pendingSurfaceDock, null);
  assert.equal(states[0].players.find(player => player.id === dockOwner).mode, "surface");
  assert.equal(states[0].players[0].arenaKey, `${dockOwner}/${dockHub}`);
  assert.equal(host.surfaceAuthority.forceUndock(dockOwner), true);
  host.stepSurfaceAuthority(1 / 60, Date.now()); host.publishSurfaceState(Date.now());
  assert.equal(host.world.isSurfaceDocked(dockOwner), false);
  assert.equal(states.at(-1).players.find(player => player.id === dockOwner).mode, "ship");
});

test("republishing keeps current docking valid while rejecting the previous revision", () => {
  const results = [], host = dockingHost({ surfaceDockResult: (...args) => results.push(args) });
  const data = { groups: [{ key: "g", color: "#123456", count: 1 }], nodes: [{ id: "Private/Main.md", group: "g", deg: 0 }], links: [] };
  Object.assign(host, { revision: 1, ids: new Map([[data.nodes[0].id, dockHub]]), graph: () => ({ data, nodes: [{ x: 0, y: 0, z: 0 }] }) });
  host.setLocalGraph(data);
  assert.equal(host.localTopology.revision, 2);
  host.requestSurfaceDock(dockTarget);
  assert.deepEqual(results.at(-1), [1, false, "target"]);
  host.requestSurfaceDock({ ...dockTarget, revision: 2 });
  assert.deepEqual(results.at(-1), [2, true, undefined]);
});

function dockingClient(results) {
  const client = new network.MultiplayerSession(callbacks({ surfaceDockResult: (...args) => results.push(args) }), () => ({ data: fixture(), nodes: [] }));
  Object.assign(client, { selfId: dockGuest, hostId: dockOwner, epoch: 1, authorityReady: true, roster: [{ id: dockOwner }, { id: dockGuest }] });
  client.peers.set(dockOwner, peerStub()); return client;
}

test("guest docking completes over the reliable control and surface state lanes without changing the host HUD", () => {
  const results = [], hostResults = [], client = dockingClient(results), host = dockingHost({ surfaceDockResult: (...args) => hostResults.push(args) });
  host.roster.push({ id: dockGuest, name: "Guest", slot: 1 }); host.world.add(host.roster[1]); host.world.players.get(dockGuest).pos.set(0, 0, 12); host.world.players.get(dockGuest).active = true;
  host.surfaceAuthority.addPlayer(dockGuest, { position: [0, 0, 12], rotation: [0, 0, 0, 1], velocity: [0, 0, 0] });
  host.peers.set(dockGuest, peerStub());
  client.requestSurfaceDock(dockTarget);
  host.onPeerMessage(dockGuest, client.peers.get(dockOwner).control.raw[0], "control");
  for (const packet of host.peers.get(dockGuest).control.raw) client.onPeerMessage(dockOwner, packet, "control");
  assert.deepEqual(results, [[1, true, undefined]]); assert.deepEqual(hostResults, []);
  host.publishSurfaceState(Date.now());
  for (const packet of host.peers.get(dockGuest).control.raw) client.onPeerMessage(dockOwner, packet, "control");
  for (const packet of host.peers.get(dockGuest).live.raw) client.onPeerMessage(dockOwner, packet, "live");
  assert.equal(client.pendingSurfaceDock, null, "decoded surface state completes the pending guest request");
});

test("docking reports stale topology, admission rejection, readiness, and failed reliable sends", () => {
  const results = [], host = dockingHost({ surfaceDockResult: (...args) => results.push(args) });
  host.requestSurfaceDock({ ...dockTarget, revision: 2 }); assert.deepEqual(results.at(-1), [1, false, "target"]);
  host.world.players.get(dockOwner).active = false;
  host.requestSurfaceDock(dockTarget); assert.deepEqual(results.at(-1), [2, false, undefined]);
  host.authorityReady = false; host.requestSurfaceDock(dockTarget); assert.deepEqual(results.at(-1), [3, false, "not-ready"]);
  host.authorityReady = true; host.requestSurfaceDock({ ...dockTarget, starId: "Private/Main.md" }); assert.deepEqual(results.at(-1), [4, false, "target"]);
  assert.equal(host.pendingSurfaceDock, null);
  for (const state of ["closed", "congested", "throwing"]) {
    const client = dockingClient(results), channel = client.peers.get(dockOwner).control;
    if (state === "closed") channel.readyState = "closed";
    if (state === "congested") channel.bufferedAmount = 128001;
    if (state === "throwing") channel.send = () => { throw new Error("connection lost"); };
    client.requestSurfaceDock(dockTarget); assert.deepEqual(results.at(-1), [1, false, "connection"]); assert.equal(client.pendingSurfaceDock, null);
  }
});

test("docking timeout covers missing results and missing entry; stale results cannot affect retries", () => {
  for (const accepted of [false, true]) {
    const results = [], client = dockingClient(results), sendResult = (sequence, accepted, epoch = 1) => client.onPeerMessage(dockOwner, JSON.stringify({ type: "surface-dock-result", epoch, sequence, accepted }), "control");
    client.requestSurfaceDock(dockTarget);
    const started = client.pendingSurfaceDock.startedAt;
    if (accepted) sendResult(1, true);
    client.expireSurfaceDock(started + 4999); assert.ok(client.pendingSurfaceDock);
    client.expireSurfaceDock(started + 5000); assert.equal(client.pendingSurfaceDock, null); assert.deepEqual(results.at(-1), [1, false, "timeout"]);
    const before = results.length; sendResult(1, true); assert.equal(results.length, before);
    client.requestSurfaceDock(dockTarget); sendResult(1, false); sendResult(2, false, 0); assert.equal(results.length, before);
    sendResult(2, false); assert.deepEqual(results.at(-1), [2, false, undefined]); assert.equal(client.pendingSurfaceDock, null);
  }
});

test("pending docking is cleared on authority reset, host change, and room leave", () => {
  const results = [], client = dockingClient(results);
  client.requestSurfaceDock(dockTarget); client.resetSurfaceTransport(); assert.deepEqual(results.at(-1), [1, false, "interrupted"]);
  client.requestSurfaceDock(dockTarget); client.hostId = dockGuest; client.epoch++; client.expireSurfaceDock(Date.now()); assert.deepEqual(results.at(-1), [2, false, "interrupted"]);
  client.hostId = dockOwner; client.requestSurfaceDock(dockTarget);
  const previousWindow = globalThis.window; globalThis.window = globalThis;
  try { client.peers.clear(); client.leave(); } finally { if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; }
  assert.deepEqual(results.at(-1), [3, false, "interrupted"]); assert.equal(client.pendingSurfaceDock, null);
});

const privateMarkers = ["PRIVATE_TITLE_CobaltVault", "PRIVATE_PATH_Secrets/Bluebird.md", "PRIVATE_TAG_Clinical", "PRIVATE_BODY_needle" ];
function fixture() {
  return {
    groups: [{ key: privateMarkers[2], label: privateMarkers[2], color: "#2468ac", count: 2 }],
    nodes: [
      { id: privateMarkers[1], name: privateMarkers[0], tags: [privateMarkers[2]], body: privateMarkers[3], group: privateMarkers[2], deg: 1 },
      { id: "another/LocalOnly.md", name: "Another private title", group: privateMarkers[2], deg: 1 },
    ],
    links: [{ source: privateMarkers[1], target: "another/LocalOnly.md", privateLabel: "never sent" }],
  };
}
function callbacks(overrides = {}) {
  return {
    status() {}, members() {}, topology() {}, positions() {}, message() {}, removed() {}, authority() {}, playerState() {}, shotState() {},
    ...overrides,
  };
}
function peerStub(topology = undefined) {
  return {
    pc: {}, signalChain: Promise.resolve(), pendingCandidates: [], topology, positionSequence: 0, lastPositionSequence: 0, topologySend: null, topologyReceive: null,
    positionReceive: new Map(),
    control: { readyState: "open", bufferedAmount: 0, sent: [], raw: [], send(message) { this.raw.push(message); this.sent.push(jsonPacket(message)); } },
    live: { readyState: "open", bufferedAmount: 0, sent: [], raw: [], send(message) { this.raw.push(message); this.sent.push(jsonPacket(message)); } },
  };
}

test("congested live state coalesces latest streams while fire dispositions bypass the pending snapshots", () => {
  const session = new network.MultiplayerSession(callbacks(), () => ({ data: fixture(), nodes: [] }));
  const peer = peerStub(); session.peers.set("guest", peer);
  peer.live.bufferedAmount = 4096;
  for (let sequence = 1; sequence <= 100; sequence++) {
    session.sendTo("guest", { type: "ship", epoch: 1, playerId: "pilot", sequence, pose: { newest: sequence } });
    session.sendTo("guest", { type: "surface-state", epoch: 1, state: { sequence, arenas: [] } });
    session.sendTo("guest", { type: "surface-input", epoch: 1, frames: [{ sequence }] });
  }
  assert.equal(peer.live.sent.length, 0, "replaceable frames stay out of the occupied SCTP queue");
  assert.equal(session.liveLatest.get("guest").size, 3, "bounded by streams, not elapsed congested ticks");
  session.sendTo("guest", { type: "surface-fire-result", epoch: 1, sequence: 7, accepted: true });
  assert.equal(JSON.parse(peer.live.sent[0]).type, "surface-fire-result");
  peer.live.bufferedAmount = 0;
  peer.live.send = function(message) { this.sent.push(message); this.bufferedAmount += 4096; };
  session.flushLiveState("guest");
  assert.equal(peer.live.sent.length, 2, "only one batch enters an undrained channel");
  assert.equal(JSON.parse(peer.live.sent[1]).sequence, 100);
  peer.live.bufferedAmount = 0; session.flushLiveState("guest");
  assert.equal(JSON.parse(peer.live.sent[2]).state.sequence, 100, "the next stream gets a turn with its newest state");
  peer.live.bufferedAmount = 0; session.flushLiveState("guest");
  assert.equal(JSON.parse(peer.live.sent[3]).frames[0].sequence, 100);
  assert.equal(session.liveLatest.get("guest").size, 0);
  peer.live.bufferedAmount = 4096; session.sendTo("guest", { type: "surface-state", epoch: 1, state: { sequence: 101, arenas: [] } });
  session.resetSurfaceTransport(); assert.equal(session.liveLatest.size, 0, "an authority reset cannot flush stale-epoch state");
});

test("compact state cannot accumulate below the former four-KB batch threshold", () => {
  const session = new network.MultiplayerSession(callbacks(), () => ({ data: fixture(), nodes: [] }));
  const peer = peerStub(); session.peers.set("guest", peer);
  peer.live.send = function(message) { this.sent.push(jsonPacket(message)); this.bufferedAmount += 100; };
  for (let sequence = 1; sequence <= 100; sequence++) session.sendTo("guest", { type: "surface-input", epoch: 1, frames: [{ sequence }] });
  assert.equal(peer.live.sent.length, 1, "one small unsent message blocks further replaceable state");
  assert.equal(JSON.parse(peer.live.sent[0]).frames[0].sequence, 1);
  assert.equal(session.liveLatest.get("guest").size, 1);
  peer.live.bufferedAmount = 0; session.flushLiveState("guest");
  assert.equal(peer.live.sent.length, 2);
  assert.equal(JSON.parse(peer.live.sent[1]).frames[0].sequence, 100, "only the newest pending controls enter SCTP");
  session.sendTo("guest", { type: "surface-fire-result", epoch: 1, sequence: 101, accepted: true });
  assert.equal(JSON.parse(peer.live.sent[2]).type, "surface-fire-result", "authoritative dispositions still bypass pending state");
});

test("checkpoint publication skips a busy reliable queue instead of accumulating stale copies", () => {
  const session = new network.MultiplayerSession(callbacks(), () => ({ data: fixture(), nodes: [] }));
  const peer = peerStub(); session.peers.set("guest", peer);
  peer.control.bufferedAmount = 1;
  session.sendReliableAll({ type: "checkpoint", epoch: 1, sentAt: 100, state: {} });
  assert.equal(peer.control.sent.length, 0);
  session.sendReliableAll({ type: "round-state", epoch: 1, state: {} });
  assert.equal(peer.control.sent.length, 1, "round events retain their existing reliable delivery path");
  peer.control.bufferedAmount = 0;
  session.sendReliableAll({ type: "checkpoint", epoch: 1, sentAt: 200, state: {} });
  assert.equal(JSON.parse(peer.control.sent[1]).sentAt, 200);
});

test("real session lanes acknowledge validated geometry and reconstruct later compact snapshots", () => {
  const owner = "11111111-1111-4111-8111-111111111111", guestId = "22222222-2222-4222-8222-222222222222", hub = "n-33333333-3333-4333-8333-333333333333";
  const authority = new surfaceAuthority.SurfaceAuthority();
  authority.setOwnerMap(owner, { revision: 1, nodes: [{ id: hub, group: 0, degree: 0, dockable: true }], links: [] }, new Float32Array([0, 0, 0]));
  authority.addPlayer(guestId, { position: [0, 0, 38 * 6 / 27], rotation: [0, 0, 0, 1], velocity: [0, 0, 0], lastDamageAt: 0 });
  assert.equal(authority.dock(guestId, owner, hub, 4000), true);
  const views = [], host = new network.MultiplayerSession(callbacks(), () => ({ data: fixture(), nodes: [] }));
  const client = new network.MultiplayerSession(callbacks({ surfaceState: snapshot => views.push(snapshot) }), () => ({ data: fixture(), nodes: [] }));
  Object.assign(host, { selfId: owner, hostId: owner, epoch: 1 }); Object.assign(client, { selfId: guestId, hostId: owner, epoch: 1 });
  const hostPeer = peerStub(), clientPeer = peerStub(); host.peers.set(guestId, hostPeer); client.peers.set(owner, clientPeer);
  host.sendTo(guestId, { type: "surface-state", epoch: 1, state: authority.snapshot(1, 1, 5000) });
  for (const packet of hostPeer.control.raw) client.onPeerMessage(owner, packet, "control");
  client.onPeerMessage(owner, hostPeer.live.raw[0], "live");
  assert.equal(views.length, 1); assert.equal(JSON.parse(clientPeer.control.sent[0]).type, "surface-geometry-ready");
  host.onPeerMessage(guestId, clientPeer.control.raw[0], "control");
  host.sendTo(guestId, { type: "surface-state", epoch: 1, state: authority.snapshot(1, 2, 5050) });
  assert.equal(typeof JSON.parse(hostPeer.live.sent[1]).state.arenas[0].arena, "number");
  client.onPeerMessage(owner, hostPeer.live.raw[1], "live");
  assert.equal(views.length, 2); assert.deepEqual(views[1].arenas[0].arena, views[0].arenas[0].arena);
  client.resetSurfaceTransport();
  client.onPeerMessage(owner, hostPeer.live.raw[1], "live");
  assert.equal(views.length, 2, "a reference with no cached geometry never reaches presentation");
  const repair = clientPeer.control.raw.at(-1); assert.equal(JSON.parse(jsonPacket(repair)).type, "surface-geometry-needed");
  host.onPeerMessage(guestId, repair, "control");
  host.sendTo(guestId, { type: "surface-state", epoch: 1, state: authority.snapshot(1, 3, 5100) });
  for (const packet of hostPeer.control.raw) client.onPeerMessage(owner, packet, "control");
  client.onPeerMessage(owner, hostPeer.live.raw[2], "live"); assert.equal(views.length, 3);
});

test("large surface checkpoints arrive atomically in bounded reliable chunks", () => {
  const owner = "11111111-1111-4111-8111-111111111111", now = Date.now();
  const authority = new surfaceAuthority.SurfaceAuthority();
  const nodes = Array.from({ length: 128 }, (_, index) => ({ id: `n-00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, group: index, degree: 0, dockable: true }));
  authority.setOwnerMap(owner, { revision: 1, nodes, links: [] }, new Float32Array(nodes.length * 3));
  for (const arena of authority.world.arenas.values()) Object.assign(arena.pickups[0], { available: false, respawnAt: now + 15000 });
  const state = { ...new combat.CombatWorld(1).snapshot(now), surface: authority.checkpoint(now) };
  assert.ok(JSON.stringify(state).length > 128000, "exercise the former receive limit");
  const host = new network.MultiplayerSession(callbacks(), () => ({ data: fixture(), nodes: [] }));
  const client = new network.MultiplayerSession(callbacks(), () => ({ data: fixture(), nodes: [] }));
  Object.assign(host, { selfId: owner, hostId: owner, epoch: 1 }); Object.assign(client, { selfId: "guest", hostId: owner, epoch: 1 });
  const outgoing = peerStub(); host.peers.set("guest", outgoing); client.peers.set(owner, peerStub());
  host.sendReliableAll({ type: "checkpoint", epoch: 1, sentAt: now, state });
  assert.ok(outgoing.control.sent.length > 1);
  for (const packet of outgoing.control.sent) { assert.ok(packet.length < 64000); assert.equal(JSON.parse(packet).type, "checkpoint-chunk"); }
  assert.ok(outgoing.control.raw.some(packet => packet instanceof ArrayBuffer), "large checkpoint parts use bounded compressed wire frames");
  const [first, ...rest] = outgoing.control.raw;
  client.onPeerMessage(owner, first, "control"); client.onPeerMessage(owner, first, "control");
  assert.equal(client.lastCheckpoint, null, "partial and duplicate parts cannot commit state");
  for (const packet of rest.reverse()) client.onPeerMessage(owner, packet, "control");
  assert.equal(client.lastCheckpoint.sentAt, now);
  assert.equal(client.lastCheckpoint.state.surface.world.arenas.length, 128);
  assert.equal(client.checkpointReceive, null);
  const malformed = { ...JSON.parse(jsonPacket(first)), sentAt: now + 1, total: Math.ceil(32 * 1024 * 1024 / 16000) + 1 };
  client.onPeerMessage(owner, JSON.stringify(malformed), "control"); assert.equal(client.checkpointReceive, null);
  client.epoch = 2; client.onPeerMessage(owner, first, "control"); assert.equal(client.checkpointReceive, null);
});

test("surface fire retries recover lost requests and results without repeating authority or callbacks", () => {
  const dispositions = [];
  const client = new network.MultiplayerSession(callbacks({ surfaceFireResult: (...value) => dispositions.push(value) }), () => ({ data: fixture(), nodes: [] }));
  const host = new network.MultiplayerSession(callbacks(), () => ({ data: fixture(), nodes: [] }));
  Object.assign(client, { selfId: "guest", hostId: "host", authorityReady: true, epoch: 1 });
  Object.assign(host, { selfId: "host", hostId: "host", authorityReady: true, epoch: 1, world: { roundPhase: "combat" } });
  const hostPeer = peerStub(), guestPeer = peerStub(); client.peers.set("host", hostPeer); host.peers.set("guest", guestPeer);
  let calls = 0; host.surfaceAuthority = { fire() { calls++; return { accepted: true }; } };
  const originalNow = Date.now; let now = 10000; Date.now = () => now;
  try {
    client.fireSurface(1, now - 75, "arena", 1, [0, 0, -1]);
    assert.equal(hostPeer.control.sent.length, 0); assert.equal(hostPeer.live.sent.length, 1);
    now += 100; client.retrySurfaceFire(now); // First request lost.
    host.onPeerMessage("guest", hostPeer.live.sent.at(-1), "live");
    assert.equal(calls, 1);
    now += 100; client.retrySurfaceFire(now); // First disposition lost.
    host.onPeerMessage("guest", hostPeer.live.sent.at(-1), "live");
    assert.equal(calls, 1, "a retry returns the cached accepted disposition without firing again");
    client.onPeerMessage("host", guestPeer.live.sent.at(-1), "live");
    client.onPeerMessage("host", guestPeer.live.sent.at(-1), "live");
    assert.deepEqual(dispositions, [[1, true]]);
    assert.equal(client.pendingSurfaceFire.size, 0);
    client.fireSurface(2, now - 75, "arena", 1, [0, 0, -1]);
    now += 1000; client.retrySurfaceFire(now);
    assert.equal(client.pendingSurfaceFire.size, 0);
    assert.deepEqual(dispositions, [[1, true]], "local expiry must not pretend to be an authoritative disposition");
    client.fireSurface(3, now - 75, "arena", 1, [0, 0, -1]);
    client.acknowledgeSurfaceInputs({ players: [{ id: "guest", mode: "surface", arenaKey: "arena", lifeId: 2, inputSequence: 0 }] });
    assert.equal(client.pendingSurfaceFire.size, 0, "no old-life retries");
    const before = calls;
    host.onPeerMessage("guest", JSON.stringify({ type: "surface-fire", epoch: 0, sequence: 4, viewTime: now, arenaKey: "arena", lifeId: 1, direction: [0, 0, -1] }), "live");
    assert.equal(calls, before);
    host.resetSurfaceTransport(); assert.equal(host.surfaceFireResults.size, 0);
  } finally { Date.now = originalNow; }
});

test("checkpoint age uses synchronized host time and retains a local recovery timestamp", () => {
  const client = new network.MultiplayerSession(callbacks(), () => ({ data: fixture(), nodes: [] }));
  Object.assign(client, { selfId: "guest", hostId: "host", epoch: 1 }); client.peers.set("host", peerStub());
  assert.equal(client.surfaceClock.observePing(19800, 18850, 18850, 19900), true);
  const surface = new surfaceAuthority.SurfaceAuthority(), state = { ...new combat.CombatWorld(1).snapshot(18950), surface: surface.checkpoint(18950) };
  const originalNow = Date.now; Date.now = () => 20000;
  try {
    client.onPeerMessage("host", JSON.stringify({ type: "checkpoint", epoch: 1, sentAt: 18950, state }), "control");
    assert.equal(client.lastCheckpoint.sentAt, 19950, "50 ms delivery age, independent of the 1-second clock offset");
    assert.equal(client.lastCheckpointWireAt, 18950);
    client.onPeerMessage("host", JSON.stringify({ type: "checkpoint", epoch: 1, sentAt: 18940, state }), "control");
    assert.equal(client.lastCheckpoint.sentAt, 19950, "a stale host timestamp cannot replace the accepted checkpoint");
  } finally { Date.now = originalNow; }
});

test("anonymous topology and all application packets omit local vault metadata", () => {
  const ids = new Map();
  const topology = network.makeAnonymousTopology(fixture(), ids, 1);
  const text = JSON.stringify(topology);
  for (const marker of privateMarkers) assert.equal(text.includes(marker), false);
  assert.equal(topology.nodes.length, 2);
  assert.equal(topology.nodes.filter(node => node.dockable).length, 1, "each populated group publishes one anonymous docking hub");
  assert.equal(topology.nodes.find(node => node.dockable).id, topology.nodes[0].id, "degree ties choose the first local path without exposing it");
  assert.deepEqual(topology.links, [[topology.nodes[0].id, topology.nodes[1].id]]);
  assert.match(topology.nodes[0].id, /^n-[0-9a-f-]{36}$/i);

  const sent = [];
  const session = new network.MultiplayerSession(callbacks(), () => ({ data: fixture(), nodes: [{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }] }), () => "ws://localhost:8787");
  const self = "11111111-1111-4111-8111-111111111111", peerId = "22222222-2222-4222-8222-222222222222";
  session.selfId = self; session.hostId = peerId; session.epoch = 4;
  session.roster = [{ id: self, name: "Host" }, { id: peerId, name: "Remote" }];
  const peer = peerStub(); session.peers.set(peerId, peer);
  session.setLocalGraph(fixture());
  session.pumpTopologies();
  session.sendPositionsTo(peerId);
  session.sendInput({ sequence: 1, thrust: 1, strafe: 0, lift: 0, roll: 0, pitch: 0, yaw: 0, boost: false, brake: false, fire: false, active: true, mouseMode: "capture", mouseSamples: [], sensitivity: 1, agility: 1, invertY: false });
  session.fire(1, 2, 0, [10, 20, 30]);
  session.requestFastTravel({ ownerId: session.selfId, starId: session.localTopology.nodes[0].id, revision: session.localTopology.revision });

  // Capture actual host round and elimination messages too. These contain only
  // anonymous player IDs, scores, round timing, and topology revisions.
  const world = new combat.CombatWorld(4);
  world.add({ id: self, slot: 0, name: "Synthetic Host", joinedAt: 1 });
  world.add({ id: peerId, slot: 1, name: "Synthetic Peer", joinedAt: 2 });
  const shooter = world.players.get(self), victim = world.players.get(peerId);
  shooter.pos.set(0, 0, 0); shooter.active = true; shooter.input.active = true;
  victim.pos.set(0, 0, -100); victim.shields = 0; victim.health = 10; victim.active = true; victim.input.active = true;
  assert.equal(world.fireShot(self, 1, 0, 10_000, undefined, 0), true);
  for (let frame = 1; frame <= 8 && victim.health > 0; frame++) world.step(1 / 60, 10_000 + frame * 17);
  const elimination = world.drainEliminations()[0];
  assert.ok(elimination);
  session.sendReliableAll({ type: "round-state", epoch: 4, state: world.roundSnapshot(10_200) });
  session.sendReliableAll({ type: "elimination", epoch: 4, event: elimination });
  sent.push(...peer.control.sent, ...peer.live.sent.map(v => v instanceof ArrayBuffer ? Buffer.from(v).toString("base64") : v));
  for (const marker of privateMarkers) assert.equal(JSON.stringify(sent).includes(marker), false);
});

test("topology limits reject rather than truncate oversized maps", () => {
  const node = { id: "local", group: "folder", deg: 0 };
  assert.throws(() => network.makeAnonymousTopology({ groups: [], nodes: Array(network.MAX_SHARED_NODES + 1).fill(node), links: [] }, new Map(), 1), /supports up to/);
  assert.throws(() => network.makeAnonymousTopology({ groups: [], nodes: [node], links: Array(network.MAX_SHARED_LINKS + 1).fill({ source: "local", target: "local" }) }, new Map(), 1), /supports up to/);
});

test("topology revisions and position snapshots reject stale or malformed traffic", () => {
  const accepted = [], positions = [];
  const session = new network.MultiplayerSession(callbacks({ topology: (_id, value) => accepted.push(value.revision), positions: (_id, value) => positions.push([...value]) }), () => ({ data: fixture(), nodes: [] }), () => "ws://localhost:8787");
  const topology = network.makeAnonymousTopology(fixture(), new Map(), 1);
  const peer = peerStub(); session.peers.set("owner", peer);
  const sendTopology = value => session.onPeerMessage("owner", JSON.stringify({ type: "topology-chunk", revision: value.revision, index: 0, total: 1, data: JSON.stringify(value) }), "control");
  sendTopology({ ...topology, revision: 2 });
  sendTopology(topology);
  sendTopology({ ...topology, revision: 3, nodes: topology.nodes.map(node => ({ ...node, dockable: false })) });
  sendTopology({ ...topology, revision: 4, nodes: topology.nodes.map((node, i) => ({ ...node, dockable: i === 0 })) });
  sendTopology({ ...topology, revision: 5, nodes: topology.nodes.map((node, i) => ({ ...node, degree: i === 0 ? 0 : 2, dockable: i === 0 })) });
  session.onPeerMessage("owner", JSON.stringify({ type: "topology-chunk", revision: 3, index: 0, total: 1, data: "{broken" }), "control");
  assert.deepEqual(accepted, [2, 4], "a topology needs exactly one dockable note in each populated group");

  const nodes = [{ x: 10, y: 20, z: 30 }, { x: -4, y: 5, z: 6 }];
  const frames = network.encodePositionChunks(nodes, { ...topology, revision: 4 }, 8);
  for (const frame of [...frames].reverse()) session.onPeerMessage("owner", frame, "live");
  for (const frame of network.encodePositionChunks(nodes, { ...topology, revision: 4 }, 7)) session.onPeerMessage("owner", frame, "live");
  const wrongRevision = network.encodePositionChunks(nodes, { ...topology, revision: 1 }, 9)[0];
  session.onPeerMessage("owner", wrongRevision, "live");
  assert.equal(positions.length, 1);
  assert.deepEqual(positions[0], [10, 20, 30, -4, 5, 6]);
  session.onPeerMessage("owner", JSON.stringify({ type: "open", path: privateMarkers[1] }), "live");
  assert.deepEqual(accepted, [2, 4]);
});

test("host accepts only current-epoch anonymous navigation and bounded authoritative fire requests", () => {
  const selfId = "11111111-1111-4111-8111-111111111111", guestId = "22222222-2222-4222-8222-222222222222";
  const graphNodes = [{ x: 0, y: 0, z: -500, deg: 1 }, { x: 10, y: 0, z: -520, deg: 2 }];
  const session = new network.MultiplayerSession(callbacks(), () => ({ data: fixture(), nodes: graphNodes }), () => "ws://localhost:8787");
  session.selfId = session.hostId = selfId; session.epoch = 3;
  session.roster = [{ id: selfId, name: "Host" }, { id: guestId, name: "Guest" }];
  const peer = peerStub(); session.peers.set(guestId, peer);
  session.setLocalGraph(fixture());
  session.world = new combat.CombatWorld(3);
  session.world.add({ id: guestId, slot: 1, name: "Guest", joinedAt: 2 });
  session.world.players.get(guestId).active = true;

  const target = { ownerId: selfId, starId: session.localTopology.nodes[0].id, revision: session.localTopology.revision };
  session.onPeerMessage(guestId, JSON.stringify({ type: "navigate", epoch: 2, target }), "control");
  assert.equal(session.world.players.get(guestId).travel, null, "stale epochs cannot start travel");
  session.onPeerMessage(guestId, JSON.stringify({ type: "navigate", epoch: 3, target: { ...target, revision: target.revision + 1 } }), "control");
  assert.equal(session.world.players.get(guestId).travel, null, "stale topology revisions cannot start travel");
  session.onPeerMessage(guestId, JSON.stringify({ type: "navigate", epoch: 3, target }), "control");
  assert.ok(session.world.players.get(guestId).travel);

  session.onPeerMessage(guestId, JSON.stringify({ type: "fire", epoch: 2, sequence: 1, gun: 0, weapon: 0, aimPoint: [2300, 0, -900] }), "control");
  session.onPeerMessage(guestId, JSON.stringify({ type: "fire", epoch: 3, sequence: 1, gun: 0, weapon: 0, aimPoint: [2300, 0, 900] }), "control");
  assert.equal(session.world.shotSnapshots().length, 0, "stale and backward shots are rejected");
  assert.equal(JSON.parse(peer.control.sent.at(-1)).accepted, false, "the host reliably rejects an invalid predicted shot");
  session.onPeerMessage(guestId, JSON.stringify({ type: "fire", epoch: 3, sequence: 1, gun: 2, weapon: 0, aimPoint: [2300, 0, -900] }), "control");
  assert.equal(session.world.shotSnapshots()[0]?.gun, 2);
  assert.equal(JSON.parse(peer.control.sent.at(-1)).accepted, true, "the host reliably acknowledges an accepted predicted shot");
  assert.equal(session.world.players.get(guestId).travel, null, "an accepted shot cancels travel");
  session.onPeerMessage(guestId, JSON.stringify({ type: "open", path: privateMarkers[1] }), "control");
  assert.equal(session.world.shotSnapshots().length, 1, "remote note-opening requests are ignored");
});

test("sequenced weapon commands survive movement throttling, reject duplicates, and cannot bypass cooldown", () => {
  const hostId = "11111111-1111-4111-8111-111111111111", guestId = "22222222-2222-4222-8222-222222222222";
  const session = new network.MultiplayerSession(callbacks(), () => ({ data: fixture(), nodes: [] }));
  session.selfId = session.hostId = hostId; session.epoch = 6;
  session.roster = [{ id: hostId, name: "Host" }, { id: guestId, name: "Guest" }];
  const peer = peerStub(); session.peers.set(guestId, peer);
  session.world = new combat.CombatWorld(6);
  session.world.add({ id: guestId, slot: 1, name: "Guest", joinedAt: 1 });
  const pilot = session.world.players.get(guestId); pilot.active = true; pilot.input.active = true; pilot.vel.set(0, 0, -100);

  const move = { sequence: 1, thrust: 0, strafe: 0, lift: 0, roll: 0, pitch: 0, yaw: 0, boost: false, brake: false, fire: false, active: true,
    mouseMode: "capture", mouseSamples: [], sensitivity: 1, agility: 1, invertY: false };
  const movementAt = Date.now();
  session.onPeerMessage(guestId, JSON.stringify({ type: "input", epoch: 6, input: move }), "live");
  assert.ok(pilot.inputAt >= movementAt, "the normal movement path records its throttle timestamp");

  // Exercise the client's actual R -> fire sequence. The reliable channel must
  // carry the weapon command before the shot, independently of input throttling.
  const client = new network.MultiplayerSession(callbacks(), () => ({ data: fixture(), nodes: [] }));
  client.selfId = guestId; client.hostId = hostId; client.epoch = 6;
  const clientPeer = peerStub(); client.peers.set(hostId, clientPeer);
  client.selectWeapon(1, 1);
  client.fire(1, 0, 1, [2300, 0, -900]);
  const outgoing = clientPeer.control.sent.map(JSON.parse);
  assert.deepEqual(outgoing.map(message => message.type), ["weapon", "fire"], "R then fire are ordered on the reliable control channel");
  for (const message of outgoing) session.onPeerMessage(guestId, JSON.stringify(message), "control");
  session.onPeerMessage(guestId, JSON.stringify({ type: "weapon", epoch: 6, sequence: 1, weapon: 0 }), "control");
  assert.equal(pilot.weapon, 1, "a duplicate old weapon command cannot overwrite the cannon choice");
  assert.equal(session.world.poses(Date.now()).find(item => item.id === guestId).pose.weaponSequence, 1, "the authoritative pose acknowledges the reliable weapon sequence");

  session.onPeerMessage(guestId, JSON.stringify({ type: "fire", epoch: 6, sequence: 1, gun: 0, weapon: 1, aimPoint: [2300, 0, -900] }), "control");
  const first = session.world.shotSnapshots()[0];
  assert.equal(first.weapon, 1); assert.equal(first.speed, 1000, "the launch speed includes the shooter velocity and is frozen");
  pilot.vel.set(0, 0, 900);
  assert.equal(session.world.shotSnapshots()[0].speed, 1000);
  assert.equal(pilot.ammunition, 35);

  session.world.setWeapon(guestId, 2, 0, Date.now());
  assert.equal(pilot.weapon, 0);
  assert.equal(session.world.fireShot(guestId, 2, 0, first.startedAt + 100, undefined, 0), false, "switching weapons does not clear the cannon cooldown");
  assert.equal(session.world.fireShot(guestId, 2, 1, first.startedAt + 1000, undefined, 0), true);
});

test("host input acknowledges exact fixed ticks and retains tick progress in a checkpoint", () => {
  const world = new combat.CombatWorld(6);
  world.add({ id: "pilot", slot: 0, name: "Pilot", joinedAt: 1 });
  const makeTick = (tick, mouseDelta) => ({ tick, thrust: 1, strafe: 0, lift: 0, roll: 0, pitch: 0, yaw: 0, boost: false, brake: false, active: true,
    mouseMode: "capture", mouseDelta, sensitivity: 1, agility: 1, invertY: false });
  const input = { ...emptyInput, sequence: 9, active: true, ticks: [makeTick(1, [10, 0]), makeTick(2, [0, 0])] };
  world.setInput("pilot", input, 1000);
  world.step(1 / 60, 1017);
  let pose = world.poses(1017).find(item => item.id === "pilot").pose;
  assert.equal(pose.inputTick, 1, "only the one simulated input tick is acknowledged");
  world.step(1 / 60, 1034);
  pose = world.poses(1034).find(item => item.id === "pilot").pose;
  assert.equal(pose.inputTick, 2);
  assert.ok(pose.spin[1] < 0);
  assert.ok(pose.mouseSmoothing[0] > 0);
  const checkpoint = world.snapshot(1034), restored = new combat.CombatWorld(7);
  assert.equal(restored.restore(checkpoint, 1034), true);
  assert.equal(restored.poses(1034).find(item => item.id === "pilot").pose.inputTick, 2);
});

test("checkpoints retain bounded outstanding input ticks and overlapping resend batches deduplicate", () => {
  const world = new combat.CombatWorld(1);
  world.add({ id: "pilot", slot: 0, name: "Pilot", joinedAt: 1 });
  const tick = value => ({ tick: value, thrust: 1, strafe: 0, lift: 0, roll: 0, pitch: 0, yaw: 0, boost: false, brake: false, active: true,
    mouseMode: "capture", mouseDelta: [0, 0], sensitivity: 1, agility: 1, invertY: false });
  world.setInput("pilot", { ...emptyInput, sequence: 1, active: true, ticks: [tick(1), tick(2), tick(3)] }, 1000);
  world.step(1 / 60, 1017);
  const checkpoint = world.snapshot(1017);
  assert.equal(checkpoint.players[0].tickQueue.length, 2);
  const resumed = new combat.CombatWorld(2);
  assert.equal(resumed.restore(checkpoint, 1017), true);
  resumed.setInput("pilot", { ...emptyInput, sequence: 2, active: true, ticks: [tick(2), tick(3), tick(4)] }, 1034);
  resumed.step(1 / 60, 1034);
  assert.equal(resumed.poses(1034)[0].pose.inputTick, 2);
  assert.equal(resumed.players.get("pilot").tickQueue.size, 2, "resent 2 and 3 are not duplicated; only tick 4 is new");
  resumed.setInput("pilot", { ...emptyInput, sequence: 2, active: true, ticks: [tick(3), tick(4)] }, 1051);
  resumed.step(1 / 60, 1051);
  assert.equal(resumed.poses(1051)[0].pose.inputTick, 3);
  assert.equal(resumed.players.get("pilot").tickQueue.size, 1);
});

test("shot results are accepted only from the current host and authority epoch", () => {
  const hostId = "11111111-1111-4111-8111-111111111111", clientId = "22222222-2222-4222-8222-222222222222", otherId = "33333333-3333-4333-8333-333333333333";
  const results = [];
  const session = new network.MultiplayerSession(callbacks({ shotResult: (...result) => results.push(result) }), () => ({ data: fixture(), nodes: [] }), () => "ws://localhost:8787");
  session.selfId = clientId; session.hostId = hostId; session.epoch = 5;
  session.peers.set(hostId, peerStub()); session.peers.set(otherId, peerStub());
  session.onPeerMessage(hostId, JSON.stringify({ type: "shot-result", epoch: 4, sequence: 3, accepted: true }), "control");
  session.onPeerMessage(otherId, JSON.stringify({ type: "shot-result", epoch: 5, sequence: 3, accepted: false }), "control");
  session.onPeerMessage(hostId, JSON.stringify({ type: "shot-result", epoch: 5, sequence: 3, accepted: false }), "control");
  assert.deepEqual(results, [[3, false]]);
});

test("round states and elimination announcements require the current host and deduplicate event ids", () => {
  const hostId = "11111111-1111-4111-8111-111111111111", selfId = "22222222-2222-4222-8222-222222222222", otherId = "33333333-3333-4333-8333-333333333333";
  const rounds = [], eliminations = [];
  const session = new network.MultiplayerSession(callbacks({ round: value => rounds.push(value), elimination: value => eliminations.push(value) }), () => ({ data: fixture(), nodes: [] }), () => "wss://rooms.example.test");
  session.selfId = selfId; session.hostId = hostId; session.epoch = 8;
  session.peers.set(hostId, peerStub()); session.peers.set(otherId, peerStub());
  const state = { epoch: 8, roundId: 2, phase: "combat", phaseRemainingMs: 0, winnerId: "", scores: [{ playerId: hostId, kills: 0, deaths: 0 }, { playerId: selfId, kills: 0, deaths: 0 }], layoutRequirements: [] };
  session.onPeerMessage(otherId, JSON.stringify({ type: "round-state", epoch: 8, state }), "control");
  session.onPeerMessage(hostId, JSON.stringify({ type: "round-state", epoch: 7, state: { ...state, epoch: 7 } }), "control");
  session.onPeerMessage(hostId, JSON.stringify({ type: "round-state", epoch: 8, state }), "control");
  assert.equal(rounds.length, 1);
  assert.equal(network.validRoundSnapshot({ ...state, phase: "supernova", winnerId: hostId }), false, "victory phases require a ten-kill score");
  const nine = { ...state, phase: "supernova", winnerId: hostId, scores: [{ ...state.scores[0], kills: 9 }, state.scores[1]] };
  assert.equal(network.validRoundSnapshot(nine), false, "nine kills cannot declare a winner");
  const ten = { ...nine, scores: [{ ...state.scores[0], kills: 10 }, state.scores[1]] };
  assert.equal(network.validRoundSnapshot(ten), true, "ten confirmed player kills can declare a winner");
  const event = { id: "2:host-shot-1", roundId: 2, attackerId: hostId, victimId: selfId, attackerScore: 1, at: 2000 };
  session.onPeerMessage(otherId, JSON.stringify({ type: "elimination", epoch: 8, event }), "control");
  session.onPeerMessage(hostId, JSON.stringify({ type: "elimination", epoch: 7, event }), "control");
  session.onPeerMessage(hostId, JSON.stringify({ type: "elimination", epoch: 8, event }), "control");
  session.onPeerMessage(hostId, JSON.stringify({ type: "elimination", epoch: 8, event }), "control");
  assert.deepEqual(eliminations, [event]);
});

test("multiplayer map coordinates double around their stable region and restore exactly in solo", () => {
  for (const [origin, solo] of [[0, [12, -8, 30]], [2300, [2312, -8, 30]], [-1150, [-1138, -8, 30]]]) {
    const scaled = solo.map(value => sim.mapCoordinate(value, origin, 2));
    assert.deepEqual(scaled, solo.map(value => origin + (value - origin) * 2));
    assert.equal(scaled[0] - origin, (solo[0] - origin) * 2);
    assert.deepEqual(solo.map(value => sim.mapCoordinate(value, origin, 1)), solo);
  }
});

const emptyInput = { sequence: 0, thrust: 0, strafe: 0, lift: 0, roll: 0, pitch: 0, yaw: 0, boost: false, brake: false, fire: false, active: false, mouseMode: "capture", mouseSamples: [], sensitivity: 1, agility: 1, invertY: false };
function addPair(world) {
  world.add({ id: "attacker", slot: 0, name: "A", joinedAt: 1 });
  world.add({ id: "target", slot: 1, name: "B", joinedAt: 2 });
  const attacker = world.players.get("attacker"), target = world.players.get("target");
  attacker.pos.set(0, 0, 0); attacker.rot.identity(); attacker.active = true;
  target.pos.set(0, 0, -100); target.rot.identity(); target.active = true;
  attacker.input = { ...emptyInput, active: true }; target.input = { ...emptyInput, active: true };
  return { attacker, target };
}

test("host projectiles sweep travel, apply the upstream weapon damage model, and checkpoint in-flight state", () => {
  const world = new combat.CombatWorld(4), { attacker, target } = addPair(world);
  target.shields = 0;
  assert.equal(world.fireShot("attacker", 1, 0, 10_000), true);
  assert.equal(world.poses(10_000).find(item => item.id === "attacker").pose.weaponCooldownDuration, 160);
  world.step(1 / 60, 10_000);
  for (let i = 0; i < 5; i++) world.step(1 / 60, 10_017 + i * 17);
  assert.ok(target.health >= 87.5 && target.health < 90, "damage follows the weapon's distance curve after shield absorption");
  assert.equal(world.impactSnapshots(10_100).at(-1)?.kind, "ship");

  world.setWeapon("attacker", 1, 1, 10_200);
  assert.equal(world.fireShot("attacker", 2, 3, 10_200, undefined, 1), true);
  assert.equal(world.poses(10_200).find(item => item.id === "attacker").pose.weaponCooldownDuration, 500);
  world.step(1 / 60, 10_200);
  const checkpoint = world.snapshot(10_200);
  assert.ok(checkpoint.shots.length > 0);
  assert.equal(checkpoint.players.find(player => player.id === "attacker").fireCooldownDuration, 500);
  assert.equal(checkpoint.shots[0].gun, 3);
  assert.deepEqual(checkpoint.shots[0].origin, world.shotSnapshots()[0].origin);
  const resumed = new combat.CombatWorld(5);
  assert.equal(resumed.restore(checkpoint, 99_000_250), true, "checkpoint timers are relative and survive clock skew between participants");
  assert.equal(resumed.shotSnapshots().length, checkpoint.shots.length);
  assert.equal(resumed.epoch, 4);
  assert.equal(resumed.restore({ ...checkpoint, players: [null] }, 10_250), false);
});

test("authoritative shots originate at cannon muzzles and converge to a validated aim point", () => {
  const world = new combat.CombatWorld(1), { attacker } = addPair(world);
  const muzzle = [1.61 * 0.68, 0.51 * 0.68, -0.97 * 0.68];
  const aimPoint = [120, 40, -900];
  assert.equal(world.fireShot("attacker", 1, 3, 1000, aimPoint), true);
  const shot = world.shotSnapshots()[0];
  assert.deepEqual(shot.origin, muzzle);
  const expected = [aimPoint[0] - muzzle[0], aimPoint[1] - muzzle[1], aimPoint[2] - muzzle[2]];
  const length = Math.hypot(...expected);
  assert.ok(Math.abs(shot.direction[0] - expected[0] / length) < 1e-12);
  assert.ok(Math.abs(shot.direction[1] - expected[1] / length) < 1e-12);
  assert.ok(Math.abs(shot.direction[2] - expected[2] / length) < 1e-12);
  assert.equal(world.fireShot("attacker", 2, 0, 1200, [0, 0, 100]), false, "shots behind the ship are rejected");
  assert.equal(world.fireShot("attacker", 3, 0, 1400, [0, 0, -5000]), false, "unbounded shots are rejected");
});

test("travel is checkpointed and movement cancels it without refilling resources", () => {
  const world = new combat.CombatWorld(7), { attacker } = addPair(world);
  attacker.energy = 0.42;
  assert.equal(world.startTravel("attacker", [0, 0, -500], 2, 1000), true);
  world.step(1 / 60, 1500);
  const checkpoint = world.snapshot(1500);
  assert.ok(checkpoint.players[0].travel);
  const resumed = new combat.CombatWorld(8);
  assert.equal(resumed.restore(checkpoint, 9000), true);
  assert.ok(resumed.players.get("attacker").travel);
  assert.equal(resumed.players.get("attacker").energy, 0.42);
  resumed.setInput("attacker", { ...emptyInput, active: true, thrust: 1 }, 9040);
  assert.equal(resumed.players.get("attacker").travel, null);
  assert.equal(resumed.players.get("attacker").energy, 0.42);
});

test("projectile hits on stars are visuals only and spawn protection holds", () => {
  const world = new combat.CombatWorld(1), { attacker, target } = addPair(world);
  target.protectedUntil = 30_000;
  world.setObstacleSet("remote-vault", new Float32Array([0, 0, -45]));
  assert.equal(world.fireShot("attacker", 1, 0, 20_000), true);
  world.step(1 / 60, 20_000);
  for (let i = 0; i < 4; i++) world.step(1 / 60, 20_017 + i * 17);
  assert.equal(target.health, 100);
  assert.equal(world.impactSnapshots(20_100).at(-1)?.kind, "star");
});

test("space bolts stop on parked ships without damaging them or adding a flight obstacle", () => {
  const world = new combat.CombatWorld(1), { attacker, target } = addPair(world);
  world.setParkedShipPositions([{ id: "docked", position: [0, 0, -18] }]);
  assert.equal(world.fireShot("attacker", 1, 0, 21_000, [0, 0, -100], 0), true);
  world.step(1 / 60, 21_017);
  assert.equal(target.health, 100);
  assert.equal(world.impactSnapshots(21_017).at(-1)?.kind, "star");
  assert.equal(world.shotSnapshots().length, 0, "the bolt terminates at the parked hull");
  const position = attacker.pos.clone();
  world.step(1 / 60, 21_034);
  assert.deepEqual(attacker.pos.toArray(), position.toArray(), "parked hulls are not added to the flight collision grid");
});

test("lethal damage respawns at five seconds with full health, boost, and three-second protection", () => {
  const world = new combat.CombatWorld(1), { attacker, target } = addPair(world);
  target.shields = 0; target.health = 10;
  assert.equal(world.fireShot("attacker", 1, 0, 30_000), true);
  world.step(1 / 60, 30_000);
  target.input = { ...emptyInput, active: true };
  for (let i = 1; i <= 6 && target.health > 0; i++) world.step(1 / 60, 30_000 + i * 17);
  assert.equal(target.health, 0);
  const respawnAt = target.respawnAt;
  assert.ok(respawnAt > 30_000 && target.active === false);
  world.step(1 / 60, respawnAt - 1);
  assert.equal(target.health, 0);
  world.step(1 / 60, respawnAt);
  assert.equal(target.health, 100);
  assert.equal(target.energy, 1);
  assert.equal(target.active, true);
  assert.equal(target.protectedUntil, respawnAt + 3000);
});

test("first-to-ten scores only confirmed lethal hits and checkpoints victory progress", () => {
  const world = new combat.CombatWorld(9), { attacker, target } = addPair(world);
  attacker.pos.set(123, 45, 80); attacker.rot.set(0, 0, Math.sin(0.325), Math.cos(0.325));
  target.pos.set(123, 45, -20);
  const retainedPosition = attacker.pos.toArray(), retainedRotation = [attacker.rot.x, attacker.rot.y, attacker.rot.z, attacker.rot.w];
  let now = 40_000;
  for (let kill = 1; kill <= 10; kill++) {
    target.shields = 0; target.health = 10; target.active = true; target.protectedUntil = 0;
    attacker.active = true;
    assert.equal(world.fireShot("attacker", kill, 0, now), true);
    for (let frame = 1; frame <= 8 && target.health > 0; frame++) world.step(1 / 60, now + frame * 17);
    const events = world.drainEliminations();
    assert.equal(events.length, 1, "one elimination is emitted for each actual alive-to-destroyed transition");
    assert.equal(events[0].attackerScore, kill);
    if (kill === 9) assert.equal(world.roundPhase, "combat", "nine kills do not end the round");
    assert.equal(world.fireShot("attacker", kill, 0, now + 200), false, "duplicate shot sequences cannot score twice");
    now += 250;
  }
  assert.equal(attacker.kills, 10);
  assert.equal(world.roundPhase, "supernova");
  assert.equal(world.fireShot("attacker", 11, 0, now), false, "combat pauses immediately at the winning hit");
  assert.equal(world.startTravel("attacker", [0, 0, -500], 1, now), false);

  const checkpoint = world.snapshot(now), transferred = new combat.CombatWorld(10);
  assert.equal(checkpoint.version, 15);
  assert.equal(transferred.restore(checkpoint, now + 100, 1200), true);
  assert.equal(transferred.currentRoundId, 1);
  assert.equal(transferred.roundSnapshot(now + 100).phaseRemainingMs, checkpoint.round.phaseRemainingMs - 1200);
  assert.equal(transferred.players.get("attacker").kills, 10);

  const waitingAt = now + 8100;
  transferred.step(1 / 60, waitingAt);
  assert.equal(transferred.roundPhase, "waiting");
  const waitingCheckpoint = transferred.snapshot(waitingAt), waitingHost = new combat.CombatWorld(11);
  assert.equal(waitingHost.restore(waitingCheckpoint, waitingAt + 100, 5000), true, "host transfer preserves the waiting phase");
  assert.equal(waitingHost.roundSnapshot(waitingAt + 100).phaseRemainingMs, 10_000);
  waitingHost.setInput("attacker", { ...emptyInput, active: false }, waitingAt + 101);
  waitingHost.startCountdown(waitingAt + 101);
  const countdownAt = waitingAt + 1101, countdownCheckpoint = waitingHost.snapshot(countdownAt), countdownHost = new combat.CombatWorld(12);
  assert.equal(countdownHost.restore(countdownCheckpoint, countdownAt + 100, 500), true, "host transfer preserves the countdown phase");
  assert.equal(countdownHost.roundSnapshot(countdownAt + 100).phaseRemainingMs, 1500);
  countdownHost.step(1 / 60, countdownAt + 1601);
  assert.equal(countdownHost.currentRoundId, 2);
  assert.equal(countdownHost.roundPhase, "combat");
  assert.equal(countdownHost.players.get("attacker").kills, 0);
  assert.equal(countdownHost.players.get("attacker").health, 100);
  assert.equal(countdownHost.players.get("attacker").energy, 1);
  assert.equal(countdownHost.players.get("attacker").active, false, "spectators remain spectators after round reset");
  assert.deepEqual(countdownHost.players.get("attacker").pos.toArray(), retainedPosition, "a flying player remains at the same space position");
  assert.deepEqual([countdownHost.players.get("attacker").rot.x, countdownHost.players.get("attacker").rot.y, countdownHost.players.get("attacker").rot.z, countdownHost.players.get("attacker").rot.w], retainedRotation, "a flying player keeps their facing across the round reset");
});

test("ship and surface eliminations share the ten-kill round threshold", () => {
  const world = new combat.CombatWorld(18), { attacker, target } = addPair(world);
  for (let kill = 1; kill <= 9; kill++) {
    target.shields = 0; target.health = 10; target.active = true; attacker.active = true;
    const at = 50_000 + kill * 250;
    assert.equal(world.fireShot("attacker", kill, 0, at), true);
    for (let frame = 1; frame <= 8 && target.health > 0; frame++) world.step(1 / 60, at + frame * 17);
  }
  assert.equal(attacker.kills, 9);
  assert.equal(world.roundPhase, "combat");
  const event = world.recordSurfaceElimination("attacker", "target", "surface-kill-10", 53_000);
  assert.equal(event.attackerScore, 10);
  assert.equal(world.roundPhase, "supernova", "a surface elimination can supply the tenth kill after ship combat");
});

test("boost drains at the shared rate and spectators resume after five seconds without refilling", () => {
  const world = new combat.CombatWorld(1);
  world.add({ id: "pilot", slot: 0, name: "P", joinedAt: 1 });
  const pilot = world.players.get("pilot");
  pilot.input = { ...emptyInput, active: true, thrust: 1, boost: true };
  for (let i = 0; i < 10; i++) world.step(0.1, 1000 + i * 100);
  assert.ok(Math.abs(pilot.energy - 0.72) < 1e-8);
  pilot.input = { ...pilot.input, boost: false };
  pilot.active = true;
  world.step(0.1, 2100);
  assert.ok(Math.abs(pilot.energy - 0.72) < 1e-8);
  for (let i = 0; i < 14; i++) world.step(0.1, 2200 + i * 100);
  assert.ok(pilot.energy > 0.72);

  pilot.health = 70; pilot.energy = 0.42; pilot.active = true; pilot.input = { ...emptyInput, active: false };
  world.step(0.01, 5000);
  pilot.input = { ...emptyInput, active: true };
  world.step(0.01, 6000);
  assert.equal(pilot.active, false);
  assert.equal(pilot.health, 70); assert.equal(pilot.energy, 0.42);
  world.step(0.01, 9999); assert.equal(pilot.active, false);
  world.step(0.01, 10000); assert.equal(pilot.active, true);
  assert.equal(pilot.health, 70); assert.ok(pilot.energy > 0.42 && pilot.energy < 0.421);
});

test("rapid boost taps reset the delay and an empty tank stays locked until thirty percent", () => {
  const world = new combat.CombatWorld(1);
  world.add({ id: "pilot", slot: 0, name: "P", joinedAt: 1 });
  const pilot = world.players.get("pilot"); pilot.active = true; pilot.energy = 0.5;
  pilot.input = { ...emptyInput, active: true, thrust: 1, boost: true };
  world.step(0.1, 1000); assert.ok(Math.abs(pilot.energy - 0.472) < 1e-8);
  pilot.input = { ...pilot.input, boost: false };
  for (let i = 0; i < 10; i++) world.step(0.1, 1100 + i * 100);
  assert.ok(Math.abs(pilot.energy - 0.472) < 1e-8);
  pilot.input = { ...pilot.input, boost: true };
  world.step(0.1, 2100);
  assert.ok(Math.abs(pilot.energy - 0.444) < 1e-8);
  pilot.input = { ...pilot.input, boost: false };
  for (let i = 0; i < 10; i++) world.step(0.1, 2200 + i * 100);
  assert.ok(Math.abs(pilot.energy - 0.444) < 1e-8, "the second tap should restart the 1.5 second delay");

  pilot.energy = 0.01; pilot.boostLocked = false; pilot.input = { ...emptyInput, active: true, thrust: 1, boost: true };
  world.step(0.1, 5000);
  assert.equal(pilot.energy, 0); assert.equal(pilot.boostLocked, true);
  pilot.input = { ...pilot.input, boost: false };
  for (let i = 0; i < 29; i++) world.step(0.1, 5100 + i * 100);
  assert.equal(pilot.energy, 0); assert.equal(pilot.boostLocked, true);
  for (let i = 0; i < 35; i++) world.step(0.1, 8100 + i * 100);
  assert.ok(pilot.energy >= 0.27 && pilot.energy < 0.3);
  assert.equal(pilot.boostLocked, true);
  pilot.input = { ...pilot.input, boost: true };
  world.step(0.1, 11600); assert.ok(pilot.energy < 0.3 && pilot.boostLocked);
  world.step(0.1, 11700); assert.ok(pilot.energy < 0.3 && pilot.boostLocked);
  world.step(0.1, 11800); assert.ok(pilot.energy >= 0.3);
  assert.equal(pilot.boostLocked, false);
  world.step(0.1, 11900);
  assert.ok(pilot.energy < 0.3 && !pilot.boostLocked, "after reaching thirty percent, boost may run the tank down again");
});

test("replicated thrust audio follows effective propulsion and goes quiet during travel", () => {
  const world = new combat.CombatWorld(1);
  world.add({ id: "pilot", slot: 0, name: "P", joinedAt: 1 });
  const pilot = world.players.get("pilot"); pilot.active = true;
  pilot.input = { ...emptyInput, active: true, thrust: 1, boost: true };
  let pose = world.poses(1000).find(item => item.id === "pilot").pose;
  assert.equal(pose.thrust, 1); assert.equal(pose.boosting, true);
  assert.equal(world.startTravel("pilot", [0, 0, -1000], 1, 1000), true);
  pose = world.poses(1000).find(item => item.id === "pilot").pose;
  assert.equal(pose.thrust, 0); assert.equal(pose.boosting, false);
});

test("new room sessions advertise protocol 15 without opening a connection on construction", () => {
  const session = new network.MultiplayerSession(callbacks(), () => ({ data: fixture(), nodes: [] }));
  assert.equal(network.ROOM_PROTOCOL, 15);
  assert.equal(session.active, false);
  assert.equal(session.room, "");
});

test("surface transport sends bounded overlapping controls, trims acknowledgements, and excludes extra private fields", () => {
  const session = new network.MultiplayerSession(callbacks(), () => ({ data: fixture(), nodes: [] }));
  session.selfId = "22222222-2222-4222-8222-222222222222"; session.hostId = "11111111-1111-4111-8111-111111111111";
  session.epoch = 1; session.authorityReady = true;
  const packets = [];
  session.sendTo = (_id, packet) => packets.push(structuredClone(packet));
  const controls = { moveX: 0, moveY: 1, sprint: false, jump: false, crouch: false, yawDelta: 0.01, pitchDelta: 0, lean: 0, interact: false, privateNote: privateMarkers[1] };
  for (let sequence = 1; sequence <= 15; sequence++) assert.equal(session.sendSurfaceInput(controls, "anonymous-arena", 1), sequence);
  assert.equal(packets.at(-1).frames.length, 12);
  assert.deepEqual(packets.at(-1).frames.map(frame => frame.sequence), Array.from({ length: 12 }, (_, index) => index + 4));
  assert.ok(privateMarkers.every(marker => !JSON.stringify(packets).includes(marker)));
  controls.yawDelta = 2;
  assert.equal(packets.at(-1).frames.at(-1).input.yawDelta, 0.01, "the resend buffer owns copies of controls");
  session.acknowledgeSurfaceInputs({ players: [{ id: session.selfId, inputSequence: 14, arenaKey: "anonymous-arena", lifeId: 1 }] });
  session.sendSurfaceInput(controls, "anonymous-arena", 1);
  assert.deepEqual(packets.at(-1).frames.map(frame => frame.sequence), [15, 16]);
  session.sendSurfaceInput(controls, "anonymous-arena", 2);
  assert.deepEqual(packets.at(-1).frames.map(frame => frame.sequence), [17]);
  session.resetSurfaceTransport();
  assert.equal(session.surfaceInputFrames.length, 0, "authority transfer cancels old pending controls");
});

test("the host samples selected WebRTC transport RTT and discards statistics from a replaced authority", async () => {
  const session = new network.MultiplayerSession(callbacks(), () => ({ data: fixture(), nodes: [] }));
  session.selfId = session.hostId = "host"; session.epoch = 1;
  const observed = [];
  session.surfaceAuthority = { observeConnectionTiming: (...args) => observed.push(args) };
  const report = new Map([
    ["transport", { type: "transport", selectedCandidatePairId: "selected" }],
    ["selected", { type: "candidate-pair", currentRoundTripTime: 0.1 }],
    ["other", { type: "candidate-pair", nominated: true, state: "succeeded", currentRoundTripTime: 0.9 }],
  ]);
  session.peers.set("guest", { pc: { connectionState: "connected", getStats: async () => report } });
  await session.sampleSurfacePeerTimings(1000);
  assert.deepEqual(observed, [["guest", 100, 1000]]);
  let deliver;
  session.peers.get("guest").pc.getStats = () => new Promise(resolve => { deliver = resolve; });
  const pending = session.sampleSurfacePeerTimings(1100);
  session.epoch = 2;
  deliver(report); await pending;
  assert.equal(observed.length, 1);
});

test("host catch-up ticks use distinct simulation timestamps instead of duplicating the observation clock", () => {
  const previousWindow = globalThis.window, previousNow = Date.now;
  let now = 10000, tickLoop;
  globalThis.window = { clearInterval() {}, setInterval(callback) { tickLoop = callback; return 1; } };
  Date.now = () => now;
  try {
    const session = new network.MultiplayerSession(callbacks(), () => ({ data: fixture(), nodes: [] }));
    session.selfId = session.hostId = "host"; session.epoch = 1; session.authorityReady = true;
    session.world = new combat.CombatWorld(1);
    const times = [];
    session.stepSurfaceAuthority = (_dt, at) => times.push(at);
    session.startGameLoop(); now += 100; tickLoop();
    assert.equal(times.length, 6);
    assert.equal(new Set(times).size, 6);
    assert.ok(times.every((at, index) => index === 0 || at - times[index - 1] >= 16 && at - times[index - 1] <= 17));
    assert.equal(times.at(-1), now);
  } finally { Date.now = previousNow; if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; }
});

test("remote pose presentation interpolates at 100 ms and caps extrapolation at 100 ms", () => {
  const poseAt = (x, active = true) => ({ position: [x, 0, 0], rotation: [0, 0, 0, 1], velocity: [100, 0, 0], spin: [0, 0, 0],
    mouseSmoothing: [0, 0], health: 100, shields: 40, energy: 1, boostLocked: false, boostHold: 0, regenDelay: 0, damagePause: 0,
    weapon: 0, weaponSequence: 0, inputSequence: 0, inputTick: 0, heat: 0, overheated: false, ammunition: 36, weaponCooldown: 0,
    weaponCooldownDuration: 160, deaths: 0, active, traveling: false, respawnAt: 0, protectedUntil: 0, thrust: 1, boosting: false, bank: 0, tilt: 0 });
  const samples = [{ pose: poseAt(0), at: 0 }, { pose: poseAt(10), at: 100 }];
  assert.equal(interpolation.interpolateRemotePose(samples, 150).position[0], 5, "render time is 100 ms behind arrival time");
  assert.equal(interpolation.interpolateRemotePose(samples, 300).position[0], 20, "100 ms of forward extrapolation is allowed");
  assert.equal(interpolation.interpolateRemotePose(samples, 450).position[0], 20, "the estimate holds after the extrapolation cap");
  samples.push({ pose: poseAt(12, false), at: 120 });
  assert.equal(interpolation.interpolateRemotePose(samples, 150).active, false, "destruction and spectator state apply immediately");
});

test("20 Hz network snapshots skip local host pose reapplication while updating peers", () => {
  const states = [];
  const session = new network.MultiplayerSession(callbacks({ playerState: (id, pose) => states.push({ id, pose }) }), () => ({ data: fixture(), nodes: [] }), () => "wss://rooms.example.test");
  session.selfId = session.hostId = "host";
  session.world = new combat.CombatWorld(1);
  for (const [slot, id] of ["host", "guest"].entries()) {
    session.world.add({ id, slot, name: id, joinedAt: 1000 });
    session.world.setInput(id, { ...emptyInput, active: true }, 1000);
  }
  session.world.step(1 / 60, 1000);
  session.publishWorldState(1000);
  assert.deepEqual(states.map(({ id, pose }) => [id, pose.active]), [["guest", true]]);
});

test("batched ship publications preserve every authoritative pose and validate atomically before callbacks", () => {
  const session = new network.MultiplayerSession(callbacks(), () => ({ data: fixture(), nodes: [] }));
  Object.assign(session, { selfId: "host", hostId: "host", epoch: 1, world: new combat.CombatWorld(1) });
  for (const [slot, id] of ["host", "guest", "two", "three"].entries()) session.world.add({ id, slot, name: id, joinedAt: 1000 });
  const peer = peerStub(); session.peers.set("guest", peer); session.publishWorldState(1000);
  const batches = peer.live.sent.map(packet => typeof packet === "string" ? JSON.parse(packet) : null).filter(packet => packet?.type === "ships");
  assert.equal(batches.length, 1); assert.deepEqual(batches[0].poses, session.world.poses(1000));
  const received = [], client = new network.MultiplayerSession(callbacks({ playerState: (id, pose) => received.push({ id, pose }) }), () => ({ data: fixture(), nodes: [] }));
  Object.assign(client, { selfId: "guest", hostId: "host", epoch: 1 }); client.peers.set("host", peerStub());
  const bad = structuredClone(batches[0]); bad.poses[3].pose.health = -1;
  client.onPeerMessage("host", JSON.stringify(bad), "live"); assert.equal(received.length, 0);
  client.onPeerMessage("host", wire.encodeNetworkJson(JSON.stringify(batches[0])), "live");
  assert.deepEqual(received, session.world.poses(1000));
  client.onPeerMessage("host", JSON.stringify(batches[0]), "live"); assert.equal(received.length, 4, "duplicate batches cannot reapply old poses");
});

test("empty-room host straight-flight trace publishes one monotonic authoritative pose per 60 Hz tick", () => {
  const previousWindow = globalThis.window, previousNow = Date.now;
  let clock = 10_000, runGameLoop;
  globalThis.window = { clearInterval() {}, setInterval(callback, interval) { assert.equal(interval, 8); runGameLoop = callback; return 1; } };
  Date.now = () => clock;
  try {
    const samples = [];
    const session = new network.MultiplayerSession(callbacks({ playerState: (id, pose) => { if (id === "host") samples.push({ tick: pose.inputTick, z: pose.position[2] }); } }), () => ({ data: fixture(), nodes: [] }));
    session.selfId = session.hostId = "host"; session.epoch = 1; session.authorityReady = true;
    session.world = new combat.CombatWorld(1); session.world.add({ id: "host", slot: 0, name: "Host", joinedAt: clock });
    session.startGameLoop();
    for (let tick = 1; tick <= 120; tick++) {
      const flightTick = { tick, thrust: 1, strafe: 0, lift: 0, roll: 0, pitch: 0, yaw: 0, boost: false, brake: false, active: true,
        mouseMode: "capture", mouseDelta: [0, 0], sensitivity: 1, agility: 1, invertY: false };
      session.sendInput({ ...emptyInput, sequence: tick, active: true, thrust: 1, ticks: [flightTick] });
      clock += [17, 17, 16][(tick - 1) % 3];
      runGameLoop();
    }
    const unique = new Map(samples.map(sample => [sample.tick, sample.z]));
    const trace = [...unique].filter(([tick]) => tick > 0).sort((a, b) => a[0] - b[0]);
    assert.equal(trace.length, 120, "the host publishes each simulated input tick without waiting for the 20 Hz network cadence");
    assert.equal(trace.at(-1)[0], 120);
    const backwardsCorrections = trace.slice(1).filter(([, z], index) => z >= trace[index][1]).length;
    assert.equal(backwardsCorrections, 0, "steady straight flight has no periodic position corrections");
    assert.ok(trace.at(-1)[1] < -80, `host motion should advance continuously, received z=${trace.at(-1)[1]}`);
  } finally {
    Date.now = previousNow;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

test("the eight-ms host poll preserves twenty publications per second and skips stalled slots", () => {
  const previousWindow = globalThis.window, previousNow = Date.now;
  let clock = 10000, runGameLoop;
  globalThis.window = { clearInterval() {}, setInterval(callback, interval) { assert.equal(interval, 8); runGameLoop = callback; return 1; } };
  Date.now = () => clock;
  try {
    const session = new network.MultiplayerSession(callbacks(), () => ({ data: fixture(), nodes: [] }));
    Object.assign(session, { selfId: "host", hostId: "host", epoch: 1, authorityReady: true, world: new combat.CombatWorld(1) });
    session.world.add({ id: "host", slot: 0, name: "Host", joinedAt: clock });
    const publications = []; session.publishWorldState = now => publications.push(now);
    session.startGameLoop();
    for (let poll = 0; poll < 125; poll++) { clock += 8; runGameLoop(); }
    assert.equal(publications.length, 20, "polling delay must not accumulate into an eighteen-Hz publisher");
    assert.ok(publications.slice(1).every((at, index) => at - publications[index] >= 48 && at - publications[index] <= 56));
    clock += 1000; runGameLoop();
    assert.equal(publications.length, 21, "a stalled poll publishes one current snapshot, not twenty obsolete ones");
    for (let poll = 0; poll < 125; poll++) { clock += 8; runGameLoop(); }
    assert.equal(publications.length, 41, "normal twenty-Hz publication resumes without phase drift");
  } finally {
    Date.now = previousNow;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

test("abrupt host failure is transferred only to the deterministic successor after verified majority votes", () => {
  const ids = [1, 2, 3].map(index => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`);
  const [host, successor, guest] = ids;
  const members = ids.map((id, slot) => ({ id, name: `Pilot ${slot}`, joinedAt: slot + 1, slot, profile: { revision: 1, ship: "classic", engine: "classic", afterburner: "classic", laser: "classic" } }));
  const roomCallbacks = callbacks();
  const voter = new network.MultiplayerSession(roomCallbacks, () => ({ data: fixture(), nodes: [] }), () => "https://ntfy.sh");
  voter.selfId = guest; voter.hostId = host; voter.epoch = 4; voter.roster = members; voter.lastHostPacketAt = Date.now() - 7000;
  const candidatePeer = peerStub(); voter.peers.set(successor, candidatePeer);
  voter.onPeerMessage(successor, JSON.stringify({ type: "authority-proposal", epoch: 5, baseEpoch: 4, failure: true, hostId: successor, members: ids }), "control");
  assert.equal(voter.hostId, successor);
  assert.equal(voter.epoch, 5);
  assert.equal(voter.authorityReady, false, "a proposal alone does not resume combat");
  assert.ok(candidatePeer.control.sent.some(raw => JSON.parse(raw).type === "authority-vote"));

  const candidate = new network.MultiplayerSession(roomCallbacks, () => ({ data: fixture(), nodes: [] }), () => "https://ntfy.sh");
  candidate.selfId = successor; candidate.hostId = successor; candidate.epoch = 5; candidate.roster = members;
  candidate.authorityVotes.add(successor);
  const guestPeer = peerStub(); candidate.peers.set(guest, guestPeer);
  const baseVote = { type: "authority-vote", epoch: 5, hostId: successor, members: ids };
  candidate.onPeerMessage(guest, JSON.stringify({ ...baseVote, voterId: host }), "control");
  assert.deepEqual([...candidate.authorityVotes], [successor], "a peer cannot claim another participant's vote");
  candidate.onPeerMessage(guest, JSON.stringify({ ...baseVote, voterId: guest }), "control");
  assert.equal(candidate.authorityReady, true);
  assert.ok(guestPeer.control.sent.some(raw => JSON.parse(raw).type === "authority-commit"));
});

test("ICE candidates arriving before or during remote description setup are retained", async () => {
  const session = new network.MultiplayerSession(callbacks(), () => ({ data: fixture(), nodes: [] }), () => "wss://rooms.example.test");
  session.selfId = session.hostId = "host";
  const peer = peerStub(), added = [];
  let finishDescription;
  const descriptionGate = new Promise(resolve => { finishDescription = resolve; });
  peer.pc = {
    remoteDescription: null,
    async setRemoteDescription(value) { await descriptionGate; this.remoteDescription = value; },
    async createAnswer() { return { type: "answer", sdp: "synthetic" }; },
    async setLocalDescription(value) { this.localDescription = value; },
    async addIceCandidate(value) { assert.ok(this.remoteDescription); added.push(value.candidate); },
  };
  session.peers.set("guest", peer);
  const signal = data => session.onSignal({ type: "signal", from: "guest", data });
  await signal({ candidate: { candidate: "before-offer" } });
  assert.equal(peer.pendingCandidates.length, 1);
  const description = signal({ description: { type: "offer", sdp: "synthetic" } });
  const candidate = signal({ candidate: { candidate: "during-description" } });
  finishDescription();
  await Promise.all([description, candidate]);
  assert.deepEqual(added, ["before-offer", "during-description"]);
  assert.equal(peer.pendingCandidates.length, 0);
});

test("one failed STUN endpoint is informational and cannot mark a connected peer or relay quota as failed", () => {
  const statuses = [];
  const session = new network.MultiplayerSession(callbacks({ status: (text, error) => statuses.push({ text, error }) }), () => ({ data: fixture(), nodes: [] }), () => "wss://rooms.example.test");
  session.selfId = session.hostId = "host";
  session.roster = [{ id: "host" }, { id: "guest" }]; session.relayStatus = "ready";
  const peer = peerStub(); peer.pc.connectionState = "connecting"; session.peers.set("guest", peer);
  session.reportIceError("guest", { errorCode: 701, url: "stun:synthetic.invalid", errorText: "STUN binding request timed out" });
  assert.match(statuses.at(-1).text, /STUN endpoint.*701/);
  assert.equal(statuses.at(-1).error, false);
  assert.equal(session.relayStatus, "ready");
  peer.pc.connectionState = "connected";
  session.updatePeerStatus();
  assert.match(statuses.at(-1).text, /1 of 1 participant connections ready/);
  assert.equal(statuses.at(-1).error, false);
  const count = statuses.length;
  session.reportIceError("guest", { errorCode: 701, url: "turn:synthetic.invalid", errorText: "quota" });
  assert.equal(statuses.length, count);
  assert.equal(session.relayStatus, "ready");
});

test("the TURN client uses Worker-issued refresh tokens and renews after a cold-session 401", async () => {
  globalThis.window ??= globalThis;
  const calls = [], tokens = ["a".repeat(64), "b".repeat(64)];
  const request = async (url, token) => {
    calls.push([url, token || ""]);
    if (url.endsWith("/turn/session")) return { status: 200, body: { token: tokens.shift(), expiresAt: Date.now() + 6 * 60 * 60_000 } };
    if (calls.filter(([path]) => path.endsWith("/turn") && !path.endsWith("/turn/session")).length === 1) return { status: 401, body: {} };
    assert.ok(token === "b".repeat(64), "retry must use the replacement Worker token");
    return { status: 200, body: { iceServers: [{ urls: "stun:relay.example.test:3478" }], iceExpiresAt: Date.now() + 3_600_000, relayStatus: "direct-only" } };
  };
  const session = new network.MultiplayerSession(callbacks(), () => ({ data: fixture(), nodes: [] }), () => "https://ntfy.sh", undefined, request);
  await session.fetchIceConfiguration();
  assert.deepEqual(calls.map(([url]) => url.split("/").at(-1)), ["session", "turn", "session", "turn"]);
  assert.equal(session.relayStatus, "direct-only");
});

test("TURN configuration restarts an ICE-checking peer instead of leaving its STUN-only attempt stuck", async () => {
  const session = new network.MultiplayerSession(callbacks(), () => ({ data: fixture(), nodes: [] }));
  const self = "00000000-0000-4000-8000-000000000001", guest = "00000000-0000-4000-8000-000000000002";
  session.selfId = self;
  session.relay = [{ urls: "turn:relay.example.test:3478", username: "temporary", credential: "temporary" }];
  const sent = [], pc = {
    connectionState: "connecting", signalingState: "stable", config: { iceServers: [] },
    setConfiguration(value) { this.config = value; }, getConfiguration() { return this.config; },
    restartIce() { this.restarted = true; },
    async createOffer(options) { this.offerOptions = options; return { type: "offer", sdp: "relay-restart" }; },
    async setLocalDescription(value) { this.localDescription = value; },
  };
  const peer = peerStub(); peer.pc = pc; session.peers.set(guest, peer);
  session.publicRoom = { signal: (to, data) => sent.push({ to, data }) };
  await session.applyIceConfiguration();
  assert.equal(pc.config.iceServers[0].urls, "turn:relay.example.test:3478");
  assert.equal(pc.restarted, true);
  assert.equal(pc.offerOptions.iceRestart, true);
  assert.deepEqual(sent, [{ to: guest, data: { description: { type: "offer", sdp: "relay-restart" } } }]);
});

test("closing a removed peer's channels cannot overwrite a clean leave or departure status", () => {
  const statuses = [];
  const session = new network.MultiplayerSession(callbacks({ status: text => statuses.push(text) }), () => ({ data: fixture(), nodes: [] }), () => "wss://rooms.example.test");
  const peer = peerStub(); peer.control = undefined; peer.live = undefined; peer.pc.close = () => {};
  session.peers.set("guest", peer);
  const channel = { label: "constellation-live", readyState: "open", close() { this.onclose?.(); } };
  session.bindChannel("guest", channel);
  session.removePeer("guest");
  assert.equal(session.peers.size, 0);
  assert.deepEqual(statuses, []);
});

test("charge start, charged release and cancellation use ordered reliable transport and deduplicate releases",()=>{
 const client=new network.MultiplayerSession(callbacks(),()=>({data:fixture(),nodes:[]}));
 const host=new network.MultiplayerSession(callbacks(),()=>({data:fixture(),nodes:[]}));
 Object.assign(client,{selfId:"guest",hostId:"host",authorityReady:true,epoch:1});Object.assign(host,{selfId:"host",hostId:"host",authorityReady:true,epoch:1,world:{roundPhase:"combat"}});
 const hostPeer=peerStub(),guestPeer=peerStub();client.peers.set("host",hostPeer);host.peers.set("guest",guestPeer);
 const received=[];host.surfaceAuthority={world:{setCharge:(...args)=>received.push(["charge",...args])},fire:(...args)=>{received.push(["fire",...args]);return {accepted:true};}};
 client.chargeSurface(true,"arena",2);client.fireSurface(1,10000,"arena",2,[0,0,-1],"charged");client.chargeSurface(false,"arena",2);
 assert.equal(hostPeer.live.sent.length,0);assert.equal(hostPeer.control.sent.length,3);
 for(const packet of hostPeer.control.sent)host.onPeerMessage("guest",packet,"control");
 assert.deepEqual(received.map(row=>row[0]),["charge","fire","charge"]);assert.equal(received[0][2],true);assert.equal(received[1].at(-1),"charged");assert.equal(received[2][2],false);
 host.onPeerMessage("guest",hostPeer.control.sent[1],"control");assert.equal(received.filter(row=>row[0]==="fire").length,1);
 const packets=hostPeer.control.sent.join("");for(const marker of privateMarkers)assert.equal(packets.includes(marker),false);
 host.onPeerMessage("guest",JSON.stringify({type:"surface-charge",epoch:0,active:true,arenaKey:"arena",lifeId:2}),"control");assert.equal(received.length,3);
});
