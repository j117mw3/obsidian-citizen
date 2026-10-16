import * as THREE from "three";
import { SURFACE, type SurfaceVector } from "./surface";
import type { SurfacePlayerState } from "./surfacePhysics";

export const SURFACE_MUZZLE_OFFSET = Object.freeze([0.12, -0.235, -0.985] as const);
export const SURFACE_WORLD_SCALE = SURFACE.worldRadius / SURFACE.radius;
export const SURFACE_BLASTER_ZERO_DISTANCE = 10;
type Vec3 = [number, number, number];

export function surfaceToWorld(position: SurfaceVector, center: SurfaceVector): Vec3 {
  return position.map((value, axis) => center[axis] + value * SURFACE_WORLD_SCALE) as Vec3;
}
export function worldToSurface(position: SurfaceVector, center: SurfaceVector): Vec3 {
  return position.map((value, axis) => (value - center[axis]) / SURFACE_WORLD_SCALE) as Vec3;
}

/** Zero the offset pistol to the reticle in the middle of the 5–15 unit arena range. */
export function surfaceBlasterDirection(state: SurfacePlayerState): Vec3 {
  const pose = surfaceViewPose(state);
  return new THREE.Vector3(...pose.eye).addScaledVector(new THREE.Vector3(...pose.look), SURFACE_BLASTER_ZERO_DISTANCE)
    .sub(new THREE.Vector3(...pose.muzzle)).normalize().toArray() as Vec3;
}

/** Shared eye, rolled camera frame, and physical muzzle, all in node-relative surface units. */
export function surfaceViewPose(state: SurfacePlayerState): { eye: Vec3; muzzle: Vec3; up: Vec3; right: Vec3; cameraUp: Vec3; look: Vec3; rotation: [number, number, number, number] } {
  const up = new THREE.Vector3(...state.position).normalize();
  const forward = new THREE.Vector3(...state.forward).projectOnPlane(up).normalize();
  const right = new THREE.Vector3().crossVectors(forward, up).normalize();
  const pitch = Math.max(-85 * Math.PI / 180, Math.min(85 * Math.PI / 180, state.pitch));
  const look = forward.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(up, Math.sin(pitch)).normalize();
  const cameraUp = new THREE.Vector3().crossVectors(right, look).normalize();
  const rotation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, cameraUp, look.clone().negate()));
  rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.max(-1, Math.min(1, state.lean / 0.35)) * 8 * Math.PI / 180));
  const eye = new THREE.Vector3(...state.position).addScaledVector(up, state.crouched ? SURFACE.crouchedEyeHeight : SURFACE.standingEyeHeight).addScaledVector(right, state.lean);
  const muzzle = new THREE.Vector3(...SURFACE_MUZZLE_OFFSET).applyQuaternion(rotation).add(eye);
  return { eye: eye.toArray() as Vec3, muzzle: muzzle.toArray() as Vec3, up: up.toArray() as Vec3,
    right: new THREE.Vector3(1, 0, 0).applyQuaternion(rotation).toArray() as Vec3,
    cameraUp: new THREE.Vector3(0, 1, 0).applyQuaternion(rotation).toArray() as Vec3,
    look: look.toArray() as Vec3, rotation: rotation.toArray() as [number, number, number, number] };
}
