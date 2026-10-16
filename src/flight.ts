import * as THREE from "three";
import { SURFACE } from "./surface";

/** Axis-only movement input shared by solo flight, room authority, and client prediction. */
export interface FlightAxes { thrust: number; strafe: number; lift: number; roll: number; pitch: number; yaw: number; brake: boolean }

export interface FlightMouseState { x: number; y: number }
export interface FlightRotationControl {
  mode: "capture" | "cursor";
  mouseDX?: number;
  mouseDY?: number;
  sensitivity?: number;
  /** Captured-mouse sensitivity uses the user's configured agility, not the speed-scaled turn response. */
  inputAgility?: number;
  invertY?: boolean;
  mouseState?: FlightMouseState;
}

export const FLIGHT = Object.freeze({
  roomCruise: 135,
  acceleration: 0.7,
  /** Extra low-speed forward pickup, tapering to zero at cruise. */
  lowSpeedForwardPickup: 0.3,
  boostDrain: 0.28,
  boostRecharge: 0.08,
  boostRechargeDelay: 1.5,
  boostEmptyHold: 3,
  boostRestartThreshold: 0.3,
  boostAcceleration: 10,
  reverse: 0.45,
  side: 0.35,
  brake: 2.4,
  response: 6,
  angularAcceleration: 4,
  inputSmoothing: 90,
  chaseCameraResponse: 8,
  cursorResponse: 16,
  cursorAngularAcceleration: 14,
  mouseRadiansPerPixel: 0.0022,
  mouseMaxRate: 9,
  pitchRate: 2,
  yawRate: 1.5,
  rollRate: 3,
  turnBleed: 0.1,
  grip: 0.7,
  gripCost: 0.06,
});

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export interface BoostResources { energy: number; boostLocked: boolean; emptyWait: number; regenDelay: number; damagePause: number }
export interface BoostInput { active: boolean; boost: boolean; thrust: number }

/** One boost-resource step shared by the room authority and local input replay. */
export function stepBoostResources(state: BoostResources, input: BoostInput, dt: number): { energy: number; boostLocked: boolean; emptyWait: number; regenDelay: number; boosting: boolean } {
  if (!(dt > 0) || !Number.isFinite(dt) || !input.active) return { energy: state.energy, boostLocked: state.boostLocked, emptyWait: state.emptyWait, regenDelay: state.regenDelay, boosting: false };
  let { energy, boostLocked, emptyWait, regenDelay } = state;
  const boosting = input.boost && input.thrust > 0 && energy > 0 && emptyWait <= 0 && !boostLocked;
  if (boosting) {
    energy = Math.max(0, energy - FLIGHT.boostDrain * dt);
    regenDelay = FLIGHT.boostRechargeDelay;
    if (energy === 0) { emptyWait = FLIGHT.boostEmptyHold; boostLocked = true; }
  } else {
    emptyWait = Math.max(0, emptyWait - dt);
    regenDelay = Math.max(0, regenDelay - dt);
    if (emptyWait === 0 && regenDelay === 0 && state.damagePause <= 0) energy = Math.min(1, energy + FLIGHT.boostRecharge * dt);
    if (boostLocked && energy >= FLIGHT.boostRestartThreshold) boostLocked = false;
  }
  return { energy, boostLocked, emptyWait, regenDelay, boosting: boosting && energy > 0 };
}

/** Shared spatial grid for the six-unit flight obstacle radius used in rooms. */
type FlightObstacle = [number, number, number] & { radius?: number };
export class StarCollisionGrid {
  private readonly cells = new Map<string, FlightObstacle[]>();
  constructor(private readonly cellSize = 80) {}

  rebuild(sets: Iterable<ArrayLike<number>>, radii: Iterable<ArrayLike<number>> = []): void {
    this.cells.clear();
    const radiusSets = [...radii]; let setIndex = -1;
    for (const values of sets) { setIndex++; for (let i = 0; i + 2 < values.length; i += 3) {
      const x = values[i], y = values[i + 1], z = values[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      const radius = radiusSets[setIndex]?.[i / 3];
      const point: FlightObstacle = [x, y, z];
      const extent = Number.isFinite(radius) && radius > 0 ? radius : 0;
      if (extent) point.radius = extent;
      for (let cx = Math.floor((x - extent) / this.cellSize); cx <= Math.floor((x + extent) / this.cellSize); cx++)
        for (let cy = Math.floor((y - extent) / this.cellSize); cy <= Math.floor((y + extent) / this.cellSize); cy++)
          for (let cz = Math.floor((z - extent) / this.cellSize); cz <= Math.floor((z + extent) / this.cellSize); cz++) {
            const key = this.key(cx, cy, cz), points = this.cells.get(key) ?? [];
            points.push(point); this.cells.set(key, points);
          }
    }}
  }

  getCell(x: number, y: number, z: number): readonly FlightObstacle[] { return this.cells.get(this.key(x, y, z)) ?? []; }

  resolve(position: THREE.Vector3, velocity: THREE.Vector3, radius = SURFACE.worldRadius): void {
    const seen = new Set<FlightObstacle>();
    const x = Math.floor(position.x / this.cellSize), y = Math.floor(position.y / this.cellSize), z = Math.floor(position.z / this.cellSize);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const point of this.cells.get(this.key(x + dx, y + dy, z + dz)) ?? []) {
        if (seen.has(point)) continue; seen.add(point);
        const actualRadius = point.radius ?? radius;
        const ox = position.x - point[0], oy = position.y - point[1], oz = position.z - point[2];
        const distanceSq = ox * ox + oy * oy + oz * oz;
        if (distanceSq >= actualRadius * actualRadius) continue;
        const distance = Math.sqrt(distanceSq) || 1e-3, nx = ox / distance, ny = oy / distance, nz = oz / distance;
        position.x += nx * (actualRadius - distance); position.y += ny * (actualRadius - distance); position.z += nz * (actualRadius - distance);
        const normalSpeed = velocity.x * nx + velocity.y * ny + velocity.z * nz;
        if (normalSpeed < 0) { velocity.x += -1.35 * normalSpeed * nx; velocity.y += -1.35 * normalSpeed * ny; velocity.z += -1.35 * normalSpeed * nz; }
      }
    }
  }

  /** Find the first clear position on an exit ray, including overlapping neighbouring node spheres. */
  clearPointOnRay(origin: THREE.Vector3, direction: THREE.Vector3, minimumDistance: number, radius = SURFACE.worldRadius + 0.5): THREE.Vector3 {
    const normal = direction.clone().normalize();
    if (normal.lengthSq() < 1e-8) normal.set(0, 1, 0);
    const intervals: Array<[number, number]> = [];
    const seen = new Set<FlightObstacle>();
    for (const points of this.cells.values()) for (const point of points) {
      if (seen.has(point)) continue; seen.add(point);
      const actualRadius = point.radius === undefined ? radius : point.radius + radius - SURFACE.worldRadius;
      const relative = new THREE.Vector3(...point).sub(origin), along = relative.dot(normal);
      const perpendicularSq = Math.max(0, relative.lengthSq() - along * along);
      if (perpendicularSq >= actualRadius * actualRadius) continue;
      const half = Math.sqrt(actualRadius * actualRadius - perpendicularSq);
      intervals.push([along - half, along + half]);
    }
    intervals.sort((a, b) => a[0] - b[0]);
    let distance = Math.max(0, minimumDistance);
    for (const [start, end] of intervals) if (start <= distance + 1e-6 && end >= distance - 1e-6) distance = end + 0.05;
    return origin.clone().addScaledVector(normal, distance);
  }

  private key(x: number, y: number, z: number): string { return `${x},${y},${z}`; }
}

/** Uses upstream's direct captured-mouse aim, cursor steering, and heavy roll response. */
export function stepFlightRotation(
  rotation: THREE.Quaternion,
  spin: THREE.Vector3,
  input: Pick<FlightAxes, "pitch" | "yaw" | "roll">,
  dt: number,
  agility = 1,
  control: FlightRotationControl = { mode: "cursor" },
): void {
  if (!(dt > 0) || !Number.isFinite(dt)) return;
  agility = Math.max(0, Number.isFinite(agility) ? agility : 1);

  if (control.mode === "capture") {
    const state = control.mouseState;
    if (state) {
      const smooth = 1 - Math.exp(-FLIGHT.inputSmoothing * dt);
      state.x += ((control.mouseDX ?? 0) - state.x) * smooth;
      state.y += ((control.mouseDY ?? 0) - state.y) * smooth;
      const sensitivity = clamp(Number.isFinite(control.sensitivity) ? control.sensitivity! : 1, 0.2, 4);
      const inputAgility = clamp(Number.isFinite(control.inputAgility) ? control.inputAgility! : agility, 0, 4);
      const gain = FLIGHT.mouseRadiansPerPixel * sensitivity * (0.75 + 0.25 * inputAgility);
      const inverse = control.invertY ? -1 : 1;
      spin.y = clamp(-state.x * gain / Math.max(dt, 1e-3), -FLIGHT.mouseMaxRate, FLIGHT.mouseMaxRate);
      spin.x = clamp(-state.y * gain * inverse / Math.max(dt, 1e-3), -FLIGHT.mouseMaxRate, FLIGHT.mouseMaxRate);
    }
  } else {
    const response = 1 - Math.exp(-FLIGHT.cursorResponse * dt);
    const cap = FLIGHT.cursorAngularAcceleration * agility * dt;
    spin.x += clamp((clamp(input.pitch, -1, 1) * FLIGHT.pitchRate * agility - spin.x) * response, -cap, cap);
    spin.y += clamp((clamp(input.yaw, -1, 1) * FLIGHT.yawRate * agility - spin.y) * response, -cap, cap);
  }

  const rollResponse = 1 - Math.exp(-FLIGHT.response * dt);
  const rollCap = FLIGHT.angularAcceleration * agility * dt * 1.4;
  spin.z += clamp((clamp(input.roll, -1, 1) * FLIGHT.rollRate * agility - spin.z) * rollResponse, -rollCap, rollCap);
  rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), spin.x * dt));
  rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin.y * dt));
  rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), spin.z * dt));
  rotation.normalize();
}

/** Applies shared reverse, strafe, braking, drag, and grip ratios to world-space velocity. */
export function stepFlightVelocity(
  velocity: THREE.Vector3, rotation: THREE.Quaternion, spin: THREE.Vector3, input: Pick<FlightAxes, "thrust" | "strafe" | "lift" | "brake">,
  dt: number, cruise: number, boosting: boolean,
): void {
  if (!(dt > 0) || !Number.isFinite(dt) || !(cruise > 0) || !Number.isFinite(cruise)) return;
  const accel = cruise * FLIGHT.acceleration;
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(rotation);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(rotation);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rotation);
  const thrust = clamp(input.thrust, -1, 1);
  let main = thrust > 0 ? accel * (boosting ? FLIGHT.boostAcceleration : 1) : thrust < 0 ? accel * FLIGHT.reverse : 0;
  if (thrust > 0 && !boosting) {
    const speedRatio = velocity.length() / cruise;
    // The baseline is 0.7 cruise speeds per second; this adds the missing 0.3
    // cruise speeds per second so low-speed pickup begins at 1.0 cruise/s.
    main += cruise * FLIGHT.lowSpeedForwardPickup * Math.max(0, 1 - speedRatio * speedRatio);
  }
  velocity.addScaledVector(forward, main * Math.sign(thrust) * dt);
  velocity.addScaledVector(right, clamp(input.strafe, -1, 1) * accel * FLIGHT.side * dt);
  velocity.addScaledVector(up, clamp(input.lift, -1, 1) * accel * FLIGHT.side * dt);

  let speed = velocity.length();
  if (input.brake && speed > 0) {
    const cut = Math.min(speed, accel * FLIGHT.brake * dt);
    velocity.multiplyScalar((speed - cut) / speed);
    speed -= cut;
  }
  velocity.divideScalar(1 + (accel / (cruise * cruise)) * speed * dt);
  velocity.divideScalar(1 + FLIGHT.turnBleed * spin.length() * dt);

  speed = velocity.length();
  if (speed > 1) {
    const cosine = velocity.dot(forward) / speed;
    if (cosine > 0) {
      const blend = 1 - Math.exp(-FLIGHT.grip * dt);
      const sine = Math.sqrt(Math.max(0, 1 - cosine * cosine));
      velocity.divideScalar(speed).lerp(forward, blend).normalize().multiplyScalar(speed * (1 - FLIGHT.gripCost * sine * blend));
    }
  }
}
