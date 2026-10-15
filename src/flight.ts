import * as THREE from "three";

/** Axis-only input shared by solo flight, room authority, and client prediction. */
export interface FlightAxes { thrust: number; strafe: number; lift: number; roll: number; pitch: number; yaw: number; brake: boolean }

export const FLIGHT = Object.freeze({
  roomCruise: 117.5,
  acceleration: 0.7,
  boostAcceleration: 10.5,
  reverse: 0.45,
  side: 0.35,
  brake: 2.4,
  response: 11,
  angularAcceleration: 9,
  inputSmoothing: 65,
  chaseCameraResponse: 6.25,
  pitchRate: 2,
  yawRate: 1.5,
  rollRate: 3,
  turnBleed: 0.1,
  grip: 0.7,
  gripCost: 0.06,
});

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Integrates the same local-axis angular inertia for every flight mode. */
export function stepFlightRotation(rotation: THREE.Quaternion, spin: THREE.Vector3, input: Pick<FlightAxes, "pitch" | "yaw" | "roll">, dt: number, agility = 1): void {
  if (!(dt > 0) || !Number.isFinite(dt)) return;
  const response = 1 - Math.exp(-FLIGHT.response * dt), cap = FLIGHT.angularAcceleration * Math.max(0, agility) * dt;
  const toward = (current: number, target: number) => current + clamp((target - current) * response, -cap, cap);
  spin.x = toward(spin.x, clamp(input.pitch, -1, 1) * FLIGHT.pitchRate * agility);
  spin.y = toward(spin.y, clamp(input.yaw, -1, 1) * FLIGHT.yawRate * agility);
  spin.z = toward(spin.z, clamp(input.roll, -1, 1) * FLIGHT.rollRate * agility);
  rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), spin.x * dt));
  rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin.y * dt));
  rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), spin.z * dt));
  rotation.normalize();
}

/** Applies shared reverse, strafe, braking, drag, and grip ratios to a world-space velocity. */
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
  const main = thrust > 0 ? accel * (boosting ? FLIGHT.boostAcceleration : 1) : thrust < 0 ? accel * FLIGHT.reverse : 0;
  velocity.addScaledVector(forward, main * Math.sign(thrust) * dt);
  velocity.addScaledVector(right, clamp(input.strafe, -1, 1) * accel * FLIGHT.side * dt);
  velocity.addScaledVector(up, clamp(input.lift, -1, 1) * accel * FLIGHT.side * dt);

  let speed = velocity.length();
  if (input.brake && speed > 0) velocity.multiplyScalar(Math.max(0, speed - accel * FLIGHT.brake * dt) / speed);
  speed = velocity.length();
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
