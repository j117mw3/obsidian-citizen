import * as THREE from "three";
import type { Pose } from "./multiplayer";

export interface TimedPose { pose: Pose; at: number }

/** Present remote motion 100 ms behind arrival time, with only a short bounded extrapolation. */
export function interpolateRemotePose(samples: TimedPose[], now: number, delayMs = 100): Pose | null {
  if (!samples.length) return null;
  const latest = samples[samples.length - 1];
  if (!latest.pose.active || latest.pose.health <= 0) return latest.pose;
  const renderAt = now - delayMs;
  while (samples.length > 2 && samples[1].at < renderAt) samples.shift();
  const first = samples[0];
  if (renderAt <= first.at) return first.pose;
  for (let i = 1; i < samples.length; i++) {
    const before = samples[i - 1], after = samples[i];
    if (renderAt > after.at) continue;
    const span = Math.max(1, after.at - before.at), t = Math.max(0, Math.min(1, (renderAt - before.at) / span));
    const position = before.pose.position.map((v, axis) => v + (after.pose.position[axis] - v) * t) as Pose["position"];
    const velocity = before.pose.velocity.map((v, axis) => v + (after.pose.velocity[axis] - v) * t) as Pose["velocity"];
    const rotation = new THREE.Quaternion(...before.pose.rotation).normalize().slerp(new THREE.Quaternion(...after.pose.rotation).normalize(), t).toArray() as Pose["rotation"];
    return { ...(t < 0.5 ? before.pose : after.pose), position, velocity, rotation };
  }
  const age = Math.max(0, Math.min(100, renderAt - latest.at)) / 1000;
  const position = latest.pose.position.map((v, axis) => v + latest.pose.velocity[axis] * age) as Pose["position"];
  const rotation = new THREE.Quaternion(...latest.pose.rotation).normalize();
  rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), latest.pose.spin[0] * age));
  rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), latest.pose.spin[1] * age));
  rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), latest.pose.spin[2] * age));
  return { ...latest.pose, position, rotation: rotation.toArray() as Pose["rotation"] };
}
