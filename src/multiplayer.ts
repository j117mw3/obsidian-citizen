import { surfaceWorldRadii } from "./surfaceGeometry";
import { MAX_CHECKPOINT_BYTES, stringifySurfaceTransfer, parseSurfaceTransfer } from "./surfaceGeometryWire";
import type { GraphData, RawLink, RawNode, SimNode } from "./types";
import { CombatWorld, type RoomCheckpoint } from "./combat";
import { DEFAULT_PILOT_PROFILE, LASER_SOUND_IDS, validPilotProfile, type PilotProfile, type LaserSoundId } from "./pilotProfile";
import { PLAYER_KILLS_TO_WIN, type EliminationEvent, type RoundSnapshot } from "./rounds";
import { DEFAULT_RELAY, type PostFn } from "./relay";
import { RelayRoom, ROOM_PROTOCOL, type RoomMember } from "./room";
import { selectMainNodeIds, SURFACE } from "./surface";
import { SurfaceAuthority, validSurfaceInput, type SurfaceAuthorityCheckpoint, type SurfaceNetworkSnapshot } from "./surfaceAuthority";
import { SurfaceHostClock } from "./surfaceHistory";
import type { SurfaceInput } from "./surfacePhysics";
import type { SurfaceTopology } from "./surfaceWorld";
import { isApprovedSurfaceLaserColor, normalizeSurfaceLaserColor } from "./surfaceColor";
import { copySurfaceControls, SURFACE_INPUT_RESEND, type SurfaceInputFrame } from "./surfaceInput";
import { compressedNetworkJson, decodeNetworkJson, sendNetworkJson } from "./networkJson";
import { SurfaceSnapshotWire } from "./surfaceSnapshotWire";

export const MAX_SHARED_NODES = 20_000;
export const MAX_SHARED_LINKS = 100_000;
export { ROOM_PROTOCOL };
export const TURN_CONFIGURATION_URL = "https://constellation-rooms.mrassetto.workers.dev/turn";
export const TURN_SESSION_URL = "https://constellation-rooms.mrassetto.workers.dev/turn/session";
const MAX_COORDINATE = 1_000_000;
const MAGIC = 0x43475031; // CGP1
const POSITION_HEADER_BYTES = 16;
const POSITION_CHUNK_MAGIC = 0x43474331; // CGC1
const POSITION_CHUNK_HEADER_BYTES = 24;
const POSITION_CHUNK_BYTES = 12_000;
const TOPOLOGY_CHUNK_CHARS = 12_000;
const MAX_TOPOLOGY_CHARS = 16 * 1024 * 1024;

export interface AnonymousGroup { color: string; count: number }
export interface AnonymousNode { id: string; group: number; degree: number; dockable: boolean }
export interface AnonymousTopology { revision: number; nodes: AnonymousNode[]; groups: AnonymousGroup[]; links: [string, string][] }
export interface AnonymousPlayer { id: string; name: string; joinedAt: number; slot: number; profile: PilotProfile }
export interface NavigationTarget { ownerId: string; starId: string; revision: number }
export interface Pose { position: [number, number, number]; rotation: [number, number, number, number]; velocity: [number, number, number]; spin: [number, number, number]; mouseSmoothing: [number, number]; health: number; shields: number; energy: number; boostLocked: boolean; boostHold: number; regenDelay: number; damagePause: number; weapon: 0 | 1; weaponSequence: number; inputSequence: number; inputTick: number; heat: number; overheated: boolean; ammunition: number; weaponCooldown: number; weaponCooldownDuration: number; deaths: number; active: boolean; traveling: boolean; respawnAt: number; protectedUntil: number; thrust: number; boosting: boolean; bank: number; tilt: number }
export interface ShotSnapshot { id: string; ownerId: string; gun: number; weapon: 0 | 1; origin: [number, number, number]; position: [number, number, number]; direction: [number, number, number]; speed: number; sound: LaserSoundId; startedAt: number }
export interface ImpactSnapshot { id: string; position: [number, number, number]; kind: "star" | "ship" }

/** Build a deliberately lossy network representation. File IDs and all note labels stop here. */
export function makeAnonymousTopology(data: GraphData, ids: Map<string, string>, revision: number): AnonymousTopology {
  if (data.nodes.length > MAX_SHARED_NODES || data.links.length > MAX_SHARED_LINKS)
    throw new Error(`This room supports up to ${MAX_SHARED_NODES.toLocaleString()} stars and ${MAX_SHARED_LINKS.toLocaleString()} links per vault.`);
  const active = new Set(data.nodes.map(n => n.id));
  for (const key of [...ids.keys()]) if (!active.has(key)) ids.delete(key);
  for (const node of data.nodes) if (!ids.has(node.id)) ids.set(node.id, `n-${crypto.randomUUID()}`);
  const groups = data.groups.map(g => ({ color: /^#[0-9a-f]{6}$/i.test(g.color) ? g.color : "#8b93a7", count: Math.max(0, Math.min(data.nodes.length, Math.floor(g.count))) }));
  const byId = new Map<string, RawNode>(data.nodes.map(n => [n.id, n]));
  const mainNodes = selectMainNodeIds(data.nodes);
  const nodes = data.nodes.map(n => ({ id: ids.get(n.id)!, group: Math.max(0, Math.min(groups.length - 1, data.groups.findIndex(g => g.key === n.group))), degree: Math.max(0, Math.min(MAX_SHARED_NODES, Math.floor(n.deg))), dockable: mainNodes.has(n.id) }));
  const links: [string, string][] = [];
  for (const link of data.links) {
    if (!byId.has(link.source) || !byId.has(link.target)) continue;
    const a = ids.get(link.source), b = ids.get(link.target);
    if (a && b && a !== b) links.push([a, b]);
  }
  return { revision, nodes, groups, links };
}

/** Binary position frame: protocol magic, topology revision, count, then xyz float32 triples. */
export function encodePositions(nodes: readonly SimNode[], topology: AnonymousTopology, sequence: number): ArrayBuffer {
  if (nodes.length !== topology.nodes.length) throw new Error("The graph changed while its position frame was being built.");
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 0xffffffff) throw new Error("Invalid position frame sequence.");
  const buffer = new ArrayBuffer(POSITION_HEADER_BYTES + nodes.length * 12);
  const view = new DataView(buffer);
  view.setUint32(0, MAGIC, true); view.setUint32(4, topology.revision, true); view.setUint32(8, nodes.length, true);
  view.setUint32(12, sequence, true);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i], o = POSITION_HEADER_BYTES + i * 12;
    for (const v of [n.x, n.y, n.z]) if (!Number.isFinite(v) || Math.abs(v) > MAX_COORDINATE) throw new Error("A constellation position is outside the room's coordinate limit.");
    view.setFloat32(o, n.x, true); view.setFloat32(o + 4, n.y, true); view.setFloat32(o + 8, n.z, true);
  }
  return buffer;
}

export function decodePositions(buffer: ArrayBuffer, topology: AnonymousTopology): { sequence: number; positions: Float32Array } | null {
  if (buffer.byteLength < POSITION_HEADER_BYTES || buffer.byteLength > POSITION_HEADER_BYTES + MAX_SHARED_NODES * 12) return null;
  const view = new DataView(buffer);
  const count = view.getUint32(8, true);
  const sequence = view.getUint32(12, true);
  if (view.getUint32(0, true) !== MAGIC || view.getUint32(4, true) !== topology.revision || count !== topology.nodes.length || !sequence || buffer.byteLength !== POSITION_HEADER_BYTES + count * 12) return null;
  const result = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i++) {
    const v = view.getFloat32(POSITION_HEADER_BYTES + i * 4, true);
    if (!Number.isFinite(v) || Math.abs(v) > MAX_COORDINATE) return null;
    result[i] = v;
  }
  return { sequence, positions: result };
}

export function encodePositionChunks(nodes: readonly SimNode[], topology: AnonymousTopology, sequence: number): ArrayBuffer[] {
  const frame = encodePositions(nodes, topology, sequence), bytes = new Uint8Array(frame);
  const total = Math.ceil(bytes.length / POSITION_CHUNK_BYTES), chunks: ArrayBuffer[] = [];
  for (let index = 0; index < total; index++) {
    const from = index * POSITION_CHUNK_BYTES, size = Math.min(POSITION_CHUNK_BYTES, bytes.length - from);
    const chunk = new ArrayBuffer(POSITION_CHUNK_HEADER_BYTES + size), view = new DataView(chunk);
    view.setUint32(0, POSITION_CHUNK_MAGIC, true); view.setUint32(4, topology.revision, true); view.setUint32(8, sequence, true);
    view.setUint32(12, index, true); view.setUint32(16, total, true); view.setUint32(20, bytes.length, true);
    new Uint8Array(chunk, POSITION_CHUNK_HEADER_BYTES).set(bytes.subarray(from, from + size)); chunks.push(chunk);
  }
  return chunks;
}

type SignalMessage = { type: string; [key: string]: unknown };
export type GameMessage = { type: "input"; epoch: number; input: FlightInput }
  | { type: "weapon"; epoch: number; sequence: number; weapon: 0 | 1 }
  | { type: "navigate"; epoch: number; target: NavigationTarget }
  | { type: "fire"; epoch: number; sequence: number; gun: number; weapon: 0 | 1; aimPoint: [number, number, number] }
  | { type: "shot-result"; epoch: number; sequence: number; accepted: boolean }
  | { type: "ship"; epoch: number; sequence: number; playerId: string; pose: Pose }
  | { type: "ships"; epoch: number; sequence: number; poses: Array<{ id: string; pose: Pose }> }
  | { type: "shots"; epoch: number; sequence: number; shots: ShotSnapshot[]; impacts: ImpactSnapshot[] }
  | { type: "round-state"; epoch: number; state: RoundSnapshot }
  | { type: "elimination"; epoch: number; event: EliminationEvent }
  | { type: "checkpoint"; epoch: number; sentAt: number; state: unknown }
  | { type: "checkpoint-chunk"; epoch: number; sentAt: number; index: number; total: number; data: string }
  | { type: "surface-dock"; epoch: number; sequence: number; target: NavigationTarget }
  | { type: "surface-dock-result"; epoch: number; sequence: number; accepted: boolean; reason?: "preparation" }
  | { type: "surface-input"; epoch: number; frames: SurfaceInputFrame[] }
  | { type: "surface-fire"; epoch: number; sequence: number; viewTime: number; arenaKey: string; lifeId: number; direction: [number, number, number]; kind?: "normal" | "charged" }
  | { type: "surface-charge"; epoch: number; active: boolean; arenaKey: string; lifeId: number }
  | { type: "surface-fire-result"; epoch: number; sequence: number; accepted: boolean }
  | { type: "surface-color"; epoch: number; sequence: number; color: string }
  | { type: "surface-color-result"; epoch: number; sequence: number; accepted: boolean; color: string }
  | { type: "surface-state"; epoch: number; state: SurfaceNetworkSnapshot }
  | { type: "surface-geometry-chunk"; epoch: number; token: number; index: number; total: number; data: string }
  | { type: "surface-geometry-ready" | "surface-geometry-needed"; epoch: number; tokens: number[] }
  | { type: "surface-ping"; epoch: number; sequence: number; clientSentAt: number }
  | { type: "surface-pong"; epoch: number; sequence: number; clientSentAt: number; hostReceivedAt: number; hostSentAt: number }
  | { type: "authority-proposal"; epoch: number; hostId: string; members: string[]; failure?: boolean; baseEpoch?: number }
  | { type: "authority-vote"; epoch: number; hostId: string; voterId: string; members: string[] }
  | { type: "authority-commit"; epoch: number; hostId: string; members: string[] };
export interface FlightTick {
  tick: number; thrust: number; strafe: number; lift: number; roll: number; pitch: number; yaw: number;
  boost: boolean; brake: boolean; active: boolean; mouseMode: "capture" | "cursor"; mouseDelta: [number, number];
  sensitivity: number; agility: number; invertY: boolean;
}
export interface FlightInput {
  sequence: number; thrust: number; strafe: number; lift: number; roll: number; pitch: number; yaw: number;
  boost: boolean; brake: boolean; fire: boolean; active: boolean;
  mouseMode: "capture" | "cursor"; mouseSamples: [number, number][]; sensitivity: number; agility: number; invertY: boolean;
  /** Exact 60 Hz input history carried in each 20 Hz network batch. */
  ticks?: FlightTick[];
}

export interface MultiplayerCallbacks {
  status(text: string, error?: boolean): void;
  members(members: AnonymousPlayer[], selfId: string, hostId: string, epoch: number): void;
  topology(playerId: string, topology: AnonymousTopology): void;
  positions(playerId: string, positions: Float32Array): void;
  message(from: string, message: GameMessage): void;
  removed(playerId: string): void;
  authority(hostId: string, epoch: number, checkpoint: unknown): void;
  playerState(playerId: string, pose: Pose): void;
  shotState(shots: ShotSnapshot[], impacts: ImpactSnapshot[]): void;
  shotResult?(sequence: number, accepted: boolean): void;
  navigation?(target: NavigationTarget | null, state?: "selected" | "travelling" | "cancelled"): void;
  round?(state: RoundSnapshot): void;
  elimination?(event: EliminationEvent): void;
  surfaceState?(snapshot: SurfaceNetworkSnapshot, estimatedHostTime: number, rttMs: number): void;
  surfaceFireResult?(sequence: number, accepted: boolean): void;
  surfaceDockResult?(sequence: number, accepted: boolean, reason?: "preparation"): void;
  surfaceColor?(sequence: number, accepted: boolean, color: string): void;
}

export function validRoundSnapshot(value: unknown, epoch?: number): value is RoundSnapshot {
  if (!value || typeof value !== "object") return false;
  const state = value as RoundSnapshot;
  if (!Number.isSafeInteger(state.epoch) || (epoch !== undefined && state.epoch !== epoch) || !Number.isSafeInteger(state.roundId) || state.roundId < 1
    || !["combat", "supernova", "waiting", "countdown"].includes(state.phase) || !Number.isFinite(state.phaseRemainingMs) || state.phaseRemainingMs < 0
    || typeof state.winnerId !== "string" || (state.winnerId !== "" && !/^[0-9a-f-]{36}$/i.test(state.winnerId))
    || !Array.isArray(state.scores) || state.scores.length > 64 || !Array.isArray(state.layoutRequirements) || state.layoutRequirements.length > 4) return false;
  const phaseLimit = state.phase === "supernova" ? 8000 : state.phase === "waiting" ? 15_000 : state.phase === "countdown" ? 3000 : 0;
  if (state.phaseRemainingMs > phaseLimit) return false;
  const players = new Set<string>();
  for (const score of state.scores) {
    if (!score || typeof score.playerId !== "string" || !/^[0-9a-f-]{36}$/i.test(score.playerId) || players.has(score.playerId) || !Number.isInteger(score.kills) || score.kills < 0 || score.kills > PLAYER_KILLS_TO_WIN || !Number.isInteger(score.deaths) || score.deaths < 0 || score.deaths > 999) return false;
    players.add(score.playerId);
  }
  const required = new Set<string>();
  for (const item of state.layoutRequirements) {
    if (!item || typeof item.playerId !== "string" || !players.has(item.playerId) || required.has(item.playerId) || !Number.isSafeInteger(item.revision) || item.revision < 1) return false;
    required.add(item.playerId);
  }
  if (state.phase === "combat" && state.winnerId) return false;
  if (state.phase !== "combat" && (!state.winnerId || !players.has(state.winnerId) || state.scores.find(score => score.playerId === state.winnerId)?.kills !== PLAYER_KILLS_TO_WIN)) return false;
  return true;
}

export function validEliminationEvent(value: unknown, roundId?: number): value is EliminationEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as EliminationEvent;
  return typeof event.id === "string" && event.id.length > 0 && event.id.length <= 128 && Number.isSafeInteger(event.roundId) && event.roundId > 0
    && (roundId === undefined || event.roundId === roundId) && typeof event.attackerId === "string" && /^[0-9a-f-]{36}$/i.test(event.attackerId)
    && typeof event.victimId === "string" && /^[0-9a-f-]{36}$/i.test(event.victimId) && event.attackerId !== event.victimId
    && Number.isInteger(event.attackerScore) && event.attackerScore >= 1 && event.attackerScore <= PLAYER_KILLS_TO_WIN && Number.isSafeInteger(event.at);
}

interface PositionAssembly { revision: number; sequence: number; totalBytes: number; chunks: Array<Uint8Array | undefined>; received: number; createdAt: number }

function validTopology(value: unknown): value is AnonymousTopology {
  if (!value || typeof value !== "object") return false;
  const t = value as AnonymousTopology;
  if (!Number.isSafeInteger(t.revision) || t.revision < 1 || !Array.isArray(t.nodes) || !Array.isArray(t.groups) || !Array.isArray(t.links) || t.nodes.length > MAX_SHARED_NODES || t.links.length > MAX_SHARED_LINKS || t.groups.length > 128) return false;
  const ids = new Set<string>();
  const dockableGroups = new Set<number>(), nodeGroups = new Set<number>(), highestDegrees = new Map<number, number>(), hubDegrees = new Map<number, number>();
  for (const n of t.nodes) {
    if (!n || typeof n.id !== "string" || !/^n-[0-9a-f-]{36}$/i.test(n.id) || ids.has(n.id) || !Number.isInteger(n.group) || n.group < 0 || n.group >= Math.max(1, t.groups.length) || !Number.isInteger(n.degree) || n.degree < 0 || n.degree > MAX_SHARED_NODES || typeof n.dockable !== "boolean") return false;
    nodeGroups.add(n.group);
    highestDegrees.set(n.group, Math.max(highestDegrees.get(n.group) ?? 0, n.degree));
    if (n.dockable) { if (dockableGroups.has(n.group)) return false; dockableGroups.add(n.group); hubDegrees.set(n.group, n.degree); }
    ids.add(n.id);
  }
  for (const group of nodeGroups) if (!dockableGroups.has(group) || hubDegrees.get(group) !== highestDegrees.get(group)) return false;
  for (const g of t.groups) if (!g || typeof g.color !== "string" || !/^#[0-9a-f]{6}$/i.test(g.color) || !Number.isInteger(g.count) || g.count < 0 || g.count > MAX_SHARED_NODES) return false;
  for (const l of t.links) if (!Array.isArray(l) || l.length !== 2 || !ids.has(l[0]) || !ids.has(l[1]) || l[0] === l[1]) return false;
  return true;
}

function validMembers(value: unknown): value is AnonymousPlayer[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return false;
  const ids = new Set<string>(), slots = new Set<number>();
  for (const item of value) {
    if (!item || typeof item !== "object") return false;
    const member = item as AnonymousPlayer;
    if (typeof member.id !== "string" || !/^[0-9a-f-]{36}$/i.test(member.id) || ids.has(member.id) || !validPilotProfile(member.profile)
      || typeof member.name !== "string" || member.name.length > 24 || !Number.isSafeInteger(member.joinedAt)
      || !Number.isInteger(member.slot) || member.slot < 0 || member.slot > 3 || slots.has(member.slot)) return false;
    ids.add(member.id); slots.add(member.slot);
  }
  return true;
}

function validIceServers(value: unknown): RTCIceServer[] {
  if (!Array.isArray(value) || value.length > 12) return [];
  const result: RTCIceServer[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const server = entry as RTCIceServer;
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    if (!urls.length || !urls.every(url => typeof url === "string" && /^(stun|stuns|turn|turns):/i.test(url))) continue;
    if (server.username !== undefined && typeof server.username !== "string") continue;
    if (server.credential !== undefined && typeof server.credential !== "string") continue;
    result.push(server);
  }
  return result;
}

/** WebRTC mesh plus a small signaling connection. Only anonymous graph messages pass through this class. */
export class MultiplayerSession {
  private socket: WebSocket | null = null;
  private publicRoom: RelayRoom | null = null;
  private readonly post: PostFn;
  private readonly request?: (url: string, token?: string) => Promise<{ status: number; body: unknown }>;
  private roomCode = "";
  private selfId = "";
  private hostId = "";
  private epoch = 0;
  private authorityReady = false;
  private authorityVotes = new Set<string>();
  private roster: AnonymousPlayer[] = [];
  private readonly peers = new Map<string, { pc: RTCPeerConnection; control?: RTCDataChannel; live?: RTCDataChannel; topology?: AnonymousTopology; positions?: Float32Array; positionsRevision?: number;
    signalChain: Promise<void>; pendingCandidates: RTCIceCandidateInit[];
    positionSequence: number; lastPositionSequence: number; topologySend: { revision: number; json: string; next: number; total: number } | null;
    topologyReceive: { revision: number; total: number; parts: string[]; bytes: number; received: number } | null;
    positionReceive: Map<number, PositionAssembly>; restartAfterStable?: boolean; iceRestarting?: boolean }>();
  // Keep replaceable state outside SCTP until the previous batch has drained.
  // A queued snapshot cannot be withdrawn from RTCDataChannel.bufferedAmount.
  private readonly liveLatest = new Map<string, Map<string, string>>();
  private readonly surfaceWire = new Map<string, SurfaceSnapshotWire>();
  private readonly retryTimers = new Map<string, number>();
  private readonly ids = new Map<string, string>();
  private topology: AnonymousTopology | null = null;
  private revision = 0;
  private sendTimer = 0;
  private checkpointTimer = 0;
  private gameTimer = 0;
  private topologyTimer = 0;
  private authorityMonitorTimer = 0;
  private world: CombatWorld | null = null;
  private surfaceAuthority: SurfaceAuthority | null = null;
  private surfaceRoundId = 0;
  private surfaceSimulatedAt = 0;
  private surfaceSnapshotSequence = 0;
  private lastSurfaceSnapshotSequence = 0;
  private surfaceRequestSequence = 0;
  private surfaceInputSequence = 0;
  private surfaceInputFrames: SurfaceInputFrame[] = [];
  private surfaceColorSequence = 0;
  private surfacePingSequence = 0;
  private lastSurfacePingAt = 0;
  private readonly pendingSurfacePings = new Map<number, number>();
  private readonly pendingSurfaceFire = new Map<number, { message: Extract<GameMessage, { type: "surface-fire" }>; startedAt: number; sentAt: number }>();
  private readonly surfaceFireResults = new Map<string, Map<number, boolean>>();
  private checkpointReceive: { sentAt: number; total: number; parts: Array<string | undefined>; bytes: number; received: number } | null = null;
  private lastCheckpointWireAt = -Infinity;
  private readonly issuedSurfaceTimes = new Map<string, number[]>();
  private readonly lastSurfaceDockSequence = new Map<string, number>();
  private readonly lastSurfaceColorSequence = new Map<string, number>();
  private readonly surfaceClock = new SurfaceHostClock();
  private lastGameStep = 0;
  private gameAccumulator = 0;
  private lastStateSend = 0;
  private gameResumeAt = 0;
  private stateSequence = 0;
  private positionSequence = 0;
  private lastShipSequence = new Map<string, number>();
  private lastShotSequence = 0;
  private lastRoundWireKey = "";
  private lastRoundId = 0;
  private lastRoundSendAt = 0;
  private readonly seenEliminations = new Set<string>();
  private relay: RTCIceServer[] = [];
  private iceExpiresAt = 0;
  private iceRefreshTimer = 0;
  private iceFallbackTimer = 0;
  private iceRefreshToken = "";
  private iceRefreshTokenExpiresAt = 0;
  private iceRequesting = false;
  private authorityTimer = 0;
  private lastHostPacketAt = 0;
  private pendingAuthorityCommit: { epoch: number; hostId: string; members: string[] } | null = null;
  private relayStatus: "ready" | "pending" | "unavailable" | "quota" | "direct-only" = "pending";
  private lastIceErrorAt = 0;
  private readonly iceFailures = new Map<string, { kind: "STUN" | "TURN" | "ICE"; code: number }>();
  private lastIceRequestAt = 0;
  private directStartedAt = 0;
  private lastCheckpoint: { state: unknown; sentAt: number } | null = null;
  private closed = false;
  private opening = false;

  constructor(private callbacks: MultiplayerCallbacks, private graph: () => { data: GraphData; nodes: readonly SimNode[] }, private signalingUrl: () => string, post?: PostFn,
    request?: (url: string, token?: string) => Promise<{ status: number; body: unknown }>) {
    this.post = post ?? (async (url, body) => (await fetch(url, { method: "POST", body, headers: { "Content-Type": "text/plain" } })).status);
    this.request = request;
  }
  get active(): boolean { return !!this.selfId && !this.closed; }
  get isHost(): boolean { return this.active && this.selfId === this.hostId; }
  get room(): string { return this.roomCode; }
  get localPlayerId(): string { return this.selfId; }
  get localTopology(): AnonymousTopology | null { return this.topology; }
  get members(): readonly AnonymousPlayer[] { return this.roster; }
  updateProfile(profile: PilotProfile): void {
    if (!this.active || !validPilotProfile(profile)) return;
    this.roster = this.roster.map(member => member.id === this.selfId ? { ...member, profile } : member);
    this.world?.setProfile(this.selfId, profile);
    this.callbacks.members(this.roster, this.selfId, this.hostId, this.epoch);
    this.publicRoom?.updateProfile(profile);
  }

  async create(name: string, profile: PilotProfile = DEFAULT_PILOT_PROFILE): Promise<void> { await this.open("create", name, "", profile); }
  async join(code: string, name: string, profile: PilotProfile = DEFAULT_PILOT_PROFILE): Promise<void> { await this.open("join", name, code, profile); }

  private async open(action: "create" | "join", name: string, code = "", profile: PilotProfile = DEFAULT_PILOT_PROFILE): Promise<void> {
    if (this.active) throw new Error("Leave the current room before joining another.");
    if (!validPilotProfile(profile)) throw new Error("The selected ship or sound profile is invalid.");
    if (this.opening) throw new Error("A room connection is already in progress.");
    if (!globalThis.RTCPeerConnection || !globalThis.EventSource) throw new Error("This Obsidian WebView does not provide the browser features multiplayer needs.");
    const url = this.signalingUrl().trim() || DEFAULT_RELAY;
    const cleanName = name.trim().slice(0, 24);
    if (!cleanName) throw new Error("Enter a display name in plugin settings.");
    if (action === "join" && code.trim().length === 0) throw new Error("Enter the room code.");
    this.topology = makeAnonymousTopology(this.graph().data, this.ids, ++this.revision);
    this.closed = false;
    this.opening = true;
    this.directStartedAt = Date.now();
    const room = this.publicRoom = new RelayRoom(url, {
      roster: (members, selfId) => this.onRelayRoster(members, selfId),
      signal: (from, data) => void this.onSignal({ type: "signal", from, data }),
      status: (text, error) => this.callbacks.status(text, error),
    }, undefined, this.post);
    this.relay = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun.cloudflare.com:3478" }];
    this.relayStatus = "direct-only";
    try {
      if (action === "create") await room.create(cleanName, profile);
      else await room.join(code, cleanName, profile);
      this.roomCode = room.code;
      this.startLoops(); this.updatePeerStatus();
    } catch (error) {
      this.leave(error instanceof Error ? error.message : "Room connection failed.");
      throw error;
    } finally { this.opening = false; }
  }

  private onRelayRoster(members: RoomMember[], selfId: string): void {
    if (this.closed || !members.some(member => member.id === selfId)) return;
    const oldIds = new Set(this.roster.map(member => member.id));
    const oldHost = this.hostId;
    const next = members.map(member => ({ ...member }));
    const nextHost = [...next].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))[0]?.id ?? "";
    this.selfId = selfId; this.roomCode = this.publicRoom?.code ?? this.roomCode;
    this.roster = next;
    if (!this.epoch) { this.epoch = 1; this.hostId = nextHost; this.authorityReady = true; }
    else if (oldHost && nextHost !== oldHost) { this.hostId = nextHost; this.epoch++; this.authorityReady = false; this.authorityVotes.clear(); this.pendingAuthorityCommit = null; this.gameResumeAt = Date.now() + 700; }
    else this.hostId = nextHost;
    if (!oldHost || nextHost !== oldHost) {
      this.lastHostPacketAt = Date.now(); this.resetSurfaceTransport();
    }

    for (const old of oldIds) if (!next.some(member => member.id === old)) {
      this.removePeer(old); this.surfaceAuthority?.ownerLeft(old); this.world?.remove(old); this.surfaceAuthority?.removePlayer(old); this.issuedSurfaceTimes.delete(old);
      this.lastSurfaceDockSequence.delete(old); this.lastSurfaceColorSequence.delete(old); this.surfaceFireResults.delete(old); this.callbacks.removed(old);
    }
    if (this.isHost) {
      for (const member of next) if (!this.world?.players.has(member.id)) {
        this.world?.add(member); this.world?.setProfile(member.id, member.profile);
        const pose = this.world?.poses(Date.now()).find(item => item.id === member.id)?.pose;
        if (pose) this.surfaceAuthority?.addPlayer(member.id, this.surfaceShipFromPose(pose));
      }
      if (!this.world) this.restoreAuthority();
    } else if (oldHost && this.hostId !== oldHost) { this.world = null; this.surfaceAuthority = null; this.issuedSurfaceTimes.clear(); }
    this.callbacks.members(this.roster, this.selfId, this.hostId, this.epoch);
    for (const member of next) if (member.id !== selfId && !this.peers.has(member.id)) void this.connectPeer(member.id, selfId.localeCompare(member.id) < 0);
    this.maybeStartAuthorityTransfer();
    if (oldHost && this.hostId !== oldHost) this.callbacks.authority(this.hostId, this.epoch, this.lastCheckpoint?.state ?? null);
    this.updatePeerStatus();
  }

  private restoreAuthority(): void {
    if (!this.isHost) return;
    this.resetSurfaceTransport();
    const checkpoint = this.lastCheckpoint;
    const restoreNow = Date.now(), checkpointAge = checkpoint ? restoreNow - checkpoint.sentAt : 0;
    const checkpointState = checkpoint?.state as (RoomCheckpoint & { surface?: SurfaceAuthorityCheckpoint | null }) | undefined;
    const oldEpoch = checkpoint?.state && typeof checkpoint.state === "object" && Number.isSafeInteger((checkpoint.state as { epoch?: unknown }).epoch)
      ? Number((checkpoint.state as { epoch: number }).epoch) : this.epoch;
    const restored = new CombatWorld(oldEpoch);
    if (checkpoint && checkpointAge >= 0 && checkpointAge <= 15_000) restored.restore(checkpoint.state, restoreNow, checkpointAge);
    for (const id of [...restored.players.keys()]) if (!this.roster.some(member => member.id === id)) restored.remove(id);
    restored.epoch = this.epoch;
    this.world = restored;
    for (const member of this.roster) { this.world.add(member); this.world.setProfile(member.id, member.profile); }
    this.createSurfaceAuthority();
    if (checkpoint && checkpointAge >= 0 && checkpointAge <= 15_000 && checkpointState?.surface) {
      this.surfaceAuthority?.restoreCheckpoint(checkpointState.surface, restoreNow, checkpointAge);
    }
    if (this.surfaceAuthority) {
      const rosterIds = new Set(this.roster.map(member => member.id));
      for (const ownerId of new Set(this.surfaceAuthority.world.listArenas().map(arena => arena.ownerId))) if (!rosterIds.has(ownerId)) this.surfaceAuthority.ownerLeft(ownerId);
      for (const player of this.surfaceAuthority.world.listPlayers()) if (!rosterIds.has(player.id)) this.surfaceAuthority.removePlayer(player.id);
      for (const { id, pose } of this.world.poses(restoreNow)) if (!this.surfaceAuthority.world.getPlayer(id)) this.surfaceAuthority.addPlayer(id, this.surfaceShipFromPose(pose));
    }
    this.startGameLoop();
  }

  private async connectPeer(id: string, offer: boolean): Promise<void> {
    if (this.peers.has(id) || !this.active || !this.roster.some(p => p.id === id)) return;
    const pc = new RTCPeerConnection({ iceServers: this.relay, iceCandidatePoolSize: 2 });
    const state: NonNullable<ReturnType<typeof this.peers.get>> = { pc, signalChain: Promise.resolve(), pendingCandidates: [], positionSequence: 0, lastPositionSequence: 0, topologySend: null, topologyReceive: null, positionReceive: new Map() };
    this.peers.set(id, state);
    pc.onicecandidate = e => { if (e.candidate) this.signal(id, { candidate: e.candidate.toJSON() }); };
    pc.onicecandidateerror = event => this.reportIceError(id, event);
    pc.ondatachannel = e => this.bindChannel(id, e.channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") { this.iceFailures.delete(id); this.updatePeerStatus(); }
      else if (pc.connectionState === "failed") { this.updatePeerStatus(); this.requestIceConfiguration(); this.schedulePeerRetry(id); }
      else if (pc.connectionState === "disconnected") this.schedulePeerRetry(id, 5000);
    };
    pc.onsignalingstatechange = () => {
      if (state.restartAfterStable && pc.signalingState === "stable") void this.restartPeerIce(id, state);
    };
    if (offer) {
      this.bindChannel(id, pc.createDataChannel("constellation-control", { ordered: true }));
      this.bindChannel(id, pc.createDataChannel("constellation-live", { ordered: false, maxRetransmits: 0 }));
    }
    if (offer) {
      try { const offerDesc = await pc.createOffer(); await pc.setLocalDescription(offerDesc); this.signal(id, { description: pc.localDescription }); }
      catch { this.callbacks.status(`Could not start a connection to ${this.memberName(id)}. Retrying.`, true); this.schedulePeerRetry(id); }
    }
  }

  private bindChannel(id: string, dc: RTCDataChannel): void {
    const peer = this.peers.get(id); if (!peer) { dc.close(); return; }
    if (dc.label === "constellation-control") peer.control = dc;
    else if (dc.label === "constellation-live") {
      peer.live = dc; dc.binaryType = "arraybuffer";
      dc.bufferedAmountLowThreshold = 0;
      dc.onbufferedamountlow = () => { if (!this.closed && this.peers.get(id) === peer) this.flushLiveState(id); };
    }
    else { dc.close(); return; }
    dc.binaryType = "arraybuffer";
    dc.onopen = () => {
      if (this.closed || this.peers.get(id) !== peer) return;
      if (dc.label === "constellation-control" && this.topology) this.queueTopology(id, this.topology);
      if (dc.label === "constellation-control" && this.isHost && this.world) this.sendReliable(id, { type: "round-state", epoch: this.epoch, state: this.world.roundSnapshot(Date.now()) });
      if (dc.label === "constellation-live") this.sendPositionsTo(id);
      this.maybeStartAuthorityTransfer();
      this.updatePeerStatus();
    };
    dc.onmessage = event => {
      if (!this.closed && this.peers.get(id) === peer) this.onPeerMessage(id, event.data, dc.label === "constellation-control" ? "control" : "live");
    };
    dc.onclose = () => {
      if (this.closed || this.peers.get(id) !== peer) return;
      if (dc.label === "constellation-control") peer.control = undefined; else peer.live = undefined;
      this.callbacks.status(`Connection to ${this.memberName(id)} closed; reconnecting.`, true);
      this.schedulePeerRetry(id);
    };
  }

  private async onSignal(msg: SignalMessage): Promise<void> {
    if (msg.type === "ice-servers") {
      const servers = validIceServers(msg.iceServers);
      const expiresAt = Number.isSafeInteger(msg.iceExpiresAt) ? Number(msg.iceExpiresAt) : 0;
      const status = this.readRelayStatus(msg.relayStatus, servers);
      const changed = expiresAt !== this.iceExpiresAt || status !== this.relayStatus || JSON.stringify(servers) !== JSON.stringify(this.relay);
      this.relay = servers; this.iceExpiresAt = expiresAt; this.relayStatus = status;
      if (changed) await this.applyIceConfiguration();
      if (status === "quota") this.callbacks.status("The free TURN relay allowance is exhausted. Direct peer connections may still work.", true);
      else if (status === "unavailable") this.callbacks.status("The relay service is temporarily unavailable. Trying direct peer connections.", true);
      else if (status === "pending") this.callbacks.status("Preparing relay access; trying direct peer connections and checking again shortly.");
      this.scheduleIceRefresh();
      return;
    }
    if (msg.type === "member-joined") {
      const p = msg.member as AnonymousPlayer;
      if (!p || typeof p.id !== "string" || p.id === this.selfId || !validMembers([p])) return;
      this.roster = [...this.roster.filter(x => x.id !== p.id), p]; this.callbacks.members(this.roster, this.selfId, this.hostId, this.epoch);
      if (this.isHost) { this.world?.add(p); this.world?.setProfile(p.id, p.profile); }
      await this.connectPeer(p.id, false); this.updatePeerStatus(); return;
    }
    if (msg.type === "member-profile") {
      if (typeof msg.id !== "string" || !validPilotProfile(msg.profile)) return;
      const existing = this.roster.find(member => member.id === msg.id);
      if (!existing || msg.profile.revision <= existing.profile.revision) return;
      this.roster = this.roster.map(member => member.id === msg.id ? { ...member, profile: msg.profile as PilotProfile } : member);
      this.world?.setProfile(msg.id, msg.profile as PilotProfile);
      this.callbacks.members(this.roster, this.selfId, this.hostId, this.epoch); return;
    }
    if (msg.type === "member-left") {
      const id = String(msg.id || ""); this.removePeer(id); this.roster = this.roster.filter(x => x.id !== id); this.callbacks.removed(id);
      this.world?.remove(id);
      this.hostId = String(msg.hostId || this.hostId); this.epoch = Number(msg.epoch) || this.epoch; this.callbacks.members(this.roster, this.selfId, this.hostId, this.epoch);
      this.updatePeerStatus(); return;
    }
    if (msg.type === "authority") {
      this.hostId = String(msg.hostId || ""); this.epoch = Number(msg.epoch) || this.epoch;
      this.gameResumeAt = Date.now() + 700;
      this.lastShipSequence.clear(); this.lastShotSequence = 0;
      this.lastRoundId = 0; this.lastRoundWireKey = ""; this.lastRoundSendAt = 0; this.seenEliminations.clear();
      this.world = this.isHost ? new CombatWorld(this.epoch) : null;
      if (this.world) {
        const checkpoint = msg.checkpoint as { state?: unknown; ageMs?: number } | null;
        if (checkpoint?.state && Number.isFinite(checkpoint.ageMs) && (checkpoint.ageMs as number) >= 0 && (checkpoint.ageMs as number) <= 15_000) this.world.restore(checkpoint.state, Date.now(), checkpoint.ageMs as number);
        this.world.epoch = this.epoch;
        for (const member of this.roster) { this.world.add(member); this.world.setProfile(member.id, member.profile); }
        this.startGameLoop();
      }
      this.callbacks.authority(this.hostId, this.epoch, msg.checkpoint);
      window.clearTimeout(this.authorityTimer);
      this.authorityTimer = window.setTimeout(() => this.updatePeerStatus(), 750); return;
    }
    if (msg.type === "signal") {
      const from = String(msg.from || ""), data = msg.data as { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
      if (!from || !data || typeof data !== "object") return;
      await this.connectPeer(from, false);
      const peer = this.peers.get(from); if (!peer) return;
      // ICE candidates can arrive before the offer, or while its asynchronous
      // setRemoteDescription is still running. Preserve them until it completes.
      peer.signalChain = peer.signalChain.then(async () => {
        if (this.peers.get(from) !== peer) return;
        if (data.description) {
          await peer.pc.setRemoteDescription(data.description);
          for (const candidate of peer.pendingCandidates.splice(0)) {
            try { await peer.pc.addIceCandidate(candidate); } catch { /* obsolete ICE generation */ }
          }
          if (data.description.type === "offer") {
            const answer = await peer.pc.createAnswer(); await peer.pc.setLocalDescription(answer);
            this.signal(from, { description: peer.pc.localDescription });
          }
        } else if (data.candidate) {
          if (!peer.pc.remoteDescription) { if (peer.pendingCandidates.length < 256) peer.pendingCandidates.push(data.candidate); }
          else { try { await peer.pc.addIceCandidate(data.candidate); } catch { /* obsolete ICE generation */ } }
        }
      }).catch(() => {
        if (this.peers.get(from) !== peer || !this.active) return;
        this.callbacks.status(`Peer setup with ${this.memberName(from)} failed; retrying.`, true);
        this.schedulePeerRetry(from);
      });
      await peer.signalChain;
    }
  }

  private onPeerMessage(id: string, data: unknown, lane: "control" | "live"): void {
    const peer = this.peers.get(id); if (!peer) return;
    if (data instanceof ArrayBuffer && compressedNetworkJson(data)) {
      const json = decodeNetworkJson(data);
      if (json !== null) this.onPeerMessage(id, json, lane);
      return;
    }
    if (lane === "control") {
      if (typeof data !== "string" || data.length > 128_000) return;
      let msg: unknown; try { msg = JSON.parse(data); } catch { return; }
      if (!msg || typeof msg !== "object") return;
      const m = msg as Record<string, unknown>;
      if (m.type === "surface-geometry-chunk" && id === this.hostId && m.epoch === this.epoch && data.length <= 16_384) {
        const token = this.surfaceWireFor(id).receiveChunk(m);
        if (token !== null) this.sendReliable(id, { type: "surface-geometry-ready", epoch: this.epoch, tokens: [token] });
        return;
      }
      if ((m.type === "surface-geometry-ready" || m.type === "surface-geometry-needed") && this.isHost && m.epoch === this.epoch) {
        this.surfaceWire.get(id)?.acknowledge(m.tokens, m.type === "surface-geometry-needed"); return;
      }
      if (id === this.hostId && m.epoch === this.epoch) this.lastHostPacketAt = Date.now();
      if (m.type === "authority-proposal" && id === m.hostId && this.validAuthorityMembers(m.members)) {
        if (m.epoch === this.epoch && m.hostId === this.hostId && m.failure !== true) {
          this.sendAuthorityVote(); return;
        }
        if (m.failure === true && m.baseEpoch === this.epoch && m.epoch === this.epoch + 1 && m.hostId === this.nextAuthorityCandidate()
          && !this.controlReady(this.hostId) && Date.now() - this.lastHostPacketAt >= 6000) {
          const previousHost = this.hostId;
          this.hostId = String(m.hostId); this.epoch = Number(m.epoch); this.authorityReady = false; this.authorityVotes.clear(); this.pendingAuthorityCommit = null;
          this.gameResumeAt = Date.now() + 700; this.lastHostPacketAt = Date.now();
          this.resetSurfaceTransport();
          if (this.isHost) this.restoreAuthority(); else this.world = null;
          this.callbacks.members(this.roster, this.selfId, this.hostId, this.epoch);
          this.callbacks.authority(this.hostId, this.epoch, this.lastCheckpoint?.state ?? null);
          this.sendAuthorityVote();
          this.callbacks.status(`The previous host (${this.memberName(previousHost)}) is unreachable. Confirming the next host with the room majority.`);
          return;
        }
      }
      if (m.type === "authority-vote" && !this.authorityReady && m.epoch === this.epoch && m.hostId === this.hostId
        && m.voterId === id && this.roster.some(member => member.id === id) && this.validAuthorityMembers(m.members)
        && this.sameAuthorityMembers(m.members)) {
        this.authorityVotes.add(id);
        this.tryCommitAuthority();
        this.tryAcceptAuthorityCommit();
        return;
      }
      if (m.type === "authority-commit" && id === this.hostId && m.epoch === this.epoch && this.validAuthorityMembers(m.members) && this.sameAuthorityMembers(m.members)) {
        this.pendingAuthorityCommit = { epoch: this.epoch, hostId: this.hostId, members: [...m.members as string[]] };
        this.tryAcceptAuthorityCommit(); return;
      }
      if (m.type === "checkpoint" && id === this.hostId && m.epoch === this.epoch && Number.isSafeInteger(m.sentAt)
        && m.state && typeof m.state === "object") {
        this.acceptCheckpoint(m.state, Number(m.sentAt));
        return;
      }
      if (m.type === "checkpoint-chunk" && id === this.hostId && m.epoch === this.epoch) { this.receiveCheckpointChunk(m); return; }
      if (m.type === "round-state" && id === this.hostId && m.epoch === this.epoch && validRoundSnapshot(m.state, this.epoch)) {
        const state = m.state;
        if (state.roundId < this.lastRoundId) return;
        this.lastRoundId = state.roundId;
        this.callbacks.round?.(state); return;
      }
      if (m.type === "elimination" && id === this.hostId && m.epoch === this.epoch && validEliminationEvent(m.event, this.lastRoundId)) {
        const event = m.event;
        if (this.seenEliminations.has(event.id)) return;
        this.seenEliminations.add(event.id); if (this.seenEliminations.size > 256) this.seenEliminations.delete(this.seenEliminations.values().next().value!);
        this.callbacks.elimination?.(event); return;
      }
      if (m.type === "shot-result" && id === this.hostId && m.epoch === this.epoch && Number.isSafeInteger(m.sequence)
        && (m.sequence as number) > 0 && typeof m.accepted === "boolean") {
        this.callbacks.shotResult?.(m.sequence as number, m.accepted); return;
      }
      if (m.type === "surface-dock" && this.isHost && m.epoch === this.epoch && Number.isSafeInteger(m.sequence) && (m.sequence as number) > 0 && this.validNavigationTarget(m.target)) {
        this.handleSurfaceDock(id, m.sequence as number, m.target); return;
      }
      if (m.type === "surface-dock-result" && id === this.hostId && m.epoch === this.epoch && Number.isSafeInteger(m.sequence) && typeof m.accepted === "boolean") {
        this.callbacks.surfaceDockResult?.(m.sequence as number, m.accepted, m.reason==="preparation"?"preparation":undefined); return;
      }
      if (this.handleSurfaceFireMessage(id, m)) return;
      if (m.type === "surface-color" && this.isHost && m.epoch === this.epoch && Number.isSafeInteger(m.sequence) && (m.sequence as number) > 0) {
        const sequence = m.sequence as number;
        if (sequence <= (this.lastSurfaceColorSequence.get(id) ?? 0)) return;
        this.lastSurfaceColorSequence.set(id, sequence);
        const requested = m.color, approved = this.surfaceAuthority?.setColor(id, requested) ?? null;
        this.sendReliable(id, { type: "surface-color-result", epoch: this.epoch, sequence, accepted: !!approved, color: approved ?? this.surfaceAuthority?.getColor(id) ?? "#8CECFF" }); return;
      }
      if (m.type === "surface-color-result" && id === this.hostId && m.epoch === this.epoch && Number.isSafeInteger(m.sequence)
        && typeof m.accepted === "boolean" && isApprovedSurfaceLaserColor(m.color)) {
        this.callbacks.surfaceColor?.(m.sequence as number, m.accepted, m.color); return;
      }
      if (m.type === "navigate" && this.isHost && m.epoch === this.epoch && this.validNavigationTarget(m.target)) { this.startRequestedTravel(id, m.target); return; }
      if (m.type === "fire" && this.isHost && m.epoch === this.epoch && Number.isSafeInteger(m.sequence) && Number.isInteger(m.gun) && (m.weapon === 0 || m.weapon === 1)
        && Array.isArray(m.aimPoint) && m.aimPoint.length === 3 && m.aimPoint.every(v => typeof v === "number" && Number.isFinite(v))) {
        const sequence = m.sequence as number;
        const accepted = this.world?.fireShot(id, sequence, m.gun as number, Date.now(), m.aimPoint as [number, number, number], m.weapon) ?? false;
        this.sendReliable(id, { type: "shot-result", epoch: this.epoch, sequence, accepted }); return;
      }
      // Weapon changes use the reliable control channel. Keeping this dispatch
      // beside firing ensures selection is applied in order before later shots.
      if (m.type === "weapon" && this.isHost && m.epoch === this.epoch
        && Number.isSafeInteger(m.sequence) && (m.weapon === 0 || m.weapon === 1)) {
        this.world?.setWeapon(id, m.sequence as number, m.weapon, Date.now()); return;
      }
      if (m.type !== "topology-chunk" || !Number.isSafeInteger(m.revision) || (m.revision as number) < 1
        || !Number.isInteger(m.index) || !Number.isInteger(m.total) || (m.index as number) < 0 || (m.total as number) < 1
        || (m.total as number) > Math.ceil(MAX_TOPOLOGY_CHARS / TOPOLOGY_CHUNK_CHARS) || (m.index as number) >= (m.total as number)
        || typeof m.data !== "string" || m.data.length > TOPOLOGY_CHUNK_CHARS) return;
      if (peer.topology && (m.revision as number) <= peer.topology.revision) return;
      let transfer = peer.topologyReceive;
      if (!transfer || transfer.revision !== m.revision || transfer.total !== m.total) {
        if (transfer && (m.revision as number) < transfer.revision) return;
        transfer = { revision: m.revision as number, total: m.total as number, parts: new Array(m.total as number), bytes: 0, received: 0 };
        peer.topologyReceive = transfer;
      }
      const index = m.index as number;
      if (transfer.parts[index] !== undefined) return;
      transfer.parts[index] = m.data;
      transfer.bytes += m.data.length;
      transfer.received++;
      if (transfer.bytes > MAX_TOPOLOGY_CHARS) { peer.topologyReceive = null; return; }
      if (transfer.received < transfer.total) return;
      try {
        const value = JSON.parse(transfer.parts.join(""));
        if (!validTopology(value) || value.revision !== transfer.revision || (peer.topology && value.revision <= peer.topology.revision)) { peer.topologyReceive = null; return; }
        peer.topology = value; peer.positions = undefined; peer.positionsRevision = undefined; peer.lastPositionSequence = 0; peer.positionReceive.clear(); peer.topologyReceive = null;
        this.refreshSurfaceMap(id);
        this.callbacks.topology(id, value);
      } catch { peer.topologyReceive = null; }
      return;
    }
    if (data instanceof ArrayBuffer) {
      const topology = peer.topology;
      if (!topology) return;
      const frame = this.acceptPositionChunk(peer, data, topology);
      if (frame && frame.sequence > peer.lastPositionSequence) {
        peer.lastPositionSequence = frame.sequence;
        peer.positions = frame.positions.slice(); peer.positionsRevision = peer.topology?.revision;
        if (this.isHost) this.world?.setObstacleSet(id, frame.positions, peer.topology ? surfaceWorldRadii(peer.topology, new Map(this.surfaceAuthority?.world.listArenas().filter(arena => arena.ownerId === id).map(arena => [arena.hubId, arena.arena.radius ?? 27]))) : undefined);
        this.refreshSurfaceMap(id);
        this.callbacks.positions(id, frame.positions);
      }
      return;
    }
    if (typeof data !== "string" || data.length > 64_000) return;
    let msg: unknown; try { msg = JSON.parse(data); } catch { return; }
    if (!msg || typeof msg !== "object") return;
    const m = msg as Record<string, unknown>;
    if (this.handleSurfaceFireMessage(id, m)) return;
    if (m.type === "surface-input" && this.isHost && this.authorityReady && this.world?.roundPhase === "combat" && m.epoch === this.epoch && this.surfaceAuthority) {
      this.surfaceAuthority.setInputFrames(id, m.frames, Date.now()); return;
    }
    if (m.type === "surface-ping" && this.isHost && m.epoch === this.epoch && Number.isSafeInteger(m.sequence) && (m.sequence as number) > 0
      && Number.isSafeInteger(m.clientSentAt)) {
      const hostReceivedAt = Date.now(), hostSentAt = Date.now();
      this.sendTo(id, { type: "surface-pong", epoch: this.epoch, sequence: m.sequence as number, clientSentAt: m.clientSentAt as number, hostReceivedAt, hostSentAt }); return;
    }
    if (m.type === "surface-pong" && id === this.hostId && m.epoch === this.epoch && Number.isSafeInteger(m.sequence)
      && Number.isSafeInteger(m.clientSentAt) && Number.isSafeInteger(m.hostReceivedAt) && Number.isSafeInteger(m.hostSentAt)) {
      const sequence = m.sequence as number, sentAt = this.pendingSurfacePings.get(sequence);
      if (sentAt !== undefined && sentAt === m.clientSentAt) {
        this.pendingSurfacePings.delete(sequence);
        this.surfaceClock.observePing(sentAt, m.hostReceivedAt as number, m.hostSentAt as number, Date.now());
      }
      return;
    }
    if (m.type === "surface-state" && id === this.hostId && m.epoch === this.epoch && m.state && typeof m.state === "object"
      && (m.state as SurfaceNetworkSnapshot).sequence > this.lastSurfaceSnapshotSequence) {
      const decoded = this.surfaceWireFor(id).decode(m.state, this.epoch), snapshot = decoded.snapshot;
      if (decoded.missing.length) this.sendReliable(id, { type: "surface-geometry-needed", epoch: this.epoch, tokens: decoded.missing });
      if (!snapshot) return;
      if (decoded.acknowledge.length) this.sendReliable(id, { type: "surface-geometry-ready", epoch: this.epoch, tokens: decoded.acknowledge });
      this.lastSurfaceSnapshotSequence = snapshot.sequence;
      this.acknowledgeSurfaceInputs(snapshot);
      const receivedAt = Date.now(); this.surfaceClock.observeSnapshot(snapshot.hostTime, receivedAt);
      this.callbacks.surfaceState?.(snapshot, this.surfaceClock.estimateHostTime(receivedAt), this.surfaceClock.roundTripMs); return;
    }
    if (m.type === "input" && this.isHost && m.epoch === this.epoch && this.validInput(m.input)) {
      this.world?.setInput(id, m.input, Date.now()); this.callbacks.message(id, { type: "input", epoch: this.epoch, input: m.input }); return;
    }
    if (m.type === "ship" && id === this.hostId && m.epoch === this.epoch && Number.isSafeInteger(m.sequence) && typeof m.playerId === "string" && this.validPose(m.pose)) {
      const sequence = m.sequence as number;
      if (sequence <= (this.lastShipSequence.get(m.playerId) ?? 0)) return;
      this.lastShipSequence.set(m.playerId, sequence); this.callbacks.playerState(m.playerId, m.pose); return;
    }
    if (m.type === "ships" && id === this.hostId && m.epoch === this.epoch && Number.isSafeInteger(m.sequence)
      && Array.isArray(m.poses) && m.poses.length <= 4) {
      const poses = m.poses as Array<{ id: string; pose: Pose }>;
      if (poses.some(item => !item || typeof item.id !== "string" || !this.validPose(item.pose)) || new Set(poses.map(item => item.id)).size !== poses.length) return;
      const sequence = m.sequence as number;
      for (const item of poses) if (sequence > (this.lastShipSequence.get(item.id) ?? 0)) {
        this.lastShipSequence.set(item.id, sequence); this.callbacks.playerState(item.id, item.pose);
      }
      return;
    }
    if (m.type === "shots" && id === this.hostId && m.epoch === this.epoch && Number.isSafeInteger(m.sequence) && (m.sequence as number) > this.lastShotSequence
      && Array.isArray(m.shots) && m.shots.length <= 128 && Array.isArray(m.impacts) && m.impacts.length <= 128) {
      if (!m.shots.every(s => this.validShot(s)) || !m.impacts.every(s => this.validImpact(s))) return;
      this.lastShotSequence = m.sequence as number; this.callbacks.shotState(m.shots, m.impacts); return;
    }
  }

  private acceptPositionChunk(peer: NonNullable<ReturnType<typeof this.peers.get>>, buffer: ArrayBuffer, topology: AnonymousTopology): { sequence: number; positions: Float32Array } | null {
    if (buffer.byteLength <= POSITION_CHUNK_HEADER_BYTES || buffer.byteLength > POSITION_CHUNK_HEADER_BYTES + POSITION_CHUNK_BYTES) return null;
    const view = new DataView(buffer), revision = view.getUint32(4, true), sequence = view.getUint32(8, true), index = view.getUint32(12, true);
    const total = view.getUint32(16, true), totalBytes = view.getUint32(20, true);
    const expectedBytes = POSITION_HEADER_BYTES + topology.nodes.length * 12;
    const expectedTotal = Math.ceil(expectedBytes / POSITION_CHUNK_BYTES);
    if (view.getUint32(0, true) !== POSITION_CHUNK_MAGIC || revision !== topology.revision || !sequence || sequence <= peer.lastPositionSequence
      || totalBytes !== expectedBytes || total !== expectedTotal || index >= total) return null;
    const offset = index * POSITION_CHUNK_BYTES, expectedChunkBytes = Math.min(POSITION_CHUNK_BYTES, totalBytes - offset);
    if (buffer.byteLength !== POSITION_CHUNK_HEADER_BYTES + expectedChunkBytes) return null;
    const now = Date.now();
    for (const [key, item] of peer.positionReceive) if (now - item.createdAt > 300) peer.positionReceive.delete(key);
    let assembly = peer.positionReceive.get(sequence);
    if (!assembly) {
      while (peer.positionReceive.size >= 3) peer.positionReceive.delete(peer.positionReceive.keys().next().value!);
      assembly = { revision, sequence, totalBytes, chunks: new Array(total), received: 0, createdAt: now };
      peer.positionReceive.set(sequence, assembly);
    }
    if (assembly.revision !== revision || assembly.totalBytes !== totalBytes || assembly.chunks.length !== total || assembly.chunks[index]) return null;
    assembly.chunks[index] = new Uint8Array(buffer.slice(POSITION_CHUNK_HEADER_BYTES)); assembly.received++;
    if (assembly.received !== total) return null;
    const frame = new ArrayBuffer(totalBytes), bytes = new Uint8Array(frame);
    assembly.chunks.forEach((chunk, part) => { if (chunk) bytes.set(chunk, part * POSITION_CHUNK_BYTES); });
    peer.positionReceive.delete(sequence);
    const decoded = decodePositions(frame, topology);
    return decoded?.sequence === sequence ? decoded : null;
  }

  private validShot(value: unknown): value is ShotSnapshot {
    if (!value || typeof value !== "object") return false;
    const s = value as ShotSnapshot;
    return typeof s.id === "string" && s.id.length <= 64 && typeof s.ownerId === "string" && s.ownerId.length <= 64
      && Number.isInteger(s.gun) && s.gun >= 0 && s.gun <= 3 && (s.weapon === 0 || s.weapon === 1)
      && Array.isArray(s.origin) && s.origin.length === 3 && s.origin.every(v => Number.isFinite(v) && Math.abs(v) <= MAX_COORDINATE)
      && Array.isArray(s.position) && s.position.length === 3 && s.position.every(v => Number.isFinite(v) && Math.abs(v) <= MAX_COORDINATE)
      && Array.isArray(s.direction) && s.direction.length === 3 && s.direction.every(v => Number.isFinite(v) && Math.abs(v) <= 1.01)
      && Number.isFinite(s.speed) && s.speed >= 1 && s.speed <= 20_000 && LASER_SOUND_IDS.includes(s.sound) && Number.isSafeInteger(s.startedAt);
  }
  private validImpact(value: unknown): value is ImpactSnapshot {
    if (!value || typeof value !== "object") return false;
    const i = value as ImpactSnapshot;
    return typeof i.id === "string" && i.id.length <= 64 && (i.kind === "star" || i.kind === "ship")
      && Array.isArray(i.position) && i.position.length === 3 && i.position.every(v => Number.isFinite(v) && Math.abs(v) <= MAX_COORDINATE);
  }

  private validInput(value: unknown): value is FlightInput {
    if (!value || typeof value !== "object") return false;
    const x = value as FlightInput;
    return Number.isSafeInteger(x.sequence) && x.sequence > 0
      && [x.thrust, x.strafe, x.lift, x.roll, x.pitch, x.yaw].every(v => Number.isFinite(v) && Math.abs(v) <= 1)
      && [x.boost, x.brake, x.fire, x.active, x.invertY].every(v => typeof v === "boolean")
      && (x.mouseMode === "capture" || x.mouseMode === "cursor") && Array.isArray(x.mouseSamples) && x.mouseSamples.length <= 8
      && x.mouseSamples.every(sample => Array.isArray(sample) && sample.length === 2 && sample.every(v => Number.isFinite(v) && Math.abs(v) <= 500))
      && Number.isFinite(x.sensitivity) && x.sensitivity >= 0.2 && x.sensitivity <= 4
      && Number.isFinite(x.agility) && x.agility >= 0.1 && x.agility <= 4
      && (x.ticks === undefined || (Array.isArray(x.ticks) && x.ticks.length <= 12 && x.ticks.every(t => Number.isSafeInteger(t.tick) && t.tick > 0
        && [t.thrust, t.strafe, t.lift, t.roll, t.pitch, t.yaw].every(v => Number.isFinite(v) && Math.abs(v) <= 1)
        && [t.boost, t.brake, t.active, t.invertY].every(v => typeof v === "boolean") && (t.mouseMode === "capture" || t.mouseMode === "cursor")
        && Array.isArray(t.mouseDelta) && t.mouseDelta.length === 2 && t.mouseDelta.every(v => Number.isFinite(v) && Math.abs(v) <= 500)
        && Number.isFinite(t.sensitivity) && t.sensitivity >= 0.2 && t.sensitivity <= 4 && Number.isFinite(t.agility) && t.agility >= 0.1 && t.agility <= 4)));
  }
  private validPose(value: unknown): value is Pose {
    if (!value || typeof value !== "object") return false;
    const p = value as Pose;
    return Array.isArray(p.position) && p.position.length === 3 && p.position.every(v => Number.isFinite(v) && Math.abs(v) <= MAX_COORDINATE)
      && Array.isArray(p.rotation) && p.rotation.length === 4 && p.rotation.every(Number.isFinite)
      && Array.isArray(p.velocity) && p.velocity.length === 3 && p.velocity.every(v => Number.isFinite(v) && Math.abs(v) <= 20_000)
      && Array.isArray(p.spin) && p.spin.length === 3 && p.spin.every(v => Number.isFinite(v) && Math.abs(v) <= 20)
      && Array.isArray(p.mouseSmoothing) && p.mouseSmoothing.length === 2 && p.mouseSmoothing.every(v => Number.isFinite(v) && Math.abs(v) <= 500)
      && Number.isFinite(p.health) && p.health >= 0 && p.health <= 100 && Number.isFinite(p.shields) && p.shields >= 0 && p.shields <= 40
      && Number.isFinite(p.energy) && p.energy >= 0 && p.energy <= 1 && typeof p.boostLocked === "boolean"
      && Number.isFinite(p.boostHold) && p.boostHold >= 0 && p.boostHold <= 3 && Number.isFinite(p.regenDelay) && p.regenDelay >= 0 && p.regenDelay <= 1.5
      && Number.isFinite(p.damagePause) && p.damagePause >= 0 && p.damagePause <= 2
      && (p.weapon === 0 || p.weapon === 1) && Number.isSafeInteger(p.weaponSequence) && p.weaponSequence >= 0 && Number.isSafeInteger(p.inputSequence) && p.inputSequence >= 0
      && Number.isSafeInteger(p.inputTick) && p.inputTick >= 0
      && Number.isFinite(p.heat) && p.heat >= 0 && p.heat <= 1 && typeof p.overheated === "boolean"
      && Number.isInteger(p.ammunition) && p.ammunition >= 0 && p.ammunition <= 36 && Number.isFinite(p.weaponCooldown) && p.weaponCooldown >= 0 && p.weaponCooldown <= 500
      && (p.weaponCooldownDuration === 160 || p.weaponCooldownDuration === 500)
      && Number.isInteger(p.deaths) && p.deaths >= 0
      && typeof p.active === "boolean" && typeof p.traveling === "boolean" && Number.isFinite(p.respawnAt) && Number.isFinite(p.protectedUntil)
      && Number.isFinite(p.thrust) && p.thrust >= 0 && p.thrust <= 3 && typeof p.boosting === "boolean"
      && Number.isFinite(p.bank) && Math.abs(p.bank) <= 0.56 && Number.isFinite(p.tilt) && Math.abs(p.tilt) <= 0.41;
  }

  private startLoops(): void {
    window.clearInterval(this.sendTimer); window.clearInterval(this.checkpointTimer); window.clearInterval(this.topologyTimer); window.clearInterval(this.authorityMonitorTimer); window.clearTimeout(this.iceRefreshTimer);
    this.sendTimer = window.setInterval(() => { this.sendPositions(); this.pingSurfaceHost(); }, 100);
    this.topologyTimer = window.setInterval(() => this.pumpTopologies(), 8);
    this.authorityMonitorTimer = window.setInterval(() => this.monitorAuthority(), 1000);
    this.checkpointTimer = window.setInterval(() => {
      if (this.isHost && this.world) {
        const sentAt = Date.now(), state = { ...this.world.snapshot(sentAt), surface: this.surfaceAuthority?.checkpoint(sentAt) ?? null };
        this.lastCheckpoint = { state, sentAt };
        this.sendReliableAll({ type: "checkpoint", epoch: this.epoch, sentAt, state });
      }
    }, 200);
    window.clearTimeout(this.iceFallbackTimer);
    this.iceFallbackTimer = window.setTimeout(() => {
      if (this.active && [...this.peers.values()].some(peer => peer.pc.connectionState !== "connected")) this.requestIceConfiguration();
    }, 8000);
    this.createWorldIfHost();
  }

  private createWorldIfHost(): void {
    if (!this.isHost) { this.world = null; this.surfaceAuthority = null; return; }
    if (this.world?.epoch === this.epoch) { if (!this.surfaceAuthority) this.createSurfaceAuthority(); return; }
    this.world = new CombatWorld(this.epoch);
    this.lastRoundWireKey = ""; this.lastRoundId = 0; this.lastRoundSendAt = 0; this.seenEliminations.clear();
    for (const member of this.roster) { this.world.add(member); this.world.setProfile(member.id, member.profile); }
    this.createSurfaceAuthority();
    this.startGameLoop();
  }

  private createSurfaceAuthority(): void {
    if (!this.isHost || !this.world) { this.surfaceAuthority = null; return; }
    const authority = this.surfaceAuthority = new SurfaceAuthority({terrain:true}), now = Date.now();
    this.surfaceRoundId = this.world.currentRoundId;
    this.surfaceSimulatedAt = now;
    for (const { id, pose } of this.world.poses(now)) authority.addPlayer(id, this.surfaceShipFromPose(pose));
    authority.observeConnectionTiming(this.selfId, 0, now);
    this.refreshSurfaceMap(this.selfId);
    for (const [id, peer] of this.peers) if (peer.topology && peer.positions && peer.positionsRevision === peer.topology.revision) this.refreshSurfaceMap(id);
  }

  private surfaceShipFromPose(pose: Pose): { position: [number, number, number]; rotation: [number, number, number, number]; velocity: [number, number, number] } {
    return { position: [...pose.position], rotation: [...pose.rotation], velocity: [...pose.velocity] };
  }

  private updatePeerStatus(): void {
    if (!this.active) return;
    const expected = this.roster.filter(p => p.id !== this.selfId).length;
    const linked = [...this.peers.values()].filter(p => p.pc.connectionState === "connected" && p.control?.readyState === "open" && p.live?.readyState === "open").length;
    const failed = [...this.peers].filter(([, peer]) => peer.pc.connectionState === "failed");
    const lastFailure = [...this.iceFailures].find(([id]) => this.peers.get(id)?.pc.connectionState !== "connected")?.[1];
    const iceNote = linked < expected && lastFailure ? ` A ${lastFailure.kind} endpoint returned ICE error ${lastFailure.code}; trying other direct and relay paths.` : "";
    const failedNote = failed.length ? " A participant connection failed; retrying." : "";
    const relayNote = this.relayStatus === "pending" ? " Relay access is preparing; direct connections are being tried." :
      this.relayStatus === "unavailable" ? " Relay service unavailable; direct connections are being tried." :
      this.relayStatus === "quota" ? " Free relay allowance exhausted; direct connections may still work." : "";
    if (!expected) this.callbacks.status(`Room ${this.roomCode} is ready; waiting for other pilots.${relayNote}`, this.relayStatus === "quota" || this.relayStatus === "unavailable");
    else this.callbacks.status(`${linked} of ${expected} participant connections ready.${failedNote}${iceNote}${relayNote}`, failed.length > 0 || (linked < expected && (this.relayStatus === "quota" || this.relayStatus === "unavailable")));
  }

  private readRelayStatus(value: unknown, servers: RTCIceServer[]): "ready" | "pending" | "unavailable" | "quota" | "direct-only" {
    if (value === "ready" || value === "pending" || value === "unavailable" || value === "quota" || value === "direct-only") return value;
    return servers.some(server => (Array.isArray(server.urls) ? server.urls : [server.urls]).some(url => typeof url === "string" && /^turns?:/i.test(url))) ? "ready" : "direct-only";
  }

  private roomServiceError(message: SignalMessage): string {
    const code = typeof message.code === "string" ? message.code : "";
    if (code === "room-not-found") return "That room code is invalid or the room has closed.";
    if (code === "full") return "That room already has four pilots.";
    if (code === "update-required") return "Everyone in the room must install plugin version 0.3.3 or newer.";
    if (code === "service-full") return "The hosted room service is at capacity. Try again later.";
    if (code === "rate-limited") return "The room service is receiving too many requests. Wait a minute and try again.";
    if (code === "service-unavailable") return "The hosted room service is temporarily unavailable. Try again shortly.";
    if (code === "relay-quota") return "The free TURN relay allowance is exhausted. Direct connections may still work.";
    return typeof message.message === "string" ? message.message.slice(0, 180) : "The room service rejected the request.";
  }

  private requestIceConfiguration(): void {
    const now = Date.now();
    if (!this.active || !this.request || this.iceRequesting) return;
    const directWait = this.directStartedAt + 8000 - now;
    if (directWait > 0) {
      window.clearTimeout(this.iceFallbackTimer);
      this.iceFallbackTimer = window.setTimeout(() => this.requestIceConfiguration(), directWait);
      return;
    }
    if (now - this.lastIceRequestAt < 20_000) return;
    this.lastIceRequestAt = now;
    this.iceRequesting = true;
    void this.fetchIceConfiguration().catch(() => {
      this.relayStatus = "unavailable";
      this.callbacks.status("TURN relay setup failed. Direct peer connections are still being tried.", true);
      this.scheduleIceRefresh();
    }).finally(() => { this.iceRequesting = false; });
  }

  private async fetchIceConfiguration(): Promise<void> {
    const request = this.request;
    if (!request) return;
    const renewToken = async (): Promise<boolean> => {
      const response = await request(TURN_SESSION_URL);
      if (response.status === 429) {
        this.callbacks.status("TURN setup is rate-limited. Direct peer connections are still being tried; retrying shortly.", true);
        return false;
      }
      const body = response.body && typeof response.body === "object" ? response.body as Record<string, unknown> : {};
      if (response.status < 200 || response.status >= 300 || typeof body.token !== "string" || !/^[0-9a-f]{64}$/i.test(body.token)
        || !Number.isSafeInteger(body.expiresAt) || Number(body.expiresAt) <= Date.now()) return false;
      this.iceRefreshToken = body.token;
      this.iceRefreshTokenExpiresAt = Number(body.expiresAt);
      return true;
    };
    if (!this.iceRefreshToken || this.iceRefreshTokenExpiresAt <= Date.now() + 60_000) {
      if (!await renewToken()) { this.relayStatus = "unavailable"; this.scheduleIceRefresh(); return; }
    }
    let response = await request(TURN_CONFIGURATION_URL, this.iceRefreshToken);
    // A cold Durable Object may forget its in-memory session. Renew once on 401.
    if (response.status === 401 && await renewToken()) response = await request(TURN_CONFIGURATION_URL, this.iceRefreshToken);
    const msg = response.body && typeof response.body === "object" ? response.body as Record<string, unknown> : {};
    if (response.status === 429) { this.relayStatus = "unavailable"; this.callbacks.status("TURN setup is rate-limited. Direct peer connections are still being tried; retrying shortly.", true); this.scheduleIceRefresh(); return; }
    if (response.status < 200 || response.status >= 300) { this.relayStatus = "unavailable"; this.callbacks.status("TURN relay setup is unavailable. Direct peer connections are still being tried.", true); this.scheduleIceRefresh(); return; }
    const servers = validIceServers(msg.iceServers), expiresAt = Number.isSafeInteger(msg.iceExpiresAt) ? Number(msg.iceExpiresAt) : 0;
    const status = this.readRelayStatus(msg.relayStatus, servers), changed = JSON.stringify(servers) !== JSON.stringify(this.relay) || expiresAt !== this.iceExpiresAt;
    this.relay = servers; this.iceExpiresAt = expiresAt; this.relayStatus = status;
    if (changed && status === "ready") await this.applyIceConfiguration();
    if (status === "quota") this.callbacks.status("The free TURN relay allowance is exhausted. Direct peer connections may still work.", true);
    else if (status === "unavailable") this.callbacks.status("TURN relay setup is unavailable. Direct peer connections are still being tried.", true);
    else if (status === "pending") this.callbacks.status("Preparing relay access; direct connections are being tried.");
    this.scheduleIceRefresh(); this.updatePeerStatus();
  }
  private scheduleIceRefresh(): void {
    window.clearTimeout(this.iceRefreshTimer);
    if (!this.active) return;
    const now = Date.now();
    const delay = this.iceExpiresAt > now ? Math.max(30_000, this.iceExpiresAt - now - 15 * 60_000) : 30_000;
    this.iceRefreshTimer = window.setTimeout(() => this.requestIceConfiguration(), delay);
  }

  private async applyIceConfiguration(): Promise<void> {
    for (const [id, peer] of this.peers) {
      try {
        peer.pc.setConfiguration({ ...peer.pc.getConfiguration(), iceServers: this.relay });
        if (peer.pc.connectionState === "failed") { this.schedulePeerRetry(id); continue; }
        // Only the deterministic offerer starts an ICE restart. Do it for
        // pending direct connections too, otherwise a peer that needs TURN
        // remains stuck on its original STUN-only checklist forever.
        if (this.selfId.localeCompare(id) < 0) await this.restartPeerIce(id, peer);
      } catch { this.schedulePeerRetry(id); }
    }
  }

  private async restartPeerIce(id: string, peer: NonNullable<ReturnType<typeof this.peers.get>>): Promise<void> {
    if (!this.active || this.peers.get(id) !== peer || this.selfId.localeCompare(id) >= 0) return;
    if (peer.pc.connectionState === "closed" || peer.pc.connectionState === "failed") { this.schedulePeerRetry(id); return; }
    if (peer.pc.signalingState !== "stable") { peer.restartAfterStable = true; return; }
    if (peer.iceRestarting) return;
    peer.iceRestarting = true;
    peer.restartAfterStable = false;
    try {
      peer.pc.restartIce();
      const offer = await peer.pc.createOffer({ iceRestart: true });
      await peer.pc.setLocalDescription(offer);
      if (peer.pc.localDescription) this.signal(id, { description: peer.pc.localDescription });
    } catch { this.schedulePeerRetry(id); }
    finally { peer.iceRestarting = false; }
  }

  private reportIceError(id: string, event: Event): void {
    const peer = this.peers.get(id);
    if (!peer || peer.pc.connectionState === "connected") return;
    const detail = event as Event & { errorCode?: number; url?: string };
    const code = Number.isInteger(detail.errorCode) ? Number(detail.errorCode) : 0;
    if (!code) return;
    const kind = /^turns?:/i.test(detail.url ?? "") ? "TURN" : /^stuns?:/i.test(detail.url ?? "") ? "STUN" : "ICE";
    this.iceFailures.set(id, { kind, code });
    // A candidate error concerns one server URL, not the entire connection.
    // Only the provider backend can confirm exhaustion of the monthly quota.
    this.updatePeerStatus();
    const now = Date.now();
    if (kind !== "TURN" || now - this.lastIceErrorAt < 10_000) return;
    this.lastIceErrorAt = now;
    this.requestIceConfiguration();
  }

  private schedulePeerRetry(id: string, delayMs = 2000): void {
    if (this.retryTimers.has(id) || !this.roster.some(p => p.id === id)) return;
    const timer = window.setTimeout(() => {
      this.retryTimers.delete(id);
      if (!this.active || !this.roster.some(p => p.id === id)) return;
      const localOrder = this.roster.findIndex(p => p.id === this.selfId), remoteOrder = this.roster.findIndex(p => p.id === id);
      this.removePeer(id);
      if (localOrder > remoteOrder) void this.connectPeer(id, true);
      else this.updatePeerStatus();
    }, delayMs);
    this.retryTimers.set(id, timer);
  }

  private startGameLoop(): void {
    window.clearInterval(this.gameTimer); this.lastGameStep = Date.now(); this.gameAccumulator = 0; this.lastStateSend = 0;
    let lastObstacleUpdate = 0;
    this.gameTimer = window.setInterval(() => {
      if (!this.isHost || !this.world) return;
      const now = Date.now();
      if (!this.authorityReady) { this.lastGameStep = now; this.gameAccumulator = 0; return; }
      if (now < this.gameResumeAt) { this.lastGameStep = now; this.gameAccumulator = 0; return; }
      const elapsed = Math.max(0, Math.min(0.12, (now - this.lastGameStep) / 1000)); this.lastGameStep = now;
      this.gameAccumulator = Math.min(0.12, this.gameAccumulator + elapsed);
      const fixed = 1 / 60;
      while (this.gameAccumulator >= fixed) {
        const simulationAt = Math.round(now - (this.gameAccumulator - fixed) * 1000);
        this.world.step(fixed, simulationAt);
        this.stepSurfaceAuthority(fixed, simulationAt);
        const ownPose = this.world.poses(simulationAt).find(item => item.id === this.selfId)?.pose;
        if (ownPose) this.callbacks.playerState(this.selfId, ownPose);
        this.gameAccumulator -= fixed;
      }
      this.updateRound(now);
      if (now - lastObstacleUpdate >= 100) {
        lastObstacleUpdate = now;
        const nodes = this.graph().nodes, positions = new Float32Array(nodes.length * 3);
        for (let i = 0; i < nodes.length; i++) { positions[i * 3] = nodes[i].x; positions[i * 3 + 1] = nodes[i].y; positions[i * 3 + 2] = nodes[i].z; }
        this.world.setObstacleSet(this.selfId, positions, this.topology ? surfaceWorldRadii(this.topology, new Map(this.surfaceAuthority?.world.listArenas().filter(arena => arena.ownerId === this.selfId).map(arena => [arena.hubId, arena.arena.radius ?? 27]))) : undefined);
        this.refreshSurfaceMap(this.selfId);
      }
      if (now - this.lastStateSend >= 50) {
        // Keep the 50 ms phase across the 8 ms polling clock. Resetting to
        // `now` every time accumulates polling delay and falls to about 18 Hz.
        // Skip missed slots after a stall; publish only the current state.
        this.lastStateSend = this.lastStateSend > 0 ? now - (now - this.lastStateSend) % 50 : now;
        this.publishWorldState(now);
      }
    }, 8);
  }

  private updateRound(now: number): void {
    const world = this.world; if (!world || !this.isHost) return;
    if (world.roundPhase === "supernova") {
      const state = world.roundSnapshot(now), requirements = state.layoutRequirements.slice();
      for (const member of this.roster) {
          if (!world.players.has(member.id)) continue;
        if (!requirements.some(item => item.playerId === member.id)) requirements.push({ playerId: member.id, revision: this.currentTopologyRevision(member.id) + 1 });
      }
      if (requirements.length !== state.layoutRequirements.length) world.requireLayouts(requirements);
    }
      // Release a late-layout spectator as soon as its current anonymous map and positions arrive,
      // even if the room has already started the next round.
      for (const requirement of world.roundSnapshot(now).layoutRequirements) {
        if (this.layoutPublished(requirement.playerId, requirement.revision)) world.markLayoutReady(requirement.playerId);
      }
    if (world.roundPhase === "waiting") {
      const state = world.roundSnapshot(now), pending: string[] = [];
      for (const requirement of state.layoutRequirements) {
        if (!world.isFlying(requirement.playerId)) continue;
          if (!this.layoutPublished(requirement.playerId, requirement.revision)) pending.push(requirement.playerId);
      }
      if (!pending.length) world.startCountdown(now);
      else if (state.phaseRemainingMs <= 100) {
        for (const id of pending) world.demoteForLateLayout(id, now);
        world.startCountdown(now);
      }
    }
    for (const event of world.drainEliminations()) {
      this.callbacks.elimination?.(event);
      this.sendReliableAll({ type: "elimination", epoch: this.epoch, event });
    }
    const state = world.roundSnapshot(now);
    const key = JSON.stringify([state.epoch, state.roundId, state.phase, state.winnerId, state.scores, state.layoutRequirements]);
    const changed = key !== this.lastRoundWireKey;
    if (changed) {
      this.lastRoundWireKey = key; this.lastRoundId = state.roundId;
      this.callbacks.round?.(state);
    }
    if (changed || now - this.lastRoundSendAt >= 200) {
      this.lastRoundSendAt = now;
      this.sendReliableAll({ type: "round-state", epoch: this.epoch, state });
    }
  }

  private authorityMembers(): string[] { return this.roster.map(member => member.id).sort(); }
  private validAuthorityMembers(value: unknown): value is string[] {
    return Array.isArray(value) && value.length === this.roster.length && value.length >= 1 && value.length <= 4
      && value.every((id, index) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id) && (index === 0 || value[index - 1] < id))
      && this.sameAuthorityMembers(value);
  }
  private sameAuthorityMembers(value: string[]): boolean {
    const expected = this.authorityMembers(); return value.length === expected.length && value.every((id, index) => id === expected[index]);
  }
  private nextAuthorityCandidate(): string {
    return [...this.roster].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id)).find(member => member.id !== this.hostId)?.id ?? "";
  }
  private sendAuthorityVote(): void {
    if (!this.hostId || !this.selfId || !this.authorityMembers().includes(this.selfId)) return;
    this.authorityVotes.add(this.selfId);
    this.sendReliableAll({ type: "authority-vote", epoch: this.epoch, hostId: this.hostId, voterId: this.selfId, members: this.authorityMembers() });
    this.tryCommitAuthority();
  }
  private tryCommitAuthority(): void {
    if (!this.active || !this.isHost || this.authorityReady || this.authorityVotes.size < Math.floor(this.roster.length / 2) + 1) return;
    this.authorityReady = true; this.gameResumeAt = Date.now() + 250; this.lastHostPacketAt = Date.now(); this.pendingAuthorityCommit = null;
    this.sendReliableAll({ type: "authority-commit", epoch: this.epoch, hostId: this.selfId, members: this.authorityMembers() });
    this.callbacks.status("Room authority is confirmed; flight has resumed.");
  }
  private tryAcceptAuthorityCommit(): void {
    const commit = this.pendingAuthorityCommit;
    if (this.isHost || !commit || commit.epoch !== this.epoch || commit.hostId !== this.hostId || this.authorityVotes.size < Math.floor(this.roster.length / 2) + 1) return;
    this.pendingAuthorityCommit = null; this.authorityReady = true; this.gameResumeAt = Date.now() + 250; this.lastHostPacketAt = Date.now();
    this.callbacks.status("Room authority is confirmed; flight has resumed.");
  }
  private monitorAuthority(): void {
    if (!this.active) return;
    const now = Date.now(), quorum = Math.floor(this.roster.length / 2) + 1;
    if (this.isHost) {
      const connected = 1 + this.roster.filter(member => member.id !== this.selfId && this.controlReady(member.id)).length;
      if (this.authorityReady && connected < quorum) {
        this.authorityReady = false; this.authorityVotes.clear(); this.pendingAuthorityCommit = null;
        this.callbacks.status("The peer network is split. Flight and combat are paused until a room majority reconnects.", true);
      } else if (!this.authorityReady && connected >= quorum) this.maybeStartAuthorityTransfer();
      return;
    }
    if (now - this.lastHostPacketAt < 6000 || this.controlReady(this.hostId)) return;
    if (this.authorityReady) {
      this.authorityReady = false; this.callbacks.status("The host is unreachable. Flight and combat are paused while the room checks for a majority.", true);
    }
    if (this.nextAuthorityCandidate() !== this.selfId || this.epoch >= Number.MAX_SAFE_INTEGER) return;
    if (!this.lastCheckpoint || now - this.lastCheckpoint.sentAt > 15_000) {
      this.callbacks.status("Host recovery is waiting for a recent room checkpoint.", true); return;
    }
    const baseEpoch = this.epoch;
    this.hostId = this.selfId; this.epoch++; this.authorityReady = false; this.authorityVotes.clear(); this.pendingAuthorityCommit = null;
    this.gameResumeAt = now + 700; this.lastHostPacketAt = now;
    this.restoreAuthority();
    this.callbacks.members(this.roster, this.selfId, this.hostId, this.epoch);
    this.callbacks.authority(this.hostId, this.epoch, this.lastCheckpoint.state);
    const members = this.authorityMembers();
    this.sendReliableAll({ type: "authority-proposal", epoch: this.epoch, hostId: this.selfId, members, failure: true, baseEpoch });
    this.sendAuthorityVote();
    this.callbacks.status("The previous host is unreachable. Confirming the next host with the room majority.");
  }
  private maybeStartAuthorityTransfer(): void {
    if (!this.active || !this.isHost || this.authorityReady || !this.world) return;
    this.authorityVotes.add(this.selfId);
    this.sendReliableAll({ type: "authority-proposal", epoch: this.epoch, hostId: this.selfId, members: this.authorityMembers() });
    this.sendAuthorityVote();
  }

  private currentTopologyRevision(id: string): number {
    return id === this.selfId ? this.topology?.revision ?? 0 : this.peers.get(id)?.topology?.revision ?? 0;
  }

  private controlReady(id: string): boolean {
    const peer = this.peers.get(id);
    return !!peer && peer.control?.readyState === "open" && peer.live?.readyState === "open";
  }

  private layoutPublished(id: string, revision: number): boolean {
    if (id === this.selfId) return (this.topology?.revision ?? 0) >= revision;
    const peer = this.peers.get(id);
    return !!peer?.topology && peer.topology.revision >= revision && peer.positionsRevision === peer.topology.revision;
  }

  private sendReliableAll(message: GameMessage): void {
    let messages = [JSON.stringify(message)];
    if (message.type === "checkpoint") {
      let data: string;
      try { data = stringifySurfaceTransfer(message.state, MAX_CHECKPOINT_BYTES); } catch { this.callbacks.status("Room checkpoint exceeds the protocol 14 size limit.", true); return; }
      if (data.length > 16_000) {
        const total = Math.ceil(data.length / 16_000);
        messages = Array.from({ length: total }, (_, index) => JSON.stringify({ type: "checkpoint-chunk", epoch: message.epoch, sentAt: message.sentAt, index, total, data: data.slice(index * 16_000, (index + 1) * 16_000) }));
      }
    }
    for (const peer of this.peers.values()) {
      const channel = peer.control;
      if (!channel || channel.readyState !== "open" || channel.bufferedAmount > (message.type === "checkpoint" ? 0 : 128_000)) continue;
      try { for (const json of messages) sendNetworkJson(channel, json); } catch { /* a peer may close while a reliable round event is queued */ }
    }
  }

  private acceptCheckpoint(state: unknown, sentAt: number): void {
    const now = Date.now(), age = this.surfaceClock.estimateHostTime(now) - sentAt;
    if (age < 0 || age > 15_000 || sentAt <= this.lastCheckpointWireAt || !state || typeof state !== "object") return;
    const checkpoint = state as RoomCheckpoint;
    if (checkpoint.version !== 14) { this.callbacks.status("Incompatible room checkpoint. Everyone must update to the same OB Citizen build (protocol 14).", true); return; }
    if (!Number.isSafeInteger(checkpoint.epoch) || checkpoint.epoch !== this.epoch) return;
    const probe = new CombatWorld(checkpoint.epoch), surfaceProbe = new SurfaceAuthority({terrain:true});
    if (probe.restore(state, now, age) && surfaceProbe.restoreCheckpoint(checkpoint.surface, now, age)) {
      this.lastCheckpointWireAt = sentAt;
      // Recovery compares against the receiver's clock, while wire ordering uses host time above.
      this.lastCheckpoint = { state, sentAt: now - age };
    }
  }

  private receiveCheckpointChunk(m: Record<string, unknown>): void {
    if (!Number.isSafeInteger(m.sentAt) || !Number.isSafeInteger(m.index) || !Number.isSafeInteger(m.total)
      || (m.total as number) < 1 || (m.total as number) > Math.ceil(MAX_CHECKPOINT_BYTES / 16_000) || (m.index as number) < 0 || (m.index as number) >= (m.total as number)
      || typeof m.data !== "string" || !m.data.length || m.data.length > 16_000) return;
    const sentAt = m.sentAt as number, age = this.surfaceClock.estimateHostTime(Date.now()) - sentAt;
    if (age < 0 || age > 15_000 || sentAt <= this.lastCheckpointWireAt) return;
    let transfer = this.checkpointReceive;
    if (!transfer || transfer.sentAt !== sentAt) {
      if (transfer && transfer.sentAt > sentAt) return;
      transfer = this.checkpointReceive = { sentAt, total: m.total as number, parts: new Array(m.total as number), bytes: 0, received: 0 };
    }
    if (transfer.total !== m.total || transfer.parts[m.index as number] !== undefined) return;
    transfer.parts[m.index as number] = m.data; transfer.bytes += m.data.length; transfer.received++;
    if (transfer.bytes > MAX_CHECKPOINT_BYTES) { this.checkpointReceive = null; return; }
    if (transfer.received !== transfer.total) return;
    this.checkpointReceive = null;
    try { this.acceptCheckpoint(parseSurfaceTransfer(transfer.parts.join(""), MAX_CHECKPOINT_BYTES), sentAt); } catch { /* incomplete or malformed checkpoint */ }
  }

  private publishWorldState(now: number): void {
    if (!this.world) return;
    const poses = this.world.poses(now);
    for (const { id, pose } of poses) {
      // The local host already receives each exact state from the 60 Hz
      // authority loop. Do not feed the same ship through the 20 Hz network
      // snapshot path as well; that second path can reapply an older pose.
      if (id !== this.selfId) this.callbacks.playerState(id, pose);
    }
    // One publication carries all pilots at the same 20 Hz simulation instant;
    // repeated pose keys compress together instead of becoming four SCTP messages.
    this.sendAll({ type: "ships", epoch: this.epoch, sequence: ++this.stateSequence, poses });
    const shots = this.world.shotSnapshots(), impacts = this.world.impactSnapshots(now);
    this.callbacks.shotState(shots, impacts);
    this.sendAll({ type: "shots", epoch: this.epoch, sequence: ++this.stateSequence, shots, impacts });
    this.publishSurfaceState(now);
  }

  private stepSurfaceAuthority(dt: number, now: number): void {
    const authority = this.surfaceAuthority, world = this.world;
    if (!authority || !world) return;
    this.surfaceSimulatedAt = now;
    if (this.surfaceRoundId !== world.currentRoundId) { authority.resetRound(now); this.surfaceRoundId = world.currentRoundId; }
    for (const { id, pose } of world.poses(now)) {
      const surfacePlayer = authority.world.getPlayer(id);
      if (world.isSurfaceDocked(id)) {
        if (surfacePlayer?.mode === "ship") world.setSurfaceDocked(id, false, surfacePlayer.ship, now);
        continue;
      }
      if (!surfacePlayer) authority.addPlayer(id, this.surfaceShipFromPose(pose));
      else authority.setShipPose(id, this.surfaceShipFromPose(pose));
      if (pose.damagePause > 0) authority.world.markShipDamage(id, now - (2 - pose.damagePause) * 1000);
    }
    if (world.roundPhase === "combat") authority.step(dt, now);
    else authority.pauseRound();
    for (const player of authority.world.listPlayers()) if (world.isSurfaceDocked(player.id) && player.mode === "ship") {
      world.setSurfaceDocked(player.id, false, player.ship, now);
    }
    for (const elimination of authority.drainEliminations()) world.recordSurfaceElimination(elimination.attackerId, elimination.victimId, elimination.id, elimination.at);
    if (world.roundPhase !== "combat") authority.pauseRound();
    const parkedShips = authority.world.listPlayers().flatMap(player => {
      if (player.mode !== "surface" || !player.arenaKey) return [];
      const arena = authority.world.getArena(player.arenaKey);
      if (!arena) return [];
      const normal = player.ship.position.map((value, axis) => value - arena.center[axis]);
      const length = Math.hypot(...normal) || 1;
      return [{ id: player.id, position: normal.map((value, axis) => arena.center[axis] + value / length * SURFACE.worldRadius * 1.2) as [number, number, number] }];
    });
    world.setParkedShipPositions(parkedShips);
  }

  private publishSurfaceState(now: number): void {
    if (!this.isHost || !this.surfaceAuthority) return;
    const hostTime = this.surfaceSimulatedAt > 0 ? Math.min(now, this.surfaceSimulatedAt) : now;
    const snapshot = this.surfaceAuthority.snapshot(this.epoch, ++this.surfaceSnapshotSequence, hostTime);
    this.acknowledgeSurfaceInputs(snapshot);
    this.callbacks.surfaceState?.(snapshot, now, 0);
    for (const member of this.roster) {
      const times = this.issuedSurfaceTimes.get(member.id) ?? [];
      times.push(hostTime);
      while (times.length && now - times[0] > 300) times.shift();
      this.issuedSurfaceTimes.set(member.id, times);
      if (member.id !== this.selfId) this.sendTo(member.id, { type: "surface-state", epoch: this.epoch, state: snapshot });
    }
  }

  private pingSurfaceHost(): void {
    if (!this.active || !this.hostId) return;
    const now = Date.now();
    this.retrySurfaceFire(now);
    if (now - this.lastSurfacePingAt < 500) return;
    this.lastSurfacePingAt = now;
    if (this.isHost) { void this.sampleSurfacePeerTimings(now); return; }
    const sequence = ++this.surfacePingSequence;
    this.pendingSurfacePings.set(sequence, now);
    while (this.pendingSurfacePings.size > 8) this.pendingSurfacePings.delete(this.pendingSurfacePings.keys().next().value!);
    this.sendTo(this.hostId, { type: "surface-ping", epoch: this.epoch, sequence, clientSentAt: now });
  }

  /** Read transport RTT on the host; clients never supply a trusted compensation allowance. */
  private async sampleSurfacePeerTimings(now: number): Promise<void> {
    const authority = this.surfaceAuthority, epoch = this.epoch;
    if (!this.isHost || !authority) return;
    await Promise.allSettled([...this.peers].map(async ([id, peer]) => {
      if (peer.pc.connectionState !== "connected" || typeof peer.pc.getStats !== "function") return;
      const report = await peer.pc.getStats();
      const selectedId = [...report.values()].find(item => item.type === "transport" && item.selectedCandidatePairId)?.selectedCandidatePairId;
      const pair = selectedId ? report.get(selectedId) : [...report.values()].find(item => item.type === "candidate-pair" && item.nominated && item.state === "succeeded");
      if (this.isHost && this.epoch === epoch && this.surfaceAuthority === authority && pair?.type === "candidate-pair"
        && typeof pair.currentRoundTripTime === "number") authority.observeConnectionTiming(id, pair.currentRoundTripTime * 1000, now);
    }));
  }

  setLocalGraph(data: GraphData): void {
    if (!this.active) return;
    try {
      this.topology = makeAnonymousTopology(data, this.ids, ++this.revision);
      this.refreshSurfaceMap(this.selfId);
      for (const id of this.peers.keys()) this.queueTopology(id, this.topology);
    } catch (e) {
      this.revision--;
      this.callbacks.status(e instanceof Error ? e.message : "Could not share this constellation.", true);
    }
  }
  republishLocalLayout(): void { if (this.active) this.setLocalGraph(this.graph().data); }
  private sendPositions(): void { if (this.topology) for (const id of this.peers.keys()) this.sendPositionsTo(id); }
  private sendPositionsTo(id: string): void {
    const peer = this.peers.get(id), topology = this.topology, channel = peer?.live;
    if (!peer || !channel || channel.readyState !== "open" || !topology || channel.bufferedAmount > 0 || this.liveLatest.get(id)?.size) return;
    try {
      const chunks = encodePositionChunks(this.graph().nodes, topology, ++peer.positionSequence);
      for (const chunk of chunks) channel.send(chunk);
    } catch (e) { this.callbacks.status(String(e), true); }
  }

  private refreshSurfaceMap(ownerId: string): void {
    if (!this.isHost || !this.surfaceAuthority || !ownerId) return;
    const topology = ownerId === this.selfId ? this.topology : this.peers.get(ownerId)?.topology;
    if (!topology) return;
    let positions: Float32Array;
    if (ownerId === this.selfId) {
      const nodes = this.graph().nodes;
      if (nodes.length !== topology.nodes.length) return;
      positions = new Float32Array(nodes.length * 3);
      for (let i = 0; i < nodes.length; i++) { positions[i * 3] = nodes[i].x; positions[i * 3 + 1] = nodes[i].y; positions[i * 3 + 2] = nodes[i].z; }
    } else {
      const peer = this.peers.get(ownerId);
      if (!peer?.positions || peer.positionsRevision !== topology.revision || peer.positions.length !== topology.nodes.length * 3) return;
      positions = peer.positions;
    }
    const surfaceTopology: SurfaceTopology = { revision: topology.revision,
      nodes: topology.nodes.map(node => ({ id: node.id, group: node.group, degree: node.degree, dockable: node.dockable })),
      links: topology.links.map(link => [link[0], link[1]] as [string, string]) };
    this.surfaceAuthority.setOwnerMap(ownerId, surfaceTopology, positions);
  }

  private queueTopology(id: string, topology: AnonymousTopology): void {
    const peer = this.peers.get(id), control = peer?.control;
    if (!peer || !control || control.readyState !== "open") return;
    const json = JSON.stringify(topology);
    if (json.length > MAX_TOPOLOGY_CHARS) { this.callbacks.status("This anonymous constellation snapshot exceeds the 16 MiB network limit.", true); return; }
    peer.topologySend = { revision: topology.revision, json, next: 0, total: Math.ceil(json.length / TOPOLOGY_CHUNK_CHARS) };
  }

  private pumpTopologies(): void {
    for (const peer of this.peers.values()) {
      const transfer = peer.topologySend, channel = peer.control;
      if (!transfer || !channel || channel.readyState !== "open" || channel.bufferedAmount > 256_000) continue;
      const index = transfer.next++, from = index * TOPOLOGY_CHUNK_CHARS;
      try { sendNetworkJson(channel, JSON.stringify({ type: "topology-chunk", revision: transfer.revision, index, total: transfer.total, data: transfer.json.slice(from, from + TOPOLOGY_CHUNK_CHARS) })); }
      catch { transfer.next--; continue; }
      if (transfer.next >= transfer.total) peer.topologySend = null;
    }
  }

  sendInput(input: FlightInput): void {
    if (!this.active) return;
    if (this.isHost) this.world?.setInput(this.selfId, input, Date.now());
    else this.sendTo(this.hostId, { type: "input", epoch: this.epoch, input });
  }
  selectWeapon(sequence: number, weapon: 0 | 1): void {
    if (!this.active || !Number.isSafeInteger(sequence) || sequence < 1 || (weapon !== 0 && weapon !== 1)) return;
    if (this.isHost) this.world?.setWeapon(this.selfId, sequence, weapon, Date.now());
    else this.sendReliable(this.hostId, { type: "weapon", epoch: this.epoch, sequence, weapon });
  }
  fire(sequence: number, gun: number, weapon: 0 | 1, aimPoint: [number, number, number]): void {
    if (!this.active || !Number.isSafeInteger(sequence) || sequence < 1 || !Number.isInteger(gun) || gun < 0 || gun > 3) return;
    const now = Date.now();
    if (!aimPoint.every(Number.isFinite) || aimPoint.some(v => Math.abs(v) > MAX_COORDINATE)) return;
    if (this.isHost) this.callbacks.shotResult?.(sequence, this.world?.fireShot(this.selfId, sequence, gun, now, aimPoint, weapon) ?? false);
    else this.sendReliable(this.hostId, { type: "fire", epoch: this.epoch, sequence, gun, weapon, aimPoint });
  }

  requestSurfaceDock(target: NavigationTarget): void {
    if (!this.active || !this.validNavigationTarget(target)) return;
    const sequence = ++this.surfaceRequestSequence;
    if (this.isHost) this.handleSurfaceDock(this.selfId, sequence, target);
    else this.sendReliable(this.hostId, { type: "surface-dock", epoch: this.epoch, sequence, target });
  }

  private acknowledgeSurfaceInputs(snapshot: SurfaceNetworkSnapshot): void {
    const local = snapshot.players.find(player => player.id === this.selfId);
    for (const [sequence, pending] of this.pendingSurfaceFire) if (!local || local.mode !== "surface" || local.arenaKey !== pending.message.arenaKey || local.lifeId !== pending.message.lifeId) this.pendingSurfaceFire.delete(sequence);
    if (!local) { this.surfaceInputFrames.length = 0; return; }
    this.surfaceInputFrames = this.surfaceInputFrames.filter(frame => frame.sequence > local.inputSequence && frame.arenaKey === local.arenaKey && frame.lifeId === local.lifeId);
  }

  private resetSurfaceTransport(): void {
    this.liveLatest.clear();
    for (const wire of this.surfaceWire.values()) wire.clear();
    this.checkpointReceive = null;
    this.lastCheckpointWireAt = -Infinity;
    this.surfaceInputFrames.length = 0; this.surfaceClock.reset(); this.lastSurfaceSnapshotSequence = 0;
    this.lastSurfacePingAt = 0;
    this.pendingSurfacePings.clear(); this.issuedSurfaceTimes.clear();
    for (const sequence of this.pendingSurfaceFire.keys()) this.callbacks.surfaceFireResult?.(sequence, false);
    this.pendingSurfaceFire.clear(); this.surfaceFireResults.clear();
  }

  /** Retries use the unordered live lane so reliable-channel head-of-line stalls cannot delay disposition. */
  private retrySurfaceFire(now: number): void {
    for (const [sequence, pending] of this.pendingSurfaceFire) {
      if (pending.message.epoch !== this.epoch || now - pending.startedAt >= 1000) {
        this.pendingSurfaceFire.delete(sequence);
      } else if (now - pending.sentAt >= 100) {
        pending.sentAt = now; this.sendTo(this.hostId, pending.message);
      }
    }
  }

  private handleSurfaceFireMessage(id: string, m: Record<string, unknown>): boolean {
    if (m.type === "surface-charge") {
      if (m.epoch === this.epoch && this.isHost && this.authorityReady && this.world?.roundPhase === "combat" && typeof m.active === "boolean") this.surfaceAuthority?.world.setCharge(id, m.active, Date.now(), m.arenaKey, m.lifeId);
      return true;
    }
    if (m.type !== "surface-fire" && m.type !== "surface-fire-result") return false;
    if (m.epoch !== this.epoch || !Number.isSafeInteger(m.sequence) || (m.sequence as number) < 1) return true;
    const sequence = m.sequence as number;
    if (m.type === "surface-fire-result") {
      if (id !== this.hostId || typeof m.accepted !== "boolean" || !this.pendingSurfaceFire.delete(sequence)) return true;
      this.callbacks.surfaceFireResult?.(sequence, m.accepted); return true;
    }
    if (!this.isHost || !this.authorityReady || this.world?.roundPhase !== "combat" || !Number.isSafeInteger(m.viewTime) || typeof m.arenaKey !== "string" || m.arenaKey.length > 128
      || !Number.isSafeInteger(m.lifeId) || (m.lifeId as number) < 1 || !Array.isArray(m.direction) || m.direction.length !== 3
      || !m.direction.every(value => typeof value === "number" && Number.isFinite(value))) return true;
    let results = this.surfaceFireResults.get(id);
    if (!results) { results = new Map(); this.surfaceFireResults.set(id, results); }
    let accepted = results.get(sequence);
    if (accepted === undefined) {
      accepted = !!this.surfaceAuthority?.fire(id, sequence, m.viewTime as number, m.direction as [number, number, number], this.issuedSurfaceTimes.get(id) ?? [], Date.now(), m.arenaKey, m.lifeId as number, m.kind as "normal" | "charged").accepted;
      results.set(sequence, accepted);
      while (results.size > 128) results.delete(results.keys().next().value!);
    }
    this.sendTo(id, { type: "surface-fire-result", epoch: this.epoch, sequence, accepted });
    return true;
  }

  sendSurfaceInput(input: SurfaceInput & { interact: boolean }, arenaKey: string, lifeId: number): number | undefined {
    if (!this.active || !this.authorityReady || !validSurfaceInput(input) || typeof arenaKey !== "string" || arenaKey.length > 128 || !Number.isSafeInteger(lifeId) || lifeId < 1) return;
    const sequence = ++this.surfaceInputSequence;
    this.surfaceInputFrames = this.surfaceInputFrames.filter(frame => frame.arenaKey === arenaKey && frame.lifeId === lifeId);
    this.surfaceInputFrames.push({ sequence, arenaKey, lifeId, input: copySurfaceControls(input) });
    if (this.surfaceInputFrames.length > SURFACE_INPUT_RESEND) this.surfaceInputFrames.splice(0, this.surfaceInputFrames.length - SURFACE_INPUT_RESEND);
    if (this.isHost) this.surfaceAuthority?.setInputFrames(this.selfId, this.surfaceInputFrames, Date.now());
    else this.sendTo(this.hostId, { type: "surface-input", epoch: this.epoch, frames: this.surfaceInputFrames.map(frame => ({ ...frame, input: { ...frame.input } })) });
    return sequence;
  }

  chargeSurface(active: boolean, arenaKey: string, lifeId: number): void {
    if (!this.active || !this.authorityReady || (this.isHost && this.world?.roundPhase !== "combat")) return;
    if (this.isHost) this.surfaceAuthority?.world.setCharge(this.selfId, active, Date.now(), arenaKey, lifeId);
    else this.sendTo(this.hostId, { type: "surface-charge", epoch: this.epoch, active, arenaKey, lifeId });
  }

  fireSurface(sequence: number, viewTime: number, arenaKey: string, lifeId: number, direction: [number, number, number], kind: "normal" | "charged" = "normal"): void {
    if (!this.active || !this.authorityReady || (this.isHost && this.world?.roundPhase !== "combat") || !Number.isSafeInteger(sequence) || sequence < 1 || !Number.isSafeInteger(viewTime)
      || typeof arenaKey !== "string" || !Number.isSafeInteger(lifeId) || !Array.isArray(direction) || direction.length !== 3 || !direction.every(Number.isFinite)) return;
    if (this.isHost) {
      const now = Date.now(), issued = this.issuedSurfaceTimes.get(this.selfId) ?? [];
      this.surfaceAuthority?.observeConnectionTiming(this.selfId, 0, now);
      const result = this.surfaceAuthority?.fire(this.selfId, sequence, viewTime, direction, issued, now, arenaKey, lifeId, kind);
      this.callbacks.surfaceFireResult?.(sequence, !!result?.accepted);
    } else {
      if (this.pendingSurfaceFire.has(sequence)) return;
      if (this.pendingSurfaceFire.size >= 32) { this.callbacks.surfaceFireResult?.(sequence, false); return; }
      const message: Extract<GameMessage, { type: "surface-fire" }> = { type: "surface-fire", epoch: this.epoch, sequence, viewTime, arenaKey, lifeId, kind, direction: [...direction] };
      const now = Date.now(); this.pendingSurfaceFire.set(sequence, { message, startedAt: now, sentAt: now });
      this.sendTo(this.hostId, message);
    }
  }

  setSurfaceColor(requested: unknown): void {
    if (!this.active) return;
    const sequence = ++this.surfaceColorSequence;
    const color = normalizeSurfaceLaserColor(requested);
    if (!color) return;
    if (this.isHost) {
      const approved = this.surfaceAuthority?.setColor(this.selfId, color) ?? null;
      this.callbacks.surfaceColor?.(sequence, !!approved, approved ?? this.surfaceAuthority?.getColor(this.selfId) ?? "#8CECFF");
    } else this.sendReliable(this.hostId, { type: "surface-color", epoch: this.epoch, sequence, color });
  }

  requestFastTravel(target: NavigationTarget): void {
    if (!this.active || !this.validNavigationTarget(target)) return;
    if (this.isHost) this.startRequestedTravel(this.selfId, target);
    else this.sendReliable(this.hostId, { type: "navigate", epoch: this.epoch, target });
  }

  private validNavigationTarget(value: unknown): value is NavigationTarget {
    if (!value || typeof value !== "object") return false;
    const target = value as NavigationTarget;
    return typeof target.ownerId === "string" && /^[0-9a-f-]{36}$/i.test(target.ownerId)
      && this.roster.some(member => member.id === target.ownerId) && typeof target.starId === "string"
      && /^n-[0-9a-f-]{36}$/i.test(target.starId) && Number.isSafeInteger(target.revision) && target.revision > 0;
  }

  private startRequestedTravel(playerId: string, target: NavigationTarget): void {
    const world = this.world; if (!world || !this.validNavigationTarget(target)) return;
    let topology: AnonymousTopology | undefined, positions: readonly SimNode[] | Float32Array | undefined;
    if (target.ownerId === this.selfId) { topology = this.topology ?? undefined; positions = this.graph().nodes; }
    else {
      const owner = this.peers.get(target.ownerId); topology = owner?.topology;
      if (owner?.positionsRevision === target.revision) positions = owner.positions;
    }
    if (!topology || topology.revision !== target.revision || !positions) return;
    const index = topology.nodes.findIndex(node => node.id === target.starId);
    if (index < 0) return;
    let position: [number, number, number], degree = topology.nodes[index].degree;
    if (positions instanceof Float32Array) {
      const offset = index * 3; position = [positions[offset], positions[offset + 1], positions[offset + 2]];
    } else {
      const node = positions[index]; if (!node) return;
      position = [node.x, node.y, node.z];
    }
    if (world.startTravel(playerId, position, Math.min(5.5, 0.9 + Math.sqrt(degree) * 0.5), Date.now())) this.callbacks.navigation?.(target, "travelling");
  }

  private handleSurfaceDock(playerId: string, sequence: number, target: NavigationTarget): void {
    const previous = this.lastSurfaceDockSequence.get(playerId) ?? 0;
    if (sequence <= previous) return;
    this.lastSurfaceDockSequence.set(playerId, sequence);
    const topology = target.ownerId === this.selfId ? this.topology : this.peers.get(target.ownerId)?.topology;
    const node = topology?.nodes.find(item => item.id === target.starId);
    const player = this.world?.players.get(playerId), now = Date.now();
    let accepted = !!this.isHost && !!this.world && !!this.surfaceAuthority && !!player && player.active && !player.docked
      && this.world.roundPhase === "combat" && target.revision === topology?.revision && !!node?.dockable;
    if (accepted) {
      accepted = this.surfaceAuthority!.dock(playerId, target.ownerId, target.starId, now);
      if (accepted && !this.world!.setSurfaceDocked(playerId, true, undefined, now)) accepted = false;
    }
    if (!accepted && this.surfaceAuthority?.world.getPlayer(playerId)?.mode === "surface" && !this.world?.isSurfaceDocked(playerId)) {
      // Keep the two authorities aligned if the ship state changed during the dock request.
      this.surfaceAuthority.forceUndock(playerId);
    }
    const reason=this.surfaceAuthority?.world.getPreparationError(`${target.ownerId}/${target.starId}`)?"preparation" as const:undefined;
    this.callbacks.surfaceDockResult?.(sequence, accepted, reason);
    if (playerId !== this.selfId) this.sendReliable(playerId, { type: "surface-dock-result", epoch: this.epoch, sequence, accepted, ...(reason?{reason}:{}) });
  }

  private sendReliable(id: string, message: GameMessage): void {
    const channel = this.peers.get(id)?.control;
    if (!channel || channel.readyState !== "open" || channel.bufferedAmount > 128_000) { this.callbacks.status(`The reliable connection to ${this.memberName(id)} is not ready.`, true); return; }
    try { sendNetworkJson(channel, JSON.stringify(message)); } catch { this.callbacks.status(`The reliable connection to ${this.memberName(id)} failed.`, true); }
  }
  sendAll(message: GameMessage): void { for (const id of this.peers.keys()) this.sendTo(id, message); }
  private surfaceWireFor(id: string): SurfaceSnapshotWire {
    let wire = this.surfaceWire.get(id);
    if (!wire) { wire = new SurfaceSnapshotWire(); this.surfaceWire.set(id, wire); }
    return wire;
  }
  private flushLiveState(id: string): void {
    const channel = this.peers.get(id)?.live, latest = this.liveLatest.get(id);
    if (!channel || channel.readyState !== "open" || !latest) return;
    // Keep replaceable state outside SCTP until the previous message drains.
    // Even a few KB can contain seconds of compact snapshots on a stalled
    // association. Map insertion order gives each pending stream a turn.
    while (channel.bufferedAmount === 0 && latest.size) {
      const [key, json] = latest.entries().next().value!;
      try { sendNetworkJson(channel, json); latest.delete(key); } catch { break; }
    }
  }
  private sendTo(id: string, message: GameMessage): void {
    if (message.type === "surface-charge" || (message.type === "surface-fire" && message.kind === "charged")) {
      this.sendReliable(id, message); return;
    }
    const ch = this.peers.get(id)?.live; if (!ch || ch.readyState !== "open") return;
    const key = message.type === "ship" ? `ship:${message.playerId}`
      : ["ships", "shots", "surface-state", "input", "surface-input"].includes(message.type) ? message.type : null;
    if (key) {
      let latest = this.liveLatest.get(id);
      if (!latest) { latest = new Map(); this.liveLatest.set(id, latest); }
      const outgoing = message.type === "surface-state" ? { ...message, state: this.surfaceWireFor(id).encode(message.state, true) } : message;
      if (message.type === "surface-state") {
        const reliable = this.peers.get(id)?.control;
        if (reliable?.readyState === "open") for (let count = 0; count < 8 && reliable.bufferedAmount < 32_000; count++) {
          const chunk = this.surfaceWireFor(id).nextChunk();
          if (!chunk) break;
          this.sendReliable(id, { type: "surface-geometry-chunk", epoch: this.epoch, ...chunk });
        }
      }
      latest.set(key, JSON.stringify(outgoing)); this.flushLiveState(id); return;
    }
    // Dispositions and retried fire requests bypass replaceable application
    // state. Never put them behind half a megabyte of obsolete snapshots.
    if (ch.bufferedAmount > 16_384) return;
    try { sendNetworkJson(ch, JSON.stringify(message)); } catch { /* the peer may have closed during a frame */ }
  }
  private signal(to: string, data: object): void { this.publicRoom?.signal(to, data); }
  private memberName(id: string): string { return this.roster.find(p => p.id === id)?.name ?? "player"; }
  private removePeer(id: string): void {
    this.liveLatest.delete(id);
    this.surfaceWire.delete(id);
    this.iceFailures.delete(id);
    const retry = this.retryTimers.get(id); if (retry !== undefined) { window.clearTimeout(retry); this.retryTimers.delete(id); }
    const peer = this.peers.get(id); if (peer) { this.peers.delete(id); peer.control?.close(); peer.live?.close(); peer.pc.close(); }
    this.lastShipSequence.delete(id);
  }

  leave(message = "Left the room."): void {
    this.checkpointReceive = null;
    this.lastCheckpointWireAt = -Infinity;
    if (this.closed) return;
    this.closed = true; window.clearInterval(this.sendTimer); window.clearInterval(this.checkpointTimer); window.clearInterval(this.topologyTimer); window.clearInterval(this.authorityMonitorTimer); window.clearTimeout(this.iceRefreshTimer); window.clearTimeout(this.authorityTimer);
    window.clearInterval(this.gameTimer); this.world = null; this.surfaceAuthority = null;
    for (const timer of this.retryTimers.values()) window.clearTimeout(timer);
    this.retryTimers.clear();
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.iceFailures.clear();
    const room = this.publicRoom; this.publicRoom = null; room?.leave(); this.socket = null;
    const self = this.selfId; this.roomCode = ""; this.selfId = ""; this.hostId = ""; this.roster = []; this.topology = null; this.ids.clear(); this.revision = 0;
    this.relay = []; this.iceExpiresAt = 0; this.relayStatus = "pending"; this.lastIceRequestAt = 0; this.directStartedAt = 0; this.lastCheckpoint = null;
    this.iceRefreshToken = ""; this.iceRefreshTokenExpiresAt = 0; this.iceRequesting = false; window.clearTimeout(this.iceFallbackTimer);
    this.lastShipSequence.clear(); this.lastShotSequence = 0; this.stateSequence = 0; this.positionSequence = 0;
    this.surfaceSnapshotSequence = 0; this.lastSurfaceSnapshotSequence = 0; this.surfaceRequestSequence = 0; this.surfaceInputSequence = 0; this.surfaceColorSequence = 0; this.surfacePingSequence = 0; this.lastSurfacePingAt = 0;
    this.surfaceInputFrames.length = 0;
    this.pendingSurfaceFire.clear(); this.surfaceFireResults.clear();
    this.pendingSurfacePings.clear(); this.issuedSurfaceTimes.clear(); this.lastSurfaceDockSequence.clear(); this.lastSurfaceColorSequence.clear(); this.surfaceClock.reset();
    this.lastRoundId = 0; this.lastRoundWireKey = ""; this.lastRoundSendAt = 0; this.seenEliminations.clear();
    this.callbacks.shotState([], []);
    this.callbacks.removed(self); this.callbacks.members([], "", "", 0); this.callbacks.status(message);
  }
}
