import { isUnknownArray } from "./validation";
import * as THREE from "three";
import type { AnonymousPlayer, FlightInput, FlightTick, ImpactSnapshot, Pose, ShotSnapshot } from "./multiplayer";
import { MULTIPLAYER_SHIP_SCALE, shipMuzzles } from "./ship";
import { FLIGHT, StarCollisionGrid, stepBoostResources, stepFlightRotation, stepFlightVelocity } from "./flight";
import { DEFAULT_PILOT_PROFILE, LASER_SOUND_IDS, stepPresentation, type PilotProfile } from "./pilotProfile";
import { PLAYER_KILLS_TO_WIN, type EliminationEvent, type LayoutRequirement, type RoundPhase, type RoundSnapshot } from "./rounds";
import { BOLT_REACH, HULL_MAX, SHIELD_DELAY, SHIELD_MAX, SHIELD_REGEN, SHIP_HIT_RADIUS, damageAt, weaponStats } from "./weapons";

const SLOTS: [number, number, number][] = [[0, 0, 0], [2300, 0, 0], [-1150, 0, 1992], [-1150, 0, -1992]];
const FULL: FlightInput = { sequence: 0, thrust: 0, strafe: 0, lift: 0, roll: 0, pitch: 0, yaw: 0, boost: false, brake: false, fire: false, active: false,
  mouseMode: "capture", mouseSamples: [], sensitivity: 1, agility: 1, invertY: false };
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

interface Fighter {
  id: string; slot: number; pos: THREE.Vector3; vel: THREE.Vector3; rot: THREE.Quaternion; spin: THREE.Vector3;
  input: FlightInput; health: number; shields: number; shieldDelay: number; damagePause: number;
  weapon: 0 | 1; heat: number; overheated: boolean; ammunition: number; deaths: number;
  energy: number; boostLocked: boolean; regenDelay: number; emptyWait: number;
  respawnAt: number; protectedUntil: number; resumeAt: number; fireAt: number; inputAt: number; active: boolean; docked: boolean;
  weaponSequence: number; inputSequence: number; receivedInputSequence: number; inputTick: number; receivedInputTick: number; tickQueue: Map<number, FlightTick>; mouseX: number; mouseY: number;
  mouseQueue: { sequence: number; dx: number; dy: number; last: boolean }[];
  resumeAfterRespawn: boolean; lastFireSequence: number; fireCooldownDuration: number; travel: Travel | null; profile: PilotProfile; bank: number; tilt: number; kills: number;
}
interface Travel { from: [number, number, number]; to: [number, number, number]; rotationFrom: [number, number, number, number]; rotationTo: [number, number, number, number]; startedAt: number; duration: number }
interface Projectile { id: string; ownerId: string; gun: number; weapon: 0 | 1; origin: [number, number, number]; pos: THREE.Vector3; direction: THREE.Vector3; velocity: THREE.Vector3; speed: number; remaining: number; travelled: number; sound: typeof LASER_SOUND_IDS[number]; startedAt: number }
interface Impact { id: string; position: [number, number, number]; kind: "star" | "ship"; at: number }

/** Small fixed-step room simulation. Vault data is never accepted by this class. */
export class CombatWorld {
  readonly players = new Map<string, Fighter>();
  private obstacleRadii = new Map<string, Float32Array>();
  private obstacleSets = new Map<string, Float32Array>();
  private obstacleGrid = new StarCollisionGrid();
  private obstaclesDirty = false;
  private parkedShipPositions = new Map<string, THREE.Vector3>();
  private projectiles: Projectile[] = [];
  private impacts: Impact[] = [];
  private impactSequence = 0;
  private eliminationQueue: EliminationEvent[] = [];
  private recentEliminations: EliminationEvent[] = [];
  private readonly scoreRecords = new Map<string, { kills: number; deaths: number }>();
  private layoutRequirements: LayoutRequirement[] = [];
  private readonly layoutBlocked = new Set<string>();
  private phase: RoundPhase = "combat";
  private phaseUntil = 0;
  private winnerId = "";
  private roundId = 1;
  private readonly ray = new THREE.Vector3();
  epoch: number;

  constructor(epoch = 1) { this.epoch = epoch; }

  add(member: AnonymousPlayer): void {
    if (this.players.has(member.id) || this.players.size >= 4) return;
    const origin = SLOTS[clamp(Math.floor(member.slot), 0, 3)];
    this.players.set(member.id, {
      id: member.id, slot: member.slot, pos: new THREE.Vector3(origin[0], origin[1], origin[2] + 80), vel: new THREE.Vector3(), rot: new THREE.Quaternion(), spin: new THREE.Vector3(),
      input: { ...FULL }, health: HULL_MAX, shields: SHIELD_MAX, shieldDelay: 0, damagePause: 0, weapon: 0, heat: 0, overheated: false, ammunition: 36, deaths: 0,
      energy: 1, boostLocked: false, regenDelay: 0, emptyWait: 0, respawnAt: 0, protectedUntil: 0, resumeAt: 0, fireAt: 0, inputAt: 0, active: false, docked: false,
      weaponSequence: 0, inputSequence: 0, receivedInputSequence: 0, inputTick: 0, receivedInputTick: 0, tickQueue: new Map(), mouseX: 0, mouseY: 0, mouseQueue: [], resumeAfterRespawn: false, lastFireSequence: 0, fireCooldownDuration: 160, travel: null,
      profile: member.profile ?? DEFAULT_PILOT_PROFILE, bank: 0, tilt: 0, kills: this.scoreRecords.get(member.id)?.kills ?? 0,
    });
    if (!this.scoreRecords.has(member.id)) this.scoreRecords.set(member.id, { kills: 0, deaths: 0 });
  }

  setProfile(id: string, profile: PilotProfile): void { const p = this.players.get(id); if (p) p.profile = profile; }

  get roundPhase(): RoundPhase { return this.phase; }
  get currentRoundId(): number { return this.roundId; }
  hasLayoutRequirements(): boolean { return this.layoutRequirements.length > 0; }
  get blockedLayoutIds(): readonly string[] { return [...this.layoutBlocked]; }
  requireLayouts(requirements: LayoutRequirement[]): void { this.layoutRequirements = requirements.map(item => ({ ...item })); }
  startCountdown(now: number): void { if (this.phase === "waiting") { this.phase = "countdown"; this.phaseUntil = now + 3000; } }
  drainEliminations(): EliminationEvent[] { const events = this.eliminationQueue; this.eliminationQueue = []; return events; }
  roundSnapshot(now: number): RoundSnapshot {
    return { epoch: this.epoch, roundId: this.roundId, phase: this.phase, phaseRemainingMs: Math.max(0, this.phaseUntil - now), winnerId: this.winnerId,
      scores: [...this.scoreRecords].map(([playerId, score]) => ({ playerId, ...score })), layoutRequirements: this.layoutRequirements.map(item => ({ ...item })) };
  }
  layoutReady(id: string, revision: number): boolean {
    const required = this.layoutRequirements.find(item => item.playerId === id);
    return !this.layoutBlocked.has(id) && (!required || revision >= required.revision);
  }
  markLayoutReady(id: string): void { this.layoutBlocked.delete(id); }
  isFlying(id: string): boolean { const player = this.players.get(id); return !!player?.active && player.health > 0; }
  demoteForLateLayout(id: string, now: number): void {
    const player = this.players.get(id); if (!player) return;
    player.active = false; player.input = { ...FULL }; player.resumeAt = now + 5000; player.travel = null; player.vel.set(0, 0, 0); this.layoutBlocked.add(id);
  }

  remove(id: string): void { this.players.delete(id); this.parkedShipPositions.delete(id); this.layoutBlocked.delete(id); this.layoutRequirements = this.layoutRequirements.filter(item => item.playerId !== id); this.removeObstacleSet(id); this.projectiles = this.projectiles.filter(s => s.ownerId !== id); }

  setObstacleSet(id: string, values: Float32Array, radii?: Float32Array): void {
    if (values.length % 3 !== 0 || values.length > 60_000) return;
    for (const v of values) if (!Number.isFinite(v) || Math.abs(v) > 1_000_000) return;
    if (radii && (radii.length !== values.length / 3 || !radii.every(r => Number.isFinite(r) && r > 0 && r <= 250))) return;
    if (radii) this.obstacleRadii.set(id, radii); else this.obstacleRadii.delete(id);
    this.obstacleSets.set(id, values); this.obstaclesDirty = true;
  }

  /** Parked hulls stop space bolts but stay outside the flight collision grid. */
  setParkedShipPositions(ships: readonly { id: string; position: readonly [number, number, number] }[]): void {
    const next = new Map<string, THREE.Vector3>();
    for (const ship of ships.slice(0, 4)) {
      if (typeof ship.id !== "string" || !ship.id || !ship.position.every(value => Number.isFinite(value) && Math.abs(value) <= 1_000_000)) continue;
      next.set(ship.id, new THREE.Vector3(...ship.position));
    }
    this.parkedShipPositions = next;
  }

  removeObstacleSet(id: string): void { this.obstacleSets.delete(id); this.obstacleRadii.delete(id); this.obstaclesDirty = true; }

  setInput(id: string, input: FlightInput, now: number): void {
    const p = this.players.get(id); if (!p || p.docked) return;
    const sequence = Number.isSafeInteger(input.sequence) && input.sequence > 0 ? input.sequence : p.receivedInputSequence + 1;
    if (sequence <= p.receivedInputSequence && !input.ticks?.length) return;
    const normalized: FlightInput = { ...FULL, ...input, sequence,
      mouseMode: input.mouseMode === "cursor" ? "cursor" : "capture", mouseSamples: isUnknownArray(input.mouseSamples) ? input.mouseSamples.slice(0, 8) : [],
      sensitivity: Number.isFinite(input.sensitivity) ? clamp(input.sensitivity, 0.2, 4) : 1, agility: Number.isFinite(input.agility) ? clamp(input.agility, 0.1, 4) : 1 };
    p.receivedInputSequence = Math.max(p.receivedInputSequence, sequence); p.inputSequence = p.receivedInputSequence;
    p.inputAt = now;
    const ticks: FlightTick[] = input.ticks?.length ? input.ticks : [{
      tick: sequence, thrust: normalized.thrust, strafe: normalized.strafe, lift: normalized.lift, roll: normalized.roll, pitch: normalized.pitch, yaw: normalized.yaw,
      boost: normalized.boost, brake: normalized.brake, active: normalized.active, mouseMode: normalized.mouseMode,
      mouseDelta: normalized.mouseSamples[0] ?? [0, 0], sensitivity: normalized.sensitivity, agility: normalized.agility, invertY: normalized.invertY,
    }];
    for (const tick of ticks) {
      if (!this.validFlightTick(tick) || tick.tick <= p.inputTick || tick.tick > p.inputTick + 120 || p.tickQueue.has(tick.tick)) continue;
      if (this.phase !== "combat" && tick.active) continue;
      if (tick.active && this.layoutBlocked.has(id)) continue;
      if (p.tickQueue.size >= 120) break;
      p.tickQueue.set(tick.tick, { ...tick, mouseDelta: [...tick.mouseDelta] as [number, number] });
      p.receivedInputTick = Math.max(p.receivedInputTick, tick.tick);
    }
    if (p.travel && ticks.some(tick => tick.active && (tick.thrust !== 0 || tick.strafe !== 0 || tick.lift !== 0 || tick.roll !== 0 || tick.pitch !== 0 || tick.yaw !== 0 || tick.boost || tick.brake || input.fire))) p.travel = null;
    const stop = [...ticks].filter(tick => this.validFlightTick(tick) && !tick.active).sort((a, b) => b.tick - a.tick)[0];
    if (stop && stop.tick > p.inputTick) {
      if (p.health <= 0) p.resumeAfterRespawn = false;
      else if (p.active) p.resumeAt = now + 5000;
      p.active = false; p.input = { ...FULL }; p.travel = null; p.vel.set(0, 0, 0);
      p.tickQueue.clear(); p.inputTick = stop.tick; p.receivedInputTick = Math.max(p.receivedInputTick, stop.tick);
    }
  }

  setWeapon(id: string, sequence: number, weapon: 0 | 1, now: number): void {
    const p = this.players.get(id);
    if (!p || this.phase !== "combat" || !p.active || p.health <= 0 || !Number.isSafeInteger(sequence) || sequence < 1 || sequence <= p.weaponSequence || (weapon !== 0 && weapon !== 1)) return;
    p.weapon = weapon; p.weaponSequence = sequence; p.inputAt = Math.max(p.inputAt, now);
  }

  /** Park a ship while its pilot is in a node arena; it cannot fly or fire until explicitly returned. */
  setSurfaceDocked(id: string, docked: boolean, ship?: { position: [number, number, number]; rotation: [number, number, number, number]; velocity: [number, number, number] }, now = Date.now()): boolean {
    const player = this.players.get(id);
    if (!player) return false;
    if (docked) {
      if (player.docked || !player.active || player.health <= 0 || this.phase !== "combat") return false;
      player.docked = true; player.active = false; player.input = { ...FULL }; player.tickQueue.clear();
      player.receivedInputTick = player.inputTick; player.vel.set(0, 0, 0); player.spin.set(0, 0, 0); player.travel = null;
      player.mouseX = player.mouseY = 0; player.mouseQueue.length = 0; player.resumeAt = 0;
      return true;
    }
    if (!player.docked || !ship || !ship.position.every(Number.isFinite) || !ship.rotation.every(Number.isFinite) || !ship.velocity.every(Number.isFinite)) return false;
    player.docked = false; player.pos.fromArray(ship.position); player.rot.set(...ship.rotation).normalize(); player.vel.fromArray(ship.velocity); player.spin.set(0, 0, 0);
    player.active = true; player.input = { ...FULL, active: true }; player.resumeAt = 0; player.protectedUntil = now + 3000;
    return true;
  }

  isSurfaceDocked(id: string): boolean { return this.players.get(id)?.docked ?? false; }

  recordSurfaceElimination(attackerId: string, victimId: string, shotId: string, now: number): EliminationEvent | null {
    if (this.phase !== "combat" || this.winnerId || !shotId || !Number.isSafeInteger(now) || attackerId === victimId) return null;
    const attacker = this.players.get(attackerId), victim = this.players.get(victimId);
    if (!attacker || !victim) return null;
    attacker.kills++; victim.deaths++;
    const attackerScore = this.scoreRecords.get(attackerId) ?? { kills: attacker.kills - 1, deaths: attacker.deaths };
    attackerScore.kills = attacker.kills; this.scoreRecords.set(attackerId, attackerScore);
    const victimScore = this.scoreRecords.get(victimId) ?? { kills: victim.kills, deaths: victim.deaths - 1 };
    victimScore.deaths = victim.deaths; this.scoreRecords.set(victimId, victimScore);
    const event = { id: `${this.roundId}:surface:${shotId}`, roundId: this.roundId, attackerId, victimId, attackerScore: attacker.kills, at: now };
    this.eliminationQueue.push(event); this.recentEliminations.push(event);
    if (this.recentEliminations.length > 12) this.recentEliminations.shift();
    if (attacker.kills >= PLAYER_KILLS_TO_WIN) {
      this.winnerId = attackerId; this.phase = "supernova"; this.phaseUntil = now + 8000; this.layoutRequirements = [];
      this.projectiles = []; this.impacts = [];
      for (const player of this.players.values()) { player.travel = null; player.input = { ...FULL, active: player.active }; }
    }
    return event;
  }

  startTravel(id: string, destination: [number, number, number], radius: number, now: number): boolean {
    const p = this.players.get(id);
    if (this.phase !== "combat" || !p || !p.active || p.health <= 0 || !destination.every(Number.isFinite) || !Number.isFinite(radius) || radius < 0 || radius > 100) return false;
    const target = new THREE.Vector3(...destination), direction = target.clone().sub(p.pos), distance = direction.length();
    if (distance < 10) return false;
    direction.normalize();
    const stop = Math.min(Math.max(20, 70 + radius * 6), distance * 0.4);
    const end = target.addScaledVector(direction, -stop);
    const look = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), direction);
    const duration = clamp(800 + end.distanceTo(p.pos) / 180 * 1000, 1200, 6000);
    p.travel = { from: p.pos.toArray(), to: end.toArray(),
      rotationFrom: [p.rot.x, p.rot.y, p.rot.z, p.rot.w], rotationTo: [look.x, look.y, look.z, look.w], startedAt: now, duration };
    p.vel.set(0, 0, 0);
    return true;
  }

  fireShot(id: string, sequence: number, gun: number, now: number, aimPoint?: [number, number, number], _weapon: 0 | 1 = 0): boolean {
    const p = this.players.get(id);
    if (this.phase !== "combat" || !p || p.docked || !p.active || p.health <= 0 || !Number.isSafeInteger(sequence) || sequence < 1 || sequence <= p.lastFireSequence || !Number.isInteger(gun) || gun < 0 || gun > 3 || now < p.fireAt) return false;
    const weapon = p.weapon;
    if (_weapon !== weapon || (weapon === 0 && p.overheated) || (weapon === 1 && p.ammunition <= 0)) return false;
    if (aimPoint && !this.validVec(aimPoint, 1_000_000)) return false;
    if (!this.fire(p, sequence, gun, now, aimPoint, weapon)) return false;
    if (weapon === 0) { p.heat = Math.min(1, p.heat + 0.1); if (p.heat >= 1) p.overheated = true; }
    else p.ammunition--;
    p.travel = null; p.protectedUntil = 0;
    p.lastFireSequence = sequence; p.fireCooldownDuration = weapon === 0 ? 160 : 500; p.fireAt = now + p.fireCooldownDuration;
    return true;
  }

  step(dt: number, now: number): void {
    if (this.obstaclesDirty) this.rebuildObstacleGrid();
    if (this.phase !== "combat") {
      if (this.phase === "supernova" && now >= this.phaseUntil) { this.phase = "waiting"; this.phaseUntil = now + 15_000; }
      else if (this.phase === "countdown" && now >= this.phaseUntil) this.beginNextRound(now);
      return;
    }
    for (const p of this.players.values()) {
      if (p.docked) { p.vel.set(0, 0, 0); continue; }
      p.heat = Math.max(0, p.heat - 0.26 * dt);
      if (p.overheated && p.heat <= 0.4) p.overheated = false;
      if (p.shieldDelay > 0) p.shieldDelay = Math.max(0, p.shieldDelay - dt);
      else p.shields = Math.min(SHIELD_MAX, p.shields + SHIELD_REGEN * dt);
      p.damagePause = Math.max(0, p.damagePause - dt);
      if (p.health <= 0) {
        p.active = false; p.travel = null; p.input = { ...FULL, active: p.resumeAfterRespawn };
        if (now >= p.respawnAt) this.respawn(p, now);
        continue;
      }
      const wasActive = p.active;
      let mouseDX = 0, mouseDY = 0;
      let nextTick = p.tickQueue.get(p.inputTick + 1);
      if (!nextTick && p.tickQueue.size) {
        const earliest = Math.min(...p.tickQueue.keys());
        if (earliest - p.inputTick > 12) {
          // The resend window no longer covers the missing tick. Advance from a neutral
          // state so stale movement cannot be replayed when the input stream resumes.
          p.inputTick = earliest - 1; p.inputSequence = p.receivedInputSequence;
          p.input = { ...FULL, active: p.active };
          nextTick = p.tickQueue.get(earliest);
        }
      }
      if (nextTick) {
        p.tickQueue.delete(nextTick.tick);
        p.inputTick = nextTick.tick;
        p.input = { ...FULL, ...nextTick, sequence: nextTick.tick, fire: false, mouseSamples: [], ticks: undefined };
        mouseDX = nextTick.mouseDelta[0]; mouseDY = nextTick.mouseDelta[1];
      }
      const wantsActive = p.input.active;
      if (wasActive && !wantsActive) { p.active = false; p.resumeAt = now + 5000; p.vel.set(0, 0, 0); p.input = { ...FULL }; p.mouseQueue.length = 0; }
      else if (!wasActive && wantsActive) { if (!p.resumeAt || now >= p.resumeAt) { p.active = true; p.resumeAt = 0; } }
      if (!p.active) continue;
      const i = p.input;
      [p.bank, p.tilt] = stepPresentation(p.bank, p.tilt, i, dt, p.spin);
      if (p.travel) {
        const t = clamp((now - p.travel.startedAt) / p.travel.duration, 0, 1), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        p.pos.fromArray(p.travel.from).lerp(new THREE.Vector3(...p.travel.to), e);
        p.rot.set(...p.travel.rotationFrom).normalize().slerp(new THREE.Quaternion(...p.travel.rotationTo).normalize(), Math.min(1, e * 1.6));
        p.vel.set(0, 0, 0);
        if (t >= 1) p.travel = null;
        continue;
      }
      const boost = stepBoostResources(p, i, dt);
      p.energy = boost.energy; p.emptyWait = boost.emptyWait; p.regenDelay = boost.regenDelay; p.boostLocked = boost.boostLocked;
      const wantsBoost = boost.boosting;
      const speed01 = clamp(p.vel.length() / (FLIGHT.roomCruise * Math.sqrt(FLIGHT.boostAcceleration)), 0, 1);
      const mouseState = { x: p.mouseX, y: p.mouseY };
      stepFlightRotation(p.rot, p.spin, i, dt, i.agility * (1 - 0.3 * speed01) * (wantsBoost ? 0.8 : 1), {
        mode: i.mouseMode, mouseDX, mouseDY, sensitivity: i.sensitivity, inputAgility: i.agility, invertY: i.invertY, mouseState,
      });
      p.mouseX = mouseState.x; p.mouseY = mouseState.y;
      stepFlightVelocity(p.vel, p.rot, p.spin, i, dt, FLIGHT.roomCruise, wantsBoost);
      p.pos.addScaledVector(p.vel, dt);
      this.collide(p);
    }
    this.stepProjectiles(dt, now);
  }

  private rebuildObstacleGrid(): void {
    this.obstacleGrid.rebuild(this.obstacleSets.values(), [...this.obstacleSets.keys()].map(id => this.obstacleRadii.get(id) ?? []));
    this.obstaclesDirty = false;
  }

  private collide(p: Fighter): void {
    this.obstacleGrid.resolve(p.pos, p.vel);
  }

  private fire(shooter: Fighter, sequence: number, gun: number, now: number, aimPoint: [number, number, number] | undefined, weapon: 0 | 1): boolean {
    const forward = this.ray.set(0, 0, -1).applyQuaternion(shooter.rot).normalize();
    const presentation = new THREE.Quaternion().setFromEuler(new THREE.Euler(shooter.tilt, 0, shooter.bank));
    const cannonRotation = shooter.rot.clone().multiply(presentation);
    const muzzle = new THREE.Vector3(...shipMuzzles(shooter.profile.ship)[gun]).multiplyScalar(MULTIPLAYER_SHIP_SCALE).applyQuaternion(cannonRotation);
    const pos = shooter.pos.clone().add(muzzle), origin = pos.toArray();
    const target = aimPoint ? new THREE.Vector3(...aimPoint) : shooter.pos.clone().addScaledVector(forward, 900);
    const direction = target.sub(pos), range = direction.length();
    if (range < 1e-3) direction.copy(forward);
    else direction.divideScalar(range);
    // A client may choose its aiming point, but cannot fire behind itself or at unbounded range.
    if (direction.dot(forward) < 0.25 || (aimPoint && range > 2_000)) return false;
    if (shooter.protectedUntil > now) shooter.protectedUntil = 0;
    const speed = weaponStats(weapon).speed + shooter.vel.length();
    this.projectiles.push({ id: `${shooter.id}:${sequence}`, ownerId: shooter.id, gun, weapon, origin, pos, direction, velocity: direction.clone().multiplyScalar(speed), speed, remaining: BOLT_REACH, travelled: 0, sound: shooter.profile.laser, startedAt: now });
    return true;
  }

  private stepProjectiles(dt: number, now: number): void {
    const keep: Projectile[] = [];
    for (const shot of this.projectiles) {
      const start = shot.pos.clone(), end = start.clone().addScaledVector(shot.velocity, dt), segment = end.clone().sub(start), lengthSq = segment.lengthSq();
      let firstT = 1.1, hitPlayer: Fighter | null = null, hitStar = false;
      for (const target of this.players.values()) {
        if (target.id === shot.ownerId || !target.active || target.health <= 0 || target.protectedUntil > now) continue;
        const relative = target.pos.clone().sub(start), t = lengthSq ? clamp(relative.dot(segment) / lengthSq, 0, 1) : 0;
        const nearest = start.clone().addScaledVector(segment, t);
        if (nearest.distanceToSquared(target.pos) <= SHIP_HIT_RADIUS * SHIP_HIT_RADIUS && t < firstT) { firstT = t; hitPlayer = target; hitStar = false; }
      }
      const minX = Math.floor((Math.min(start.x, end.x) - 6) / 80), maxX = Math.floor((Math.max(start.x, end.x) + 6) / 80);
      const minY = Math.floor((Math.min(start.y, end.y) - 6) / 80), maxY = Math.floor((Math.max(start.y, end.y) + 6) / 80);
      const minZ = Math.floor((Math.min(start.z, end.z) - 6) / 80), maxZ = Math.floor((Math.max(start.z, end.z) + 6) / 80);
      for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) {
        for (const node of this.obstacleGrid.getCell(x, y, z)) {
          const point = new THREE.Vector3(...node), relative = point.clone().sub(start), t = lengthSq ? clamp(relative.dot(segment) / lengthSq, 0, 1) : 0;
          if (t >= firstT) continue;
          const nearest = start.clone().addScaledVector(segment, t);
          if (nearest.distanceToSquared(point) <= (node.radius ?? 6) ** 2) { firstT = t; hitPlayer = null; hitStar = true; }
        }
      }
      // A parked ship is a small, projectile-only obstacle. It cannot take damage and never blocks another ship.
      for (const [parkedId, point] of this.parkedShipPositions) {
        if (parkedId === shot.ownerId) continue;
        const relative = point.clone().sub(start), t = lengthSq ? clamp(relative.dot(segment) / lengthSq, 0, 1) : 0;
        if (t >= firstT) continue;
        const nearest = start.clone().addScaledVector(segment, t);
        if (nearest.distanceToSquared(point) <= 2.25) { firstT = t; hitPlayer = null; hitStar = true; }
      }
      if (hitPlayer || hitStar) {
        const impactPos = start.clone().addScaledVector(segment, firstT);
        this.impacts.push({ id: `${shot.id}:impact:${++this.impactSequence}`, position: impactPos.toArray(), kind: hitPlayer ? "ship" : "star", at: now });
        if (hitPlayer) {
          const wasAlive = hitPlayer.health > 0;
          const shotDistance = shot.travelled + Math.sqrt(lengthSq) * firstT;
          let damage = damageAt(shot.weapon, shotDistance);
          const shieldDamage = Math.min(hitPlayer.shields, damage);
          hitPlayer.shields -= shieldDamage; damage -= shieldDamage;
          if (damage > 0) hitPlayer.health = Math.max(0, hitPlayer.health - damage);
          hitPlayer.shieldDelay = SHIELD_DELAY; hitPlayer.damagePause = 2;
          if (wasAlive && hitPlayer.health === 0) {
            hitPlayer.resumeAfterRespawn = hitPlayer.active; hitPlayer.active = false; hitPlayer.respawnAt = now + 5000; hitPlayer.vel.set(0, 0, 0); hitPlayer.input = { ...FULL, active: hitPlayer.resumeAfterRespawn };
            hitPlayer.deaths++;
            const victimScore = this.scoreRecords.get(hitPlayer.id) ?? { kills: hitPlayer.kills, deaths: 0 };
            victimScore.deaths = hitPlayer.deaths; this.scoreRecords.set(hitPlayer.id, victimScore);
            const attacker = this.players.get(shot.ownerId);
            if (attacker && attacker.id !== hitPlayer.id && this.phase === "combat" && !this.winnerId) {
              attacker.kills++; attacker.health = Math.min(HULL_MAX, attacker.health + 30); attacker.shields = SHIELD_MAX;
              const score = this.scoreRecords.get(attacker.id) ?? { kills: 0, deaths: attacker.deaths };
              score.kills = attacker.kills; this.scoreRecords.set(attacker.id, score);
              const event = { id: `${this.roundId}:${shot.id}`, roundId: this.roundId, attackerId: attacker.id, victimId: hitPlayer.id, attackerScore: attacker.kills, at: now };
              this.eliminationQueue.push(event); this.recentEliminations.push(event);
              if (this.recentEliminations.length > 12) this.recentEliminations.shift();
              if (attacker.kills >= PLAYER_KILLS_TO_WIN) {
                this.winnerId = attacker.id; this.phase = "supernova"; this.phaseUntil = now + 8000; this.layoutRequirements = [];
                this.projectiles = []; this.impacts = [];
                for (const player of this.players.values()) { player.travel = null; player.input = { ...FULL, active: player.active }; }
                break;
              }
            }
          }
        }
        continue;
      }
      const travelled = Math.sqrt(lengthSq); shot.pos.copy(end); shot.remaining -= travelled; shot.travelled += travelled;
      if (shot.remaining > 0) keep.push(shot);
    }
    this.projectiles = this.phase === "combat" ? keep : [];
    this.impacts = this.impacts.filter(i => now - i.at <= 400);
  }

  private beginNextRound(now: number): void {
    this.roundId++;
    this.phase = "combat"; this.phaseUntil = 0; this.winnerId = "";
    this.scoreRecords.clear();
    this.projectiles = []; this.impacts = []; this.eliminationQueue = []; this.recentEliminations = [];
    for (const player of this.players.values()) {
      const resumesFlying = player.health <= 0 ? player.resumeAfterRespawn : player.active;
      player.kills = 0; player.deaths = 0; this.scoreRecords.set(player.id, { kills: 0, deaths: 0 });
      player.health = HULL_MAX; player.shields = SHIELD_MAX; player.shieldDelay = 0; player.damagePause = 0; player.weapon = 0; player.heat = 0; player.overheated = false; player.ammunition = 36;
      player.energy = 1; player.boostLocked = false; player.regenDelay = 0; player.emptyWait = 0;
      player.respawnAt = 0; player.protectedUntil = now + 3000; player.vel.set(0, 0, 0); player.spin.set(0, 0, 0); player.bank = 0; player.tilt = 0; player.travel = null;
      player.active = player.docked ? false : resumesFlying; player.resumeAfterRespawn = false;
      player.fireAt = 0; player.fireCooldownDuration = 160; player.input = { ...FULL, active: player.active }; player.mouseX = player.mouseY = 0; player.mouseQueue.length = 0;
      player.tickQueue.clear(); player.receivedInputTick = player.inputTick;
    }
  }

  private respawn(p: Fighter, now: number): void {
    const origin = SLOTS[clamp(Math.floor(p.slot), 0, 3)];
    p.pos.set(origin[0], origin[1], origin[2] + 80); p.vel.set(0, 0, 0); p.spin.set(0, 0, 0); p.rot.identity(); p.bank = 0; p.tilt = 0; p.health = HULL_MAX; p.shields = SHIELD_MAX; p.shieldDelay = 0; p.damagePause = 0;
    p.weapon = 0; p.heat = 0; p.overheated = false; p.ammunition = 36; p.energy = 1; p.boostLocked = false; p.emptyWait = 0; p.regenDelay = 0;
    p.respawnAt = 0; p.protectedUntil = now + 3000; p.resumeAt = 0; p.travel = null; p.active = p.resumeAfterRespawn; p.fireAt = now; p.fireCooldownDuration = 160;
    p.input = { ...FULL, active: p.resumeAfterRespawn }; p.mouseX = p.mouseY = 0; p.mouseQueue.length = 0; p.tickQueue.clear(); p.resumeAfterRespawn = false;
  }

  snapshot(now: number): RoomCheckpoint {
    return { version: 14, epoch: this.epoch, at: now, round: { roundId: this.roundId, phase: this.phase, phaseRemainingMs: Math.max(0, this.phaseUntil - now), winnerId: this.winnerId,
      scores: [...this.scoreRecords].map(([playerId, score]) => ({ playerId, ...score })), layoutRequirements: this.layoutRequirements.map(item => ({ ...item })), layoutBlocked: [...this.layoutBlocked], recentEliminations: this.recentEliminations.slice(-12) }, players: [...this.players.values()].map(p => ({
      id: p.id, slot: p.slot, position: p.pos.toArray(), rotation: [p.rot.x, p.rot.y, p.rot.z, p.rot.w], velocity: p.vel.toArray(), spin: p.spin.toArray(), input: { ...p.input },
      health: p.health, shields: p.shields, shieldDelay: p.shieldDelay, damagePause: p.damagePause, weapon: p.weapon, heat: p.heat, overheated: p.overheated, ammunition: p.ammunition, deaths: p.deaths,
      energy: p.energy, boostLocked: p.boostLocked, regenDelay: p.regenDelay, emptyWait: p.emptyWait, respawnAt: Math.max(0, p.respawnAt - now),
      protectedUntil: Math.max(0, p.protectedUntil - now), resumeAt: Math.max(0, p.resumeAt - now), fireAt: Math.max(0, p.fireAt - now), active: p.active, docked: p.docked, resumeAfterRespawn: p.resumeAfterRespawn,
       lastFireSequence: p.lastFireSequence, weaponSequence: p.weaponSequence, inputSequence: p.inputSequence, receivedInputSequence: p.receivedInputSequence,
       inputTick: p.inputTick, receivedInputTick: p.receivedInputTick, tickQueue: [...p.tickQueue.values()].map(item => ({ ...item, mouseDelta: [...item.mouseDelta] as [number, number] })), fireCooldownDuration: p.fireCooldownDuration,
       mouseX: p.mouseX, mouseY: p.mouseY, mouseQueue: p.mouseQueue.map(item => ({ ...item })), bank: p.bank, tilt: p.tilt,
      travel: p.travel ? { from: p.travel.from, to: p.travel.to, rotationFrom: p.travel.rotationFrom, rotationTo: p.travel.rotationTo, elapsed: Math.max(0, Math.min(p.travel.duration, now - p.travel.startedAt)), duration: p.travel.duration } : null,
    })), shots: this.projectiles.map(s => ({ id: s.id, ownerId: s.ownerId, gun: s.gun, weapon: s.weapon, origin: s.origin, position: s.pos.toArray(), direction: s.direction.toArray(), speed: s.speed, remaining: s.remaining, travelled: s.travelled, sound: s.sound, startedAt: s.startedAt })) };
  }

  restore(value: unknown, now: number, ageMs = 0): boolean {
    if (!value || typeof value !== "object") return false;
    const state = value as RoomCheckpoint;
    if (state.version !== 14 || !isUnknownArray(state.players) || state.players.length > 4 || !Number.isSafeInteger(state.epoch)
      || !Number.isSafeInteger(state.at) || !Number.isFinite(ageMs) || ageMs < 0 || ageMs > 15_000 || !isUnknownArray(state.shots) || state.shots.length > 128) return false;
    const next = new Map<string, Fighter>();
    for (const item of state.players) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || !Number.isInteger(item.slot) || item.slot < 0 || item.slot > 3 || !this.validVec(item.position, 1_000_000) || !this.validVec(item.velocity, 20_000) || !this.validVec(item.spin, 20)
        || !isUnknownArray(item.rotation) || item.rotation.length !== 4 || !item.rotation.every(Number.isFinite) || item.rotation.every(v => v === 0)
        || !Number.isFinite(item.health) || item.health < 0 || item.health > HULL_MAX || !Number.isFinite(item.shields) || item.shields < 0 || item.shields > SHIELD_MAX
        || !Number.isFinite(item.energy) || item.energy < 0 || item.energy > 1 || typeof item.boostLocked !== "boolean" || !this.validInput(item.input)
         || ![item.shieldDelay, item.damagePause, item.heat, item.ammunition, item.deaths, item.regenDelay, item.emptyWait, item.respawnAt, item.protectedUntil, item.resumeAt, item.fireAt, item.lastFireSequence, item.weaponSequence, item.inputSequence, item.receivedInputSequence, item.inputTick, item.receivedInputTick, item.fireCooldownDuration, item.mouseX, item.mouseY, item.bank, item.tilt].every(Number.isFinite)
        || item.shieldDelay < 0 || item.shieldDelay > SHIELD_DELAY || item.damagePause < 0 || item.damagePause > 2 || item.heat < 0 || item.heat > 1 || typeof item.overheated !== "boolean"
        || (item.weapon !== 0 && item.weapon !== 1) || !Number.isInteger(item.ammunition) || item.ammunition < 0 || item.ammunition > 36 || !Number.isInteger(item.deaths) || item.deaths < 0
        || Math.abs(item.bank) > 0.56 || Math.abs(item.tilt) > 0.41
        || item.lastFireSequence < 0 || !Number.isSafeInteger(item.lastFireSequence) || !Number.isSafeInteger(item.weaponSequence) || item.weaponSequence < 0
         || !Number.isSafeInteger(item.inputSequence) || item.inputSequence < 0 || !Number.isSafeInteger(item.receivedInputSequence) || item.receivedInputSequence < item.inputSequence
         || !Number.isSafeInteger(item.inputTick) || item.inputTick < 0 || !Number.isSafeInteger(item.receivedInputTick) || item.receivedInputTick < item.inputTick || item.receivedInputTick - item.inputTick > 120
         || (item.fireCooldownDuration !== 160 && item.fireCooldownDuration !== 500)
         || !isUnknownArray(item.tickQueue) || item.tickQueue.length > 120 || item.tickQueue.some(tick => !this.validFlightTick(tick) || tick.tick <= item.inputTick || tick.tick > item.inputTick + 120)
        || Math.abs(item.mouseX) > 500 || Math.abs(item.mouseY) > 500 || !isUnknownArray(item.mouseQueue) || item.mouseQueue.length > 48
        || item.mouseQueue.some(sample => !sample || !Number.isSafeInteger(sample.sequence) || sample.sequence < 1 || !Number.isFinite(sample.dx) || Math.abs(sample.dx) > 500 || !Number.isFinite(sample.dy) || Math.abs(sample.dy) > 500 || typeof sample.last !== "boolean")
        || typeof item.active !== "boolean" || (item.docked !== undefined && typeof item.docked !== "boolean") || typeof item.resumeAfterRespawn !== "boolean" || next.has(item.id)
        || (item.travel !== null && (!item.travel || !this.validVec(item.travel.from, 1_000_000) || !this.validVec(item.travel.to, 1_000_000)
          || !isUnknownArray(item.travel.rotationFrom) || item.travel.rotationFrom.length !== 4 || !item.travel.rotationFrom.every(Number.isFinite)
          || !isUnknownArray(item.travel.rotationTo) || item.travel.rotationTo.length !== 4 || !item.travel.rotationTo.every(Number.isFinite)
          || !Number.isFinite(item.travel.elapsed) || !Number.isFinite(item.travel.duration) || item.travel.duration < 1200 || item.travel.duration > 6000
          || item.travel.elapsed < 0 || item.travel.elapsed > item.travel.duration))) return false;
      const p = { id: item.id, slot: item.slot, pos: new THREE.Vector3(...item.position), vel: new THREE.Vector3(...item.velocity), rot: new THREE.Quaternion(...item.rotation).normalize(), spin: new THREE.Vector3(...item.spin), input: { ...item.input },
        health: item.health, shields: item.shields, shieldDelay: clamp(item.shieldDelay, 0, SHIELD_DELAY), damagePause: clamp(item.damagePause, 0, 2), weapon: item.weapon, heat: item.heat, overheated: item.overheated, ammunition: item.ammunition, deaths: item.deaths,
        energy: item.energy, boostLocked: item.boostLocked, regenDelay: clamp(item.regenDelay, 0, 1.5), emptyWait: clamp(item.emptyWait, 0, 3), respawnAt: now + Math.max(0, item.respawnAt - ageMs), protectedUntil: now + Math.max(0, item.protectedUntil - ageMs),
        resumeAt: now + Math.max(0, item.resumeAt - ageMs), fireAt: now + Math.max(0, item.fireAt - ageMs), inputAt: now, active: item.active, docked: item.docked ?? false, resumeAfterRespawn: item.resumeAfterRespawn,
        weaponSequence: item.weaponSequence, inputSequence: item.inputSequence, receivedInputSequence: item.receivedInputSequence, inputTick: item.inputTick, receivedInputTick: item.receivedInputTick,
        tickQueue: new Map(item.tickQueue.map(tick => [tick.tick, { ...tick, mouseDelta: [...tick.mouseDelta] as [number, number] }])), fireCooldownDuration: item.fireCooldownDuration,
        mouseX: item.mouseX, mouseY: item.mouseY, mouseQueue: item.mouseQueue.map(sample => ({ ...sample })),
        lastFireSequence: item.lastFireSequence, bank: item.bank, tilt: item.tilt, kills: 0, profile: DEFAULT_PILOT_PROFILE, travel: item.travel ? { from: [...item.travel.from] as [number, number, number], to: [...item.travel.to] as [number, number, number],
          rotationFrom: [...item.travel.rotationFrom] as [number, number, number, number], rotationTo: [...item.travel.rotationTo] as [number, number, number, number],
          startedAt: now - item.travel.elapsed - ageMs, duration: item.travel.duration } : null };
      next.set(p.id, p);
    }
    const shots: Projectile[] = [];
    for (const item of state.shots) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || item.id.length > 64 || typeof item.ownerId !== "string" || !next.has(item.ownerId)
        || !Number.isInteger(item.gun) || item.gun < 0 || item.gun > 3 || (item.weapon !== 0 && item.weapon !== 1) || !this.validVec(item.origin, 1_000_000)
        || !this.validVec(item.position, 1_000_000) || !this.validVec(item.direction, 1.01) || !Number.isFinite(item.remaining) || item.remaining < 0 || item.remaining > 900
        || !Number.isFinite(item.speed) || item.speed < 1 || item.speed > 20_000 || !Number.isFinite(item.travelled) || item.travelled < 0 || item.travelled > BOLT_REACH
        || !LASER_SOUND_IDS.includes(item.sound) || !Number.isSafeInteger(item.startedAt)) return false;
      const direction = new THREE.Vector3(...item.direction).normalize();
      if (direction.lengthSq() < 0.9) return false;
      shots.push({ id: item.id, ownerId: item.ownerId, gun: item.gun, weapon: item.weapon, origin: [...item.origin] as [number, number, number], pos: new THREE.Vector3(...item.position), direction, velocity: direction.clone().multiplyScalar(item.speed), speed: item.speed, remaining: item.remaining, travelled: item.travelled, sound: item.sound, startedAt: item.startedAt });
    }
    const round = state.round;
    if (!round || !Number.isSafeInteger(round.roundId) || round.roundId < 1 || !["combat", "supernova", "waiting", "countdown"].includes(round.phase)
      || !Number.isFinite(round.phaseRemainingMs) || round.phaseRemainingMs < 0 || typeof round.winnerId !== "string"
      || !isUnknownArray(round.scores) || round.scores.length > 64 || !isUnknownArray(round.layoutRequirements) || round.layoutRequirements.length > 4
      || !isUnknownArray(round.layoutBlocked) || round.layoutBlocked.length > 4
      || !isUnknownArray(round.recentEliminations) || round.recentEliminations.length > 12) return false;
    const phaseLimit = round.phase === "supernova" ? 8000 : round.phase === "waiting" ? 15_000 : round.phase === "countdown" ? 3000 : 0;
    if (round.phaseRemainingMs > phaseLimit) return false;
    const scoreIds = new Set<string>();
    for (const score of round.scores) {
      if (!score || typeof score.playerId !== "string" || score.playerId.length > 64 || scoreIds.has(score.playerId) || !Number.isInteger(score.kills) || score.kills < 0 || score.kills > PLAYER_KILLS_TO_WIN || !Number.isInteger(score.deaths) || score.deaths < 0 || score.deaths > 999) return false;
      scoreIds.add(score.playerId);
    }
    // Validate retained elimination events against the checkpoint's scores,
    // not the newly constructed Fighter defaults (which start at zero).
    const nextScores = new Map<string, { kills: number; deaths: number }>();
    for (const score of round.scores) { nextScores.set(score.playerId, { kills: score.kills, deaths: score.deaths }); const player = next.get(score.playerId); if (player) { player.kills = score.kills; player.deaths = score.deaths; } }
    const requirementIds = new Set<string>();
    for (const item of round.layoutRequirements) {
      if (!item || !next.has(item.playerId) || requirementIds.has(item.playerId) || !Number.isSafeInteger(item.revision) || item.revision < 1) return false;
      requirementIds.add(item.playerId);
    }
    const blockedIds = new Set<string>();
    for (const id of round.layoutBlocked) { if (typeof id !== "string" || !next.has(id) || blockedIds.has(id)) return false; blockedIds.add(id); }
    if (round.phase === "combat" ? round.winnerId !== "" : !round.winnerId || !round.scores.some(score => score.playerId === round.winnerId && score.kills === PLAYER_KILLS_TO_WIN)) return false;
    const eventIds = new Set<string>();
    for (const event of round.recentEliminations) {
      if (!event || typeof event.id !== "string" || event.id.length > 120 || eventIds.has(event.id) || event.roundId !== round.roundId || !nextScores.has(event.attackerId) || !nextScores.has(event.victimId) || event.attackerId === event.victimId
        || !Number.isInteger(event.attackerScore) || event.attackerScore < 1 || event.attackerScore > PLAYER_KILLS_TO_WIN || (nextScores.get(event.attackerId)?.kills ?? 0) < event.attackerScore || !Number.isSafeInteger(event.at)) return false;
      eventIds.add(event.id);
    }
    this.roundId = round.roundId; this.phase = round.phase; this.phaseUntil = now + Math.max(0, round.phaseRemainingMs - ageMs); this.winnerId = round.winnerId;
    this.layoutRequirements = round.layoutRequirements.map(item => ({ ...item })); this.layoutBlocked.clear(); round.layoutBlocked.forEach(id => this.layoutBlocked.add(id));
    this.recentEliminations = round.recentEliminations.map(event => ({ ...event })); this.eliminationQueue = [];
    this.players.clear(); for (const [id, p] of next) this.players.set(id, p);
    this.scoreRecords.clear(); for (const [id, score] of nextScores) this.scoreRecords.set(id, score);
    this.projectiles = shots; this.impacts = [];
    this.epoch = state.epoch;
    return true;
  }

  shotSnapshots(): ShotSnapshot[] {
    return this.projectiles.map(s => ({ id: s.id, ownerId: s.ownerId, gun: s.gun, weapon: s.weapon, origin: s.origin, position: s.pos.toArray(), direction: s.direction.toArray(), speed: s.speed, sound: s.sound, startedAt: s.startedAt }));
  }

  impactSnapshots(now: number): ImpactSnapshot[] {
    return this.impacts.filter(i => now - i.at <= 300).map(({ id, position, kind }) => ({ id, position, kind }));
  }

  poses(now: number): { id: string; pose: Pose }[] {
    return [...this.players.values()].map(p => ({ id: p.id, pose: {
      position: p.pos.toArray(), rotation: [p.rot.x, p.rot.y, p.rot.z, p.rot.w], velocity: p.vel.toArray(),
      spin: p.spin.toArray(), mouseSmoothing: [p.mouseX, p.mouseY],
      health: p.health, shields: p.shields, energy: p.energy, boostLocked: p.boostLocked, boostHold: p.emptyWait, regenDelay: p.regenDelay,
      damagePause: p.damagePause, weapon: p.weapon, weaponSequence: p.weaponSequence, inputSequence: p.inputSequence, inputTick: p.inputTick, heat: p.heat, overheated: p.overheated, ammunition: p.ammunition,
      weaponCooldown: Math.max(0, p.fireAt - now), weaponCooldownDuration: p.fireCooldownDuration, deaths: p.deaths,
      active: p.active && this.phase === "combat", traveling: !!p.travel, respawnAt: Math.max(0, p.respawnAt - now), protectedUntil: Math.max(0, p.protectedUntil - now),
      thrust: p.active && p.health > 0 && !p.travel ? Math.abs(p.input.thrust) + Math.abs(p.input.strafe) + Math.abs(p.input.lift) : 0,
      boosting: p.active && p.health > 0 && !p.travel && p.input.boost && p.input.thrust > 0 && p.energy > 0 && !p.boostLocked,
      bank: p.bank, tilt: p.tilt,
    } }));
  }

  private validVec(value: unknown, max: number): value is [number, number, number] { return isUnknownArray(value) && value.length === 3 && value.every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max); }
  private validInput(value: unknown): value is FlightInput {
    if (!value || typeof value !== "object") return false;
    const i = value as FlightInput;
    return [i.thrust, i.strafe, i.lift, i.roll, i.pitch, i.yaw].every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1)
      && [i.boost, i.brake, i.fire, i.active, i.invertY].every(v => typeof v === "boolean")
      && (i.mouseMode === "capture" || i.mouseMode === "cursor") && isUnknownArray(i.mouseSamples) && i.mouseSamples.length <= 8
      && i.mouseSamples.every(sample => isUnknownArray(sample) && sample.length === 2 && sample.every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 500))
      && Number.isFinite(i.sensitivity) && i.sensitivity >= 0.2 && i.sensitivity <= 4 && Number.isFinite(i.agility) && i.agility >= 0.1 && i.agility <= 4
      && (i.ticks === undefined || (isUnknownArray(i.ticks) && i.ticks.length <= 12 && i.ticks.every(tick => this.validFlightTick(tick))));
  }
  private validFlightTick(value: unknown): value is FlightTick {
    if (!value || typeof value !== "object") return false;
    const tick = value as FlightTick;
    return Number.isSafeInteger(tick.tick) && tick.tick > 0 && [tick.thrust, tick.strafe, tick.lift, tick.roll, tick.pitch, tick.yaw].every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1)
      && [tick.boost, tick.brake, tick.active, tick.invertY].every(v => typeof v === "boolean")
      && (tick.mouseMode === "capture" || tick.mouseMode === "cursor") && isUnknownArray(tick.mouseDelta) && tick.mouseDelta.length === 2 && tick.mouseDelta.every(v => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 500)
      && Number.isFinite(tick.sensitivity) && tick.sensitivity >= 0.2 && tick.sensitivity <= 4 && Number.isFinite(tick.agility) && tick.agility >= 0.1 && tick.agility <= 4;
  }
}

export interface RoomCheckpoint {
  version: 14; epoch: number; at: number; surface?: unknown;
  round: { roundId: number; phase: RoundPhase; phaseRemainingMs: number; winnerId: string; scores: Array<{ playerId: string; kills: number; deaths: number }>; layoutRequirements: LayoutRequirement[]; layoutBlocked: string[]; recentEliminations: EliminationEvent[] };
  players: Array<{ id: string; slot: number; position: [number, number, number]; rotation: [number, number, number, number]; velocity: [number, number, number]; spin: [number, number, number]; input: FlightInput;
    health: number; shields: number; shieldDelay: number; damagePause: number; weapon: 0 | 1; heat: number; overheated: boolean; ammunition: number; deaths: number; energy: number; boostLocked: boolean; regenDelay: number; emptyWait: number; respawnAt: number; protectedUntil: number; resumeAt: number; fireAt: number; active: boolean; docked?: boolean; resumeAfterRespawn: boolean;
    lastFireSequence: number; weaponSequence: number; inputSequence: number; receivedInputSequence: number; inputTick: number; receivedInputTick: number; tickQueue: FlightTick[]; fireCooldownDuration: number; mouseX: number; mouseY: number; mouseQueue: { sequence: number; dx: number; dy: number; last: boolean }[];
    bank: number; tilt: number; travel: { from: [number, number, number]; to: [number, number, number]; rotationFrom: [number, number, number, number]; rotationTo: [number, number, number, number]; elapsed: number; duration: number } | null }>;
  shots: Array<{ id: string; ownerId: string; gun: number; weapon: 0 | 1; origin: [number, number, number]; position: [number, number, number]; direction: [number, number, number]; speed: number; remaining: number; travelled: number; sound: typeof LASER_SOUND_IDS[number]; startedAt: number }>;
}
