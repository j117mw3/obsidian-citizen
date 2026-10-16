import { groundRadius, wallGroundRadius, terrainForWalls, terrainQuery, type TerrainDefinition } from "./surfaceTerrain";
import * as THREE from "three";
import { SURFACE, surfaceBodySegments, type SurfaceWall } from "./surface";
import { nearbySurfaceWalls, surfaceCapsuleWallContact, surfaceSupportRadius } from "./surfaceCollision";

export interface SurfacePlayerState {
  radius?: number;
  terrainHash?: string;
  position: [number, number, number];
  velocity: [number, number, number];
  forward: [number, number, number];
  pitch: number;
  /** Upper-body/camera displacement in the local right direction, in surface units. */
  lean: number;
  crouched: boolean;
  grounded: boolean;
  jumpHeld: boolean;
}

export interface SurfaceInput {
  moveX: number;
  moveY: number;
  sprint: boolean;
  jump: boolean;
  crouch: boolean;
  yawDelta: number;
  pitchDelta: number;
  lean: number;
}

const UP = new THREE.Vector3(0, 1, 0);
const RIGHT_AXIS = new THREE.Vector3(1, 0, 0);
const clamp = (n: number, low: number, high: number): number => Math.max(low, Math.min(high, n));
const vector = (values: readonly number[]): THREE.Vector3 => new THREE.Vector3(values[0], values[1], values[2]);
const tuple = (v: THREE.Vector3): [number, number, number] => [v.x, v.y, v.z];

/** The same bounds apply to live snapshots and migration checkpoints, including jump altitude. */
export function validSurfacePlayerState(value: unknown): value is SurfacePlayerState {
  if (!value || typeof value !== "object") return false;
  const state = value as SurfacePlayerState;
  const arenaRadius = state.radius ?? SURFACE.radius;
  if (!Number.isFinite(arenaRadius) || arenaRadius < 27 || arenaRadius > 1000) return false;
  const relief = typeof state.terrainHash === "string" && /^[0-9a-f]{8}$/.test(state.terrainHash);
  if (state.terrainHash !== undefined && !relief) return false;
  const lower = relief ? -.8 : 0, upper = relief ? 1.6 : 0;
  const triple = (input: unknown, bound: number): input is [number, number, number] => Array.isArray(input) && input.length === 3
    && input.every(number => typeof number === "number" && Number.isFinite(number) && Math.abs(number) <= bound);
  if (!triple(state.position, arenaRadius + upper + SURFACE.jumpHeight + 0.2) || !triple(state.velocity, 40) || !triple(state.forward, 1.1)
    || !Number.isFinite(state.pitch) || Math.abs(state.pitch) > 85 * Math.PI / 180 + 1e-5
    || !Number.isFinite(state.lean) || Math.abs(state.lean) > 0.35 + 1e-5
    || typeof state.crouched !== "boolean" || typeof state.grounded !== "boolean" || typeof state.jumpHeld !== "boolean") return false;
  const radius = Math.hypot(...state.position), forwardLength = Math.hypot(...state.forward);
  return radius >= arenaRadius + lower - 0.05 && radius <= arenaRadius + upper + SURFACE.jumpHeight + 0.2
    && (!state.grounded || radius <= arenaRadius + upper + SURFACE.maximumStep + 0.05) && Math.abs(forwardLength - 1) <= 0.02
    && Math.abs(state.position.reduce((sum, component, axis) => sum + component / radius * state.forward[axis], 0)) < 0.02;
}

function projectTangent(value: THREE.Vector3, up: THREE.Vector3): THREE.Vector3 {
  return value.addScaledVector(up, -value.dot(up));
}

function surfaceUp(position: THREE.Vector3): THREE.Vector3 {
  return position.clone().normalize();
}

export function createSurfacePlayerState(normal: readonly [number, number, number] = [0, 1, 0], facing: readonly [number, number, number] = [0, 0, -1], arenaRadius: number = SURFACE.radius, terrain?: TerrainDefinition): SurfacePlayerState {
  const up = vector(normal).normalize();
  if (up.lengthSq() < 1e-8) up.copy(UP);
  const forward = projectTangent(vector(facing), up);
  if (forward.lengthSq() < 1e-8) forward.copy(Math.abs(up.y) < 0.9 ? UP : RIGHT_AXIS).cross(up);
  forward.normalize();
  return { ...(arenaRadius === SURFACE.radius ? {} : { radius: arenaRadius }), ...(terrain ? {terrainHash:terrain.hash} : {}), position: tuple(up.multiplyScalar(arenaRadius + (terrain ? terrainQuery(terrain).height(tuple(up)) : 0))), velocity: [0, 0, 0], forward: tuple(forward), pitch: 0, lean: 0, crouched: false, grounded: true, jumpHeld: false };
}

/** True when the complete standing/crouched capsule is clear of the immutable arena walls. */
export function surfacePoseClear(position: readonly [number, number, number], height: number, walls: readonly SurfaceWall[], orientation?: readonly [number, number, number], arenaRadius: number = SURFACE.radius): boolean {
  return !nearbySurfaceWalls(position, position, walls, arenaRadius, height + SURFACE.playerRadius).some(wall => (surfaceCapsuleWallContact(position, height, wall, orientation, arenaRadius)?.penetration ?? 0) > 1e-5);
}

/** Resolve the capsule against fixed tangent-plane wall boxes and keep its feet on the sphere. */
export function resolveSurfaceWalls(
  position: readonly [number, number, number], height: number, walls: readonly SurfaceWall[], grounded = false, previous?: readonly [number, number, number], arenaRadius: number = SURFACE.radius,
): { position: [number, number, number]; correction: [number, number, number] } {
  const point = vector(position), initial = point.clone();
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    for (const wall of nearbySurfaceWalls(tuple(point), tuple(point), walls, arenaRadius, height + SURFACE.playerRadius)) {
      const contact = surfaceCapsuleWallContact(tuple(point), height, wall, undefined, arenaRadius);
      if (!contact || contact.penetration <= 1e-5) continue;
      const normal = vector(contact.normal), radialDistance = point.length(), up = point.clone().normalize();
      const mayLand = !previous || vector(previous).dot(vector(wall.normal).normalize()) >= wallGroundRadius(wall,arenaRadius) + wall.height - 1e-3;
      const lateral = grounded || (!mayLand && normal.dot(up) > 0.5);
      let push = contact.penetration + 1e-4;
      if (lateral) {
        const side = new THREE.Vector3().crossVectors(vector(wall.normal), vector(wall.tangent)).normalize();
        const across = point.dot(side);
        normal.projectOnPlane(up);
        const length = normal.length();
        if (length > 1e-5) { normal.multiplyScalar(1 / length); push /= Math.max(0.1, length); }
        else { normal.copy(side).multiplyScalar(across < 0 ? -1 : 1); push = (wall.thickness??SURFACE.wallThickness) / 2 + SURFACE.playerRadius - Math.abs(across) + 1e-4; }
      }
      point.addScaledVector(normal, push);
      if (lateral || Math.abs(normal.dot(up)) < 0.5) point.normalize().multiplyScalar(radialDistance);
      const floor=groundRadius(tuple(point),walls,arenaRadius);
      if (point.length() < floor) point.normalize().multiplyScalar(floor);
      changed = true;
    }
    if (!changed) break;
  }
  const floor=groundRadius(tuple(point),walls,arenaRadius);if(point.length()<floor)point.normalize().multiplyScalar(floor);
  return { position: tuple(point), correction: tuple(point.sub(initial)) };
}

/** Sweep a capsule between two poses using short spherical/linear samples, so a fast step cannot skip a wall. */
export function sweepSurfaceWalls(
  start: readonly [number, number, number], end: readonly [number, number, number], height: number, walls: readonly SurfaceWall[], alongSurface = false, arenaRadius: number = SURFACE.radius,
): { position: [number, number, number]; correction: [number, number, number] } {
  const from = vector(start), to = vector(end), distance = alongSurface
    ? arenaRadius * Math.acos(clamp(from.clone().normalize().dot(to.clone().normalize()), -1, 1))
    : from.distanceTo(to);
  const steps = Math.max(1, Math.ceil(distance / 0.075));
  const rotation = new THREE.Quaternion();
  if (alongSurface) {
    const fromNormal = from.clone().normalize(), toNormal = to.clone().normalize();
    const axis = new THREE.Vector3().crossVectors(fromNormal, toNormal);
    if (axis.lengthSq() > 1e-12) rotation.setFromAxisAngle(axis.normalize(), Math.acos(clamp(fromNormal.dot(toNormal), -1, 1)));
  }
  const safe = from.clone();
  for (let index = 1; index <= steps; index++) {
    const t = index / steps;
    const candidate = alongSurface ? from.clone().applyQuaternion(new THREE.Quaternion().identity().slerp(rotation, t)).normalize()
      : from.clone().lerp(to, t);
    if (alongSurface) candidate.multiplyScalar(surfaceSupportRadius(tuple(candidate), walls, arenaRadius));
    const resolved = resolveSurfaceWalls(tuple(candidate), height, walls, alongSurface, start, arenaRadius);
    const correction = vector(resolved.correction);
    if (correction.lengthSq() > 1e-10) return { position: resolved.position, correction: tuple(correction) };
    safe.copy(candidate);
  }
  return { position: tuple(safe), correction: [0, 0, 0] };
}

/** Deterministic fixed-step spherical walking, jumping, and crouch transition. */
export function stepSurfacePlayer(
  state: SurfacePlayerState, input: SurfaceInput, dt: number, walls: readonly SurfaceWall[] = [],
): SurfacePlayerState {
  if (!(dt > 0) || !Number.isFinite(dt) || dt > 0.1) return { ...state };

  const arenaRadius = state.radius ?? SURFACE.radius;
  const position = vector(state.position);
  const movementStart = position.clone();
  let up = surfaceUp(position);
  const initialVelocity = vector(state.velocity);
  const velocity = projectTangent(initialVelocity.clone(), up).addScaledVector(up, initialVelocity.dot(up));
  const forward = projectTangent(vector(state.forward), up).normalize();
  const pitchLimit = 85 * Math.PI / 180;
  const pitch = clamp(state.pitch + clamp(Number.isFinite(input.pitchDelta) ? input.pitchDelta : 0, -Math.PI, Math.PI), -pitchLimit, pitchLimit);
  const yaw = clamp(Number.isFinite(input.yawDelta) ? input.yawDelta : 0, -Math.PI, Math.PI);
  forward.applyAxisAngle(up, yaw).normalize();

  let crouched = !!input.crouch;
  if (!crouched && state.crouched && !surfacePoseClear(tuple(position), SURFACE.standingHeight, walls, undefined, arenaRadius)) crouched = true;
  const grounded = state.grounded && position.length() <= surfaceSupportRadius(tuple(position), walls, arenaRadius) + 1e-3 && velocity.dot(up) <= 1e-3;
  const jumpPressed = !!input.jump && !state.jumpHeld;

  if (grounded && jumpPressed && crouched && surfacePoseClear(tuple(position), SURFACE.standingHeight, walls, undefined, arenaRadius)) crouched = false;
  const canJump = grounded && jumpPressed && !crouched && surfacePoseClear(tuple(position), SURFACE.standingHeight, walls, undefined, arenaRadius);
  let airborne = !grounded;
  if (canJump) {
    velocity.addScaledVector(up, Math.sqrt(2 * SURFACE.gravity * SURFACE.jumpHeight));
    airborne = true;
  }

  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  const moveX = clamp(Number.isFinite(input.moveX) ? input.moveX : 0, -1, 1);
  const moveY = clamp(Number.isFinite(input.moveY) ? input.moveY : 0, -1, 1);
  const wish = right.multiplyScalar(moveX).addScaledVector(forward, moveY);
  if (wish.lengthSq() > 1) wish.normalize();
  const speed = crouched ? SURFACE.crouchSpeed : input.sprint && !airborne ? SURFACE.sprintSpeed : SURFACE.walkSpeed;
  const targetVelocity = wish.multiplyScalar(speed);
  const terrain=terrainForWalls(walls);
  if(terrain&&grounded){const normal=vector(terrainQuery(terrain).normal(tuple(position))),slope=targetVelocity.dot(normal);targetVelocity.addScaledVector(normal,-slope);const along=targetVelocity.length();if(along>1e-8){targetVelocity.multiplyScalar(speed/along);targetVelocity.projectOnPlane(up);}}
  const radialSpeed = velocity.dot(up);
  const planarVelocity = projectTangent(velocity.clone(), up);
  const response = wish.lengthSq() > 0 ? 30 * (airborne ? SURFACE.airControl : 1) : 20;
  const blend = Math.min(1, response * dt);
  planarVelocity.addScaledVector(targetVelocity.sub(planarVelocity), blend);
  velocity.copy(planarVelocity).addScaledVector(up, radialSpeed);

  const movedAlongSurface = grounded && !canJump;
  if (movedAlongSurface) {
    const displacement = velocity.clone().multiplyScalar(dt);
    const distance = displacement.length();
    if (distance > 1e-8) {
      const direction = displacement.multiplyScalar(1 / distance);
      const axis = new THREE.Vector3().crossVectors(up, direction);
      if (axis.lengthSq() > 1e-10) {
        axis.normalize();
        const rotation = new THREE.Quaternion().setFromAxisAngle(axis, distance / position.length());
        position.applyQuaternion(rotation).normalize();
        position.multiplyScalar(surfaceSupportRadius(tuple(position), walls, arenaRadius));
        forward.applyQuaternion(rotation).normalize();
        velocity.applyQuaternion(rotation);
        up = surfaceUp(position);
      }
    }
  } else {
    velocity.addScaledVector(up, -SURFACE.gravity * dt);
    position.addScaledVector(velocity, dt);
    const support = surfaceSupportRadius(tuple(position), walls, arenaRadius);
    if (position.length() <= support) {
      position.normalize().multiplyScalar(support);
      up = surfaceUp(position);
      const normalSpeed = velocity.dot(up);
      if (normalSpeed < 0) velocity.addScaledVector(up, -normalSpeed);
      airborne = false;
    }
  }

  const collision = sweepSurfaceWalls(tuple(movementStart), tuple(position), crouched ? SURFACE.crouchedHeight : SURFACE.standingHeight, walls, movedAlongSurface, arenaRadius);
  position.copy(vector(collision.position));
  const correction = vector(collision.correction);
  if (correction.lengthSq() > 1e-10) {
    const outward = correction.normalize();
    const intoWall = velocity.dot(outward);
    if (intoWall < 0) velocity.addScaledVector(outward, -intoWall);
  }

  up = surfaceUp(vector(collision.position));
  const finalPosition = vector(collision.position);
  const finalVelocity = velocity.clone();
  if (!airborne) projectTangent(finalVelocity, up);
  const finalForward = projectTangent(forward, up).normalize();
  const previousLean = Number.isFinite(state.lean) ? state.lean : 0;
  const leanInput = Number.isFinite(input.lean) ? clamp(input.lean, -1, 1) : 0;
  const desiredLean = airborne || (input.sprint && !crouched) ? 0 : leanInput * 0.35;
  const easedLean = previousLean + (desiredLean - previousLean) * (1 - Math.exp(-dt / 0.12));
  const leanRight = new THREE.Vector3().crossVectors(finalForward, up).normalize();
  const [upperBottom, upperHeight] = surfaceBodySegments(crouched)[1];
  let lean = 0;
  const leanSteps = Math.max(1, Math.ceil(Math.abs(easedLean) / 0.025));
  for (let index = 1; index <= leanSteps; index++) {
    const candidate = easedLean * index / leanSteps;
    const upperFeet = finalPosition.clone().addScaledVector(up, upperBottom).addScaledVector(leanRight, candidate);
    if (!surfacePoseClear(tuple(upperFeet), upperHeight, walls, tuple(up), arenaRadius)) break;
    lean = candidate;
  }
  return {
    ...state, position: tuple(finalPosition), velocity: tuple(finalVelocity), forward: tuple(finalForward), pitch,
    lean, crouched, grounded: !airborne, jumpHeld: !!input.jump,
  };
}
