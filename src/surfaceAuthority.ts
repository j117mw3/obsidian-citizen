import { validTerrainDefinition, bindSurfaceTerrain } from "./surfaceTerrain";
import { encodeCoverPoses, validCoverPackets, type SurfaceCoverPacket } from "./surfaceCoverWire";
import { surfaceRadiusForConnections, surfaceWorldRadii } from "./surfaceGeometry";
import { SURFACE, type SurfaceVector, type SurfaceBotView, type SurfaceBotShotView, type SurfaceBotDropView } from "./surface";
import { surfaceShotDamage, type SurfaceShotKind, SURFACE_BLASTER, spreadSurfaceDirection, surfaceSeed, surfaceSpreadDegrees, traceSurfaceSegment, type SurfaceCombatTarget } from "./surfaceCombat";
import { validSurfacePlayerState as validSurfaceState, type SurfaceInput, type SurfacePlayerState } from "./surfacePhysics";
import { SurfaceConnectionTiming, SurfaceHistory, validateSurfaceViewTime } from "./surfaceHistory";
import { DEFAULT_SURFACE_LASER_COLOR, normalizeSurfaceLaserColor, isApprovedSurfaceLaserColor } from "./surfaceColor";
import { SurfaceWorld, MAX_SURFACE_CHECKPOINT_ARENAS, MAX_SURFACE_BOTS, MAX_SURFACE_BOT_SHOTS, MAX_SURFACE_BOT_DROPS, type SurfaceArenaView, type SurfacePickupView, type SurfacePlayerView, type SurfaceShipState, type SurfaceTopology, type SurfaceWorldCheckpoint } from "./surfaceWorld";
import { SurfaceInputBuffer, validSurfaceControls } from "./surfaceInput";
import { surfaceViewPose } from "./surfaceView";
import { StarCollisionGrid } from "./flight";
import { PLAYER_KILLS_TO_WIN } from "./rounds";
import * as THREE from "three";
export { validSurfaceControls as validSurfaceInput } from "./surfaceInput";

type Vec3 = [number, number, number];
const unit = (value: SurfaceVector): Vec3 => { const n = Math.hypot(...value) || 1; return [value[0] / n, value[1] / n, value[2] / n]; };
const dot = (a: SurfaceVector, b: SurfaceVector): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: SurfaceVector, b: SurfaceVector): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a: SurfaceVector, b: SurfaceVector): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: SurfaceVector, n: number): Vec3 => [a[0] * n, a[1] * n, a[2] * n];
const sub = (a: SurfaceVector, b: SurfaceVector): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const WORLD_PLANET_RADIUS = SURFACE.worldRadius;
const WORLD_TO_SURFACE = SURFACE.radius / WORLD_PLANET_RADIUS;

export interface SurfacePlayerSnapshot extends SurfacePlayerView { laserColor: string; inputSequence: number }
export interface SurfaceProjectileSnapshot {
  id: string; ownerId: string; sequence: number; lifeId: number; arenaKey: string;
  position: Vec3; direction: Vec3; travelled: number; color: string; startedAt: number; stoppedAt: number; kind?: SurfaceShotKind;
}
export interface SurfaceDamageCue { id: string; targetId: string; at: number; direction: Vec3 }
export interface SurfaceHitConfirmation { id: string; ownerId: string; targetId: string; sequence: number; at: number }
export interface SurfaceNetworkSnapshot {
  epoch: number; sequence: number; hostTime: number;
  players: SurfacePlayerSnapshot[]; arenas: SurfaceArenaView[]; projectiles: SurfaceProjectileSnapshot[];
  pickups: Array<SurfacePickupView & { arenaKey: string }>;
  bots: SurfaceBotView[]; botShots: SurfaceBotShotView[]; botDrops: SurfaceBotDropView[];
  damageCues: SurfaceDamageCue[]; hitConfirmations: SurfaceHitConfirmation[]; cover?: SurfaceCoverPacket[];
}
export interface SurfaceAuthorityCheckpoint {
  version: 2;
  world: SurfaceWorldCheckpoint;
  colors: Array<[string, string]>;
  lastInputSequences: Array<[string, number]>;
  lastFireRequestSequences: Array<[string, number]>;
  projectiles: Array<{ shot: SurfaceProjectileSnapshot; ageMs: number; stoppedRemainingMs: number; rewindMs: number }>;
  projectileSequence: number;
}
export interface SurfaceElimination { id: string; attackerId: string; victimId: string; at: number }
export interface SurfaceFireDisposition { accepted: boolean; player: SurfacePlayerView | null; projectile: SurfaceProjectileSnapshot | null; reason?: "state" | "sequence" | "view-time" | "history" | "aim" | "muzzle" | "cooldown" }

interface RuntimeProjectile extends SurfaceProjectileSnapshot { rewindMs: number; simulatedAt: number }

function normalizedDirection(value: unknown): Vec3 | null {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(v => typeof v === "number" && Number.isFinite(v))) return null;
  const length = Math.hypot(value[0], value[1], value[2]);
  if (length < 0.9 || length > 1.1) return null;
  return [value[0] / length, value[1] / length, value[2] / length];
}

function isRecord(value: unknown): value is Record<string, any> { return !!value && typeof value === "object" && !Array.isArray(value); }
function finiteTuple(value: unknown, length: number, limit = 1_000_000): value is number[] {
  return Array.isArray(value) && value.length === length && value.every(number => typeof number === "number" && Number.isFinite(number) && Math.abs(number) <= limit);
}
const validatedImmutableGeometry = new WeakSet<object>();
function validArenaPayload(value: unknown): value is SurfaceArenaView {
  if (!isRecord(value) || !isRecord(value.arena) || value.arena.hubId !== value.hubId || !Number.isSafeInteger(value.topologyRevision) || value.topologyRevision < 1 || !Number.isSafeInteger(value.arena.seed)
    || !Array.isArray(value.arena.walls) || value.arena.walls.length > 39_998 || (value.arena.radius ?? SURFACE.radius) !== surfaceRadiusForConnections(value.arena.walls.length / 2)
    || !Array.isArray(value.arena.pickups) || value.arena.pickups.length !== 6) return false;
  if(value.arena.terrain!==undefined&&!validTerrainDefinition(value.arena.terrain,value.arena.radius??27))return false;
  bindSurfaceTerrain(value.arena.walls,value.arena.terrain);
  if (Object.isFrozen(value.arena) && validatedImmutableGeometry.has(value.arena)) return true;
  const wallIds = new Set<string>(), connectionCounts = new Map<string, number>();
  for (const wall of value.arena.walls) {
    if (!isRecord(wall) || typeof wall.id !== "string" || !/^wall-\d+$/.test(wall.id) || wallIds.has(wall.id)
      || typeof wall.connectionId !== "string" || !/^n-[0-9a-f-]{36}$/i.test(wall.connectionId) || wall.connectionId === value.hubId || (connectionCounts.get(wall.connectionId) ?? 0) >= 2
      || !finiteTuple(wall.normal, 3, 1.01) || !finiteTuple(wall.tangent, 3, 1.01)
      || Math.abs(Math.hypot(...wall.normal) - 1) > 0.01 || Math.abs(Math.hypot(...wall.tangent) - 1) > 0.01
      || Math.abs(dot(wall.normal as Vec3, wall.tangent as Vec3)) > 0.02 || ![SURFACE.lowWallHeight, SURFACE.tallWallHeight].includes(wall.height)
      || !Number.isFinite(wall.length) || wall.length < 1 || wall.length > 10) return false;
    wallIds.add(wall.id); connectionCounts.set(wall.connectionId, (connectionCounts.get(wall.connectionId) ?? 0) + 1);
  }
  if ([...connectionCounts.values()].some(count => count !== 2)) return false;
  const pickupIds = new Set<string>();
  for (const pickup of value.arena.pickups) {
    if (!isRecord(pickup) || typeof pickup.id !== "string" || !/^pickup-\d+$/.test(pickup.id) || pickupIds.has(pickup.id)
      || !finiteTuple(pickup.normal, 3, 1.01) || Math.abs(Math.hypot(...pickup.normal) - 1) > 0.01
      || !["small-health", "large-health", "armor"].includes(pickup.kind)
      || !["cover", "open"].includes(pickup.placement) || !Number.isFinite(pickup.heal) || !Number.isFinite(pickup.armor)
      || !Number.isSafeInteger(pickup.respawnMs) || pickup.respawnMs < 10_000 || pickup.respawnMs > 60_000) return false;
    const expected = pickup.kind === "small-health" ? [25, 0, 15_000, value.arena.walls.length ? "cover" : "open"]
      : pickup.kind === "large-health" ? [50, 0, 30_000, "open"]
      : [0, 25, 30_000, pickup.placement];
    if (pickup.heal !== expected[0] || pickup.armor !== expected[1] || pickup.respawnMs !== expected[2]
      || (pickup.kind !== "armor" && pickup.placement !== expected[3])) return false;
    pickupIds.add(pickup.id);
  }
  const small = value.arena.pickups.filter((pickup: any) => pickup.kind === "small-health").length;
  const large = value.arena.pickups.filter((pickup: any) => pickup.kind === "large-health").length;
  const armor = value.arena.pickups.filter((pickup: any) => pickup.kind === "armor").length;
  const valid = small === 2 && large === 2 && armor === 2;
  if (valid && Object.isFrozen(value.arena) && Object.isFrozen(value.arena.walls) && Object.isFrozen(value.arena.pickups)
    && value.arena.walls.every((wall: any) => Object.isFrozen(wall) && Object.isFrozen(wall.normal) && Object.isFrozen(wall.tangent))
    && value.arena.pickups.every((pickup: any) => Object.isFrozen(pickup) && Object.isFrozen(pickup.normal))) validatedImmutableGeometry.add(value.arena);
  return valid;
}

export function validSurfaceArenaPayload(value: unknown): value is SurfaceArenaView {
  return isRecord(value) && typeof value.key === "string" && value.key === `${value.ownerId}/${value.hubId}`
    && /^[0-9a-f-]{36}$/i.test(value.ownerId) && /^n-[0-9a-f-]{36}$/i.test(value.hubId)
    && Number.isSafeInteger(value.revision) && value.revision >= 1 && finiteTuple(value.center, 3, 1_000_000)
    && typeof value.acceptingPlayers === "boolean" && validArenaPayload(value);
}

/** Host-owned room surface simulation, projectiles, resources, and bounded target rewind. */
export class SurfaceAuthority {
  readonly world:SurfaceWorld;
  constructor(readonly options:{terrain?:boolean}={}){this.world=new SurfaceWorld(options);}
  private readonly history = new SurfaceHistory();
  private readonly inputs = new Map<string, SurfaceInputBuffer>();
  private readonly connectionTiming = new Map<string, SurfaceConnectionTiming>();
  private readonly departureRadii = new Map<string, Float32Array>();
  private readonly departurePositions = new Map<string, Float32Array>();
  private readonly departureGrid = new StarCollisionGrid();
  private departureGridDirty = true;
  private readonly colors = new Map<string, string>();
  private readonly projectiles: RuntimeProjectile[] = [];
  private readonly eliminations: SurfaceElimination[] = [];
  private readonly damageCues: SurfaceDamageCue[] = [];
  private readonly hitConfirmations: SurfaceHitConfirmation[] = [];
  private projectileSequence = 0;
  private lastInputSequence = new Map<string, number>();
  private lastFireRequestSequence = new Map<string, number>();

  addPlayer(id: string, ship: SurfaceShipState): void {
    this.world.addPlayer(id, ship);
    if (!this.colors.has(id)) this.colors.set(id, DEFAULT_SURFACE_LASER_COLOR);
    if (!this.inputs.has(id)) this.inputs.set(id, new SurfaceInputBuffer());
  }

  removePlayer(id: string): void {
    this.connectionTiming.delete(id);
    this.world.removePlayer(id); this.history.clearPlayer(id); this.inputs.delete(id); this.colors.delete(id); this.lastInputSequence.delete(id); this.lastFireRequestSequence.delete(id);
    for (let i = this.projectiles.length - 1; i >= 0; i--) if (this.projectiles[i].ownerId === id) this.projectiles.splice(i, 1);
  }

  setShipPose(id: string, ship: SurfaceShipState): void { this.world.setShipPose(id, ship); }
  setOwnerMap(ownerId: string, topology: SurfaceTopology, positions: Float32Array): void {
    if (positions.length !== topology.nodes.length * 3 || positions.length > 60000 || !positions.every(Number.isFinite)) return;
    this.departurePositions.set(ownerId, positions.slice()); this.departureGridDirty = true;
    const previous = this.world.listPlayers(), centers = this.captureCenters(previous);
    this.world.setOwnerMap(ownerId, topology, positions);
    this.departureRadii.set(ownerId, surfaceWorldRadii(topology, new Map(this.world.listArenas().filter(arena => arena.ownerId === ownerId).map(arena => [arena.hubId, arena.arena.radius ?? 27]))));
    this.restoreWorldShips(previous, centers);
  }
  ownerLeft(ownerId: string): void {
    this.departureRadii.delete(ownerId); this.departurePositions.delete(ownerId); this.departureGridDirty = true;
    const previous = this.world.listPlayers(), centers = this.captureCenters(previous);
    this.world.ownerLeft(ownerId);
    this.restoreWorldShips(previous, centers);
  }

  setColor(id: string, requested: unknown): string | null {
    if (!this.world.getPlayer(id)) return null;
    const color = normalizeSurfaceLaserColor(requested);
    if (!color) return null;
    this.colors.set(id, color);
    return color;
  }

  getColor(id: string): string { return this.colors.get(id) ?? DEFAULT_SURFACE_LASER_COLOR; }

  observeConnectionTiming(id: string, roundTripMs: number, now: number): boolean {
    if (!this.world.getPlayer(id)) return false;
    const timing = this.connectionTiming.get(id) ?? new SurfaceConnectionTiming();
    if (!timing.observe(roundTripMs, now)) return false;
    this.connectionTiming.set(id, timing); return true;
  }

  dock(id: string, ownerId: string, hubId: string, now: number): boolean {
    const player = this.world.getPlayer(id);
    if (!player || player.mode !== "ship" || !/^[0-9a-f-]{36}$/i.test(ownerId) || !/^n-[0-9a-f-]{36}$/i.test(hubId)) return false;
    if (Math.hypot(...player.ship.velocity) > 10) return false;
    const key = `${ownerId}/${hubId}`, arena = this.world.getArena(key);
    if (!arena) return false;
    this.world.setShipPose(id, this.toSurfaceShip(player.ship, arena.center));
    const accepted = this.world.dock(id, key, now, WORLD_TO_SURFACE);
    if (!accepted) this.world.setShipPose(id, player.ship);
    return accepted;
  }

  forceUndock(id: string): boolean {
    const before = this.world.getPlayer(id);
    const center = before?.arenaKey ? this.world.getArena(before.arenaKey)?.center : undefined;
    if (!center || !this.world.forceUndock(id)) return false;
    const after = this.world.getPlayer(id);
    if (after?.mode === "ship") this.world.setShipPose(id, this.toWorldShip(after.ship, center));
    return true;
  }

  forceUndockAll(): string[] {
    const returned: string[] = [];
    for (const player of this.world.listPlayers()) if (player.mode === "surface" && this.forceUndock(player.id)) returned.push(player.id);
    return returned;
  }

  resetRound(now = Date.now()): void {
    this.world.resetRound(now);
    this.history.clear(); this.projectiles.length = 0; this.damageCues.length = 0; this.hitConfirmations.length = 0; this.eliminations.length = 0;
    for (const player of this.world.listPlayers()) this.inputs.set(player.id, new SurfaceInputBuffer(this.lastInputSequence.get(player.id) ?? 0));
  }

  pauseRound(): void { this.world.freezeRound(); this.projectiles.length = 0; this.history.clear(); }

  setInput(id: string, sequence: number, input: unknown, now = Date.now()): boolean {
    const player = this.world.getPlayer(id);
    if (!player?.arenaKey || !validSurfaceControls(input)) return false;
    return this.setInputFrames(id, [{ sequence, arenaKey: player.arenaKey, lifeId: player.lifeId, input }], now);
  }

  setInputFrames(id: string, frames: unknown, now: number): boolean {
    const player = this.world.getPlayer(id), buffer = this.inputs.get(id);
    if (player?.mode !== "surface" || !player.arenaKey || !buffer || !buffer.accept(frames, player.arenaKey, player.lifeId, now)) return false;
    this.lastInputSequence.set(id, buffer.highestSequence);
    return true;
  }

  fire(id: string, sequence: number, viewTime: unknown, aim: unknown, issuedTimes: readonly number[], now: number, arenaKey: unknown, lifeId: unknown, kind: SurfaceShotKind = "normal"): SurfaceFireDisposition {
    const player = this.world.getPlayer(id);
    if (!player?.surface || player.mode !== "surface" || !player.arenaKey) return { accepted: false, player, projectile: null, reason: "state" };
    if (arenaKey !== player.arenaKey || lifeId !== player.lifeId) return { accepted: false, player, projectile: null, reason: "state" };
    if (!Number.isSafeInteger(sequence) || sequence < 1) return { accepted: false, player, projectile: null, reason: "sequence" };
    if (sequence <= (this.lastFireRequestSequence.get(id) ?? 0)) return { accepted: false, player, projectile: null, reason: "sequence" };
    this.lastFireRequestSequence.set(id, sequence);
    const viewed = validateSurfaceViewTime(viewTime, now, issuedTimes, this.connectionTiming.get(id)?.measuredRtt(now) ?? null);
    if (!viewed.accepted) return { accepted: false, player, projectile: null, reason: "view-time" };
    const direction = normalizedDirection(aim);
    if (!direction) return { accepted: false, player, projectile: null, reason: "aim" };
    const arena = this.world.getArena(player.arenaKey);
    if (!arena) return { accepted: false, player, projectile: null, reason: "state" };
    if (viewed.rewindMs > 0 && this.world.listPlayers().some(target => target.id !== id && target.mode === "surface" && target.arenaKey === player.arenaKey
      && target.health > 0 && target.protectedUntil <= now && !this.history.sample(target.id, now - viewed.rewindMs, player.arenaKey!, target.lifeId, arena.revision))) {
      return { accepted: false, player, projectile: null, reason: "history" };
    }
    const { eye, muzzle } = surfaceViewPose(player.surface);
    const muzzleBlock = traceSurfaceSegment(eye, muzzle, arena.arena.walls, [], id, arena.arena.radius ?? SURFACE.radius);
    if (muzzleBlock) return { accepted: false, player, projectile: null, reason: "muzzle" };
    const fire = this.world.tryFire(id, sequence, now, kind);
    if (!fire.accepted) return { accepted: false, player: this.world.getPlayer(id), projectile: null, reason: "cooldown" };
    const spread = surfaceSpreadDegrees(player.surface);
    const shotDirection = spreadSurfaceDirection(direction, spread, surfaceSeed(id, sequence));
    const projectile: RuntimeProjectile = {
      id: `${id}:${sequence}`, ownerId: id, sequence, lifeId: player.lifeId, arenaKey: player.arenaKey,
      kind, position: muzzle, direction: shotDirection, travelled: 0, color: this.getColor(id), startedAt: now, stoppedAt: 0, rewindMs: viewed.rewindMs, simulatedAt: now,
    };
    this.projectiles.push(projectile);
    this.projectileSequence++;
    const view = this.world.getPlayer(id);
    return { accepted: true, player: view, projectile: this.projectileView(projectile) };
  }

  step(dt: number, now: number): void {
    if (!(dt > 0) || dt > 0.1 || !Number.isFinite(now)) return;
    this.world.moveCover(dt);
    const previous = this.world.listPlayers(), centers = this.captureCenters(previous);
    for (const player of previous) {
      if (player.mode !== "surface") continue;
      if (!player.arenaKey) continue;
      const buffer = this.inputs.get(player.id);
      if (!buffer) continue;
      const input = buffer.advance(player.arenaKey, player.lifeId, now);
      this.world.updatePlayer(player.id, input, dt, now);
    }
    this.restoreWorldShips(previous, centers);
    for (const player of this.world.listPlayers()) {
      if (player.mode === "surface" && player.surface && player.arenaKey) this.history.record({
        playerId: player.id, arenaKey: player.arenaKey, arenaRevision: this.world.getArena(player.arenaKey)?.revision, lifeId: player.lifeId, at: now,
        state: player.surface, protected: player.protectedUntil > now,
      });
    }
    for (const cue of this.world.stepBots(dt, now)) this.damageCues.push(cue);
    this.stepProjectiles(dt, now);
  }

  snapshot(epoch: number, sequence: number, hostTime: number): SurfaceNetworkSnapshot {
    const players = this.world.listPlayers().map(player => ({ ...player, laserColor: this.getColor(player.id), inputSequence: this.inputs.get(player.id)?.acknowledgedSequence ?? 0 }));
    const occupiedKeys = new Set(players.map(player => player.arenaKey).filter((key): key is string => !!key));
    for (const projectile of this.projectiles) occupiedKeys.add(projectile.arenaKey);
    const arenas = [...occupiedKeys].map(key => this.world.getGeometryArena(key)).filter((arena): arena is SurfaceArenaView => !!arena);
    const visibleBotIds = new Set(this.world.listBots().filter(bot => occupiedKeys.has(bot.arenaKey)).map(bot => bot.id));
    const visibleActorIds = new Set([...players.map(player => player.id), ...visibleBotIds]);
    return { epoch, sequence, hostTime, players, arenas, cover: encodeCoverPoses(arenas.map(arena => this.world.getArena(arena.key)!), players), projectiles: this.projectiles.map(shot => this.projectileView(shot)),
      pickups: arenas.flatMap(arena => this.world.getPickups(arena.key, hostTime).map(pickup => ({ ...pickup, arenaKey: arena.key }))),
      bots: this.world.listBots().filter(bot => occupiedKeys.has(bot.arenaKey)), botShots: this.world.listBotShots().filter(shot => occupiedKeys.has(shot.arenaKey)),
      botDrops: this.world.listBotDrops(hostTime).filter(drop => occupiedKeys.has(drop.arenaKey)),
      damageCues: this.damageCues.filter(event => hostTime - event.at <= 1500 && visibleActorIds.has(event.targetId)).map(event => ({ ...event, direction: [...event.direction] })),
      hitConfirmations: this.hitConfirmations.filter(event => hostTime - event.at <= 1500 && visibleActorIds.has(event.targetId) && players.some(player => player.id === event.ownerId)).map(event => ({ ...event })) };
  }

  checkpoint(now: number): SurfaceAuthorityCheckpoint {
    const players = this.world.listPlayers();
    const projectiles = this.projectiles.filter(shot => !!this.world.getArena(shot.arenaKey));
    const arenaKeys = projectiles.map(shot => shot.arenaKey);
    return {
      version: 2,
      world: this.world.checkpoint(now, arenaKeys),
      colors: players.map(player => [player.id, this.getColor(player.id)]),
      lastInputSequences: players.map(player => [player.id, this.lastInputSequence.get(player.id) ?? 0]),
      lastFireRequestSequences: players.map(player => [player.id, this.lastFireRequestSequence.get(player.id) ?? 0]),
      projectiles: projectiles.map(shot => ({
        shot: this.projectileView(shot), ageMs: Math.max(0, now - shot.startedAt),
        stoppedRemainingMs: shot.stoppedAt ? Math.max(0, shot.stoppedAt - now) : 0, rewindMs: shot.rewindMs,
      })),
      projectileSequence: this.projectileSequence,
    };
  }

  /** Restore durable surface state, but deliberately start a fresh rewind epoch. */
  restoreCheckpoint(value: unknown, now: number, ageMs = 0): boolean {
    if (!isRecord(value) || value.version !== 2 || !Number.isSafeInteger(now) || !Number.isFinite(ageMs) || ageMs < 0 || ageMs > 15_000
      || !Number.isSafeInteger(value.projectileSequence) || value.projectileSequence < 0 || !Array.isArray(value.colors)
      || !Array.isArray(value.lastInputSequences) || !Array.isArray(value.lastFireRequestSequences) || !Array.isArray(value.projectiles)
      || value.projectiles.length > 128 || !isRecord(value.world) || !Array.isArray(value.world.players) || value.world.players.length > 4
      || !Array.isArray(value.world.arenas) || value.world.arenas.length > MAX_SURFACE_CHECKPOINT_ARENAS) return false;

    const playerIds = new Set<string>();
    for (const item of value.world.players) {
      const id = item?.view?.id;
      if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || playerIds.has(id)) return false;
      playerIds.add(id);
    }
    const pairs = (items: unknown[], validate: (id: string, item: unknown) => boolean): boolean => {
      const seen = new Set<string>();
      for (const pair of items) {
        if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== "string" || !playerIds.has(pair[0]) || seen.has(pair[0]) || !validate(pair[0], pair[1])) return false;
        seen.add(pair[0]);
      }
      return seen.size === playerIds.size;
    };
    if (!pairs(value.colors, (_id, entry) => isApprovedSurfaceLaserColor(entry))
      || !pairs(value.lastInputSequences, (_id, entry) => typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 0)
      || !pairs(value.lastFireRequestSequences, (_id, entry) => typeof entry === "number" && Number.isSafeInteger(entry) && entry >= 0)) return false;

    const arenaKeys = new Set<string>();
    for (const item of value.world.arenas) {
      const view = item?.view;
      if (!view || !validSurfaceArenaPayload(view) || arenaKeys.has(view.key)
        || (item.pending?.value != null && !validSurfaceArenaPayload({ ...item.pending.value, acceptingPlayers: true }))) return false;
      arenaKeys.add(view.key);
    }
    const arenaKeysWithProjectiles = new Set(arenaKeys);
    const projectileIds = new Set<string>();
    for (const item of value.projectiles) {
      const shot = item?.shot;
      if (!isRecord(item) || !isRecord(shot) || typeof shot.id !== "string" || shot.id.length > 80
        || !playerIds.has(shot.ownerId) || !Number.isSafeInteger(shot.sequence) || shot.sequence < 1
        || shot.id !== `${shot.ownerId}:${shot.sequence}` || projectileIds.has(shot.id)
        || !Number.isSafeInteger(shot.lifeId) || shot.lifeId < 1 || typeof shot.arenaKey !== "string" || !arenaKeysWithProjectiles.has(shot.arenaKey)
        || !finiteTuple(shot.position, 3, (value.world.arenas.find(arena => arena.view.key === shot.arenaKey)?.view.arena.radius ?? 27) + SURFACE_BLASTER.boltRange + 5) || !normalizedDirection(shot.direction)
        || !Number.isFinite(shot.travelled) || shot.travelled < 0 || shot.travelled > SURFACE_BLASTER.boltRange
        || (shot.kind !== undefined && shot.kind !== "normal" && shot.kind !== "charged") || !isApprovedSurfaceLaserColor(shot.color) || !Number.isSafeInteger(shot.startedAt) || !Number.isSafeInteger(shot.stoppedAt)
        || !Number.isFinite(item.ageMs) || item.ageMs < 0 || item.ageMs > SURFACE_BLASTER.boltLifetimeMs
        || !Number.isFinite(item.stoppedRemainingMs) || item.stoppedRemainingMs < 0 || item.stoppedRemainingMs > 90
        || !Number.isFinite(item.rewindMs) || item.rewindMs < 0 || item.rewindMs > 150) return false;
      projectileIds.add(shot.id);
    }
    if (value.projectileSequence < value.projectiles.length) return false;

    const candidateWorld = new SurfaceWorld(this.options);
    if (!candidateWorld.restoreCheckpoint(value.world, now, ageMs)) return false;
    if (!this.world.restoreCheckpoint(value.world, now, ageMs, true)) return false;

    this.colors.clear(); this.lastInputSequence.clear(); this.lastFireRequestSequence.clear(); this.inputs.clear();
    for (const [id, laserColor] of value.colors as Array<[string, string]>) this.colors.set(id, laserColor);
    for (const [id, sequence] of value.lastInputSequences as Array<[string, number]>) {
      this.lastInputSequence.set(id, sequence); this.inputs.set(id, new SurfaceInputBuffer(sequence));
    }
    for (const [id, sequence] of value.lastFireRequestSequences as Array<[string, number]>) this.lastFireRequestSequence.set(id, sequence);
    this.projectiles.length = 0;
    for (const item of value.projectiles as SurfaceAuthorityCheckpoint["projectiles"]) {
      const totalAge = item.ageMs + ageMs;
      const stoppedRemaining = item.stoppedRemainingMs - ageMs;
      if (totalAge >= SURFACE_BLASTER.boltLifetimeMs || item.shot.travelled >= SURFACE_BLASTER.boltRange || (item.shot.stoppedAt > 0 && stoppedRemaining <= 0)) continue;
      this.projectiles.push({ ...item.shot, position: [...item.shot.position], direction: [...item.shot.direction],
        startedAt: now - totalAge, stoppedAt: item.shot.stoppedAt > 0 ? now + stoppedRemaining : 0, rewindMs: 0, simulatedAt: now });
    }
    this.projectileSequence = value.projectileSequence;
    this.connectionTiming.clear();
    this.departureGridDirty = true;
    this.history.clear(); this.eliminations.length = 0; this.damageCues.length = 0; this.hitConfirmations.length = 0;
    return true;
  }

  drainEliminations(): SurfaceElimination[] { const items = this.eliminations.splice(0); return items; }

  private stepProjectiles(dt: number, now: number): void {
    for (let index = this.projectiles.length - 1; index >= 0; index--) {
      const shot = this.projectiles[index];
      if (shot.stoppedAt) {
        if (now >= shot.stoppedAt) this.projectiles.splice(index, 1);
        continue;
      }
      if (now <= shot.simulatedAt) continue;
      const stepAt = Math.min(now, shot.startedAt + SURFACE_BLASTER.boltLifetimeMs);
      if (stepAt <= shot.simulatedAt || now - shot.simulatedAt > 100 || shot.travelled >= SURFACE_BLASTER.boltRange) { this.projectiles.splice(index, 1); continue; }
      const arena = this.world.getArena(shot.arenaKey);
      if (!arena) { this.projectiles.splice(index, 1); continue; }
      const distance = Math.min(SURFACE_BLASTER.boltSpeed * (stepAt - shot.simulatedAt) / 1000, SURFACE_BLASTER.boltRange - shot.travelled);
      const end = add(shot.position, scale(shot.direction, distance));
      const targetFrames = this.world.listPlayers().flatMap(player => {
        if (player.mode !== "surface" || player.arenaKey !== shot.arenaKey || !player.surface || player.health <= 0) return [];
        const frame = this.history.sample(player.id, stepAt - shot.rewindMs, shot.arenaKey, player.lifeId, arena.revision);
        return frame ? [{ player, frame }] : [];
      });
      const targets: SurfaceCombatTarget[] = targetFrames.map(({ player, frame }) => ({ id: player.id, state: frame.state, health: player.health, protected: frame.protected }));
      const bots = this.world.listBots().filter(bot => bot.arenaKey === shot.arenaKey && bot.health > 0);
      for (const bot of bots) targets.push({ id: bot.id, state: bot.state, health: bot.health, protected: false });
      const hit = traceSurfaceSegment(shot.position, end, arena.arena.walls, targets, shot.ownerId, arena.arena.radius ?? SURFACE.radius);
      if (hit) {
        shot.position = hit.position; shot.travelled += distance * hit.t; shot.stoppedAt = now + 90;
        if (hit.kind === "player" && hit.id) {
          const bot = bots.find(candidate => candidate.id === hit.id);
          const damage = bot ? this.world.damageBot(hit.id, shot.ownerId, surfaceShotDamage(shot.kind), now)
            : this.world.damage(hit.id, shot.ownerId, surfaceShotDamage(shot.kind), now);
          if (damage.applied > 0) {
            const direction = unit(scale(shot.direction, -1));
            const eventId = `${now}:${shot.id}:${hit.id}`;
            this.damageCues.push({ id: eventId, targetId: hit.id, at: now, direction });
            this.hitConfirmations.push({ id: eventId, ownerId: shot.ownerId, targetId: hit.id, sequence: shot.sequence, at: now });
          }
          if (damage.killed && !bot) this.eliminations.push({ id: `${now}:${shot.id}:${hit.id}`, attackerId: shot.ownerId, victimId: hit.id, at: now });
        }
      } else { shot.position = end; shot.travelled += distance; }
      shot.simulatedAt = stepAt;
      if (!hit && (stepAt >= shot.startedAt + SURFACE_BLASTER.boltLifetimeMs || shot.travelled >= SURFACE_BLASTER.boltRange)) this.projectiles.splice(index, 1);
    }
  }

  private projectileView(shot: RuntimeProjectile): SurfaceProjectileSnapshot {
    return { id: shot.id, ownerId: shot.ownerId, sequence: shot.sequence, lifeId: shot.lifeId, arenaKey: shot.arenaKey,
      kind: shot.kind ?? "normal", position: [...shot.position], direction: [...shot.direction], travelled: shot.travelled, color: shot.color, startedAt: shot.startedAt, stoppedAt: shot.stoppedAt };
  }

  private captureCenters(players: readonly SurfacePlayerView[]): Map<string, Vec3> {
    const result = new Map<string, Vec3>();
    for (const player of players) if (player.arenaKey) {
      const arena = this.world.getArena(player.arenaKey);
      if (arena) result.set(player.arenaKey, [...arena.center]);
    }
    return result;
  }

  private restoreWorldShips(previous: readonly SurfacePlayerView[], centers: ReadonlyMap<string, Vec3>): void {
    for (const old of previous) {
      if (old.mode !== "surface" || !old.arenaKey) continue;
      const current = this.world.getPlayer(old.id);
      if (current?.mode !== "ship") continue;
      const center = centers.get(old.arenaKey) ?? this.world.getArena(old.arenaKey)?.center;
      if (center) this.world.setShipPose(old.id, this.toWorldShip(current.ship, center));
    }
  }

  private toSurfaceShip(ship: SurfaceShipState, center: Vec3): SurfaceShipState {
    return {
      position: ship.position.map((value, axis) => center[axis] + (value - center[axis]) * WORLD_TO_SURFACE) as Vec3,
      // A successful docking parks the ship and the eventual return starts at rest.
      rotation: [...ship.rotation], velocity: [0, 0, 0],
    };
  }

  private toWorldShip(ship: SurfaceShipState, center: Vec3): SurfaceShipState {
    const scaleToWorld = 1 / WORLD_TO_SURFACE;
    if (this.departureGridDirty) {
      const arenas = this.world.listArenas().flatMap(arena => arena.center);
      this.departureGrid.rebuild([...this.departurePositions.values(), new Float32Array(arenas)], [...[...this.departurePositions.keys()].map(id => this.departureRadii.get(id) ?? []), this.world.listArenas().map(arena => (arena.arena.radius ?? 27) * 6 / 27)]); this.departureGridDirty = false;
    }
    const origin = new THREE.Vector3(...center), offset = new THREE.Vector3(...ship.position).sub(origin).multiplyScalar(scaleToWorld);
    const position = this.departureGrid.clearPointOnRay(origin, offset, offset.length());
    return {
      position: position.toArray() as Vec3,
      rotation: [...ship.rotation], velocity: [0, 0, 0],
    };
  }

}

/** Defensive payload validation used by every peer before rendering host snapshots. */
export function validSurfaceNetworkSnapshot(value: unknown, epoch?: number): value is SurfaceNetworkSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as SurfaceNetworkSnapshot;
  if (!Number.isSafeInteger(snapshot.epoch) || snapshot.epoch < 1 || (epoch !== undefined && snapshot.epoch !== epoch)
    || !Number.isSafeInteger(snapshot.sequence) || snapshot.sequence < 1 || !Number.isSafeInteger(snapshot.hostTime)
    || !Array.isArray(snapshot.players) || snapshot.players.length > 4 || !Array.isArray(snapshot.arenas) || snapshot.arenas.length > 4 + 128
      || !Array.isArray(snapshot.projectiles) || snapshot.projectiles.length > 128
      || !Array.isArray(snapshot.pickups) || snapshot.pickups.length !== snapshot.arenas.length * 6
      || !Array.isArray(snapshot.bots) || snapshot.bots.length > MAX_SURFACE_BOTS
      || !Array.isArray(snapshot.botShots) || snapshot.botShots.length > MAX_SURFACE_BOT_SHOTS
      || !Array.isArray(snapshot.botDrops) || snapshot.botDrops.length > MAX_SURFACE_BOT_DROPS
      || !Array.isArray(snapshot.damageCues) || snapshot.damageCues.length > 64
      || !Array.isArray(snapshot.hitConfirmations) || snapshot.hitConfirmations.length > 64) return false;
  const ids = new Set<string>(), arenaKeys = new Set<string>();
  for (const arena of snapshot.arenas) {
    if (!arena || typeof arena.key !== "string" || arena.key !== `${arena.ownerId}/${arena.hubId}` || arenaKeys.has(arena.key)
      || !/^[0-9a-f-]{36}$/i.test(arena.ownerId) || !/^n-[0-9a-f-]{36}$/i.test(arena.hubId)
      || !Number.isSafeInteger(arena.revision) || arena.revision < 1 || !Array.isArray(arena.center) || arena.center.length !== 3
      || !arena.center.every(number => Number.isFinite(number) && Math.abs(number) <= 1_000_000) || typeof arena.acceptingPlayers !== "boolean"
      || !validArenaPayload(arena)) return false;
    arenaKeys.add(arena.key);
  }
  for (const player of snapshot.players) {
    if (!player || typeof player.id !== "string" || !/^[0-9a-f-]{36}$/i.test(player.id) || ids.has(player.id)
      || !Number.isSafeInteger(player.lifeId) || player.lifeId < 1 || !["ship", "surface"].includes(player.mode)
      || !Number.isSafeInteger(player.inputSequence) || player.inputSequence < 0
      || (player.arenaKey !== null && (!arenaKeys.has(player.arenaKey) || !snapshot.arenas.some(arena => arena.key === player.arenaKey)))
      || !Number.isFinite(player.health) || player.health < 0 || player.health > 100 || !Number.isFinite(player.armor) || player.armor < 0 || player.armor > 50
      || !Number.isSafeInteger(player.kills) || player.kills < 0 || player.kills > PLAYER_KILLS_TO_WIN || !Number.isSafeInteger(player.deaths) || player.deaths < 0
      || !Number.isSafeInteger(player.protectedUntil) || player.protectedUntil < 0 || !Number.isSafeInteger(player.respawnAt) || player.respawnAt < 0
      || !Number.isFinite(player.exitProgress) || player.exitProgress < 0 || player.exitProgress > 1
      || !Number.isFinite(player.heat) || player.heat < 0 || player.heat > 100 || !Number.isSafeInteger(player.ventUntil)
      || !isRecord(player.ship) || !finiteTuple(player.ship.position, 3) || !finiteTuple(player.ship.rotation, 4, 1.1)
      || Math.abs(Math.hypot(...player.ship.rotation) - 1) > 0.02 || !finiteTuple(player.ship.velocity, 3, 10_000)
      || (player.mode === "surface" && (typeof player.arenaKey !== "string" || !validSurfaceState(player.surface) || (player.surface.radius ?? 27) !== (snapshot.arenas.find(arena => arena.key === player.arenaKey)?.arena.radius ?? 27) || player.surface.terrainHash !== snapshot.arenas.find(arena=>arena.key===player.arenaKey)?.arena.terrain?.hash))
      || (player.mode === "ship" && (player.arenaKey !== null || player.surface !== null)) || !isApprovedSurfaceLaserColor(player.laserColor)) return false;
    ids.add(player.id);
  }
  const bots = new Map<string, SurfaceBotView>(), botIndexes = new Map<string, Set<number>>();
  for (const bot of snapshot.bots) {
    const arena = snapshot.arenas.find(item => item.key === bot?.arenaKey);
    if (!bot || !arena || !Number.isSafeInteger(bot.index) || bot.index < 0 || bot.index > 3 || bot.id !== bot.arenaKey + "/bot-" + bot.index
      || bots.has(bot.id) || !Number.isSafeInteger(bot.lifeId) || bot.lifeId < 1 || !validSurfaceState(bot.state)
      || (bot.state.radius ?? SURFACE.radius) !== (arena.arena.radius ?? SURFACE.radius) || bot.state.terrainHash !== arena.arena.terrain?.hash
      || !Number.isFinite(bot.health) || bot.health < 0 || bot.health > 100 || typeof bot.aggressive !== "boolean" || typeof bot.targetId !== "string"
      || (bot.targetId !== "" && (!snapshot.players.some(player => player.id === bot.targetId && player.mode === "surface" && player.arenaKey === bot.arenaKey && player.health > 0)))
      || (bot.aggressive !== (bot.targetId !== "")) || !Number.isSafeInteger(bot.respawnAt)
      || (bot.health > 0 ? bot.respawnAt !== 0 : bot.respawnAt <= snapshot.hostTime || bot.respawnAt > snapshot.hostTime + 15_000)) return false;
    const indexes = botIndexes.get(bot.arenaKey) ?? new Set<number>();
    if (indexes.has(bot.index)) return false;
    indexes.add(bot.index); botIndexes.set(bot.arenaKey, indexes); bots.set(bot.id, bot);
  }
  for (const arena of snapshot.arenas) {
    const occupied = snapshot.players.some(player => player.mode === "surface" && player.arenaKey === arena.key);
    if (occupied && (botIndexes.get(arena.key)?.size !== 4 || [0, 1, 2, 3].some(index => !botIndexes.get(arena.key)?.has(index)))) return false;
  }
  const botShotIds = new Set<string>();
  for (const shot of snapshot.botShots) {
    const bot = shot && bots.get(shot.botId), arena = shot && snapshot.arenas.find(item => item.key === shot.arenaKey);
    if (!bot || bot.health <= 0 || !arena || shot.arenaKey !== bot.arenaKey || !Number.isSafeInteger(shot.sequence) || shot.sequence < 1
      || shot.id !== bot.id + ":" + bot.lifeId + ":" + shot.sequence || botShotIds.has(shot.id)
      || !finiteTuple(shot.position, 3, (arena.arena.radius ?? SURFACE.radius) + 35) || !normalizedDirection(shot.direction)
      || !Number.isFinite(shot.travelled) || shot.travelled < 0 || shot.travelled > 30 || !Number.isSafeInteger(shot.startedAt)
      || snapshot.hostTime - shot.startedAt < 0 || snapshot.hostTime - shot.startedAt > 250
      || !Number.isSafeInteger(shot.stoppedAt) || shot.stoppedAt < 0 || (shot.stoppedAt !== 0 && shot.stoppedAt < snapshot.hostTime)) return false;
    botShotIds.add(shot.id);
  }
  const botDropIds = new Set<string>();
  for (const drop of snapshot.botDrops) {
    const arena = drop && snapshot.arenas.find(item => item.key === drop.arenaKey);
    if (!arena || typeof drop.id !== "string" || !/^bot-drop-\d+$/.test(drop.id) || botDropIds.has(drop.id)
      || !finiteTuple(drop.position, 3, (arena.arena.radius ?? SURFACE.radius) + 0.02) || Math.abs(Math.hypot(...drop.position) - (arena.arena.radius ?? SURFACE.radius)) > 0.02
      || drop.heal !== 30 || drop.available !== true || !Number.isSafeInteger(drop.expiresAt) || drop.expiresAt <= snapshot.hostTime
      || drop.expiresAt > snapshot.hostTime + 30_000) return false;
    botDropIds.add(drop.id);
  }
  if (!validCoverPackets(snapshot.cover, snapshot.arenas)) return false;
  const pickupKeys = new Set<string>();
  for (const pickup of snapshot.pickups) {
    if (!isRecord(pickup) || typeof pickup.id !== "string" || typeof pickup.arenaKey !== "string") return false;
    const definition = snapshot.arenas.find(arena => arena.key === pickup.arenaKey)?.arena.pickups.find(item => item.id === pickup.id);
    const key = `${pickup.arenaKey}/${pickup.id}`;
    if (!definition || pickupKeys.has(key) || typeof pickup.available !== "boolean" || !Number.isSafeInteger(pickup.respawnAt)
      || (pickup.available ? pickup.respawnAt !== 0 : pickup.respawnAt <= snapshot.hostTime || pickup.respawnAt > snapshot.hostTime + definition.respawnMs)) return false;
    pickupKeys.add(key);
  }
  for (const shot of snapshot.projectiles) {
    if (!shot || typeof shot.id !== "string" || shot.id.length > 80 || !ids.has(shot.ownerId) || !Number.isSafeInteger(shot.sequence) || shot.sequence < 1
      || !Number.isSafeInteger(shot.lifeId) || !arenaKeys.has(shot.arenaKey) || !Array.isArray(shot.position) || shot.position.length !== 3
      || !shot.position.every(number => Number.isFinite(number) && Math.abs(number) <= (snapshot.arenas.find(arena => arena.key === shot.arenaKey)?.arena.radius ?? SURFACE.radius) + SURFACE_BLASTER.boltRange + 5) || !normalizedDirection(shot.direction)
      || !Number.isFinite(shot.travelled) || shot.travelled < 0 || shot.travelled > SURFACE_BLASTER.boltRange
      || (shot.kind !== undefined && shot.kind !== "normal" && shot.kind !== "charged") || !isApprovedSurfaceLaserColor(shot.color) || !Number.isSafeInteger(shot.startedAt) || !Number.isSafeInteger(shot.stoppedAt)) return false;
  }
  const cueIds = new Set<string>();
  for (const cue of snapshot.damageCues) {
    if (!isRecord(cue) || typeof cue.id !== "string" || cue.id.length > 160 || cueIds.has(cue.id) || (!ids.has(cue.targetId) && !bots.has(cue.targetId))
      || !Number.isSafeInteger(cue.at) || snapshot.hostTime - cue.at < 0 || snapshot.hostTime - cue.at > 1500
      || !normalizedDirection(cue.direction)) return false;
    cueIds.add(cue.id);
  }
  const hitIds = new Set<string>();
  for (const hit of snapshot.hitConfirmations) {
    if (!isRecord(hit) || typeof hit.id !== "string" || hit.id.length > 160 || hitIds.has(hit.id) || !ids.has(hit.ownerId) || (!ids.has(hit.targetId) && !bots.has(hit.targetId))
      || !Number.isSafeInteger(hit.sequence) || hit.sequence < 1 || !Number.isSafeInteger(hit.at)
      || snapshot.hostTime - hit.at < 0 || snapshot.hostTime - hit.at > 1500) return false;
    hitIds.add(hit.id);
  }
  return true;
}
