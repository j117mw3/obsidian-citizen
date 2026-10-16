import { terrainForWalls, terrainQuery, wallGroundRadius, wallBurial } from "./surfaceTerrain";
import { SURFACE, surfaceBodySegments, type SurfaceVector, type SurfaceWall } from "./surface";
import { nearbySurfaceWalls } from "./surfaceCollision";
import type { SurfacePlayerState } from "./surfacePhysics";

export type SurfaceShotKind = "normal" | "charged";
export const SURFACE_CHARGE = Object.freeze({ chargeMs: 1000, maximumHoldMs: 5000, damage: 50, heatPerShot: 55 });
export const surfaceShotDamage = (kind?: SurfaceShotKind): number => kind === "charged" ? SURFACE_CHARGE.damage : SURFACE_BLASTER.damage;
export const SURFACE_BLASTER = Object.freeze({
  damage: 10,
  shotsPerSecond: 5,
  cooldownMs: 200,
  heatPerShot: 7,
  ventHeat: 100,
  ventMs: 2000,
  coolingDelayMs: 350,
  coolingPerSecond: 25,
  boltSpeed: 120,
  boltRange: 30,
  boltLifetimeMs: 250,
  standingSpreadDegrees: 2,
  crouchedSpreadDegrees: 0.8,
  movingSpreadDegrees: 0.6,
  airborneSpreadDegrees: 1.2,
});

export function surfaceShotsToKill(health: number, armor: number): number {
  if (!Number.isFinite(health) || !Number.isFinite(armor) || health <= 0 || armor < 0) return 0;
  return Math.ceil((health + armor) / SURFACE_BLASTER.damage);
}

/** Immediate first shot, followed by the fixed 200 ms pistol cadence. */
export function surfaceTimeToKillMs(health: number, armor: number): number {
  const shots = surfaceShotsToKill(health, armor);
  return shots ? (shots - 1) * SURFACE_BLASTER.cooldownMs : 0;
}

export interface SurfaceCombatTarget {
  id: string;
  state: SurfacePlayerState;
  health: number;
  protected: boolean;
}
export interface SurfaceTraceHit { kind: "wall" | "planet" | "player"; id?: string; t: number; position: [number, number, number] }

const add = (a: SurfaceVector, b: SurfaceVector): [number, number, number] => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: SurfaceVector, b: SurfaceVector): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: SurfaceVector, n: number): [number, number, number] => [a[0] * n, a[1] * n, a[2] * n];
const dot = (a: SurfaceVector, b: SurfaceVector): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: SurfaceVector, b: SurfaceVector): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: SurfaceVector): number => Math.hypot(a[0], a[1], a[2]);
const unit = (a: SurfaceVector): [number, number, number] => { const n = length(a) || 1; return scale(a, 1 / n); };
const clamp = (value: number, low: number, high: number): number => Math.max(low, Math.min(high, value));
const at = (start: SurfaceVector, delta: SurfaceVector, t: number): [number, number, number] => add(start, scale(delta, t));

function segmentBox(start: SurfaceVector, delta: SurfaceVector, wall: SurfaceWall, arenaRadius: number): number | null {
  const normal = unit(wall.normal), tangent = unit(sub(wall.tangent, scale(normal, dot(wall.tangent, normal)))), side = unit(cross(normal, tangent));
  const center = scale(normal, wallGroundRadius(wall,arenaRadius) + (wall.height-wallBurial(wall)) / 2), relative = sub(start, center);
  const axes: Array<{ axis: SurfaceVector; extent: number }> = [
    { axis: tangent, extent: wall.length / 2 }, { axis: side, extent: (wall.thickness ?? SURFACE.wallThickness) / 2 }, { axis: normal, extent: (wall.height+wallBurial(wall)) / 2 },
  ];
  let near = 0, far = 1;
  for (const { axis, extent } of axes) {
    const origin = dot(relative, axis), direction = dot(delta, axis);
    if (Math.abs(direction) < 1e-9) { if (origin < -extent || origin > extent) return null; continue; }
    let a = (-extent - origin) / direction, b = (extent - origin) / direction;
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a); far = Math.min(far, b);
    if (near > far) return null;
  }
  return near >= 0 && near <= 1 ? near : null;
}

function segmentSphere(start: SurfaceVector, delta: SurfaceVector, radius: number): number | null {
  const a = dot(delta, delta), b = 2 * dot(start, delta), c = dot(start, start) - radius * radius;
  if (c <= 0) return 0;
  if (a < 1e-12) return null;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/** First entry into the capsule, rather than the ray's closest point to its axis. */
function segmentCapsule(start: SurfaceVector, delta: SurfaceVector, a: SurfaceVector, b: SurfaceVector, radius: number): number | null {
  const axis = sub(b, a), relative = sub(start, a), axisSq = dot(axis, axis), raySq = dot(delta, delta);
  if (axisSq < 1e-12) return segmentSphere(relative, delta, radius);
  const projection = dot(relative, axis), closest = sub(relative, scale(axis, clamp(projection / axisSq, 0, 1)));
  if (dot(closest, closest) <= radius * radius) return 0;
  let first: number | null = null;
  const consider = (t: number | null) => { if (t !== null && t >= 0 && t <= 1 && (first === null || t < first)) first = t; };
  consider(segmentSphere(relative, delta, radius));
  consider(segmentSphere(sub(start, b), delta, radius));
  const along = dot(axis, delta), quadratic = axisSq * raySq - along * along;
  const linear = axisSq * dot(relative, delta) - projection * along;
  const constant = axisSq * dot(relative, relative) - projection * projection - radius * radius * axisSq;
  const discriminant = linear * linear - quadratic * constant;
  if (quadratic > 1e-12 && discriminant >= 0) {
    for (const sign of [-1, 1]) {
      const t = (-linear + sign * Math.sqrt(discriminant)) / quadratic;
      const y = projection + t * along;
      if (y >= 0 && y <= axisSq) consider(t);
    }
  }
  return first;
}

function targetCapsules(target: SurfaceCombatTarget): Array<{ a: [number, number, number]; b: [number, number, number]; radius: number }> {
  const { state } = target, up = unit(state.position), forward = unit(sub(state.forward, scale(up, dot(state.forward, up))));
  const right = unit(cross(forward, up)), shift = scale(right, clamp(state.lean ?? 0, -0.35, 0.35));
  const specs = surfaceBodySegments(state.crouched);
  return specs.map(([bottom, height], index) => {
    const offset: SurfaceVector = index === 1 ? shift : [0, 0, 0];
    return {
      a: add(state.position, add(offset, scale(up, bottom + SURFACE.playerRadius))),
      b: add(state.position, add(offset, scale(up, bottom + height - SURFACE.playerRadius))),
      radius: SURFACE.playerRadius,
    };
  });
}

/** Find the first authoritative obstruction along one fixed projectile step. */
export function traceSurfaceSegment(
  start: SurfaceVector, end: SurfaceVector, walls: readonly SurfaceWall[], targets: readonly SurfaceCombatTarget[], ignoredPlayerId = "", arenaRadius: number = SURFACE.radius,
): SurfaceTraceHit | null {
  const delta = sub(end, start);
  let best: SurfaceTraceHit | null = null;
  const consider = (kind: SurfaceTraceHit["kind"], t: number, id?: string) => {
    if (best && best.t <= t) return;
    best = { kind, id, t, position: at(start, delta, t) };
  };
  for (const wall of nearbySurfaceWalls(start, end, walls, arenaRadius)) {
    const t = segmentBox(start, delta, wall, arenaRadius);
    if (t !== null) consider("wall", t);
  }
  const terrain = terrainForWalls(walls);
  const planetT = terrain ? terrainQuery(terrain).ray(start,end) : segmentSphere(start, delta, arenaRadius);
  if (planetT !== null) consider("planet", planetT);
  for (const target of targets) {
    if (target.id === ignoredPlayerId || target.health <= 0 || target.protected) continue;
    for (const capsule of targetCapsules(target)) {
      const t = segmentCapsule(start, delta, capsule.a, capsule.b, capsule.radius);
      if (t !== null) consider("player", t, target.id);
    }
  }
  return best;
}

export function surfaceSpreadDegrees(state: Pick<SurfacePlayerState, "crouched" | "grounded" | "velocity">): number {
  const moving = Math.hypot(...state.velocity) > 0.15;
  return (state.crouched ? SURFACE_BLASTER.crouchedSpreadDegrees : SURFACE_BLASTER.standingSpreadDegrees)
    + (moving ? SURFACE_BLASTER.movingSpreadDegrees : 0) + (!state.grounded ? SURFACE_BLASTER.airborneSpreadDegrees : 0);
}

/** Deterministic cone sample shared by prediction and host validation. */
export function spreadSurfaceDirection(direction: SurfaceVector, degrees: number, seed: number): [number, number, number] {
  let state = (seed >>> 0) || 1;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 0x1_0000_0000; };
  const forward = unit(direction), reference: SurfaceVector = Math.abs(forward[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const right = unit(cross(forward, reference)), up = unit(cross(right, forward));
  const maxAngle = Math.max(0, degrees) * Math.PI / 180, cosTheta = 1 - random() * (1 - Math.cos(maxAngle));
  const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta)), phi = random() * Math.PI * 2;
  return unit(add(scale(forward, cosTheta), add(scale(right, sinTheta * Math.cos(phi)), scale(up, sinTheta * Math.sin(phi)))));
}

export function surfaceSeed(id: string, sequence: number): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 0x01000193) >>> 0;
  hash = Math.imul(hash ^ sequence, 0x01000193) >>> 0;
  return hash || 1;
}
