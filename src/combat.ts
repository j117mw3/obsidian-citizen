import * as THREE from "three";
import type { AnonymousPlayer, FlightInput, ImpactSnapshot, Pose, ShotSnapshot } from "./multiplayer";
import { MULTIPLAYER_SHIP_SCALE, SHIP_MUZZLES } from "./ship";
import { DEFAULT_PILOT_PROFILE, LASER_SOUND_IDS, stepPresentation, type PilotProfile } from "./pilotProfile";
import type { EliminationEvent, LayoutRequirement, RoundPhase, RoundSnapshot } from "./rounds";

const SLOTS: [number, number, number][] = [[0, 0, 0], [2300, 0, 0], [-1150, 0, 1992], [-1150, 0, -1992]];
const FULL: FlightInput = { thrust: 0, strafe: 0, lift: 0, roll: 0, pitch: 0, yaw: 0, boost: false, brake: false, fire: false, active: false };
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

interface Fighter {
  id: string; slot: number; pos: THREE.Vector3; vel: THREE.Vector3; rot: THREE.Quaternion;
  input: FlightInput; health: number; energy: number; boostLocked: boolean; regenDelay: number; emptyWait: number;
  respawnAt: number; protectedUntil: number; resumeAt: number; fireAt: number; inputAt: number; active: boolean;
  resumeAfterRespawn: boolean; lastFireSequence: number; travel: Travel | null; profile: PilotProfile; bank: number; tilt: number; kills: number;
}
interface Travel { from: [number, number, number]; to: [number, number, number]; rotationFrom: [number, number, number, number]; rotationTo: [number, number, number, number]; startedAt: number; duration: number }
interface Projectile { id: string; ownerId: string; gun: number; origin: [number, number, number]; pos: THREE.Vector3; direction: THREE.Vector3; velocity: THREE.Vector3; remaining: number; sound: typeof LASER_SOUND_IDS[number]; startedAt: number }
interface Impact { id: string; position: [number, number, number]; kind: "star" | "ship"; at: number }

/** Small fixed-step room simulation. Vault data is never accepted by this class. */
export class CombatWorld {
  readonly players = new Map<string, Fighter>();
  private obstacleSets = new Map<string, Float32Array>();
  private obstacleGrid = new Map<string, { position: [number, number, number]; ownerId: string }[]>();
  private obstaclesDirty = false;
  private projectiles: Projectile[] = [];
  private impacts: Impact[] = [];
  private impactSequence = 0;
  private eliminationQueue: EliminationEvent[] = [];
  private recentEliminations: EliminationEvent[] = [];
  private layoutRequirements: LayoutRequirement[] = [];
  private readonly layoutBlocked = new Set<string>();
  private phase: RoundPhase = "combat";
  private phaseUntil = 0;
  private winnerId = "";
  private roundId = 1;
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3();
  private readonly toTarget = new THREE.Vector3();
  private readonly ray = new THREE.Vector3();
  private readonly spinX = new THREE.Quaternion();
  private readonly spinY = new THREE.Quaternion();
  private readonly spinZ = new THREE.Quaternion();
  epoch: number;

  constructor(epoch = 1) { this.epoch = epoch; }

  add(member: AnonymousPlayer): void {
    if (this.players.has(member.id) || this.players.size >= 4) return;
    const origin = SLOTS[clamp(Math.floor(member.slot), 0, 3)];
    this.players.set(member.id, {
      id: member.id, slot: member.slot, pos: new THREE.Vector3(origin[0], origin[1], origin[2] + 80), vel: new THREE.Vector3(), rot: new THREE.Quaternion(),
      input: { ...FULL }, health: 100, energy: 1, boostLocked: false, regenDelay: 0, emptyWait: 0, respawnAt: 0, protectedUntil: 0, resumeAt: 0, fireAt: 0, inputAt: 0, active: false, resumeAfterRespawn: false, lastFireSequence: 0, travel: null,
      profile: member.profile ?? DEFAULT_PILOT_PROFILE, bank: 0, tilt: 0, kills: 0,
    });
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
      scores: [...this.players.values()].map(player => ({ playerId: player.id, kills: player.kills })), layoutRequirements: this.layoutRequirements.map(item => ({ ...item })) };
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

  remove(id: string): void { this.players.delete(id); this.layoutBlocked.delete(id); this.layoutRequirements = this.layoutRequirements.filter(item => item.playerId !== id); this.removeObstacleSet(id); this.projectiles = this.projectiles.filter(s => s.ownerId !== id); }

  setObstacleSet(id: string, values: Float32Array): void {
    if (values.length % 3 !== 0 || values.length > 60_000) return;
    for (const v of values) if (!Number.isFinite(v) || Math.abs(v) > 1_000_000) return;
    this.obstacleSets.set(id, values); this.obstaclesDirty = true;
  }

  removeObstacleSet(id: string): void { this.obstacleSets.delete(id); this.obstaclesDirty = true; }

  setInput(id: string, input: FlightInput, now: number): void {
    const p = this.players.get(id); if (!p || (input.active && now - p.inputAt < 35)) return;
    if (this.phase !== "combat") {
      // A player can still become a spectator during a paused round transition.
      if (!input.active) { p.active = false; p.input = { ...FULL }; p.resumeAt = now + 5000; p.travel = null; p.vel.set(0, 0, 0); p.inputAt = now; }
      return;
    }
    if (input.active && this.layoutBlocked.has(id)) return;
    if (p.health <= 0) { p.resumeAfterRespawn = input.active; p.input = { ...FULL }; p.inputAt = now; return; }
    if (p.travel && (!input.active || input.thrust !== 0 || input.strafe !== 0 || input.lift !== 0 || input.roll !== 0 || input.pitch !== 0 || input.yaw !== 0 || input.boost || input.brake || input.fire)) p.travel = null;
    p.input = { ...input }; p.inputAt = now;
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
    p.travel = { from: p.pos.toArray() as [number, number, number], to: end.toArray() as [number, number, number],
      rotationFrom: [p.rot.x, p.rot.y, p.rot.z, p.rot.w], rotationTo: [look.x, look.y, look.z, look.w], startedAt: now, duration };
    p.vel.set(0, 0, 0);
    return true;
  }

  fireShot(id: string, sequence: number, gun: number, now: number, aimPoint?: [number, number, number]): boolean {
    const p = this.players.get(id);
    if (this.phase !== "combat" || !p || !p.active || p.health <= 0 || !Number.isSafeInteger(sequence) || sequence < 1 || sequence <= p.lastFireSequence || !Number.isInteger(gun) || gun < 0 || gun > 3 || now < p.fireAt) return false;
    if (aimPoint && !this.validVec(aimPoint, 1_000_000)) return false;
    if (!this.fire(p, sequence, gun, now, aimPoint)) return false;
    p.travel = null; p.protectedUntil = 0;
    p.lastFireSequence = sequence; p.fireAt = now + 160;
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
      if (p.health <= 0) {
        p.active = false; p.travel = null; p.input = { ...FULL, active: p.resumeAfterRespawn };
        if (now >= p.respawnAt) this.respawn(p, now);
        continue;
      }
      const wasActive = p.active;
      const wantsActive = p.input.active;
      if (wasActive && !wantsActive) { p.active = false; p.resumeAt = now + 5000; p.vel.set(0, 0, 0); p.input = { ...FULL }; }
      else if (!wasActive && wantsActive) { if (!p.resumeAt || now >= p.resumeAt) { p.active = true; p.resumeAt = 0; } }
      if (!p.active) continue;
      const i = p.input;
      [p.bank, p.tilt] = stepPresentation(p.bank, p.tilt, i, dt);
      if (p.travel) {
        const t = clamp((now - p.travel.startedAt) / p.travel.duration, 0, 1), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        p.pos.fromArray(p.travel.from).lerp(new THREE.Vector3(...p.travel.to), e);
        p.rot.set(...p.travel.rotationFrom).normalize().slerp(new THREE.Quaternion(...p.travel.rotationTo).normalize(), Math.min(1, e * 1.6));
        p.vel.set(0, 0, 0);
        if (t >= 1) p.travel = null;
        continue;
      }
      const wantsBoost = i.boost && i.thrust > 0 && p.energy > 0 && p.emptyWait <= 0 && !p.boostLocked;
      if (wantsBoost) { p.energy = Math.max(0, p.energy - 0.28 * dt); p.regenDelay = 1.5; if (p.energy === 0) { p.emptyWait = 3; p.boostLocked = true; } }
      else {
        p.emptyWait = Math.max(0, p.emptyWait - dt);
        p.regenDelay = Math.max(0, p.regenDelay - dt);
        if (p.emptyWait === 0 && p.regenDelay === 0) p.energy = Math.min(1, p.energy + 0.08 * dt);
        if (p.boostLocked && p.energy >= 0.3) p.boostLocked = false;
      }
      this.spinX.setFromAxisAngle(new THREE.Vector3(1, 0, 0), clamp(i.pitch, -1, 1) * 2 * dt);
      this.spinY.setFromAxisAngle(new THREE.Vector3(0, 1, 0), clamp(i.yaw, -1, 1) * 1.5 * dt);
      this.spinZ.setFromAxisAngle(new THREE.Vector3(0, 0, 1), clamp(i.roll, -1, 1) * 3 * dt);
      p.rot.multiply(this.spinX).multiply(this.spinY).multiply(this.spinZ).normalize();
      this.forward.set(0, 0, -1).applyQuaternion(p.rot);
      this.right.set(1, 0, 0).applyQuaternion(p.rot); this.up.set(0, 1, 0).applyQuaternion(p.rot);
      const accel = 70;
      p.vel.addScaledVector(this.forward, (i.thrust > 0 ? accel * (wantsBoost ? 11 : 1) : i.thrust < 0 ? -accel * 0.45 : 0) * dt);
      p.vel.addScaledVector(this.right, clamp(i.strafe, -1, 1) * accel * 0.35 * dt);
      p.vel.addScaledVector(this.up, clamp(i.lift, -1, 1) * accel * 0.35 * dt);
      let speed = p.vel.length();
      if (i.brake && speed > 0) p.vel.multiplyScalar(Math.max(0, speed - 168 * dt) / speed);
      speed = p.vel.length();
      p.vel.divideScalar(1 + (70 / 10_000) * speed * dt);
      p.pos.addScaledVector(p.vel, dt);
      this.collide(p);
    }
    this.stepProjectiles(dt, now);
  }

  private obstacleKey(x: number, y: number, z: number): string { return `${Math.floor(x / 80)},${Math.floor(y / 80)},${Math.floor(z / 80)}`; }
  private rebuildObstacleGrid(): void {
    this.obstacleGrid.clear();
    for (const [ownerId, values] of this.obstacleSets) for (let i = 0; i < values.length; i += 3) {
      const x = values[i], y = values[i + 1], z = values[i + 2], key = this.obstacleKey(x, y, z);
      const list = this.obstacleGrid.get(key) ?? []; list.push({ position: [x, y, z], ownerId }); this.obstacleGrid.set(key, list);
    }
    this.obstaclesDirty = false;
  }

  private collide(p: Fighter): void {
    const x = Math.floor(p.pos.x / 80), y = Math.floor(p.pos.y / 80), z = Math.floor(p.pos.z / 80), radius = 6;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const point of this.obstacleGrid.get(`${x + dx},${y + dy},${z + dz}`) ?? []) {
        const ox = p.pos.x - point.position[0], oy = p.pos.y - point.position[1], oz = p.pos.z - point.position[2];
        const d2 = ox * ox + oy * oy + oz * oz; if (d2 >= radius * radius) continue;
        const d = Math.sqrt(d2) || 1e-3, nx = ox / d, ny = oy / d, nz = oz / d;
        p.pos.add(new THREE.Vector3(nx, ny, nz).multiplyScalar(radius - d));
        const vn = p.vel.x * nx + p.vel.y * ny + p.vel.z * nz;
        if (vn < 0) p.vel.add(new THREE.Vector3(nx, ny, nz).multiplyScalar(-1.35 * vn));
      }
    }
  }

  private fire(shooter: Fighter, sequence: number, gun: number, now: number, aimPoint?: [number, number, number]): boolean {
    const forward = this.ray.set(0, 0, -1).applyQuaternion(shooter.rot).normalize();
    const presentation = new THREE.Quaternion().setFromEuler(new THREE.Euler(shooter.tilt, 0, shooter.bank));
    const cannonRotation = shooter.rot.clone().multiply(presentation);
    const muzzle = new THREE.Vector3(...SHIP_MUZZLES[gun]).multiplyScalar(MULTIPLAYER_SHIP_SCALE).applyQuaternion(cannonRotation);
    const pos = shooter.pos.clone().add(muzzle), origin = pos.toArray() as [number, number, number];
    const target = aimPoint ? new THREE.Vector3(...aimPoint) : shooter.pos.clone().addScaledVector(forward, 900);
    const direction = target.sub(pos), range = direction.length();
    if (range < 1e-3) direction.copy(forward);
    else direction.divideScalar(range);
    // A client may choose its aiming point, but cannot fire behind itself or at unbounded range.
    if (direction.dot(forward) < 0.25 || (aimPoint && range > 2_000)) return false;
    if (shooter.protectedUntil > now) shooter.protectedUntil = 0;
    this.projectiles.push({ id: `${shooter.id}:${sequence}`, ownerId: shooter.id, gun, origin, pos, direction, velocity: direction.clone().multiplyScalar(1500), remaining: 900, sound: shooter.profile.laser, startedAt: now });
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
        if (nearest.distanceToSquared(target.pos) <= 16 && t < firstT) { firstT = t; hitPlayer = target; hitStar = false; }
      }
      const minX = Math.floor((Math.min(start.x, end.x) - 6) / 80), maxX = Math.floor((Math.max(start.x, end.x) + 6) / 80);
      const minY = Math.floor((Math.min(start.y, end.y) - 6) / 80), maxY = Math.floor((Math.max(start.y, end.y) + 6) / 80);
      const minZ = Math.floor((Math.min(start.z, end.z) - 6) / 80), maxZ = Math.floor((Math.max(start.z, end.z) + 6) / 80);
      for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) {
        for (const node of this.obstacleGrid.get(`${x},${y},${z}`) ?? []) {
          const point = new THREE.Vector3(...node.position), relative = point.clone().sub(start), t = lengthSq ? clamp(relative.dot(segment) / lengthSq, 0, 1) : 0;
          if (t >= firstT) continue;
          const nearest = start.clone().addScaledVector(segment, t);
          if (nearest.distanceToSquared(point) <= 36) { firstT = t; hitPlayer = null; hitStar = true; }
        }
      }
      if (hitPlayer || hitStar) {
        const impactPos = start.clone().addScaledVector(segment, firstT);
        this.impacts.push({ id: `${shot.id}:impact:${++this.impactSequence}`, position: impactPos.toArray() as [number, number, number], kind: hitPlayer ? "ship" : "star", at: now });
        if (hitPlayer) {
          const wasAlive = hitPlayer.health > 0;
          hitPlayer.health = Math.max(0, hitPlayer.health - 10);
          if (wasAlive && hitPlayer.health === 0) {
            hitPlayer.resumeAfterRespawn = hitPlayer.active; hitPlayer.active = false; hitPlayer.respawnAt = now + 5000; hitPlayer.vel.set(0, 0, 0); hitPlayer.input = { ...FULL, active: hitPlayer.resumeAfterRespawn };
            const attacker = this.players.get(shot.ownerId);
            if (attacker && attacker.id !== hitPlayer.id && this.phase === "combat" && !this.winnerId) {
              attacker.kills++;
              const event = { id: `${this.roundId}:${shot.id}`, roundId: this.roundId, attackerId: attacker.id, victimId: hitPlayer.id, attackerScore: attacker.kills, at: now };
              this.eliminationQueue.push(event); this.recentEliminations.push(event);
              if (this.recentEliminations.length > 12) this.recentEliminations.shift();
              if (attacker.kills >= 5) {
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
      shot.pos.copy(end); shot.remaining -= Math.sqrt(lengthSq);
      if (shot.remaining > 0) keep.push(shot);
    }
    this.projectiles = this.phase === "combat" ? keep : [];
    this.impacts = this.impacts.filter(i => now - i.at <= 400);
  }

  private beginNextRound(now: number): void {
    this.roundId++;
    this.phase = "combat"; this.phaseUntil = 0; this.winnerId = "";
    this.projectiles = []; this.impacts = []; this.eliminationQueue = []; this.recentEliminations = [];
    for (const player of this.players.values()) {
      player.kills = 0; player.health = 100; player.energy = 1; player.boostLocked = false; player.regenDelay = 0; player.emptyWait = 0;
      player.respawnAt = 0; player.protectedUntil = player.active ? now + 3000 : 0; player.vel.set(0, 0, 0); player.rot.identity(); player.bank = 0; player.tilt = 0; player.travel = null;
      player.fireAt = 0; player.input = { ...FULL, active: player.active };
      const origin = SLOTS[clamp(Math.floor(player.slot), 0, 3)]; player.pos.set(origin[0], origin[1], origin[2] + 80);
    }
  }

  private respawn(p: Fighter, now: number): void {
    const origin = SLOTS[clamp(Math.floor(p.slot), 0, 3)];
    p.pos.set(origin[0], origin[1], origin[2] + 80); p.vel.set(0, 0, 0); p.rot.identity(); p.bank = 0; p.tilt = 0; p.health = 100; p.energy = 1; p.boostLocked = false; p.emptyWait = 0; p.regenDelay = 0;
    p.respawnAt = 0; p.protectedUntil = now + 3000; p.resumeAt = 0; p.travel = null; p.active = p.resumeAfterRespawn;
    p.input = { ...FULL, active: p.resumeAfterRespawn }; p.resumeAfterRespawn = false;
  }

  snapshot(now: number): RoomCheckpoint {
    return { version: 4, epoch: this.epoch, at: now, round: { roundId: this.roundId, phase: this.phase, phaseRemainingMs: Math.max(0, this.phaseUntil - now), winnerId: this.winnerId,
      scores: [...this.players.values()].map(player => ({ playerId: player.id, kills: player.kills })), layoutRequirements: this.layoutRequirements.map(item => ({ ...item })), layoutBlocked: [...this.layoutBlocked], recentEliminations: this.recentEliminations.slice(-12) }, players: [...this.players.values()].map(p => ({
      id: p.id, slot: p.slot, position: p.pos.toArray(), rotation: [p.rot.x, p.rot.y, p.rot.z, p.rot.w], velocity: p.vel.toArray(), input: { ...p.input },
      health: p.health, energy: p.energy, boostLocked: p.boostLocked, regenDelay: p.regenDelay, emptyWait: p.emptyWait, respawnAt: Math.max(0, p.respawnAt - now),
      protectedUntil: Math.max(0, p.protectedUntil - now), resumeAt: Math.max(0, p.resumeAt - now), fireAt: Math.max(0, p.fireAt - now), active: p.active, resumeAfterRespawn: p.resumeAfterRespawn,
      lastFireSequence: p.lastFireSequence, bank: p.bank, tilt: p.tilt, travel: p.travel ? { from: p.travel.from, to: p.travel.to, rotationFrom: p.travel.rotationFrom, rotationTo: p.travel.rotationTo, elapsed: Math.max(0, Math.min(p.travel.duration, now - p.travel.startedAt)), duration: p.travel.duration } : null,
    })), shots: this.projectiles.map(s => ({ id: s.id, ownerId: s.ownerId, gun: s.gun, origin: s.origin, position: s.pos.toArray() as [number, number, number], direction: s.direction.toArray() as [number, number, number], remaining: s.remaining, sound: s.sound, startedAt: s.startedAt })) };
  }

  restore(value: unknown, now: number, ageMs = 0): boolean {
    if (!value || typeof value !== "object") return false;
    const state = value as RoomCheckpoint;
    if (state.version !== 4 || !Array.isArray(state.players) || state.players.length > 4 || !Number.isSafeInteger(state.epoch)
      || !Number.isSafeInteger(state.at) || !Number.isFinite(ageMs) || ageMs < 0 || ageMs > 15_000 || !Array.isArray(state.shots) || state.shots.length > 128) return false;
    const next = new Map<string, Fighter>();
    for (const item of state.players) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || !Number.isInteger(item.slot) || item.slot < 0 || item.slot > 3 || !this.validVec(item.position, 1_000_000) || !this.validVec(item.velocity, 20_000)
        || !Array.isArray(item.rotation) || item.rotation.length !== 4 || !item.rotation.every(Number.isFinite) || item.rotation.every(v => v === 0)
        || !Number.isFinite(item.health) || item.health < 0 || item.health > 100 || !Number.isFinite(item.energy) || item.energy < 0 || item.energy > 1 || typeof item.boostLocked !== "boolean" || !this.validInput(item.input)
        || ![item.regenDelay, item.emptyWait, item.respawnAt, item.protectedUntil, item.resumeAt, item.fireAt, item.lastFireSequence, item.bank, item.tilt].every(Number.isFinite)
        || Math.abs(item.bank) > 0.56 || Math.abs(item.tilt) > 0.41
        || item.lastFireSequence < 0 || !Number.isSafeInteger(item.lastFireSequence)
        || typeof item.active !== "boolean" || typeof item.resumeAfterRespawn !== "boolean" || next.has(item.id)
        || (item.travel !== null && (!item.travel || !this.validVec(item.travel.from, 1_000_000) || !this.validVec(item.travel.to, 1_000_000)
          || !Array.isArray(item.travel.rotationFrom) || item.travel.rotationFrom.length !== 4 || !item.travel.rotationFrom.every(Number.isFinite)
          || !Array.isArray(item.travel.rotationTo) || item.travel.rotationTo.length !== 4 || !item.travel.rotationTo.every(Number.isFinite)
          || !Number.isFinite(item.travel.elapsed) || !Number.isFinite(item.travel.duration) || item.travel.duration < 1200 || item.travel.duration > 6000
          || item.travel.elapsed < 0 || item.travel.elapsed > item.travel.duration))) return false;
      const p = { id: item.id, slot: item.slot, pos: new THREE.Vector3(...item.position), vel: new THREE.Vector3(...item.velocity), rot: new THREE.Quaternion(...item.rotation).normalize(), input: { ...item.input },
        health: item.health, energy: item.energy, boostLocked: item.boostLocked, regenDelay: clamp(item.regenDelay, 0, 1.5), emptyWait: clamp(item.emptyWait, 0, 3), respawnAt: now + Math.max(0, item.respawnAt - ageMs), protectedUntil: now + Math.max(0, item.protectedUntil - ageMs),
        resumeAt: now + Math.max(0, item.resumeAt - ageMs), fireAt: now + Math.max(0, item.fireAt - ageMs), inputAt: now, active: item.active, resumeAfterRespawn: item.resumeAfterRespawn,
        lastFireSequence: item.lastFireSequence, bank: item.bank, tilt: item.tilt, kills: 0, profile: DEFAULT_PILOT_PROFILE, travel: item.travel ? { from: [...item.travel.from] as [number, number, number], to: [...item.travel.to] as [number, number, number],
          rotationFrom: [...item.travel.rotationFrom] as [number, number, number, number], rotationTo: [...item.travel.rotationTo] as [number, number, number, number],
          startedAt: now - item.travel.elapsed - ageMs, duration: item.travel.duration } : null } as Fighter;
      next.set(p.id, p);
    }
    const shots: Projectile[] = [];
    for (const item of state.shots) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || item.id.length > 64 || typeof item.ownerId !== "string" || !next.has(item.ownerId)
        || !Number.isInteger(item.gun) || item.gun < 0 || item.gun > 3 || !this.validVec(item.origin, 1_000_000)
        || !this.validVec(item.position, 1_000_000) || !this.validVec(item.direction, 1.01) || !Number.isFinite(item.remaining) || item.remaining < 0 || item.remaining > 900
        || !LASER_SOUND_IDS.includes(item.sound) || !Number.isSafeInteger(item.startedAt)) return false;
      const direction = new THREE.Vector3(...item.direction).normalize();
      if (direction.lengthSq() < 0.9) return false;
      shots.push({ id: item.id, ownerId: item.ownerId, gun: item.gun, origin: [...item.origin] as [number, number, number], pos: new THREE.Vector3(...item.position), direction, velocity: direction.clone().multiplyScalar(1500), remaining: item.remaining, sound: item.sound, startedAt: item.startedAt });
    }
    const round = state.round;
    if (!round || !Number.isSafeInteger(round.roundId) || round.roundId < 1 || !["combat", "supernova", "waiting", "countdown"].includes(round.phase)
      || !Number.isFinite(round.phaseRemainingMs) || round.phaseRemainingMs < 0 || typeof round.winnerId !== "string"
      || !Array.isArray(round.scores) || round.scores.length > 4 || !Array.isArray(round.layoutRequirements) || round.layoutRequirements.length > 4
      || !Array.isArray(round.layoutBlocked) || round.layoutBlocked.length > 4
      || !Array.isArray(round.recentEliminations) || round.recentEliminations.length > 12) return false;
    const phaseLimit = round.phase === "supernova" ? 8000 : round.phase === "waiting" ? 15_000 : round.phase === "countdown" ? 3000 : 0;
    if (round.phaseRemainingMs > phaseLimit) return false;
    const scoreIds = new Set<string>();
    for (const score of round.scores) {
      if (!score || !next.has(score.playerId) || scoreIds.has(score.playerId) || !Number.isInteger(score.kills) || score.kills < 0 || score.kills > 5) return false;
      scoreIds.add(score.playerId);
    }
    // Validate retained elimination events against the checkpoint's scores,
    // not the newly constructed Fighter defaults (which start at zero).
    for (const score of round.scores) next.get(score.playerId)!.kills = score.kills;
    const requirementIds = new Set<string>();
    for (const item of round.layoutRequirements) {
      if (!item || !next.has(item.playerId) || requirementIds.has(item.playerId) || !Number.isSafeInteger(item.revision) || item.revision < 1) return false;
      requirementIds.add(item.playerId);
    }
    const blockedIds = new Set<string>();
    for (const id of round.layoutBlocked) { if (typeof id !== "string" || !next.has(id) || blockedIds.has(id)) return false; blockedIds.add(id); }
    if (round.phase === "combat" ? round.winnerId !== "" : !round.winnerId || !next.has(round.winnerId) || !round.scores.some(score => score.playerId === round.winnerId && score.kills === 5)) return false;
    const eventIds = new Set<string>();
    for (const event of round.recentEliminations) {
      if (!event || typeof event.id !== "string" || event.id.length > 120 || eventIds.has(event.id) || event.roundId !== round.roundId || !next.has(event.attackerId) || !next.has(event.victimId) || event.attackerId === event.victimId
        || !Number.isInteger(event.attackerScore) || event.attackerScore < 1 || event.attackerScore > 5 || (next.get(event.attackerId)?.kills ?? 0) < event.attackerScore || !Number.isSafeInteger(event.at)) return false;
      eventIds.add(event.id);
    }
    this.roundId = round.roundId; this.phase = round.phase; this.phaseUntil = now + Math.max(0, round.phaseRemainingMs - ageMs); this.winnerId = round.winnerId;
    this.layoutRequirements = round.layoutRequirements.map(item => ({ ...item })); this.layoutBlocked.clear(); round.layoutBlocked.forEach(id => this.layoutBlocked.add(id));
    this.recentEliminations = round.recentEliminations.map(event => ({ ...event })); this.eliminationQueue = [];
    this.players.clear(); for (const [id, p] of next) this.players.set(id, p);
    this.projectiles = shots; this.impacts = [];
    this.epoch = state.epoch;
    return true;
  }

  shotSnapshots(): ShotSnapshot[] {
    return this.projectiles.map(s => ({ id: s.id, ownerId: s.ownerId, gun: s.gun, origin: s.origin, position: s.pos.toArray() as [number, number, number], direction: s.direction.toArray() as [number, number, number], sound: s.sound, startedAt: s.startedAt }));
  }

  impactSnapshots(now: number): ImpactSnapshot[] {
    return this.impacts.filter(i => now - i.at <= 300).map(({ id, position, kind }) => ({ id, position, kind }));
  }

  poses(now: number): { id: string; pose: Pose }[] {
    return [...this.players.values()].map(p => ({ id: p.id, pose: {
      position: p.pos.toArray() as Pose["position"], rotation: [p.rot.x, p.rot.y, p.rot.z, p.rot.w], velocity: p.vel.toArray() as Pose["velocity"],
      health: p.health, energy: p.energy, boostLocked: p.boostLocked, boostHold: p.emptyWait, regenDelay: p.regenDelay,
      active: p.active && this.phase === "combat", respawnAt: Math.max(0, p.respawnAt - now), protectedUntil: Math.max(0, p.protectedUntil - now),
      thrust: p.active && p.health > 0 && !p.travel ? Math.abs(p.input.thrust) + Math.abs(p.input.strafe) + Math.abs(p.input.lift) : 0,
      boosting: p.active && p.health > 0 && !p.travel && p.input.boost && p.input.thrust > 0 && p.energy > 0 && !p.boostLocked,
      bank: p.bank, tilt: p.tilt,
    } }));
  }

  private validVec(value: unknown, max: number): value is [number, number, number] { return Array.isArray(value) && value.length === 3 && value.every(v => Number.isFinite(v) && Math.abs(v) <= max); }
  private validInput(value: unknown): value is FlightInput {
    if (!value || typeof value !== "object") return false;
    const i = value as FlightInput;
    return [i.thrust, i.strafe, i.lift, i.roll, i.pitch, i.yaw].every(v => Number.isFinite(v) && Math.abs(v) <= 1)
      && [i.boost, i.brake, i.fire, i.active].every(v => typeof v === "boolean");
  }
}

export interface RoomCheckpoint {
  version: 4; epoch: number; at: number;
  round: { roundId: number; phase: RoundPhase; phaseRemainingMs: number; winnerId: string; scores: Array<{ playerId: string; kills: number }>; layoutRequirements: LayoutRequirement[]; layoutBlocked: string[]; recentEliminations: EliminationEvent[] };
  players: Array<{ id: string; slot: number; position: [number, number, number]; rotation: [number, number, number, number]; velocity: [number, number, number]; input: FlightInput;
    health: number; energy: number; boostLocked: boolean; regenDelay: number; emptyWait: number; respawnAt: number; protectedUntil: number; resumeAt: number; fireAt: number; active: boolean; resumeAfterRespawn: boolean;
    lastFireSequence: number; bank: number; tilt: number; travel: { from: [number, number, number]; to: [number, number, number]; rotationFrom: [number, number, number, number]; rotationTo: [number, number, number, number]; elapsed: number; duration: number } | null }>;
  shots: Array<{ id: string; ownerId: string; gun: number; origin: [number, number, number]; position: [number, number, number]; direction: [number, number, number]; remaining: number; sound: typeof LASER_SOUND_IDS[number]; startedAt: number }>;
}
