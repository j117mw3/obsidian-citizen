import { PILOT_DOCK_RANGE_WORLD_UNITS } from "./docking";
import { bindSurfaceTerrain, validTerrainDefinition, terrainHeight } from "./surfaceTerrain";
import { SurfaceCoverMotion } from "./surfaceCover";
import { generateDirectedSurfaceArena, surfaceRadiusForConnections } from "./surfaceGeometry";
import { SURFACE, SURFACE_PARKING_NORMALS, type SurfaceArena, type SurfaceVector, type SurfaceBotView, type SurfaceBotShotView, type SurfaceBotDropView } from "./surface";
import { createSurfacePlayerState, stepSurfacePlayer, surfacePoseClear, validSurfacePlayerState as validSurfaceState, type SurfaceInput, type SurfacePlayerState } from "./surfacePhysics";
import { SURFACE_CHARGE, type SurfaceShotKind, SURFACE_BLASTER, spreadSurfaceDirection, surfaceSeed, traceSurfaceSegment, type SurfaceCombatTarget } from "./surfaceCombat";
import { createSurfacePatrol, stepSurfacePatrol, type SurfacePatrol } from "./surfacePatrol";
import { surfaceViewPose } from "./surfaceView";
import { PLAYER_KILLS_TO_WIN } from "./rounds";

type Vec3 = [number, number, number];
type Quaternion = [number, number, number, number];
// Four owners may each publish up to 128 groups. Pickup timers can outlive occupation.
export const MAX_SURFACE_CHECKPOINT_ARENAS = 4 * 128;
export const BOT_HEALTH = 100;
export const BOT_DROP_HEAL = 30;
export const BOT_DROP_LIFETIME_MS = 30_000;
export const BOT_RESPAWN_MS = 15_000;

export interface SurfaceTopology {
  revision: number;
  nodes: Array<{ id: string; group: number; degree: number; dockable: boolean }>;
  links: Array<[string, string]>;
}
export interface SurfaceShipState { position: Vec3; rotation: Quaternion; velocity: Vec3 }
export interface SurfacePlayerView {
  id: string;
  /** Changes whenever the player crosses a death, docking, or evacuation boundary. */
  lifeId: number;
  mode: "ship" | "surface";
  arenaKey: string | null;
  surface: SurfacePlayerState | null;
  health: number;
  armor: number;
  kills: number;
  deaths: number;
  protectedUntil: number;
  respawnAt: number;
  exitProgress: number;
  heat: number;
  ventUntil: number;
  ship: SurfaceShipState;
}
export interface SurfaceDamageResult { applied: number; killed: boolean; attackerHealth: number | null }
export interface SurfacePickupView { id: string; available: boolean; respawnAt: number }
export interface SurfaceFireResult { accepted: boolean; heat: number; ventUntil: number }
export interface SurfaceArenaView { key: string; ownerId: string; hubId: string; revision: number; topologyRevision: number; center: Vec3; arena: SurfaceArena; acceptingPlayers: boolean }
export interface SurfaceWorldCheckpoint {
  version: 2;
  players: Array<{
    view: SurfacePlayerView;
    shipDamageAgeMs: number;
    damageLockRemainingMs: number;
    exitPole: 1 | -1;
    exitHeld: number;
    lastFireAgeMs: number;
    lastFireSequence: number;
    lastCoolAgeMs: number;
  }>;
  arenas: Array<{
    view: SurfaceArenaView;
    pickups: Array<{ available: boolean; respawnRemainingMs: number }>;
    pending: { value: Omit<SurfaceArenaView, "acceptingPlayers"> | null } | null;
  }>;
  bots: Array<{
    id: string; index: number; arenaKey: string; lifeId: number; state: SurfacePlayerState; health: number; armor: number; targetId: string;
    lastSeenNormal: Vec3 | null; lastSeenAgeMs: number; pursuitAgeMs: number; reacquireRemainingMs: number; nextShotRemainingMs: number; respawnRemainingMs: number;
    patrol: { home: Vec3; goal: Vec3; leash: number; random: number; wait: number; stuck: number; repath: number; returningHome: boolean; shotSequence: number };
  }>;
  botShots: Array<SurfaceBotShotView & { ageMs: number; simulatedAgeMs: number; stoppedRemainingMs: number }>;
  botDrops: Array<Omit<SurfaceBotDropView, "expiresAt"> & { remainingMs: number }>;
  nextBotDropId: number;
  trainingBotArmor: number;
}

interface PickupRuntime { available: boolean; respawnAt: number }
interface ArenaRuntime extends SurfaceArenaView {
  occupants: Set<string>;
  pickups: PickupRuntime[];
  pending: { value: Omit<SurfaceArenaView, "acceptingPlayers"> | null } | null;
}
interface PlayerRuntime extends SurfacePlayerView { shipLastDamageAt: number; damageLockUntil: number; exitPole: 1 | -1; exitHeld: number; lastFireSequence: number; lastFireAt: number; lastCoolAt: number }
interface BotRuntime {
  id: string; index: number; arenaKey: string; lifeId: number; patrol: SurfacePatrol; health: number; armor: number; targetId: string;
  lastSeenNormal: Vec3 | null; lastSeenAt: number; pursuitStartedAt: number; reacquireUntil: number; nextShotAt: number; respawnAt: number; shotSequence: number;
}
interface BotShotRuntime extends SurfaceBotShotView { simulatedAt: number }
type BotDropRuntime = SurfaceBotDropView;

const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const keyFor = (ownerId: string, hubId: string): string => `${ownerId}/${hubId}`;
const vec = (v: readonly number[]): Vec3 => [v[0], v[1], v[2]];
const length = (v: readonly number[]): number => Math.hypot(v[0], v[1], v[2]);
const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v: readonly number[]): Vec3 => { const n = length(v) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
const angleDistance = (a: readonly number[], b: readonly number[], radius: number = SURFACE.radius): number => radius * Math.acos(clamp(dot(unit(a), unit(b)), -1, 1));
const finiteTuple = (value: unknown, size: number, limit = Infinity): value is number[] => Array.isArray(value) && value.length === size && value.every(item => typeof item === "number" && Number.isFinite(item) && Math.abs(item) <= limit);
const add = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: readonly number[], b: readonly number[]): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: readonly number[], amount: number): Vec3 => [a[0] * amount, a[1] * amount, a[2] * amount];
export const MAX_SURFACE_BOTS = 16;
export const MAX_SURFACE_BOT_SHOTS = 32;
export const MAX_SURFACE_BOT_DROPS = 64;

function validArenaDefinition(arena: unknown, hubId: string): arena is SurfaceArena {
  if (!arena || typeof arena !== "object") return false;
  const value = arena as SurfaceArena;
  if (value.hubId !== hubId || !Number.isSafeInteger(value.seed) || !Array.isArray(value.walls) || value.walls.length > 39_998 || (value.radius ?? SURFACE.radius) !== surfaceRadiusForConnections(value.walls.length / 2)
    || !Array.isArray(value.pickups) || value.pickups.length !== 6) return false;
  if(value.terrain!==undefined&&!validTerrainDefinition(value.terrain,value.radius??27))return false;
  bindSurfaceTerrain(value.walls,value.terrain);
  const wallIds = new Set<string>(), connectionCounts = new Map<string, number>();
  for (const wall of value.walls) {
    if (!wall || typeof wall.id !== "string" || !/^wall-\d+$/.test(wall.id) || wallIds.has(wall.id) || typeof wall.connectionId !== "string" || !wall.connectionId.length || wall.connectionId === hubId || (connectionCounts.get(wall.connectionId) ?? 0) >= 2 || !finiteTuple(wall.normal, 3) || !finiteTuple(wall.tangent, 3)
      || Math.abs(Math.hypot(...wall.normal) - 1) > 0.01 || Math.abs(Math.hypot(...wall.tangent) - 1) > 0.01
      || Math.abs(dot(wall.normal, wall.tangent)) > 0.02 || !([SURFACE.lowWallHeight, SURFACE.tallWallHeight] as number[]).includes(wall.height)
      || !Number.isFinite(wall.length) || wall.length < 1 || wall.length > 10) return false;
    wallIds.add(wall.id); connectionCounts.set(wall.connectionId, (connectionCounts.get(wall.connectionId) ?? 0) + 1);
  }
  if ([...connectionCounts.values()].some(count => count !== 2)) return false;
  const pickupIds = new Set<string>();
  for (const pickup of value.pickups) {
    if (!pickup || typeof pickup.id !== "string" || !/^pickup-\d+$/.test(pickup.id) || pickupIds.has(pickup.id) || !finiteTuple(pickup.normal, 3)
      || Math.abs(Math.hypot(...pickup.normal) - 1) > 0.01 || !["small-health", "large-health", "armor"].includes(pickup.kind)
      || !["cover", "open"].includes(pickup.placement) || !Number.isFinite(pickup.heal) || !Number.isFinite(pickup.armor) || !Number.isSafeInteger(pickup.respawnMs)) return false;
    pickupIds.add(pickup.id);
  }
  return value.pickups.filter(item => item.kind === "small-health").length === 2
    && value.pickups.filter(item => item.kind === "large-health").length === 2 && value.pickups.filter(item => item.kind === "armor").length === 2;
}

function makeArenaView(ownerId: string, topology: SurfaceTopology, positions: Float32Array, hubId: string, terrainEnabled=false): Omit<SurfaceArenaView, "acceptingPlayers"> | null {
  if (!Number.isSafeInteger(topology.revision) || topology.revision < 1 || positions.length !== topology.nodes.length * 3) return null;
  const hubIndex = topology.nodes.findIndex(node => node.id === hubId && node.dockable);
  if (hubIndex < 0) return null;
  const center: Vec3 = [positions[hubIndex * 3], positions[hubIndex * 3 + 1], positions[hubIndex * 3 + 2]];
  if (!center.every(Number.isFinite)) return null;
  const linked = new Set<string>();
  for (const edge of topology.links) {
    if (edge[0] === hubId) linked.add(edge[1]);
    else if (edge[1] === hubId) linked.add(edge[0]);
  }
  linked.delete(hubId);
  const directions = new Map<string, SurfaceVector>();
  topology.nodes.forEach((node, index) => {
    if (linked.has(node.id)) directions.set(node.id, [positions[index * 3] - center[0], positions[index * 3 + 1] - center[1], positions[index * 3 + 2] - center[2]]);
  });
  return { key: keyFor(ownerId, hubId), ownerId, hubId, revision: topology.revision, topologyRevision: topology.revision, center, arena: generateDirectedSurfaceArena(hubId, [...linked].sort(), directions, terrainEnabled) };
}

function spawnCandidates(pole: 1 | -1, radius: number = SURFACE.radius): Vec3[] {
  const result: Vec3[] = [[0, pole, 0]];
  for (const arc of [3, 6, 9, 12]) for (let index = 0; index < 12; index++) {
    const angle = arc / radius;
    const bearing = index * Math.PI / 6;
    const tangentX = Math.sin(bearing) * Math.sin(angle), tangentZ = Math.cos(bearing) * Math.sin(angle);
    result.push([tangentX, pole * Math.cos(angle), tangentZ]);
  }
  return result;
}

/** Host-owned dock, surface movement, pickup, damage, death, and exit state. */
export class SurfaceWorld {
  constructor(readonly options: { terrain?: boolean } = {}) {}
  private readonly players = new Map<string, PlayerRuntime>();
  private readonly arenas = new Map<string, ArenaRuntime>();
  private readonly bots = new Map<string, BotRuntime>();
  private botShots: BotShotRuntime[] = [];
  private botDrops: BotDropRuntime[] = [];
  private nextBotDropId = 0;
  private trainingBotArmor = 0;
  private readonly coverMotion = new Map<string, { revision: number; motion: SurfaceCoverMotion }>();
  private readonly ownerMaps = new Map<string, { topology: SurfaceTopology; positions: Float32Array }>();
  private geometryRevision = 0;
  private readonly preparationErrors=new Set<string>();
  getPreparationError(key:string):string|null {return this.preparationErrors.has(key)?"Planet preparation failed: no accessible combat layout. Try a different main node.":null;}

  addPlayer(id: string, ship: SurfaceShipState): void {
    if (!id || !this.validShip(ship)) return;
    const existing = this.players.get(id);
    if (existing) { existing.ship = this.cloneShip(ship); return; }
    this.players.set(id, { id, lifeId: 1, mode: "ship", arenaKey: null, surface: null, health: 100, armor: 0, kills: 0, deaths: 0, protectedUntil: 0, respawnAt: 0,
      exitProgress: 0, heat: 0, ventUntil: 0, ship: this.cloneShip(ship), shipLastDamageAt: 0, damageLockUntil: 0, exitPole: 1, exitHeld: 0,
      lastFireSequence: 0, lastFireAt: -Infinity, lastCoolAt: 0 });
  }

  removePlayer(id: string): void {
    this.charges.delete(id);
    const player = this.players.get(id);
    if (player?.arenaKey) {
      const arena = this.arenas.get(player.arenaKey);
      arena?.occupants.delete(id);
      if (arena) this.applyPendingIfEmpty(arena);
    }
    this.players.delete(id);
  }

  getPlayer(id: string): SurfacePlayerView | null {
    const player = this.players.get(id);
    if (!player) return null;
    return {
      id: player.id, lifeId: player.lifeId, mode: player.mode, arenaKey: player.arenaKey,
      surface: player.surface ? this.cloneSurface(player.surface) : null,
      health: player.health, armor: player.armor, kills: player.kills, deaths: player.deaths,
      protectedUntil: player.protectedUntil, respawnAt: player.respawnAt, exitProgress: player.exitProgress,
      heat: player.heat, ventUntil: player.ventUntil, ship: this.cloneShip(player.ship),
    };
  }

  listPlayers(): SurfacePlayerView[] { return [...this.players.keys()].map(id => this.getPlayer(id)!).filter(Boolean); }

  getArena(key: string): SurfaceArenaView | null {
    const arena = this.arenas.get(key);
    return arena ? { key: arena.key, ownerId: arena.ownerId, hubId: arena.hubId, revision: arena.revision, topologyRevision: arena.topologyRevision, center: [...arena.center], arena: arena.arena, acceptingPlayers: !arena.pending } : null;
  }

  /** Static layout is transferred once; moving poses travel separately from immutable geometry. */
  getGeometryArena(key: string): SurfaceArenaView | null {
    const view=this.getArena(key),state=this.coverMotion.get(key);
    return view&&state?.revision===view.revision ? {...view,arena:state.motion.base} : view;
  }

  moveCover(dt: number): void {
    for(const [key,arena] of this.arenas) {
      if(!arena.occupants.size)continue;
      const source=this.ownerMaps.get(arena.ownerId);if(!source)continue;
      let state=this.coverMotion.get(key);
      if(!state||state.revision!==arena.revision) {
        state={revision:arena.revision,motion:new SurfaceCoverMotion(arena.arena)};this.coverMotion.set(key,state);
        arena.arena={...arena.arena,walls:state.motion.walls};
      }
      const directions=new Map<string,SurfaceVector>();
      source.topology.nodes.forEach((node,i)=>directions.set(node.id,[source.positions[i*3]-arena.center[0],source.positions[i*3+1]-arena.center[1],source.positions[i*3+2]-arena.center[2]]));
      const players=[...arena.occupants].map(id=>this.players.get(id)).filter((p):p is PlayerRuntime=>!!p?.surface&&p.health>0).map(p=>p.surface!);
      for(const bot of this.bots.values())if(bot.arenaKey===key&&bot.health>0)players.push(bot.patrol.state);
      state.motion.step(directions,players,dt);
    }
    for(const key of this.coverMotion.keys())if(!this.arenas.has(key))this.coverMotion.delete(key);
  }

  listArenas(): SurfaceArenaView[] { return [...this.arenas.values()].map(arena => this.getArena(arena.key)!).filter(Boolean); }

  getPickups(key: string, now: number): SurfacePickupView[] {
    const arena = this.arenas.get(key);
    if (!arena) return [];
    return arena.pickups.map((runtime, index) => {
      if (!runtime.available && now >= runtime.respawnAt) { runtime.available = true; runtime.respawnAt = 0; }
      return { id: arena.arena.pickups[index].id, available: runtime.available, respawnAt: runtime.respawnAt };
    });
  }

  listBots(): SurfaceBotView[] {
    return [...this.bots.values()].map(bot => ({ id: bot.id, index: bot.index, arenaKey: bot.arenaKey, lifeId: bot.lifeId,
      state: this.cloneSurface(bot.patrol.state), health: bot.health, armor: bot.armor, aggressive: !!bot.targetId, targetId: bot.targetId, respawnAt: bot.respawnAt }));
  }

  /** Preserve the existing solo training reset without changing ordinary or network bot difficulty. */
  resetTrainingBots(armor: number, now = Date.now()): void {
    this.trainingBotArmor = clamp(Number.isFinite(armor) ? armor : 0, 0, 50);
    const arenas = new Set<string>();
    for (const bot of this.bots.values()) {
      const arena = this.arenas.get(bot.arenaKey);
      if (arena?.occupants.size) {
        this.bots.set(bot.id, this.createBot(arena, bot.index, bot.id, bot.lifeId, now));
        arenas.add(arena.key);
      }
    }
    this.botShots = this.botShots.filter(shot => !arenas.has(shot.arenaKey));
  }

  listBotShots(): SurfaceBotShotView[] { return this.botShots.map(shot => ({ ...shot, position: [...shot.position], direction: [...shot.direction] })); }

  listBotDrops(now: number): SurfaceBotDropView[] {
    this.botDrops = this.botDrops.filter(drop => drop.expiresAt > now && !!this.arenas.get(drop.arenaKey)?.occupants.size);
    return this.botDrops.map(drop => ({ ...drop, position: [...drop.position] }));
  }

  /** Host and solo use the same deterministic patrol, pursuit, and firing simulation. */
  stepBots(dt: number, now: number): Array<{ id: string; targetId: string; at: number; direction: Vec3 }> {
    if (!(dt > 0) || dt > 0.1 || !Number.isFinite(now)) return [];
    const cues: Array<{ id: string; targetId: string; at: number; direction: Vec3 }> = [];
    for (const bot of this.bots.values()) {
      const arena = this.arenas.get(bot.arenaKey);
      if (!arena?.occupants.size) continue;
      if (bot.health <= 0) {
        if (bot.respawnAt > 0 && now >= bot.respawnAt) this.respawnBot(bot, arena, now);
        continue;
      }
      const visible = this.visiblePlayers(bot, arena);
      let target = bot.targetId ? this.players.get(bot.targetId) : undefined;
      if (target && (target.mode !== "surface" || target.arenaKey !== bot.arenaKey || target.health <= 0)) target = undefined;
      if (bot.targetId && (!target || now - bot.pursuitStartedAt >= 10_000 || now - bot.lastSeenAt >= 4000)) {
        this.loseBotTarget(bot, now); target = undefined;
      }
      if (!target && now >= bot.reacquireUntil && visible.length) {
        target = visible[0].player; bot.targetId = target.id; bot.pursuitStartedAt = now; bot.lastSeenAt = now;
        bot.lastSeenNormal = unit([...target.surface!.position]); bot.nextShotAt = now + 1000;
      }
      const sighted = target ? visible.find(item => item.player.id === target.id) : undefined;
      if (target && sighted) { bot.lastSeenAt = now; bot.lastSeenNormal = unit([...target.surface!.position]); }
      if (target && bot.lastSeenNormal) {
        bot.patrol.goal = [...bot.lastSeenNormal]; bot.patrol.repath = 1;
      }
      bot.patrol.state = stepSurfacePatrol(bot.patrol, arena.arena, dt, target ? 0.36 : 0.48);
      if (!target || !sighted || now < bot.nextShotAt) continue;
      const muzzle = surfaceViewPose(bot.patrol.state).muzzle;
      const targetEye = surfaceViewPose(target.surface!).eye;
      const aim = unit(sub(targetEye, muzzle));
      const forward = unit(bot.patrol.state.forward);
      if (dot(aim, forward) < Math.cos(15 * Math.PI / 180)) continue;
      const sequence = ++bot.shotSequence, direction = spreadSurfaceDirection(aim, 10, surfaceSeed(bot.id, sequence));
      const id = `${bot.id}:${bot.lifeId}:${sequence}`;
      if (this.botShots.length < MAX_SURFACE_BOT_SHOTS) this.botShots.push({ id, botId: bot.id, arenaKey: bot.arenaKey, sequence, position: muzzle, direction, travelled: 0, startedAt: now, stoppedAt: 0, simulatedAt: now });
      bot.nextShotAt = now + 1000;
    }
    this.expireBotDrops(now);
    for (let index = this.botShots.length - 1; index >= 0; index--) {
      const shot = this.botShots[index];
      if (shot.stoppedAt) { if (now >= shot.stoppedAt) this.botShots.splice(index, 1); continue; }
      const elapsed = Math.max(0, Math.min(dt, (now - shot.simulatedAt) / 1000));
      if (!elapsed) continue;
      const arena = this.arenas.get(shot.arenaKey);
      if (!arena) { this.botShots.splice(index, 1); continue; }
      const distance = Math.min(120 * elapsed, 30 - shot.travelled), start = [...shot.position] as Vec3, end = add(start, scale(shot.direction, distance));
      const targets: SurfaceCombatTarget[] = this.listPlayers().filter(player => player.mode === "surface" && player.arenaKey === shot.arenaKey && !!player.surface && player.health > 0)
        .map(player => ({ id: player.id, state: player.surface!, health: player.health, protected: player.protectedUntil > now }));
      const hit = traceSurfaceSegment(start, end, arena.arena.walls, targets, shot.botId, arena.arena.radius ?? SURFACE.radius);
      if (hit) {
        shot.position = hit.position; shot.travelled += distance * hit.t; shot.stoppedAt = now + 90;
        if (hit.kind === "player" && hit.id) {
          const damage = this.damageFromBot(hit.id, shot.botId, SURFACE_BLASTER.damage, now);
          if (damage.applied > 0) cues.push({ id: `${shot.id}:${hit.id}:${now}`, targetId: hit.id, at: now, direction: unit(scale(shot.direction, -1)) });
        }
      } else { shot.position = end; shot.travelled += distance; }
      shot.simulatedAt = now;
      if (!hit && (shot.travelled >= 30 || now >= shot.startedAt + 250)) this.botShots.splice(index, 1);
    }
    return cues;
  }

  /** Called only at the next shared round; ordinary docking and evacuation never refill resources. */
  resetRound(now = Date.now()): void {
    this.charges.clear();
    for (const player of this.players.values()) {
      player.lifeId++; player.health = 100; player.armor = 0; player.kills = 0; player.deaths = 0;
      player.heat = 0; player.ventUntil = 0; player.respawnAt = 0; player.protectedUntil = now + 3000;
      player.shipLastDamageAt = 0;
      player.damageLockUntil = 0; player.exitHeld = 0; player.exitProgress = 0; player.lastFireAt = -Infinity; player.lastCoolAt = 0;
    }
    for (const arena of this.arenas.values()) for (const pickup of arena.pickups) { pickup.available = true; pickup.respawnAt = 0; }
    this.botShots = []; this.botDrops = []; this.bots.clear();
    for (const arena of this.arenas.values()) if (arena.occupants.size) this.ensureBots(arena, now);
  }

  freezeRound(): void { this.charges.clear(); this.botShots = []; }

  checkpoint(now: number, includeArenaKeys: readonly string[] = []): SurfaceWorldCheckpoint {
    const players = [...this.players.values()].map(player => {
      const view = this.getPlayer(player.id)!;
      view.protectedUntil = Math.max(0, view.protectedUntil - now);
      view.respawnAt = Math.max(0, view.respawnAt - now);
      view.ventUntil = Math.max(0, view.ventUntil - now);
      return {
        view,
        shipDamageAgeMs: player.shipLastDamageAt > 0 ? clamp(now - player.shipLastDamageAt, 0, 60_000) : -1,
        damageLockRemainingMs: clamp(player.damageLockUntil - now, 0, 3000), exitPole: player.exitPole, exitHeld: clamp(player.exitHeld, 0, 2),
        lastFireAgeMs: Number.isFinite(player.lastFireAt) ? clamp(now - player.lastFireAt, 0, 60_000) : -1,
        lastFireSequence: player.lastFireSequence, lastCoolAgeMs: clamp(now - player.lastCoolAt, 0, 60_000),
      };
    });
    const included = new Set(includeArenaKeys);
    for (const arena of this.arenas.values()) this.getPickups(arena.key, now);
    const arenas = [...this.arenas.values()].filter(arena => arena.occupants.size > 0 || !!arena.pending || arena.pickups.some(pickup => !pickup.available) || included.has(arena.key)).map(arena => ({
        view: {
        key: arena.key, ownerId: arena.ownerId, hubId: arena.hubId, revision: arena.revision, topologyRevision: arena.topologyRevision, center: [...arena.center] as Vec3,
        arena: { ...arena.arena, walls: arena.arena.walls.map(wall => ({ ...wall, normal: vec(wall.normal), tangent: vec(wall.tangent) })), pickups: arena.arena.pickups.map(pickup => ({ ...pickup, normal: vec(pickup.normal) })) },
        acceptingPlayers: !arena.pending,
      },
        pickups: arena.pickups.map(pickup => ({ available: pickup.available, respawnRemainingMs: pickup.available ? 0 : clamp(pickup.respawnAt - now, 0, 60_000) })),
      pending: arena.pending ? { value: arena.pending.value ? { ...arena.pending.value, center: [...arena.pending.value.center] as Vec3 } : null } : null,
    }));
    const bots = [...this.bots.values()].map(bot => ({ id: bot.id, index: bot.index, arenaKey: bot.arenaKey, lifeId: bot.lifeId, state: this.cloneSurface(bot.patrol.state), health: bot.health, armor: bot.armor,
      targetId: bot.targetId, lastSeenNormal: bot.lastSeenNormal ? [...bot.lastSeenNormal] as Vec3 : null,
      lastSeenAgeMs: bot.targetId ? clamp(now - bot.lastSeenAt, 0, 10_000) : 0, pursuitAgeMs: bot.targetId ? clamp(now - bot.pursuitStartedAt, 0, 10_000) : 0,
      reacquireRemainingMs: clamp(bot.reacquireUntil - now, 0, 3000), nextShotRemainingMs: bot.targetId ? clamp(bot.nextShotAt - now, 0, 1000) : 0,
      respawnRemainingMs: bot.respawnAt ? clamp(bot.respawnAt - now, 0, BOT_RESPAWN_MS) : 0,
      patrol: { home: [...bot.patrol.home] as Vec3, goal: [...bot.patrol.goal] as Vec3, leash: bot.patrol.leash, random: bot.patrol.random >>> 0,
        wait: bot.patrol.wait, stuck: bot.patrol.stuck, repath: bot.patrol.repath, returningHome: bot.patrol.returningHome, shotSequence: bot.shotSequence } }));
    const botShots = this.botShots.map(({ simulatedAt, ...shot }) => ({ ...shot, position: [...shot.position] as Vec3, direction: [...shot.direction] as Vec3,
      ageMs: clamp(now - shot.startedAt, 0, 250), simulatedAgeMs: clamp(now - simulatedAt, 0, 100), stoppedRemainingMs: shot.stoppedAt ? clamp(shot.stoppedAt - now, 0, 90) : 0 }));
    const botDrops = this.listBotDrops(now).map(drop => ({ id: drop.id, arenaKey: drop.arenaKey, position: [...drop.position] as Vec3, heal: drop.heal,
      available: drop.available, remainingMs: clamp(drop.expiresAt - now, 0, BOT_DROP_LIFETIME_MS) }));
    return { version: 2, players, arenas, bots, botShots, botDrops, nextBotDropId: this.nextBotDropId, trainingBotArmor: this.trainingBotArmor };
  }

  restoreCheckpoint(value: unknown, now: number, ageMs = 0, mergeStaticArenas = false): boolean {
    if (!value || typeof value !== "object" || !Number.isSafeInteger(now) || !Number.isFinite(ageMs) || ageMs < 0 || ageMs > 15_000) return false;
    const checkpoint = value as SurfaceWorldCheckpoint;
    if (checkpoint.version !== 2 || !Array.isArray(checkpoint.players) || checkpoint.players.length > 4 || !Array.isArray(checkpoint.arenas) || checkpoint.arenas.length > MAX_SURFACE_CHECKPOINT_ARENAS
      || !Array.isArray(checkpoint.bots) || checkpoint.bots.length > MAX_SURFACE_BOTS || !Array.isArray(checkpoint.botShots) || checkpoint.botShots.length > MAX_SURFACE_BOT_SHOTS
      || !Array.isArray(checkpoint.botDrops) || checkpoint.botDrops.length > MAX_SURFACE_BOT_DROPS || !Number.isSafeInteger(checkpoint.nextBotDropId) || checkpoint.nextBotDropId < 0
      || !Number.isFinite(checkpoint.trainingBotArmor) || checkpoint.trainingBotArmor < 0 || checkpoint.trainingBotArmor > 50) return false;
    const nextArenas = new Map<string, ArenaRuntime>();
    for (const item of checkpoint.arenas) {
      const view = item?.view;
      if (!view || typeof view.key !== "string" || typeof view.ownerId !== "string" || !view.ownerId || typeof view.hubId !== "string" || !view.hubId
        || view.key !== keyFor(view.ownerId, view.hubId) || nextArenas.has(view.key) || !Number.isSafeInteger(view.revision) || view.revision < 1
        || !Number.isSafeInteger(view.topologyRevision) || view.topologyRevision < 1
        || !finiteTuple(view.center, 3) || view.center.some(number => Math.abs(number) > 1_000_000) || typeof view.acceptingPlayers !== "boolean"
        || !validArenaDefinition(view.arena, view.hubId) || !Array.isArray(item.pickups) || item.pickups.length !== view.arena.pickups.length
        || item.pickups.some(pickup => !pickup || typeof pickup.available !== "boolean" || !Number.isFinite(pickup.respawnRemainingMs) || pickup.respawnRemainingMs < 0 || pickup.respawnRemainingMs > 60_000)
        || (item.pending !== null && (!item.pending || typeof item.pending !== "object" || (item.pending.value !== null && !this.validPendingArena(item.pending.value, view.key))))
        || view.acceptingPlayers !== (item.pending === null)) return false;
      const arena: ArenaRuntime = {
        ...view, center: [...view.center] as Vec3, arena: this.cloneArena(view.arena), occupants: new Set(),
        pickups: item.pickups.map(pickup => ({ available: pickup.available, respawnAt: pickup.available ? 0 : now + Math.max(0, pickup.respawnRemainingMs - ageMs) })),
        pending: item.pending ? { value: item.pending.value ? { ...item.pending.value, center: [...item.pending.value.center] as Vec3 } : null } : null,
      };
      nextArenas.set(view.key, arena);
    }

    const nextPlayers = new Map<string, PlayerRuntime>();
    for (const item of checkpoint.players) {
      const view = item?.view;
      if (!view || typeof view.id !== "string" || !view.id || view.id.length > 128 || nextPlayers.has(view.id)
        || !Number.isSafeInteger(view.lifeId) || view.lifeId < 1 || (view.mode !== "ship" && view.mode !== "surface")
        || (view.mode === "surface" ? typeof view.arenaKey !== "string" || !nextArenas.has(view.arenaKey) || !validSurfaceState(view.surface) || view.surface.terrainHash !== nextArenas.get(view.arenaKey)?.arena.terrain?.hash : view.arenaKey !== null || view.surface !== null)
        || !Number.isFinite(view.health) || view.health < 0 || view.health > 100 || !Number.isFinite(view.armor) || view.armor < 0 || view.armor > 50
        || !Number.isSafeInteger(view.kills) || view.kills < 0 || view.kills > PLAYER_KILLS_TO_WIN || !Number.isSafeInteger(view.deaths) || view.deaths < 0
        || !Number.isFinite(view.protectedUntil) || view.protectedUntil < 0 || view.protectedUntil > 3000
        || !Number.isFinite(view.respawnAt) || view.respawnAt < 0 || view.respawnAt > 5000
        || !Number.isFinite(view.exitProgress) || view.exitProgress < 0 || view.exitProgress > 1
        || !Number.isFinite(view.heat) || view.heat < 0 || view.heat > 100 || !Number.isFinite(view.ventUntil) || view.ventUntil < 0 || view.ventUntil > 2000
        || !view.ship || !finiteTuple(view.ship.position, 3) || view.ship.position.some(number => Math.abs(number) > 1_000_000)
        || !finiteTuple(view.ship.rotation, 4) || Math.abs(Math.hypot(...view.ship.rotation) - 1) > 0.02 || !finiteTuple(view.ship.velocity, 3)
        || !Number.isFinite(item.shipDamageAgeMs) || item.shipDamageAgeMs < -1 || item.shipDamageAgeMs > 60_000
        || !Number.isFinite(item.damageLockRemainingMs) || item.damageLockRemainingMs < 0 || item.damageLockRemainingMs > 3000
        || (item.exitPole !== 1 && item.exitPole !== -1) || !Number.isFinite(item.exitHeld) || item.exitHeld < 0 || item.exitHeld > 2
        || !Number.isFinite(item.lastFireAgeMs) || item.lastFireAgeMs < -1 || item.lastFireAgeMs > 60_000
        || !Number.isSafeInteger(item.lastFireSequence) || item.lastFireSequence < 0 || !Number.isFinite(item.lastCoolAgeMs) || item.lastCoolAgeMs < 0 || item.lastCoolAgeMs > 60_000) return false;
      const player: PlayerRuntime = {
        ...view,
        surface: view.surface ? this.cloneSurface(view.surface) : null,
        ship: this.cloneShip(view.ship),
        protectedUntil: view.protectedUntil > 0 ? now + Math.max(0, view.protectedUntil - ageMs) : 0,
        respawnAt: view.respawnAt > 0 ? now + Math.max(0, view.respawnAt - ageMs) : 0,
        ventUntil: view.ventUntil > 0 ? now + Math.max(0, view.ventUntil - ageMs) : 0,
        shipLastDamageAt: item.shipDamageAgeMs < 0 ? 0 : now - item.shipDamageAgeMs - ageMs,
        damageLockUntil: now + Math.max(0, item.damageLockRemainingMs - ageMs), exitPole: item.exitPole, exitHeld: item.exitHeld,
        lastFireSequence: item.lastFireSequence, lastFireAt: item.lastFireAgeMs < 0 ? -Infinity : now - item.lastFireAgeMs - ageMs,
        lastCoolAt: now - item.lastCoolAgeMs - ageMs,
      };
      nextPlayers.set(player.id, player);
    }

    const mergedArenas = new Map<string, ArenaRuntime>();
    if (mergeStaticArenas) for (const [key, arena] of this.arenas) mergedArenas.set(key, this.cloneArenaRuntime(arena));
    for (const [key, arena] of nextArenas) mergedArenas.set(key, arena);
    for (const player of nextPlayers.values()) if (player.arenaKey) {
      const arena = mergedArenas.get(player.arenaKey);
      if (!arena || player.mode !== "surface") return false;
      if ((player.surface?.radius ?? 27) !== (arena.arena.radius ?? 27)) return false;
      arena.occupants.add(player.id);
    }
    for (const arena of mergedArenas.values()) if (arena.pending && arena.occupants.size === 0) return false;

    const nextBots = new Map<string, BotRuntime>(), botIndexes = new Map<string, Set<number>>();
    const next = (checkpoint).bots;
    for (const item of next) {
      const arena = mergedArenas.get(item?.arenaKey), patrol = item?.patrol;
      if (!arena || !arena.occupants.size || !Number.isSafeInteger(item.index) || item.index < 0 || item.index > 3
        || item.id !== item.arenaKey + "/bot-" + item.index || nextBots.has(item.id) || !Number.isSafeInteger(item.lifeId) || item.lifeId < 1
        || !validSurfaceState(item.state) || item.state.terrainHash !== arena.arena.terrain?.hash || (item.state.radius ?? SURFACE.radius) !== (arena.arena.radius ?? SURFACE.radius)
        || !Number.isFinite(item.health) || item.health < 0 || item.health > BOT_HEALTH || !Number.isFinite(item.armor) || item.armor < 0 || item.armor > 50 || !Number.isFinite(item.lastSeenAgeMs) || item.lastSeenAgeMs < 0 || item.lastSeenAgeMs > 10_000
        || !Number.isFinite(item.pursuitAgeMs) || item.pursuitAgeMs < 0 || item.pursuitAgeMs > 10_000
        || !Number.isFinite(item.reacquireRemainingMs) || item.reacquireRemainingMs < 0 || item.reacquireRemainingMs > 3000
        || !Number.isFinite(item.nextShotRemainingMs) || item.nextShotRemainingMs < 0 || item.nextShotRemainingMs > 1000
        || !Number.isFinite(item.respawnRemainingMs) || item.respawnRemainingMs < 0 || item.respawnRemainingMs > BOT_RESPAWN_MS
        || typeof item.targetId !== "string" || (item.targetId !== "" && (!nextPlayers.get(item.targetId)?.surface || nextPlayers.get(item.targetId)?.mode !== "surface" || nextPlayers.get(item.targetId)?.arenaKey !== item.arenaKey))
        || (item.lastSeenNormal !== null && (!finiteTuple(item.lastSeenNormal, 3, 1.01) || Math.abs(Math.hypot(...item.lastSeenNormal) - 1) > 0.01))
        || (!!item.targetId !== !!item.lastSeenNormal) || !patrol || !finiteTuple(patrol.home, 3, 1.01) || !finiteTuple(patrol.goal, 3, 1.01)
        || !Number.isFinite(patrol.leash) || patrol.leash < 1 || patrol.leash > (arena.arena.radius ?? SURFACE.radius) * 1.2
        || !Number.isSafeInteger(patrol.random) || patrol.random < 0 || patrol.random > 0xffff_ffff
        || !Number.isFinite(patrol.wait) || patrol.wait < 0 || patrol.wait > 10 || !Number.isFinite(patrol.stuck) || patrol.stuck < 0 || patrol.stuck > 10
        || !Number.isFinite(patrol.repath) || patrol.repath < 0 || patrol.repath > 10 || typeof patrol.returningHome !== "boolean" || !Number.isSafeInteger(patrol.shotSequence) || patrol.shotSequence < 0
        || (item.health === 0 ? item.respawnRemainingMs <= 0 : item.respawnRemainingMs !== 0)) return false;
      const indexes = botIndexes.get(item.arenaKey) ?? new Set<number>();
      if (indexes.has(item.index)) return false;
      indexes.add(item.index); botIndexes.set(item.arenaKey, indexes);
      const brain: SurfacePatrol = { index: item.index, state: this.cloneSurface(item.state), home: [...patrol.home] as Vec3, goal: [...patrol.goal] as Vec3,
        leash: patrol.leash, random: patrol.random, wait: patrol.wait, stuck: patrol.stuck, repath: patrol.repath, returningHome: patrol.returningHome };
      nextBots.set(item.id, { id: item.id, index: item.index, arenaKey: item.arenaKey, lifeId: item.lifeId, patrol: brain, health: item.health, armor: item.armor, targetId: item.targetId,
        lastSeenNormal: item.lastSeenNormal ? [...item.lastSeenNormal] as Vec3 : null, lastSeenAt: item.targetId ? now - item.lastSeenAgeMs - ageMs : now,
        pursuitStartedAt: item.targetId ? now - item.pursuitAgeMs - ageMs : 0, reacquireUntil: now + Math.max(0, item.reacquireRemainingMs - ageMs),
        nextShotAt: item.targetId ? now + Math.max(0, item.nextShotRemainingMs - ageMs) : 0,
        respawnAt: item.health === 0 ? now + Math.max(0, item.respawnRemainingMs - ageMs) : 0, shotSequence: patrol.shotSequence });
    }
    for (const [key, arena] of mergedArenas) if (arena.occupants.size && (botIndexes.get(key)?.size !== 4 || [0, 1, 2, 3].some(index => !botIndexes.get(key)?.has(index)))) return false;

    const nextBotShots: BotShotRuntime[] = [], botShotIds = new Set<string>();
    for (const item of checkpoint.botShots) {
      const bot = item && nextBots.get(item.botId), arena = item && mergedArenas.get(item.arenaKey);
      if (!bot || bot.health <= 0 || !arena || item.arenaKey !== bot.arenaKey || !Number.isSafeInteger(item.sequence) || item.sequence < 1 || item.sequence > bot.shotSequence
        || item.id !== bot.id + ":" + bot.lifeId + ":" + item.sequence || botShotIds.has(item.id) || !finiteTuple(item.position, 3, (arena.arena.radius ?? SURFACE.radius) + 35)
        || !finiteTuple(item.direction, 3, 1.01) || Math.abs(Math.hypot(...item.direction) - 1) > 0.01 || !Number.isFinite(item.travelled) || item.travelled < 0 || item.travelled > 30
        || !Number.isFinite(item.ageMs) || item.ageMs < 0 || item.ageMs > 250 || !Number.isFinite(item.simulatedAgeMs) || item.simulatedAgeMs < 0 || item.simulatedAgeMs > 100
        || !Number.isFinite(item.stoppedRemainingMs) || item.stoppedRemainingMs < 0 || item.stoppedRemainingMs > 90) return false;
      botShotIds.add(item.id);
      nextBotShots.push({ id: item.id, botId: item.botId, arenaKey: item.arenaKey, sequence: item.sequence, position: [...item.position] as Vec3, direction: [...item.direction] as Vec3,
        travelled: item.travelled, startedAt: now - item.ageMs - ageMs, simulatedAt: now - item.simulatedAgeMs - ageMs,
        stoppedAt: item.stoppedRemainingMs > 0 ? now + Math.max(0, item.stoppedRemainingMs - ageMs) : 0 });
    }

    const nextBotDrops: BotDropRuntime[] = [], botDropIds = new Set<string>(); let highestDropId = 0;
    for (const item of checkpoint.botDrops) {
      const arena = item && mergedArenas.get(item.arenaKey), idMatch = typeof item?.id === "string" ? /^bot-drop-(\d+)$/.exec(item.id) : null;
      if (!arena?.occupants.size || !idMatch || botDropIds.has(item.id) || !finiteTuple(item.position, 3, (arena.arena.radius ?? SURFACE.radius) + 0.02)
        || Math.abs(Math.hypot(...item.position) - (arena.arena.radius ?? SURFACE.radius)) > 0.02 || item.heal !== BOT_DROP_HEAL || item.available !== true
        || !Number.isFinite(item.remainingMs) || item.remainingMs <= 0 || item.remainingMs > BOT_DROP_LIFETIME_MS) return false;
      botDropIds.add(item.id); highestDropId = Math.max(highestDropId, Number(idMatch[1]));
      nextBotDrops.push({ id: item.id, arenaKey: item.arenaKey, position: [...item.position] as Vec3, heal: BOT_DROP_HEAL, available: true,
        expiresAt: now + Math.max(0, item.remainingMs - ageMs) });
    }
    if (checkpoint.nextBotDropId < highestDropId) return false;

    this.coverMotion.clear(); this.charges.clear(); this.players.clear(); for (const [id, player] of nextPlayers) this.players.set(id, player);
    this.arenas.clear(); for (const [key, arena] of mergedArenas) this.arenas.set(key, arena);
    this.bots.clear(); for (const [id, bot] of nextBots) this.bots.set(id, bot);
    this.botShots = nextBotShots; this.botDrops = nextBotDrops; this.nextBotDropId = checkpoint.nextBotDropId; this.trainingBotArmor = checkpoint.trainingBotArmor;
    this.geometryRevision = Math.max(0, ...[...this.arenas.values()].map(arena => Math.max(arena.revision, arena.pending?.value?.revision ?? 0)));
    return true;
  }

  /** Update a participant's anonymous topology/position frame; busy arenas keep their current layout. */
  setOwnerMap(ownerId: string, topology: SurfaceTopology, positions: Float32Array): void {
    if (!ownerId || topology.nodes.length > 20_000 || positions.length !== topology.nodes.length * 3 || topology.links.length > 100_000) return;
    this.ownerMaps.set(ownerId, { topology, positions: positions.slice() });
    const next = new Map<string, Omit<SurfaceArenaView, "acceptingPlayers">>();
    for (const node of topology.nodes) if (node.dockable) {
      const current = this.arenas.get(keyFor(ownerId, node.id));
      const reusable = current?.topologyRevision === topology.revision ? current : current?.pending?.value?.topologyRevision === topology.revision ? current.pending.value : null;
      const index = topology.nodes.indexOf(node);
      let candidate:Omit<SurfaceArenaView,"acceptingPlayers">|null;
      try{candidate = reusable ? { ...reusable, center: [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]] as Vec3 } : makeArenaView(ownerId, topology, positions, node.id, this.options.terrain);this.preparationErrors.delete(keyFor(ownerId,node.id));}
      catch{this.preparationErrors.add(keyFor(ownerId,node.id));continue;}
      if (candidate) {
        if (!reusable) candidate.revision = ++this.geometryRevision;
        next.set(candidate.key, candidate);
      }
    }

    for (const [key, current] of [...this.arenas]) {
      if (current.ownerId !== ownerId) continue;
      const candidate = next.get(key);
      if (candidate && candidate.topologyRevision === current.topologyRevision) {
        this.moveArenaCenter(current, candidate.center);
        current.pending = null; current.acceptingPlayers = true;
        next.delete(key);
      } else if (current.occupants.size && candidate) {
        this.moveArenaCenter(current, candidate.center);
        current.pending = { value: candidate };
        current.acceptingPlayers = false;
        next.delete(key);
      } else if (current.occupants.size && topology.nodes.some(node => node.id === current.hubId)) {
        const index = topology.nodes.findIndex(node => node.id === current.hubId);
        this.moveArenaCenter(current, [positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]]);
        current.pending = { value: null }; current.acceptingPlayers = false;
      } else if (current.occupants.size) {
        for (const id of current.occupants) {
          const player = this.players.get(id);
          if (player) this.evacuate(player, current);
        }
        current.occupants.clear();
        this.clearArenaBots(key);
        this.arenas.delete(key);
      } else if (candidate) {
        Object.assign(current, candidate, { pending: null, acceptingPlayers: true });
        next.delete(key);
      } else {
        this.clearArenaBots(key);
        this.arenas.delete(key);
      }
    }
    for (const candidate of next.values()) this.arenas.set(candidate.key, { ...candidate, acceptingPlayers: true, occupants: new Set(), pickups: candidate.arena.pickups.map(() => ({ available: true, respawnAt: 0 })), pending: null });
  }

  ownerLeft(ownerId: string): void {
    this.ownerMaps.delete(ownerId);
    for (const [key, arena] of [...this.arenas]) if (arena.ownerId === ownerId) {
      for (const id of arena.occupants) {
        const player = this.players.get(id);
        if (player) this.evacuate(player, arena);
      }
      this.clearArenaBots(key);
      this.arenas.delete(key);
    }
  }

  setShipPose(id: string, ship: SurfaceShipState): void {
    const player = this.players.get(id);
    if (player?.mode === "ship" && this.validShip(ship)) player.ship = this.cloneShip(ship);
  }

  /** Accept one host-timed pistol shot; sequence, rate, heat, and vent cannot be client-overridden. */
  private readonly charges = new Map<string, { at: number; arenaKey: string; lifeId: number }>();

  setCharge(id: string, active: boolean, now: number, arenaKey: unknown, lifeId: unknown): boolean {
    const player = this.players.get(id);
    if (!player || player.mode !== "surface" || player.health <= 0 || player.arenaKey !== arenaKey || player.lifeId !== lifeId || !Number.isFinite(now)) return false;
    if (!active) { this.charges.delete(id); player.lastCoolAt = now; return true; }
    this.coolWeapon(player, now);
    if (this.charges.has(id)) return false;
    if (player.ventUntil > now || now - player.lastFireAt < SURFACE_BLASTER.cooldownMs) return false;
    this.charges.set(id, { at: now, arenaKey: player.arenaKey!, lifeId: player.lifeId });
    return true;
  }

  tryFire(id: string, sequence: number, now: number, kind: SurfaceShotKind = "normal"): SurfaceFireResult {
    const player = this.players.get(id);
    if (!player || player.mode !== "surface" || !player.surface || player.health <= 0 || !Number.isSafeInteger(sequence) || sequence <= player.lastFireSequence || !Number.isFinite(now))
      return { accepted: false, heat: player?.heat ?? 0, ventUntil: player?.ventUntil ?? 0 };
    player.lastFireSequence = sequence;
    const charge = this.charges.get(id);
    if (kind !== "normal" && kind !== "charged") return { accepted: false, heat: player.heat, ventUntil: player.ventUntil };
    if (kind === "charged" && (!charge || charge.arenaKey !== player.arenaKey || charge.lifeId !== player.lifeId || now - charge.at < SURFACE_CHARGE.chargeMs || now - charge.at > SURFACE_CHARGE.maximumHoldMs)) {
      this.charges.delete(id); return { accepted: false, heat: player.heat, ventUntil: player.ventUntil };
    }
    if (kind === "normal" && charge) return { accepted: false, heat: player.heat, ventUntil: player.ventUntil };
    this.coolWeapon(player, now);
    this.charges.delete(id);
    if (now < player.ventUntil || now - player.lastFireAt < 200) return { accepted: false, heat: player.heat, ventUntil: player.ventUntil };
    player.lastFireAt = now; player.lastCoolAt = now;
    player.protectedUntil = 0;
    player.heat = Math.min(100, player.heat + (kind === "charged" ? SURFACE_CHARGE.heatPerShot : SURFACE_BLASTER.heatPerShot));
    if (player.heat >= 100) player.ventUntil = now + 2000;
    return { accepted: true, heat: player.heat, ventUntil: player.ventUntil };
  }

  markShipDamage(id: string, now: number): void {
    const player = this.players.get(id);
    if (player?.mode === "ship" && Number.isFinite(now)) player.shipLastDamageAt = Math.max(player.shipLastDamageAt, now);
  }

  forceUndock(id: string): boolean {
    const player = this.players.get(id), arena = player?.arenaKey ? this.arenas.get(player.arenaKey) : undefined;
    if (!player || player.mode !== "surface" || !arena) return false;
    player.ship.position = [arena.center[0], arena.center[1] + player.exitPole * ((arena.arena.radius ?? SURFACE.radius) + 8), arena.center[2]];
    player.ship.velocity = [0, 0, 0];
    this.leaveSurface(player, arena);
    return true;
  }

  /** Ray, range, speed, cooldown, and hub eligibility are checked from the host's saved ship pose. */
  dock(id: string, key: string, now: number, surfaceUnitsPerWorldUnit = 1): boolean {
    const player = this.players.get(id), arena = this.arenas.get(key);
    if (player?.mode === "ship" && player.health <= 0 && player.respawnAt > 0 && now >= player.respawnAt) {
      player.lifeId++; player.health = 100; player.armor = 0; player.respawnAt = 0; player.heat = 0; player.ventUntil = 0;
    }
    if (!player || !arena || player.mode !== "ship" || player.health <= 0 || arena.pending || arena.occupants.size >= 4 || now - player.shipLastDamageAt < 3000
      || !Number.isFinite(surfaceUnitsPerWorldUnit) || surfaceUnitsPerWorldUnit < 0.1 || surfaceUnitsPerWorldUnit > 100) return false;
    const offset: Vec3 = [arena.center[0] - player.ship.position[0], arena.center[1] - player.ship.position[1], arena.center[2] - player.ship.position[2]];
    const centerDistance = length(offset), speed = length(player.ship.velocity);
    if (centerDistance < (arena.arena.radius ?? SURFACE.radius) || centerDistance > (arena.arena.radius ?? SURFACE.radius) + PILOT_DOCK_RANGE_WORLD_UNITS * surfaceUnitsPerWorldUnit || speed > 10 * surfaceUnitsPerWorldUnit) return false;
    const forward = this.rotateForward(player.ship.rotation), along = dot(offset, forward);
    if (along <= 0 || length([offset[0] - forward[0] * along, offset[1] - forward[1] * along, offset[2] - forward[2] * along]) > (arena.arena.radius ?? SURFACE.radius)) return false;
    if (!arena.occupants.size) {
      const source = this.ownerMaps.get(arena.ownerId);
      let sampled:Omit<SurfaceArenaView,"acceptingPlayers">|null|undefined;
      try{sampled=source&&makeArenaView(arena.ownerId,source.topology,source.positions,arena.hubId,this.options.terrain);}
      catch{this.preparationErrors.add(key);return false;}
      if (sampled) Object.assign(arena, sampled, { revision: ++this.geometryRevision });
    }
    const enemies = this.surfaceEnemies(arena, id);
    const spawn = this.findSafeSpawn(arena, enemies, SURFACE.standingHeight);
    if (!spawn) return false;
    const parking = SURFACE_PARKING_NORMALS.find(normal => [...arena.occupants].every(occupant => {
      const other = this.players.get(occupant);
      return !other || dot(normal, unit(other.ship.position.map((value, axis) => value - arena.center[axis]))) < 0.99;
    }));
    if (!parking) return false;
    player.ship.position = parking.map((value, axis) => arena.center[axis] + value * (arena.arena.radius ?? SURFACE.radius) * 1.2) as Vec3;
    player.ship.velocity = [0, 0, 0];
    player.lifeId++; player.mode = "surface"; player.arenaKey = key; player.surface = createSurfacePlayerState(spawn, [1, 0, 0], arena.arena.radius ?? SURFACE.radius, arena.arena.terrain);
    player.protectedUntil = now + 3000; player.respawnAt = 0; player.exitPole = spawn[1] >= 0 ? 1 : -1;
    player.exitHeld = 0; player.exitProgress = 0;
    arena.occupants.add(id);
    this.ensureBots(arena, now);
    return true;
  }

  /** One authoritative player step. Holding F in a pole zone undocks after two uninterrupted seconds. */
  updatePlayer(id: string, input: SurfaceInput & { interact: boolean }, dt: number, now: number): "none" | "pickup" | "respawn" | "undock" {
    const player = this.players.get(id), arena = player?.arenaKey ? this.arenas.get(player.arenaKey) : undefined;
    if (!player || player.mode !== "surface" || !arena || !player.surface || !(dt > 0) || dt > 0.1) return "none";
    this.coolWeapon(player, now);
    if (player.health <= 0) {
      if (now < player.respawnAt) return "none";
      const spawn = this.findSafeSpawn(arena, this.surfaceEnemies(arena, id), SURFACE.standingHeight);
      if (!spawn) { player.respawnAt = now + 250; return "none"; }
      player.lifeId++; player.surface = createSurfacePlayerState(spawn, [1, 0, 0], arena.arena.radius ?? SURFACE.radius, arena.arena.terrain); player.health = 100; player.armor = 0;
      player.protectedUntil = now + 3000; player.respawnAt = 0; player.exitPole = spawn[1] >= 0 ? 1 : -1; player.exitHeld = 0; player.exitProgress = 0;
      return "respawn";
    }

    player.surface = stepSurfacePlayer(player.surface, input, dt, arena.arena.walls);
    const atNorth = angleDistance(player.surface.position, [0, 1, 0], arena.arena.radius ?? SURFACE.radius) <= 3;
    const atSouth = angleDistance(player.surface.position, [0, -1, 0], arena.arena.radius ?? SURFACE.radius) <= 3;
    if (input.interact && now >= player.damageLockUntil && (atNorth || atSouth)) {
      player.exitPole = atNorth ? 1 : -1; player.exitHeld += dt; player.exitProgress = clamp(player.exitHeld / 2, 0, 1);
      if (player.exitHeld >= 2 - 1e-6) {
        const normal: Vec3 = [0, player.exitPole, 0];
        player.ship.position = [arena.center[0] + normal[0] * ((arena.arena.radius ?? SURFACE.radius) + 8), arena.center[1] + normal[1] * ((arena.arena.radius ?? SURFACE.radius) + 8), arena.center[2] + normal[2] * ((arena.arena.radius ?? SURFACE.radius) + 8)];
        player.ship.velocity = [0, 0, 0];
        this.leaveSurface(player, arena);
        return "undock";
      }
    } else { player.exitHeld = 0; player.exitProgress = 0; }

    for (let i = 0; i < arena.arena.pickups.length; i++) {
      const pickup = arena.arena.pickups[i], runtime = arena.pickups[i];
      if (!runtime.available) {
        if (now < runtime.respawnAt) continue;
        runtime.available = true; runtime.respawnAt = 0;
      }
      if (angleDistance(player.surface.position, pickup.normal, arena.arena.radius ?? SURFACE.radius) > 1) continue;
      const health = Math.min(100, player.health + pickup.heal), armor = Math.min(50, player.armor + pickup.armor);
      if (health === player.health && armor === player.armor) continue;
      player.health = health; player.armor = armor; runtime.available = false; runtime.respawnAt = now + pickup.respawnMs;
      return "pickup";
    }
    for (let index = this.botDrops.length - 1; index >= 0; index--) {
      const drop = this.botDrops[index];
      if (drop.arenaKey !== arena.key || !drop.available || drop.expiresAt <= now || angleDistance(player.surface.position, drop.position, arena.arena.radius ?? SURFACE.radius) > 1) continue;
      const health = Math.min(100, player.health + drop.heal);
      if (health === player.health) continue;
      player.health = health; this.botDrops.splice(index, 1);
      return "pickup";
    }
    return "none";
  }

  damage(targetId: string, attackerId: string, amount: number, now: number): SurfaceDamageResult {
    const target = this.players.get(targetId), attacker = this.players.get(attackerId);
    if (!target || target.mode !== "surface" || !target.arenaKey || target.health <= 0 || target.protectedUntil > now || !Number.isFinite(amount) || amount <= 0 || amount > 100) return { applied: 0, killed: false, attackerHealth: attacker?.health ?? null };
    const arena = this.arenas.get(target.arenaKey);
    if (!arena || (attackerId !== targetId && (!attacker || attacker.mode !== "surface" || attacker.arenaKey !== target.arenaKey))) return { applied: 0, killed: false, attackerHealth: attacker?.health ?? null };
    target.damageLockUntil = now + 3000; target.exitHeld = 0; target.exitProgress = 0;
    const armorDamage = Math.min(target.armor, amount); target.armor -= armorDamage;
    const healthDamage = Math.min(target.health, amount - armorDamage); target.health -= healthDamage;
    const killed = target.health <= 0;
    if (killed) {
      target.health = 0; target.deaths++; target.lifeId++; target.respawnAt = now + 5000;
      if (attacker && attacker.id !== target.id) {
        attacker.kills++;
        if (attacker.health > 0) attacker.health = Math.min(100, attacker.health + 30);
      }
      for (const bot of this.bots.values()) if (bot.targetId === target.id) this.loseBotTarget(bot, now);
    }
    return { applied: armorDamage + healthDamage, killed, attackerHealth: attacker?.health ?? null };
  }

  damageBot(botId: string, attackerId: string, amount: number, now: number): SurfaceDamageResult {
    const bot = this.bots.get(botId), attacker = this.players.get(attackerId), arena = bot ? this.arenas.get(bot.arenaKey) : undefined;
    if (!bot || !arena || bot.health <= 0 || !attacker || attacker.mode !== "surface" || attacker.arenaKey !== bot.arenaKey || !attacker.surface || attacker.health <= 0
      || !Number.isFinite(amount) || amount <= 0 || amount > 100) return { applied: 0, killed: false, attackerHealth: attacker?.health ?? null };
    if (bot.targetId !== attackerId) { bot.targetId = attackerId; bot.pursuitStartedAt = now; bot.nextShotAt = now + 1000; }
    bot.lastSeenAt = now; bot.lastSeenNormal = [...attacker.surface.position];
    const armorDamage = Math.min(bot.armor, amount); bot.armor -= armorDamage;
    const healthDamage = Math.min(bot.health, amount - armorDamage); bot.health -= healthDamage;
    const applied = armorDamage + healthDamage;
    const killed = bot.health <= 0;
    if (killed) {
      bot.health = 0; bot.targetId = ""; bot.lastSeenNormal = null; bot.respawnAt = now + BOT_RESPAWN_MS;
      this.botShots = this.botShots.filter(shot => shot.botId !== bot.id);
      if (this.botDrops.length < MAX_SURFACE_BOT_DROPS) this.botDrops.push({ id: `bot-drop-${++this.nextBotDropId}`, arenaKey: bot.arenaKey,
        position: [...bot.patrol.state.position], heal: BOT_DROP_HEAL, available: true, expiresAt: now + BOT_DROP_LIFETIME_MS });
    }
    return { applied, killed, attackerHealth: attacker.health };
  }

  damageFromBot(targetId: string, botId: string, amount: number, now: number): SurfaceDamageResult {
    const target = this.players.get(targetId), bot = this.bots.get(botId);
    if (!target || !bot || target.mode !== "surface" || target.arenaKey !== bot.arenaKey || target.health <= 0 || target.protectedUntil > now
      || !Number.isFinite(amount) || amount <= 0 || amount > 100) return { applied: 0, killed: false, attackerHealth: target?.health ?? null };
    target.damageLockUntil = now + 3000; target.exitHeld = 0; target.exitProgress = 0;
    const armorDamage = Math.min(target.armor, amount); target.armor -= armorDamage;
    const healthDamage = Math.min(target.health, amount - armorDamage); target.health -= healthDamage;
    const killed = target.health <= 0;
    if (killed) {
      target.health = 0; target.deaths++; target.lifeId++; target.respawnAt = now + 5000;
      this.charges.delete(target.id);
      for (const chasing of this.bots.values()) if (chasing.targetId === target.id) this.loseBotTarget(chasing, now);
    }
    return { applied: armorDamage + healthDamage, killed, attackerHealth: target.health };
  }

  private ensureBots(arena: ArenaRuntime, now: number): void {
    for (let index = 0; index < 4; index++) {
      const id = arena.key + "/bot-" + index;
      if (!this.bots.has(id)) this.bots.set(id, this.createBot(arena, index, id, 1, now));
    }
  }

  private createBot(arena: ArenaRuntime, index: number, id: string, lifeId: number, now: number): BotRuntime {
    let patrol = createSurfacePatrol(arena.arena, index);
    const occupants = [...arena.occupants].map(playerId => this.players.get(playerId)).filter((player): player is PlayerRuntime => !!player?.surface && player.health > 0);
    for (let attempt = 0; attempt < 20 && occupants.some(player => angleDistance(player.surface!.position, patrol.state.position, arena.arena.radius ?? SURFACE.radius) < 5); attempt++) {
      patrol = createSurfacePatrol({ ...arena.arena, seed: (arena.arena.seed + Math.imul(lifeId + attempt + 1, 0x45d9f3b)) >>> 0 }, index);
    }
    return { id, index, arenaKey: arena.key, lifeId, patrol, health: BOT_HEALTH, armor: this.trainingBotArmor, targetId: "", lastSeenNormal: null, lastSeenAt: now,
      pursuitStartedAt: 0, reacquireUntil: now, nextShotAt: 0, respawnAt: 0, shotSequence: 0 };
  }

  private respawnBot(bot: BotRuntime, arena: ArenaRuntime, now: number): void {
    const next = this.createBot(arena, bot.index, bot.id, bot.lifeId + 1, now);
    next.shotSequence = bot.shotSequence;
    this.bots.set(bot.id, next);
  }

  private visiblePlayers(bot: BotRuntime, arena: ArenaRuntime): Array<{ player: PlayerRuntime; distance: number }> {
    const origin = bot.patrol.state.position, up = unit(origin), forward = unit(sub(bot.patrol.state.forward, scale(up, dot(bot.patrol.state.forward, up))));
    const { eye } = surfaceViewPose(bot.patrol.state), visible: Array<{ player: PlayerRuntime; distance: number }> = [];
    for (const id of arena.occupants) {
      const player = this.players.get(id);
      if (!player?.surface || player.health <= 0 || player.mode !== "surface") continue;
      const distance = angleDistance(origin, player.surface.position, arena.arena.radius ?? SURFACE.radius);
      if (distance > 18) continue;
      const targetUp = unit(player.surface.position), radialDot = dot(up, targetUp), tangent = sub(targetUp, scale(up, radialDot));
      if (dot(forward, unit(tangent)) < Math.cos(Math.PI / 3)) continue;
      const targetEye = surfaceViewPose(player.surface).eye;
      if (traceSurfaceSegment(eye, targetEye, arena.arena.walls, [], bot.id, arena.arena.radius ?? SURFACE.radius)) continue;
      visible.push({ player, distance });
    }
    return visible.sort((a, b) => a.distance - b.distance || a.player.id.localeCompare(b.player.id));
  }

  private expireBotDrops(now: number): void {
    this.botDrops = this.botDrops.filter(drop => drop.expiresAt > now && !!this.arenas.get(drop.arenaKey)?.occupants.size);
  }

  private loseBotTarget(bot: BotRuntime, now: number): void {
    bot.targetId = ""; bot.lastSeenNormal = null; bot.reacquireUntil = now + 3000; bot.nextShotAt = 0;
    bot.patrol.goal = [...bot.patrol.home]; bot.patrol.returningHome = true; bot.patrol.repath = 0; bot.patrol.wait = 0;
  }

  private leaveSurface(player: PlayerRuntime, arena: ArenaRuntime): void {
    this.charges.delete(player.id);
    arena.occupants.delete(player.id); player.lifeId++; player.mode = "ship"; player.arenaKey = null; player.surface = null;
    player.exitHeld = 0; player.exitProgress = 0; player.protectedUntil = 0;
    if (!arena.occupants.size) this.clearArenaBots(arena.key);
    this.applyPendingIfEmpty(arena);
  }

  private clearArenaBots(arenaKey: string): void {
    for (const [id, bot] of this.bots) if (bot.arenaKey === arenaKey) this.bots.delete(id);
    this.botShots = this.botShots.filter(shot => shot.arenaKey !== arenaKey);
    this.botDrops = this.botDrops.filter(drop => drop.arenaKey !== arenaKey);
  }

  private coolWeapon(player: PlayerRuntime, now: number): void {
    const charge = this.charges.get(player.id);
    if (charge) {
      if (charge.lifeId === player.lifeId && charge.arenaKey === player.arenaKey && player.health > 0 && now - charge.at <= SURFACE_CHARGE.maximumHoldMs) { player.lastCoolAt = now; return; }
      this.charges.delete(player.id);
    }
    if (player.ventUntil > 0) {
      if (now < player.ventUntil) { player.lastCoolAt = now; return; }
      player.heat = 0; player.ventUntil = 0; player.lastCoolAt = now;
      return;
    }
    if (now <= player.lastFireAt + 350) { player.lastCoolAt = now; return; }
    const from = Math.max(player.lastCoolAt, player.lastFireAt + 350);
    player.heat = Math.max(0, player.heat - Math.max(0, now - from) * 0.025);
    player.lastCoolAt = now;
  }

  private evacuate(player: PlayerRuntime, arena: ArenaRuntime): void {
    this.charges.delete(player.id);
    player.lifeId++; player.arenaKey = null; player.mode = "ship"; player.surface = null;
    player.exitProgress = 0; player.exitHeld = 0; player.protectedUntil = 0;
    player.ship.position = [arena.center[0], arena.center[1] + player.exitPole * ((arena.arena.radius ?? SURFACE.radius) + 8), arena.center[2]];
    player.ship.velocity = [0, 0, 0];
  }

  private applyPendingIfEmpty(arena: ArenaRuntime): void {
    if (arena.occupants.size || !arena.pending) return;
    const pending = arena.pending.value;
    if (!pending) this.arenas.delete(arena.key);
    else this.arenas.set(arena.key, { ...pending, acceptingPlayers: true, occupants: new Set(), pickups: pending.arena.pickups.map((pickup) => arena.pickups[arena.arena.pickups.findIndex(previous => previous.id === pickup.id)] ?? { available: true, respawnAt: 0 }), pending: null });
  }

  private surfaceEnemies(arena: ArenaRuntime, exceptId: string): PlayerRuntime[] {
    return [...arena.occupants].filter(id => id !== exceptId).map(id => this.players.get(id)!).filter(player => !!player?.surface && player.health > 0);
  }

  private findSafeSpawn(arena: ArenaRuntime, enemies: PlayerRuntime[], height: number): SurfaceVector | null {
    const candidates = [...spawnCandidates(1, arena.arena.radius ?? SURFACE.radius), ...spawnCandidates(-1, arena.arena.radius ?? SURFACE.radius)];
    const preferred = (candidate: SurfaceVector) => Math.acos(clamp(Math.abs(candidate[1]), -1, 1)) * (arena.arena.radius ?? SURFACE.radius) <= 6 + 1e-6;
    for (const poleArea of [true, false]) {
      let best: SurfaceVector | null = null, bestDistance = -1, bestVisibility = Infinity;
      for (const candidate of candidates.filter(candidate => preferred(candidate) === poleArea)) {
        const ground=(arena.arena.radius??27)+(arena.arena.terrain?terrainHeight(arena.arena.terrain,candidate):0);
        const feet:Vec3=candidate.map(v=>v*ground) as Vec3;
        if (!surfacePoseClear(feet, height, arena.arena.walls, undefined, arena.arena.radius ?? SURFACE.radius)) continue;
        const distances = enemies.map(enemy => angleDistance(candidate, enemy.surface!.position, arena.arena.radius ?? SURFACE.radius));
        const nearest = distances.length ? Math.min(...distances) : Infinity;
        if (nearest < 6 - 1e-6) continue;
        const eye: Vec3 = candidate.map(value => value * (ground + SURFACE.standingEyeHeight)) as Vec3;
        const visible = enemies.filter(enemy => {
          const state = enemy.surface!, up = unit(state.position), eyeHeight = state.crouched ? SURFACE.crouchedEyeHeight : SURFACE.standingEyeHeight;
          const target: Vec3 = state.position.map((value, axis) => value + up[axis] * eyeHeight) as Vec3;
          return !traceSurfaceSegment(eye, target, arena.arena.walls, [], "", arena.arena.radius ?? SURFACE.radius);
        }).length;
        if (visible > bestVisibility || (visible === bestVisibility && nearest <= bestDistance)) continue;
        best = candidate; bestDistance = nearest; bestVisibility = visible;
      }
      if (best) return best;
    }
    return null;
  }

  private rotateForward(q: Quaternion): Vec3 {
    const [x, y, z, w] = q, fx = -2 * (x * z + w * y), fy = -2 * (y * z - w * x), fz = -(1 - 2 * (x * x + y * y));
    return unit([fx, fy, fz]);
  }

  private moveArenaCenter(arena: ArenaRuntime, center: Vec3): void {
    const delta = center.map((value, axis) => value - arena.center[axis]);
    for (const id of arena.occupants) {
      const player = this.players.get(id);
      if (player) player.ship.position = player.ship.position.map((value, axis) => value + delta[axis]) as Vec3;
    }
    arena.center = [...center];
  }

  private validShip(ship: SurfaceShipState): boolean {
    return !!ship && Array.isArray(ship.position) && ship.position.length === 3 && ship.position.every(Number.isFinite)
      && Array.isArray(ship.velocity) && ship.velocity.length === 3 && ship.velocity.every(Number.isFinite)
      && Array.isArray(ship.rotation) && ship.rotation.length === 4 && ship.rotation.every(Number.isFinite);
  }

  private validPendingArena(value: unknown, expectedKey: string): value is Omit<SurfaceArenaView, "acceptingPlayers"> {
    if (!value || typeof value !== "object") return false;
    const arena = value as Omit<SurfaceArenaView, "acceptingPlayers">;
    return typeof arena.ownerId === "string" && !!arena.ownerId && typeof arena.hubId === "string" && !!arena.hubId
      && arena.key === expectedKey && arena.key === keyFor(arena.ownerId, arena.hubId) && Number.isSafeInteger(arena.revision) && arena.revision > 0
      && Number.isSafeInteger(arena.topologyRevision) && arena.topologyRevision > 0
      && finiteTuple(arena.center, 3) && arena.center.every(number => Math.abs(number) <= 1_000_000) && validArenaDefinition(arena.arena, arena.hubId);
  }

  private cloneArena(arena: SurfaceArena): SurfaceArena {
    const cloned = { ...arena, walls: arena.walls.map(wall => ({ ...wall, normal: [...wall.normal] as Vec3, tangent: [...wall.tangent] as Vec3 })), pickups: arena.pickups.map(pickup => ({ ...pickup, normal: [...pickup.normal] as Vec3 })) };
    bindSurfaceTerrain(cloned.walls,cloned.terrain);return cloned;
  }

  private cloneArenaRuntime(arena: ArenaRuntime): ArenaRuntime {
    return { ...arena, center: [...arena.center], arena: this.cloneArena(arena.arena), occupants: new Set(), pickups: arena.pickups.map(pickup => ({ ...pickup })),
      pending: arena.pending ? { value: arena.pending.value ? { ...arena.pending.value, center: [...arena.pending.value.center], arena: this.cloneArena(arena.pending.value.arena) } : null } : null };
  }

  private cloneShip(ship: SurfaceShipState): SurfaceShipState { return { position: [...ship.position], rotation: [...ship.rotation], velocity: [...ship.velocity] }; }
  private cloneSurface(state: SurfacePlayerState): SurfacePlayerState { return { ...state, position: [...state.position], velocity: [...state.velocity], forward: [...state.forward] }; }
}
