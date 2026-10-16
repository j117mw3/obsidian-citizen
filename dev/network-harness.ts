import "./obsidian-shim";
import { connectionStats, connectionStatById } from "../src/rtcStats";
import { browserRequest, browserPost, proxyStats } from "./browser-http";
// Synthetic network-only browser harness. No vault access and no WebGL required.
import { MultiplayerSession, type AnonymousPlayer, type AnonymousTopology, type Pose } from "../src/multiplayer";
import * as THREE from "three";
import { DEFAULT_RELAY } from "../src/relay";
import type { GraphData, SimNode } from "../src/types";
import { SurfaceAuthority, type SurfaceNetworkSnapshot } from "../src/surfaceAuthority";
import { neutralSurfaceInput } from "../src/surfaceInput";
import { surfaceBlasterDirection, surfaceViewPose } from "../src/surfaceView";
import { traceSurfaceSegment } from "../src/surfaceCombat";
import { proxyIceConnection } from "./network-impairment";
import type { FlightTick } from "../src/multiplayer";
import { SurfaceHistory } from "../src/surfaceHistory";
import { presentSurfacePlayers } from "../src/surfacePresentation";

const name = document.getElementById("name") as HTMLInputElement;
const code = document.getElementById("code") as HTMLInputElement;
const flying = document.getElementById("flying") as HTMLInputElement;
const relay = document.getElementById("relay") as HTMLInputElement;
const status = document.getElementById("status")!;
const players = document.getElementById("players")!;
const transport = document.getElementById("transport")!;
const maps = document.getElementById("maps")!;
const surfaceSummary = document.getElementById("surface")!;
const surfaceResult = document.getElementById("surface-result")!;
const fireReasons = new Map<string, number>();
const authorityFire = Object.getOwnPropertyDescriptor(SurfaceAuthority.prototype, "fire")!.value as SurfaceAuthority["fire"];
// Observe the production decision only; never alter arguments, results, or resources.
SurfaceAuthority.prototype.fire = function(...args: Parameters<typeof authorityFire>) {
  const result = authorityFire.apply(this, args), reason = result.accepted ? "accepted" : result.reason ?? "rejected";
  fireReasons.set(reason, (fireReasons.get(reason) ?? 0) + 1);
  document.getElementById("host-fire-diagnostics")!.textContent = `Host fire decisions: ${JSON.stringify(Object.fromEntries(fireReasons))}; latest represented-view age ${args[5] - Number(args[2])} ms`;
  return result;
};
const exitPole = document.getElementById("exit") as HTMLInputElement;
const crouch = document.getElementById("crouch") as HTMLInputElement;
const lean = document.getElementById("lean") as HTMLSelectElement;
const color = document.getElementById("color") as HTMLInputElement;
const arenaOwner = document.getElementById("arena-owner") as HTMLSelectElement;
const visitPlayer = document.getElementById("visit-player") as HTMLSelectElement;
const walk = document.getElementById("walk") as HTMLInputElement;
let latestSurface: SurfaceNetworkSnapshot | null = null, surfaceSnapshots = 0, fireSequence = 0, dispositions = 0;
let lastSnapshotReceivedAt = 0;
let latestHostEstimate = 0, lastSnapshotWallAt = 0;
const displayedHistory = new SurfaceHistory();
function presentation() {
  const snapshot = latestSurface;
  if (!snapshot) return null;
  const shooter = snapshot.players.find(player => player.id === self);
  return presentSurfacePlayers(displayedHistory, snapshot.players, new Map(snapshot.arenas.map(arena => [arena.key, arena])), self, shooter?.arenaKey ?? null,
    latestHostEstimate + Math.max(0, Date.now() - lastSnapshotWallAt), snapshot.hostTime);
}
type FireSample = { sequence: number; sentAt: number; viewTime: number; representedLagMs: number; exhausted: boolean; elapsedMs?: number; accepted?: boolean };
let trial: { epoch: number; arenaKey: string; lifeId: number; samples: FireSample[]; aborted: string | null; sent: number; startedAt: number } | null = null;
function renderTrial(): void {
  if (!trial) return;
  const samples = trial.samples, resolved = samples.filter(sample => sample.elapsedMs !== undefined), times = resolved.map(sample => sample.elapsedMs!).sort((a, b) => a - b);
  const percentile = (fraction: number) => times.length ? Math.round(times[Math.min(times.length - 1, Math.ceil(times.length * fraction) - 1)]) : 0;
  const within = (limit: number) => samples.length ? (resolved.filter(sample => sample.elapsedMs! <= limit).length / samples.length * 100).toFixed(1) : "0.0";
  document.getElementById("fire-trial-summary")!.textContent = `${trial.aborted ? `INVALID: ${trial.aborted}` : trial.sent === 500 && performance.now() - samples[samples.length - 1].sentAt > 1500 ? "Complete" : "Running"}; ${trial.sent}/500 attempts; ${resolved.length} dispositions; ${resolved.filter(sample => sample.accepted).length} accepted; ${within(600)}% within 600 ms; ${within(1000)}% within 1000 ms; p95 ${percentile(0.95)} ms; p99 ${percentile(0.99)} ms`;
  document.getElementById("fire-trial-data")!.textContent = JSON.stringify({ scope: "Real browser WebRTC disposition trial using the renderer's shared presentation selector and bounded pose history. Ordinary resources; no WebGL, hit fairness, or rendered prediction assertions. Cancellation invalidates the trial.", epoch: trial.epoch, aborted: trial.aborted, samples }, null, 2);
}
const connections = new Set<RTCPeerConnection>();
const dataChannels = new Set<RTCDataChannel>();
const requestedRelay = new URLSearchParams(location.search).get("relay");
// Restrict the test-only override to loopback. Production defaults remain unchanged.
const loopbackRelay = requestedRelay && /^http:\/\/(127\.0\.0\.1|localhost):\d+\/relay$/.test(requestedRelay) ? requestedRelay : null;
if (loopbackRelay) { relay.disabled = true; status.textContent = "Loopback signaling fixture; TURN credential requests disabled."; }
const NativeConnection = window.RTCPeerConnection;
const udpToken = loopbackRelay ? new URLSearchParams(location.search).get("udp") : null;
const FixtureConnection = NativeConnection && udpToken ? proxyIceConnection(NativeConnection, udpToken, () => { status.textContent = "UDP impairment registration failed; connection closed."; status.className = "error"; }) : NativeConnection;
if (NativeConnection) {
  window.RTCPeerConnection = class extends FixtureConnection {
    constructor(configuration?: RTCConfiguration) {
      super({ ...configuration, iceTransportPolicy: relay.checked ? "relay" : "all" });
      connections.add(this);
      this.addEventListener("datachannel", event => dataChannels.add(event.channel));
    }
    createDataChannel(label: string, options?: RTCDataChannelInit): RTCDataChannel { const channel = super.createDataChannel(label, options); dataChannels.add(channel); return channel; }
  };
}

const data: GraphData = {
  groups: [{ key: "synthetic", label: "Synthetic", color: "#5b9bff", count: 2 }],
  nodes: [{ id: "Alpha.md", name: "Alpha", group: "synthetic", deg: 1 }, { id: "Beta.md", name: "Beta", group: "synthetic", deg: 1 }],
  links: [{ source: "Alpha.md", target: "Beta.md" }],
};
const nodes: SimNode[] = data.nodes.map((node, index) => ({ ...node, index, gi: 0, x: index * 40, y: 0, z: 0, vx: 0, vy: 0, vz: 0, phase: 0, speed: 0 }));
let members: AnonymousPlayer[] = [], self = "", topologyCount = 0, positionCount = 0;
const poses = new Map<string, Pose>();
const topologies = new Map<string, AnonymousTopology>();
const ORIGINS = [[0, 0, 0], [2300, 0, 0], [-1150, 0, 1992], [-1150, 0, -1992]];
function movePublishedMain(slot: number): void {
  const origin = ORIGINS[slot];
  if (origin) for (const [index, node] of nodes.entries()) { node.x = origin[0] + index * 40; node.y = origin[1]; node.z = origin[2] + 68; }
}
function updateMemberOptions(select: HTMLSelectElement): void {
  const selected = select.value || self;
  select.replaceChildren(...members.map(member => {
    const option = createEl("option"); option.value = member.id; option.textContent = member.name; return option;
  }));
  if (members.some(member => member.id === selected)) select.value = selected;
}
function dockOwner(ownerId: string): void {
  const topology = ownerId === self ? network.localTopology : topologies.get(ownerId), hub = topology?.nodes.find(node => node.dockable);
  if (topology && hub) network.requestSurfaceDock({ ownerId, starId: hub.id, revision: topology.revision });
}
const rows = new Map<string, HTMLLIElement>();
const requestIce = async (url: string, token?: string) => {
  const response = await browserRequest(url, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* preserve the status for the service error path */ }
  return { status: response.status, body };
};
function renderPlayers(): void {
  for (const [id, row] of rows) if (!members.some(member => member.id === id)) { row.remove(); rows.delete(id); }
  for (const member of members) {
    let row = rows.get(member.id);
    if (!row) { row = createEl("li"); rows.set(member.id, row); players.append(row); }
    const pose = poses.get(member.id);
    const text = `${member.name}${member.id === self ? " (you)" : ""}: ${pose ? `${pose.health} HP, ${pose.active ? "flying" : "spectator"}` : "waiting for flight state"}`;
    const detail = `${text}${pose ? `; flight ack ${pose.inputTick}` : ""}`;
    if (row.textContent !== detail) row.textContent = detail;
  }
}
function renderMaps(): void { maps.textContent = `${topologyCount} map revisions; ${positionCount} position frames`; }
const network = new MultiplayerSession({
  status(text, error) { status.textContent = text; status.className = error ? "error" : ""; },
  members(value, selfId) {
    const joined = selfId !== self;
    if (joined) { inputSequence = 0; flightFrames.length = 0; }
    members = value; self = selfId; relay.disabled = !!self || !!loopbackRelay;
    const slot = value.find(member => member.id === selfId)?.slot ?? 0;
    if (joined) movePublishedMain(slot);
    updateMemberOptions(arenaOwner); updateMemberOptions(visitPlayer);
    for (const id of poses.keys()) if (!members.some(member => member.id === id)) poses.delete(id);
    renderPlayers();
  },
  playerState(id, pose) { poses.set(id, pose); renderPlayers(); },
  topology(id, topology) { topologies.set(id, topology); topologyCount++; renderMaps(); }, positions() { positionCount++; renderMaps(); },
  message() {}, removed() {}, authority() {}, shotState() {},
  surfaceState(snapshot, hostNow, rtt) {
    if (snapshot.epoch !== latestSurface?.epoch) displayedHistory.clear();
    latestSurface = snapshot; surfaceSnapshots++; lastSnapshotReceivedAt = performance.now();
    latestHostEstimate = hostNow; lastSnapshotWallAt = Date.now();
    for (const player of snapshot.players) if (player.mode === "surface" && player.surface && player.arenaKey) displayedHistory.record({
      playerId: player.id, arenaKey: player.arenaKey, arenaRevision: snapshot.arenas.find(arena => arena.key === player.arenaKey)?.revision,
      lifeId: player.lifeId, at: snapshot.hostTime, state: player.surface, protected: player.protectedUntil > snapshot.hostTime,
    });
    const trialPlayer = snapshot.players.find(player => player.id === self);
    if (trial && (snapshot.epoch !== trial.epoch || trialPlayer?.lifeId !== trial.lifeId || trialPlayer?.arenaKey !== trial.arenaKey || trialPlayer.mode !== "surface" || trialPlayer.health <= 0 || members.length !== 4)) trial.aborted = "Authority, life, arena, or four-player membership changed";
    const counts = new Map<string, number>();
    for (const player of snapshot.players) if (player.arenaKey) counts.set(player.arenaKey, (counts.get(player.arenaKey) ?? 0) + 1);
    surfaceSummary.textContent = `${surfaceSnapshots} surface snapshots; epoch ${snapshot.epoch}; RTT ${Math.round(rtt ?? 0)} ms; snapshot age ${Math.max(0, Date.now() - snapshot.hostTime)} ms\n${snapshot.players.map(player => `${members.find(member => member.id === player.id)?.name ?? "Pilot"}${player.id === self ? " (you)" : ""}: ${player.mode}; ${player.health} HP; ${player.armor} armor; ${player.heat.toFixed(1)} heat; ${player.laserColor}; input ack ${player.inputSequence}; ${player.kills} kills/${player.deaths} deaths${player.surface ? `; ${player.surface.crouched ? "crouched" : "standing"}; lean ${player.surface.lean.toFixed(3)}` : ""}`).join("\n")}\n${counts.size} occupied arenas; largest occupancy ${Math.max(0, ...counts.values())}; ${snapshot.projectiles.length} bolts; ${snapshot.pickups.filter(pickup => pickup.available).length}/${snapshot.pickups.length} pickups available`;
  },
  surfaceDockResult(_sequence, accepted) { surfaceResult.textContent = accepted ? "Dock accepted" : "Dock rejected"; },
  surfaceFireResult(sequence, accepted) {
    dispositions++; surfaceResult.textContent = `Fire ${sequence}: ${accepted ? "accepted" : "rejected"}; ${dispositions} authoritative dispositions`;
    const sample = trial?.samples.find(sample => sample.sequence === sequence);
    if (sample && sample.elapsedMs === undefined) { sample.elapsedMs = performance.now() - sample.sentAt; sample.accepted = accepted; renderTrial(); }
  },
  surfaceColor(_sequence, accepted, approved) { surfaceResult.textContent = `Color ${accepted ? "approved" : "rejected"}: ${approved}`; },
}, () => ({ data, nodes }), () => loopbackRelay ?? DEFAULT_RELAY, browserPost, loopbackRelay ? undefined : requestIce);

async function start(action: "create" | "join"): Promise<void> {
  try {
    if (action === "create") await network.create(name.value); else await network.join(code.value, name.value);
    code.value = network.room;
  } catch (error) { status.textContent = error instanceof Error ? error.message : "Connection failed"; status.className = "error"; }
}
document.getElementById("create")!.addEventListener("click", () => void start("create"));
document.getElementById("join")!.addEventListener("click", () => void start("join"));
document.getElementById("leave")!.addEventListener("click", () => network.leave());
document.getElementById("dock")!.addEventListener("click", () => {
  dockOwner(self);
});
document.getElementById("dock-selected")!.addEventListener("click", () => dockOwner(arenaOwner.value));
document.getElementById("move-main")!.addEventListener("click", () => {
  const member = members.find(member => member.id === visitPlayer.value);
  if (member) { movePublishedMain(member.slot); surfaceResult.textContent = `Published main moved near ${member.name}'s spawn`; }
});
document.getElementById("fire-nearest")!.addEventListener("click", () => {
  const snapshot = latestSurface, shooter = snapshot?.players.find(player => player.id === self);
  const arena = snapshot?.arenas.find(arena => arena.key === shooter?.arenaKey);
  if (!snapshot || !shooter?.surface || !shooter.arenaKey || !arena || shooter.health <= 0) return;
  const pose = surfaceViewPose(shooter.surface), muzzle = new THREE.Vector3(...pose.muzzle);
  const displayed = presentation(); if (!displayed) return;
  const targets = displayed.samples.filter(({ player }) => player.arenaKey === shooter.arenaKey && player.health > 0)
    .map(({ player, frame }) => ({ id: player.id, state: frame.state, health: player.health, protected: player.protectedUntil > snapshot.hostTime }));
  for (const target of targets.sort((a, b) => muzzle.distanceToSquared(new THREE.Vector3(...a.state.position)) - muzzle.distanceToSquared(new THREE.Vector3(...b.state.position)))) {
    if (target.protected) continue;
    const up = new THREE.Vector3(...target.state.position).normalize(), forward = new THREE.Vector3(...target.state.forward).projectOnPlane(up).normalize();
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();
    const point = new THREE.Vector3(...target.state.position).addScaledVector(up, target.state.crouched ? 0.7 : 1.2).addScaledVector(right, target.state.lean);
    const hit = traceSurfaceSegment(pose.muzzle, point.toArray(), arena.arena.walls, targets, self);
    if (hit?.kind !== "player") continue;
    network.fireSurface(++fireSequence, Math.floor(displayed.representedAt), shooter.arenaKey, shooter.lifeId, point.sub(muzzle).normalize().toArray());
    return;
  }
  surfaceResult.textContent = "No visible unprotected player on this arena";
});
document.getElementById("surface-fire")!.addEventListener("click", () => {
  const player = latestSurface?.players.find(player => player.id === self);
  const displayed = presentation();
  if (latestSurface && player?.surface && player.arenaKey && displayed) network.fireSurface(++fireSequence, Math.floor(displayed.representedAt), player.arenaKey, player.lifeId, surfaceBlasterDirection(player.surface));
});
document.getElementById("set-color")!.addEventListener("click", () => network.setSurfaceColor(color.value));
document.getElementById("fire-trial")!.addEventListener("click", () => {
  const player = latestSurface?.players.find(player => player.id === self);
  if (!latestSurface || !player?.surface || !player.arenaKey || player.health <= 0 || members.length !== 4 || latestSurface.players.filter(player => player.mode === "surface").length !== 4 || performance.now() - lastSnapshotReceivedAt > 500 || Date.now() - latestSurface.hostTime > 500 || trial && !trial.aborted && trial.sent < 500) { surfaceResult.textContent = "Trial needs four docked players, fresh same-computer snapshots, and no running trial"; return; }
  trial = { epoch: latestSurface.epoch, arenaKey: player.arenaKey, lifeId: player.lifeId, samples: [], aborted: null, sent: 0, startedAt: performance.now() };
  const thisTrial = trial;
  const timer = window.setInterval(() => {
    if (trial !== thisTrial || thisTrial.aborted) { window.clearInterval(timer); renderTrial(); return; }
    const shooter = latestSurface?.players.find(player => player.id === self);
    if (!latestSurface || !shooter?.surface || shooter.mode !== "surface" || shooter.health <= 0 || shooter.lifeId !== thisTrial.lifeId || shooter.arenaKey !== thisTrial.arenaKey || latestSurface.epoch !== thisTrial.epoch) { thisTrial.aborted = "Shooter state changed"; window.clearInterval(timer); renderTrial(); return; }
    const displayed = presentation(); if (!displayed) return;
    const viewTime = Math.floor(displayed.representedAt);
    const sample = { sequence: ++fireSequence, sentAt: performance.now(), viewTime, representedLagMs: latestHostEstimate + Math.max(0, Date.now() - lastSnapshotWallAt) - viewTime, exhausted: displayed.exhausted };
    thisTrial.samples.push(sample); thisTrial.sent++;
    network.fireSurface(sample.sequence, viewTime, shooter.arenaKey, shooter.lifeId, surfaceBlasterDirection(shooter.surface));
    renderTrial();
    if (thisTrial.sent === 500) { window.clearInterval(timer); window.setTimeout(renderTrial, 1500); }
  }, 220);
});
let inputSequence = 0;
const flightFrames: FlightTick[] = [];
const inputs = window.setInterval(() => {
  if (!network.active || !poses.has(self)) return;
  const player = latestSurface?.players.find(player => player.id === self);
  if (player?.mode === "surface" && player.arenaKey) network.sendSurfaceInput({ ...neutralSurfaceInput(), moveY: walk.checked ? 1 : 0, crouch: crouch.checked, lean: Number(lean.value), interact: exitPole.checked }, player.arenaKey, player.lifeId);
  else {
    // Mirror production's overlapping resend window: a dropped flight tick must
    // not strand this stationary fixture before it can request docking.
    flightFrames.push({ tick: ++inputSequence, thrust: 0, strafe: 0, lift: 0, roll: 0, pitch: 0, yaw: 0, boost: false, brake: false, active: flying.checked, mouseMode: "capture", mouseDelta: [0, 0], sensitivity: 1, agility: 1, invertY: false });
    if (flightFrames.length > 12) flightFrames.shift();
    network.sendInput({ sequence: inputSequence, thrust: 0, strafe: 0, lift: 0, roll: 0, pitch: 0, yaw: 0, boost: false, brake: false, fire: false, active: flying.checked, mouseMode: "capture", mouseSamples: [[0, 0]], sensitivity: 1, agility: 1, invertY: false, ticks: flightFrames.map(frame => ({ ...frame, mouseDelta: [...frame.mouseDelta] as [number, number] })) });
  }
}, 50);
const stats = window.setInterval(() => {
  renderTrial();
  void Promise.all([...connections].filter(pc => pc.connectionState !== "closed").map(async pc => {
    const report = await pc.getStats();
    const selected = connectionStats(report).find(item => item.type === "transport" && item.selectedCandidatePairId)?.selectedCandidatePairId;
    const pair = selected ? connectionStatById(report, selected) : connectionStats(report).find(item => item.type === "candidate-pair" && item.nominated && item.state === "succeeded");
    const local = pair && connectionStatById(report, pair.localCandidateId)?.candidateType;
    const remoteCandidate = pair && connectionStatById(report, pair.remoteCandidateId);
    const remote = remoteCandidate?.candidateType;
    // Display only types and counters, never candidate addresses or credentials.
    return `${pc.connectionState}${pair ? `: ${local} -> ${remote}; ${pair.bytesSent || 0} bytes sent; RTT ${Math.round((pair.currentRoundTripTime ?? 0) * 1000)} ms${udpToken ? `; proxy route ${remoteCandidate?.address === "127.0.0.1" ? "selected" : "NOT VERIFIED"}` : ""}` : ""}`;
  })).then(rows => { transport.textContent = (rows.join("\n") || "No peer connection") + `\n${[...dataChannels].filter(channel => channel.readyState === "open").map(channel => `${channel.label}: ${channel.bufferedAmount} bytes queued`).join("\n")}`; }).catch(() => { transport.textContent = "Connection statistics unavailable"; });
  if (udpToken) {
    const url = new URL("/udp/stats", location.origin); url.searchParams.set("token", udpToken);
    void proxyStats(url.toString()).then(value => {
      document.getElementById("impairment")!.textContent = `UDP impairment: ${value.profile.rtt} ms RTT; ±${value.profile.jitter} ms one-way jitter; ${value.profile.loss * 100}% loss\n${value.forwarded} forwarded; ${value.dropped} dropped; ${value.pairedSockets}/${value.sockets} paired sockets; ${value.sendErrors} send errors; mean applied delay ${value.meanDelayMs.toFixed(1)} ms`;
    }).catch(() => { document.getElementById("impairment")!.textContent = "UDP proxy statistics unavailable"; });
  }
}, 1000);
window.addEventListener("beforeunload", () => { window.clearInterval(inputs); window.clearInterval(stats); network.leave(); });
renderMaps();
if (!NativeConnection) status.textContent = "This browser does not provide WebRTC.";
