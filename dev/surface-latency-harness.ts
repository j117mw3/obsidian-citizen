import { browserPost } from "./browser-http";
import { bindSurfaceTerrain, type TerrainDefinition } from "../src/surfaceTerrain";
// Deterministic four-session acceptance harness. No vault, signaling service, browser, or socket access.
import * as THREE from "three";
import { MultiplayerSession } from "../src/multiplayer";
import { SurfaceAuthority, validSurfaceNetworkSnapshot, type SurfaceNetworkSnapshot, type SurfacePlayerSnapshot } from "../src/surfaceAuthority";
import { SurfaceHistory, SURFACE_INTERPOLATION_MS } from "../src/surfaceHistory";
import { SurfacePrediction, neutralSurfaceInput } from "../src/surfaceInput";
import { createSurfacePlayerState, stepSurfacePlayer, type SurfacePlayerState } from "../src/surfacePhysics";
import { surfaceSeed, spreadSurfaceDirection, surfaceSpreadDegrees, traceSurfaceSegment, SURFACE_BLASTER } from "../src/surfaceCombat";
import { surfaceViewPose, surfaceToWorld } from "../src/surfaceView";
import { SURFACE, type SurfaceWall } from "../src/surface";
import { ConstellationRenderer } from "../src/renderer";
import { SurfacePilot } from "../src/surfacePilot";
import { DEFAULT_PILOT_PROFILE } from "../src/pilotProfile";

export type SurfaceLatencyStance = "standing" | "crouched" | "leaning" | "crouched-leaning";
export type SurfaceLatencyScenario = "strafe" | "reverse" | "cover";
export interface SurfaceLatencyCase {
  rttMs: number; distance: number; stance: SurfaceLatencyStance; scenario: SurfaceLatencyScenario;
  shots?: number; seed?: number; jitterMs?: number; loss?: number; reliableRetryMs?: number;
  referenceAt?: number; terrain?: boolean; terrainDefinition?:TerrainDefinition;
}
export interface SurfaceLatencyResult {
  rttMs: number; distance: number; stance: SurfaceLatencyStance; scenario: SurfaceLatencyScenario;
  clients: number; attempts: number; accepted: number; dispositions: number; oracleHits: number; actualHits: number;
  agreement: number; hitRateDeficit: number; dispositionP95Ms: number; dispositionP99Ms: number; within600Ms: number; within1000Ms: number;
  duplicateHits: number; duplicateCollections: number; invalidSnapshots: number; modeDivergence: number; ghosts: number;
  maxRewindMs: number; blockerViolations: number; rejectionReasons: Record<string, number>; mismatchSequences: number[];
  liveDrops: number; reliableRetries: number; eligible: boolean; passed: boolean;
}

const IDS = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"];
const HUB = "n-55555555-5555-4555-8555-555555555555", OWNER = IDS[3], KEY = `${OWNER}/${HUB}`, BASE = 100000;
const DT = 1000 / 60;
const unit = (v: THREE.Vector3) => v.lengthSq() ? v.normalize() : v.set(0, 1, 0);
export { targetState as latencyTargetState, testWalls as latencyWalls, oracle as latencyOracle };
// Private access is confined to this fixture adapter; production classes get no test-only hooks.
import { fixture, requireFixture, type SessionFixture } from "./fixture-access";
function randomGenerator(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

interface Scheduled { at: number; order: number; run(): void }
class ImpairedTransport {
  now = BASE;
  liveDrops = 0;
  reliableRetries = 0;
  private order = 0;
  private heap: Scheduled[] = [];
  private ordered = new Map<string, number>();
  private random: () => number;
  constructor(private config: Required<Pick<SurfaceLatencyCase, "rttMs" | "jitterMs" | "loss" | "reliableRetryMs">>, seed: number) { this.random = randomGenerator(seed); }
  private push(event: Scheduled): void {
    this.heap.push(event);
    let index = this.heap.length - 1;
    while (index > 0) { const parent = (index - 1) >> 1; if (this.compare(this.heap[parent], event) <= 0) break; this.heap[index] = this.heap[parent]; index = parent; }
    this.heap[index] = event;
  }
  private compare(a: Scheduled, b: Scheduled): number { return a.at - b.at || a.order - b.order; }
  private pop(): Scheduled {
    const first = this.heap[0], last = this.heap.pop()!;
    if (this.heap.length) {
      let index = 0;
      while (true) {
        let child = index * 2 + 1;
        if (child >= this.heap.length) break;
        if (child + 1 < this.heap.length && this.compare(this.heap[child + 1], this.heap[child]) < 0) child++;
        if (this.compare(last, this.heap[child]) <= 0) break;
        this.heap[index] = this.heap[child]; index = child;
      }
      this.heap[index] = last;
    }
    return first;
  }
  send(from: number, to: number, lane: "control" | "live", data: string | ArrayBuffer, receive: () => void): void {
    let delay = Math.max(0, this.config.rttMs / 2 + (this.random() * 2 - 1) * this.config.jitterMs);
    if (lane === "live") { if (this.random() < this.config.loss) { this.liveDrops++; return; } }
    else {
      let retries = 0;
      while (this.random() < this.config.loss) { delay += this.config.reliableRetryMs * 2 ** retries++; this.reliableRetries++; }
    }
    const key = `${from}/${to}/${lane}`;
    let at = Math.ceil(this.now + delay);
    if (lane === "control") { at = Math.max(at, this.ordered.get(key) ?? 0); this.ordered.set(key, at); }
    this.push({ at, order: ++this.order, run: receive });
  }
  advance(at: number): void {
    while (this.heap.length && this.heap[0].at <= at) { const event = this.pop(); this.now = event.at; event.run(); }
    this.now = at;
  }
}

interface Attempt { sequence: number; at: number; oracle: boolean; accepted?: boolean; reason?: string; dispositionAt?: number; hits: Set<string>; blocker?: boolean }
interface Replica { session: MultiplayerSession; access: SessionFixture; history: SurfaceHistory; prediction: SurfacePrediction; latest: SurfaceNetworkSnapshot | null; self: SurfacePlayerSnapshot | null }

function targetState(config: SurfaceLatencyCase, at: number): SurfacePlayerState {
  const crouched = config.stance.includes("crouched"), lean = config.stance.includes("leaning") ? 0.35 : 0;
  const speed = crouched ? SURFACE.crouchSpeed : SURFACE.walkSpeed, theta = config.distance / SURFACE.radius;
  const seconds = (at - (config.referenceAt ?? BASE)) / 1000;
  let displacement = seconds, sign = 1;
  if (config.scenario === "reverse") {
    const phase = ((seconds / 0.6) % 4 + 4) % 4;
    displacement = (phase < 1 ? phase : phase < 3 ? 2 - phase : phase - 4) * 0.6;
    sign = phase < 1 || phase >= 3 ? 1 : -1;
  }
  const phi = config.scenario === "cover" ? Math.sin(seconds * 0.8) * 0.65 : displacement * speed / (SURFACE.radius * Math.sin(theta));
  const normal: [number, number, number] = [Math.sin(theta) * Math.sin(phi), Math.cos(theta), -Math.sin(theta) * Math.cos(phi)];
  const forward = unit(new THREE.Vector3(0, 1, 0).projectOnPlane(new THREE.Vector3(...normal)));
  const state = createSurfacePlayerState(normal, forward.toArray(),27,config.terrainDefinition);
  const velocity = config.scenario === "cover" ? 0.65 * 0.8 * Math.cos(seconds * 0.8) * SURFACE.radius * Math.sin(theta) : speed * sign;
  return { ...state, crouched, lean, velocity: [Math.cos(phi) * velocity, 0, Math.sin(phi) * velocity] };
}

function testWalls(config: SurfaceLatencyCase): SurfaceWall[] {
  const walls: SurfaceWall[] = [0, 1, 2, 3].map(index => {
    const normal = unit(new THREE.Vector3(index % 2 ? -0.2 : 0.2, -1, index < 2 ? 0.1 : -0.1));
    return { id: `wall-${index}`, normal: normal.toArray(), tangent: unit(new THREE.Vector3(1, 0, 0).projectOnPlane(normal)).toArray(), height: 2.2, length: 3.5 };
  });
  if (config.scenario === "cover") {
    const theta = (config.distance - 2) / SURFACE.radius;
    walls[0] = { id: "wall-0", normal: [0, Math.cos(theta), -Math.sin(theta)], tangent: [1, 0, 0], height: 2.2, length: 3.5 };
  }
  return walls;
}

/** The oracle starts from the displayed pose and advances the scripted movement without transport delay. */
function oracle(config: SurfaceLatencyCase, displayed: SurfacePlayerState, representedAt: number, muzzle: [number, number, number], aim: [number, number, number], sequence: number, shooter: SurfacePlayerState, walls: SurfaceWall[], shooterId = IDS[1]): boolean {
  const direction = spreadSurfaceDirection(aim, surfaceSpreadDegrees(shooter), surfaceSeed(shooterId, sequence));
  const original = targetState(config, representedAt), position = new THREE.Vector3(...muzzle);
  let elapsed = 0;
  while (elapsed < SURFACE_BLASTER.boltLifetimeMs) {
    const next = Math.min(SURFACE_BLASTER.boltLifetimeMs, elapsed + DT), future = targetState(config, representedAt + next);
    const target = { ...displayed, position: displayed.position.map((value, axis) => value + future.position[axis] - original.position[axis]) as [number, number, number] };
    const end = position.clone().addScaledVector(new THREE.Vector3(...direction), SURFACE_BLASTER.boltSpeed * (next - elapsed) / 1000);
    const hit = traceSurfaceSegment(position.toArray(), end.toArray(), walls, [{ id: IDS[2], state: target, health: 100, protected: false }]);
    if (hit) return hit.kind === "player";
    position.copy(end); elapsed = next;
  }
  return false;
}

export function runSurfaceLatencyCase(config: SurfaceLatencyCase): SurfaceLatencyResult {
  const requiredShots = config.shots ?? 500, network = new ImpairedTransport({ rttMs: config.rttMs, jitterMs: config.jitterMs ?? 25, loss: config.loss ?? 0.01, reliableRetryMs: config.reliableRetryMs ?? 1000 }, config.seed ?? 7319);
  const previousNow = Date.now; Date.now = () => network.now;
  const attempts = new Map<number, Attempt>(), replicas: Replica[] = [], reasons: Record<string, number> = {};
  let invalidSnapshots = 0, modeDivergence = 0, duplicateCollections = 0, maxRewindMs = 0, blockerViolations = 0;
  const authority = new SurfaceAuthority({terrain:config.terrain}), walls = testWalls(config), hostId = IDS[0];
  const members = IDS.map((id, slot) => ({ id, slot, name: `Fixture ${slot}`, joinedAt: BASE + slot, profile: DEFAULT_PILOT_PROFILE }));
  const hitEvents = new Set<string>(), collections = new Set<string>();
  const pilotHud = fixture(Object.create(SurfacePilot.prototype) as SurfacePilot);
  Object.assign(pilotHud, { active: true, playerId: IDS[1], seenCombatEvents: new Set(), hitMarkerUntil: 0, audio: { play() {} }, updateHud() {}, showDamageCue() {} });
  const graphics = fixture(Object.create(ConstellationRenderer.prototype) as ConstellationRenderer);
  Object.assign(graphics, { multiplayer: true, roomCombatEnabled: true, localPlayerId: IDS[1], scene: new THREE.Scene(), networkSurfaceBolts: new Map(), roomSurfaceArenas: new Map(), roomSurfaceLocalArena: null,
    roomSurfaceLocalView: null, roomSurfaceHostTime: BASE, roomSurfaceReceivedAt: BASE, cb: { onSurfaceFire(sequence: number, viewTime: number, key: string, life: number, aim: [number, number, number]) { replicas[1].session.fireSurface(sequence, viewTime, key, life, aim); } } });
  try {
    authority.setOwnerMap(OWNER, { revision: 1, nodes: [{ id: HUB, group: 0, degree: 0, dockable: true }], links: [] }, new Float32Array([0, 0, 0]));
    for (const id of IDS) { authority.addPlayer(id, { position: [0, 0, 38 * SURFACE.worldRadius / SURFACE.radius], rotation: [0, 0, 0, 1], velocity: [0, 0, 0] }); if (!authority.dock(id, OWNER, HUB, BASE)) throw new Error("Fixture docking failed"); }
    config={...config,terrainDefinition:authority.world.getArena(KEY)?.arena.terrain};
    bindSurfaceTerrain(walls,config.terrainDefinition);
    requireFixture(fixture(authority.world).arenas.get(KEY)).arena.walls = walls.map((wall, index) => ({ ...wall, connectionId: `n-00000000-0000-4000-8000-${String(Math.floor(index / 2)).padStart(12, "0")}` }));
    bindSurfaceTerrain(requireFixture(fixture(authority.world).arenas.get(KEY)).arena.walls,config.terrainDefinition);
    requireFixture(fixture(authority.world).arenas.get(KEY)).arena.pickups.forEach((pickup) => { if (pickup.kind === "small-health") pickup.placement = "cover"; });
    const realUpdate = authority.world.updatePlayer.bind(authority.world);
    authority.world.updatePlayer = (id, controls, dt, now) => {
      const player = requireFixture(fixture(authority.world).players.get(id));
      player.health = 100; player.armor = 0; player.protectedUntil = 0;
      const before = authority.world.getPickups(KEY, now), result = realUpdate(id, controls, dt, now);
      if (result === "pickup") for (const pickup of authority.world.getPickups(KEY, now)) if (!pickup.available && before.find(item => item.id === pickup.id)?.available) {
        const key = `${pickup.id}/${pickup.respawnAt}`; if (collections.has(key)) duplicateCollections++; collections.add(key);
      }
      if (id === IDS[2]) player.surface = targetState(config, now);
      else if (id === IDS[1]) player.surface = { ...createSurfacePlayerState([0,1,0],[0,0,-1],27,config.terrainDefinition), crouched: config.stance.includes("crouched"), lean: config.stance.includes("leaning") ? 0.35 : 0 };
      else player.surface = createSurfacePlayerState(id === IDS[0] ? [1, 0, 0] : [-1, 0, 0],[0,0,-1],27,config.terrainDefinition);
      return result;
    };
    const realFire = authority.fire.bind(authority);
    authority.fire = (...args) => {
      const result = realFire(...args), attempt = attempts.get(args[1]);
      if (attempt) { attempt.accepted = result.accepted; attempt.reason = result.reason; if (result.reason) reasons[result.reason] = (reasons[result.reason] ?? 0) + 1; }
      if (result.projectile) maxRewindMs = Math.max(maxRewindMs, fixture(requireFixture(authority)).projectiles.find((shot) => shot.id === result.projectile!.id)?.rewindMs ?? 0);
      return result;
    };
    for (let index = 0; index < 4; index++) {
      const history = new SurfaceHistory(), prediction = new SurfacePrediction();
      const replica: Replica = { session: null!, access: null!, history, prediction, latest: null, self: null };
      const session = replica.session = new MultiplayerSession({ status() {}, members() {}, topology() {}, positions() {}, message() {}, removed() {}, authority() {}, playerState() {}, shotState() {},
        surfaceState(snapshot, hostNow) {
          if (!validSurfaceNetworkSnapshot(snapshot, 1)) { invalidSnapshots++; return; }
          replica.latest = snapshot;
          for (const player of snapshot.players) {
            if (player.mode !== "surface" || player.arenaKey !== KEY) modeDivergence++;
            if (player.surface && player.arenaKey) history.record({ playerId: player.id, arenaKey: player.arenaKey, arenaRevision: 1, lifeId: player.lifeId, at: snapshot.hostTime, state: player.surface, protected: player.protectedUntil > snapshot.hostTime });
          }
          const self = snapshot.players.find(player => player.id === IDS[index]);
          if (self) replica.self = prediction.reconcile(self, 1, walls);
          if (index === 1) {
            graphics.roomSurfaceArenas = new Map(snapshot.arenas.map(arena => [arena.key, arena])); graphics.roomSurfaceLocalArena = snapshot.arenas.find(arena => arena.key === KEY) ?? null;
            graphics.roomSurfaceLocalView = replica.self; graphics.roomSurfaceHostTime = hostNow; graphics.roomSurfaceReceivedAt = network.now;
            for (const shot of snapshot.projectiles) graphics.upsertNetworkSurfaceBolt(shot, snapshot.hostTime);
            pilotHud.applyCombatEvents(snapshot.damageCues, snapshot.hitConfirmations, IDS[1], snapshot.hostTime);
          }
          if (index === 0) for (const hit of snapshot.hitConfirmations) if (!hitEvents.has(hit.id)) { hitEvents.add(hit.id); if (hit.ownerId === IDS[1] && hit.targetId === IDS[2]) attempts.get(hit.sequence)?.hits.add(hit.id); }
        },
        surfaceFireResult(sequence, accepted) {
          if (index !== 1) return;
          const attempt = attempts.get(sequence);
          if (attempt && attempt.dispositionAt === undefined) { attempt.dispositionAt = network.now; if (attempt.accepted === undefined) attempt.accepted = accepted; }
          graphics.reconcileSurfaceFire(sequence, accepted);
        },
      }, () => ({ data: { nodes: [], groups: [], links: [] }, nodes: [] }), () => "https://fixture.invalid", browserPost);
      replica.access = fixture(session); Object.assign(replica.access, { selfId: IDS[index], hostId, roster: members, epoch: 1, authorityReady: true });
      if (index === 0) { replica.access.surfaceAuthority = authority; replica.access.world = { roundPhase: "combat" } as SessionFixture["world"]; }
      replicas.push(replica);
    }
    for (let from = 0; from < 4; from++) for (let to = 0; to < 4; to++) if (from !== to) {
      const channel = (lane: "live" | "control") => ({ readyState: "open", bufferedAmount: 0,
        send(data: string | ArrayBuffer) { network.send(from, to, lane, data, () => replicas[to].access.onPeerMessage(IDS[from], data, lane)); } });
      replicas[from].access.peers.set(IDS[to], { pc: {} as RTCPeerConnection, signalChain: Promise.resolve(), pendingCandidates: [], positionSequence: 0, lastPositionSequence: 0, topologySend: null, topologyReceive: null, live: channel("live") as RTCDataChannel, control: channel("control") as RTCDataChannel, positionReceive: new Map() });
    }
    let sequence = 0, nextFire = BASE + 1500, finishedAt = Infinity;
    const maximumTicks = Math.ceil((1500 + requiredShots * 2 * 600 + 3000) / DT);
    for (let tick = 0; tick < maximumTicks; tick++) {
      const at = Math.round(BASE + tick * DT); network.advance(at);
      for (const replica of replicas) if (replica.self?.surface && replica.self.arenaKey) {
        const controls = { ...neutralSurfaceInput(), crouch: replica.self.surface.crouched, lean: Math.sign(replica.self.surface.lean) };
        const inputSequence = replica.session.sendSurfaceInput(controls, replica.self.arenaKey, replica.self.lifeId);
        if (inputSequence !== undefined) {
          replica.prediction.record({ sequence: inputSequence, arenaKey: replica.self.arenaKey, lifeId: replica.self.lifeId, input: controls }, 1);
          replica.self = { ...replica.self, surface: stepSurfacePlayer(replica.self.surface, controls, 1 / 60, walls) };
        }
      }
      network.advance(at);
      if (tick % 30 === 0) authority.observeConnectionTiming(IDS[1], config.rttMs, at);
      if (tick % 6 === 0) for (const replica of replicas.slice(1)) replica.access.pingSurfaceHost();
      const segments = new Map<string, [number, number, number]>(fixture(requireFixture(authority)).projectiles.filter((shot) => !shot.stoppedAt).map((shot) => [shot.id, [...shot.position]]));
      authority.step(1 / 60, at); replicas[0].access.surfaceSimulatedAt = at;
      for (const shot of fixture(requireFixture(authority)).projectiles) {
        const start = segments.get(shot.id);
        if (!start || !shot.stoppedAt || !fixture(requireFixture(authority)).hitConfirmations.some((hit) => hit.at === at && hit.sequence === shot.sequence && hit.ownerId === shot.ownerId)) continue;
        // Independently retrace the actual damage segment with players removed: any blocker before its endpoint invalidates the hit.
        const blocker = traceSurfaceSegment(start, shot.position, walls, []);
        if (blocker && blocker.t < 1 - 1e-6) blockerViolations++;
      }
      if (tick % 3 === 0) replicas[0].access.publishSurfaceState(at);
      network.advance(at);
      const shooter = replicas[1], accepted = [...attempts.values()].filter(attempt => attempt.accepted).length;
      if (at >= nextFire && sequence < requiredShots * 2 && accepted < requiredShots && shooter.self?.surface && shooter.self.ventUntil <= shooter.access.surfaceClock.estimateHostTime(at) && shooter.self.heat < 100) {
        const displayAt = shooter.access.surfaceClock.estimateHostTime(at) - SURFACE_INTERPOLATION_MS;
        const target = shooter.history.present(IDS[2], displayAt, KEY, authority.world.getPlayer(IDS[2])!.lifeId, 1);
        if (target) {
          const pose = surfaceViewPose(shooter.self.surface), state = target.frame.state, up = unit(new THREE.Vector3(...state.position));
          const forward = unit(new THREE.Vector3(...state.forward).projectOnPlane(up)), right = unit(new THREE.Vector3().crossVectors(forward, up));
          const aimPoint = new THREE.Vector3(...state.position).addScaledVector(up, state.crouched ? 0.7 : 1.2).addScaledVector(right, state.lean)
            .addScaledVector(new THREE.Vector3(...state.velocity), config.distance / SURFACE_BLASTER.boltSpeed).addScaledVector(right, Math.sin((sequence + 1) * 2.399963) * 0.3);
          const direction = aimPoint.sub(new THREE.Vector3(...pose.muzzle)).normalize().toArray();
          const representedAt = Math.floor(target.frame.at); sequence++;
          attempts.set(sequence, { sequence, at, oracle: oracle(config, state, representedAt, pose.muzzle, direction, sequence, shooter.self.surface, walls), hits: new Set() });
          graphics.roomSurfaceLocalView = shooter.self;
          graphics.onSurfaceFire(surfaceToWorld(pose.muzzle, [0, 0, 0]), direction, sequence, representedAt);
          nextFire = at + 600;
        }
      }
      graphics.updateNetworkSurfaceBolts(shooter.access.surfaceClock.estimateHostTime(at));
      if (accepted >= requiredShots && finishedAt === Infinity) finishedAt = at + 3000;
      if (at >= finishedAt) break;
    }
    const rows = [...attempts.values()], count = rows.length, accepted = rows.filter(row => row.accepted).length;
    const oracleHits = rows.filter(row => row.oracle).length, actualHits = rows.filter(row => row.hits.size > 0).length;
    const mismatchSequences = rows.filter(row => row.oracle !== (row.hits.size > 0)).map(row => row.sequence);
    const latencies = rows.map(row => row.dispositionAt === undefined ? Infinity : row.dispositionAt - row.at).sort((a, b) => a - b);
    const percentile = (p: number) => latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)] ?? Infinity;
    const agreement = count ? 1 - mismatchSequences.length / count : 0, deficit = count ? (oracleHits - actualHits) / count : 1;
    const within600 = latencies.filter(value => value <= 600).length / Math.max(1, count), within1000 = latencies.filter(value => value <= 1000).length / Math.max(1, count);
    const duplicateHits = rows.reduce((sum, row) => sum + Math.max(0, row.hits.size - 1), 0);
    const ghosts = graphics.networkSurfaceBolts.size + Number(pilotHud.hitMarkerUntil > network.now);
    const eligible = requiredShots >= 500, passed = accepted >= requiredShots && invalidSnapshots === 0 && modeDivergence === 0 && duplicateHits === 0 && duplicateCollections === 0 && ghosts === 0
      && blockerViolations === 0 && maxRewindMs <= 150 && (config.rttMs > 100 || agreement >= 0.9 && deficit <= 0.05) && (config.rttMs !== 200 || within600 >= 0.95 && within1000 >= 0.99);
    return { rttMs: config.rttMs, distance: config.distance, stance: config.stance, scenario: config.scenario, clients: 4, attempts: count, accepted,
      dispositions: rows.filter(row => row.dispositionAt !== undefined).length, oracleHits, actualHits, agreement, hitRateDeficit: deficit,
      dispositionP95Ms: percentile(0.95), dispositionP99Ms: percentile(0.99), within600Ms: within600, within1000Ms: within1000,
      duplicateHits, duplicateCollections, invalidSnapshots, modeDivergence, ghosts, maxRewindMs, blockerViolations, rejectionReasons: reasons,
      mismatchSequences: mismatchSequences.slice(0, 12), liveDrops: network.liveDrops, reliableRetries: network.reliableRetries, eligible, passed };
  } finally { graphics.clearRoomSurfacePresentation = () => {}; for (const bolt of graphics.networkSurfaceBolts.values()) bolt.graphic.dispose(); Date.now = previousNow; }
}
