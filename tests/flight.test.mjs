import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const built = await build({
  stdin: {
    contents: 'import * as THREE from "three"; export { THREE }; export * from "./src/flight";',
    resolveDir: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", target: "node22", write: false,
});
const flight = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);

function simulate(fps, duration, axis, boosted = false) {
  const velocity = new flight.THREE.Vector3(), rotation = new flight.THREE.Quaternion(), spin = new flight.THREE.Vector3();
  const input = { thrust: axis, strafe: 0, lift: 0, roll: 0, pitch: 0, yaw: 0, brake: false };
  const turn = { pitch: 0, yaw: 0, roll: 0 };
  const steps = Math.round(fps * duration), dt = duration / steps;
  for (let i = 0; i < steps; i++) {
    flight.stepFlightRotation(rotation, spin, turn, dt);
    flight.stepFlightVelocity(velocity, rotation, spin, input, dt, flight.FLIGHT.roomCruise, boosted);
  }
  return { velocity, rotation, spin };
}

test("the shared flight compromise uses the agreed room speeds and response constants", () => {
  assert.equal(flight.FLIGHT.roomCruise, 117.5);
  assert.equal(flight.FLIGHT.acceleration, 0.7);
  assert.equal(flight.FLIGHT.boostAcceleration, 10.5);
  assert.equal(flight.FLIGHT.chaseCameraResponse, 6.25);
  assert.equal(flight.FLIGHT.inputSmoothing, 65);
  assert.equal(flight.FLIGHT.response, 11);
  assert.equal(flight.FLIGHT.angularAcceleration, 9);
});

test("steady-thrust speed agrees at 30, 60, and 144 frames per second", () => {
  const runs = [30, 60, 144].map(fps => simulate(fps, 12, 1).velocity.length());
  assert.ok(runs.every(speed => speed > 110 && speed < 119), `expected cruise near 117.5 units/s: ${runs.join(", ")}`);
  assert.ok(Math.max(...runs) - Math.min(...runs) < 1.2, `frame-rate spread was too large: ${runs.join(", ")}`);
});

test("boosted acceleration and braking remain bounded across frame rates", () => {
  const runs = [30, 60, 144].map(fps => {
    const state = simulate(fps, 0.8, 1, true);
    const boosted = state.velocity.length();
    const input = { thrust: 0, strafe: 0, lift: 0, brake: true };
    for (let i = 0; i < fps; i++) flight.stepFlightVelocity(state.velocity, state.rotation, state.spin, input, 1 / fps, flight.FLIGHT.roomCruise, false);
    return [boosted, state.velocity.length()];
  });
  assert.ok(runs.every(([boosted]) => boosted > 300 && boosted < 400), JSON.stringify(runs));
  assert.ok(runs.every(([, stopped]) => stopped < 5));
  assert.ok(Math.max(...runs.map(([boosted]) => boosted)) - Math.min(...runs.map(([boosted]) => boosted)) < 15);
});

test("releasing mouse-driven turn input lets angular inertia settle", () => {
  const rotation = new flight.THREE.Quaternion(), spin = new flight.THREE.Vector3();
  for (let i = 0; i < 60; i++) flight.stepFlightRotation(rotation, spin, { pitch: 0, yaw: 0.6, roll: 0 }, 1 / 60);
  assert.ok(Math.abs(spin.y) > 0.5, "the moderated turn has weight while the input is held");
  for (let i = 0; i < 120; i++) flight.stepFlightRotation(rotation, spin, { pitch: 0, yaw: 0, roll: 0 }, 1 / 60);
  assert.ok(Math.abs(spin.y) < 0.01, "the ship settles promptly after the mouse stops");
});
