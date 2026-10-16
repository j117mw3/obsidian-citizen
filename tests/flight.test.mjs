import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const built = await build({
  stdin: {
    contents: 'import * as THREE from "three"; export { THREE }; export * from "./src/flight"; export { PilotController } from "./src/pilot";',
    resolveDir: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", target: "node22", write: false,
});
const flight = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);

test("docking requires a continuous 1.5-second ready hold and sends only one request until release", () => {
  for (const multiplayer of [false, true]) {
    const pilot = Object.create(flight.PilotController.prototype), requests = [];
    let target = { key: "owner/main", distance: 4 };
    Object.assign(pilot, { active: true, opts: { multiplayer }, keys: new Set(["KeyF"]), health: 100,
      vel: new flight.THREE.Vector3(), clock: 0, dockHeld: 0, dockTargetKey: "", dockSent: false, dockMessageUntil: 0,
      dockingPrompt: {}, host: { dockingTarget: () => target, onDockRequest: () => requests.push(target.key) } });
    for (let tick = 0; tick < 14; tick++) pilot.updateDocking(0.1, true);
    assert.equal(requests.length, 0); assert.match(pilot.dockingPrompt.textContent, /93%/);
    pilot.updateDocking(0.1, true); assert.deepEqual(requests, ["owner/main"]);
    for (let tick = 0; tick < 30; tick++) pilot.updateDocking(0.1, true);
    assert.equal(requests.length, 1, "holding F does not spam host requests");
    pilot.keys.clear(); pilot.updateDocking(0.1, true); pilot.keys.add("KeyF");
    for (let tick = 0; tick < 10; tick++) pilot.updateDocking(0.1, true);
    target = { key: "other/main", distance: 4 }; pilot.updateDocking(0.1, true);
    assert.ok(pilot.dockHeld < 0.2, "switching main resets the hold");
    pilot.updateDocking(0.1, false); assert.equal(pilot.dockHeld, 0);
    target = null; pilot.updateDocking(0.1, true); assert.match(pilot.dockingPrompt.textContent, /Aim/);
    target = { key: "owner/main", distance: 15 }; pilot.updateDocking(0.1, true); assert.match(pilot.dockingPrompt.textContent, /within 14u/);
    target.distance = -1; pilot.updateDocking(0.1, true); assert.match(pilot.dockingPrompt.textContent, /outside/);
    target.distance = 4; pilot.vel.z = 11; pilot.updateDocking(0.1, true); assert.match(pilot.dockingPrompt.textContent, /Hold X/);
    assert.equal(requests.length, 1);
    pilot.showDockMessage("Host rejected docking"); pilot.updateDocking(0.1, true);
    assert.equal(pilot.dockingPrompt.textContent, "Host rejected docking");
  }
});

test("solo flight collides with the visible main sphere before entering its opaque surface", () => {
  const pilot = Object.create(flight.PilotController.prototype);
  Object.assign(pilot, { pos: new flight.THREE.Vector3(0, 0, 5), vel: new flight.THREE.Vector3(0, 0, -2),
    host: { nodes: () => [{ x: 0, y: 0, z: 0 }], solid: () => true, nodeRadius: () => 0.9, nodeCollisionRadius: () => 6 } });
  pilot.collide();
  assert.ok(Math.abs(pilot.pos.z - 6.7) < 1e-8);
  assert.ok(pilot.vel.z >= 0);
});

test("pole departure skips the union of overlapping node obstacles without changing the exit direction", () => {
  const grid = new flight.StarCollisionGrid(), nodes = [[0, 0, 0], [0, 8, 0], [0, 16, 0], [50, 10, 0]];
  grid.rebuild([new Float32Array(nodes.flat())]);
  const position = grid.clearPointOnRay(new flight.THREE.Vector3(), new flight.THREE.Vector3(0, 1, 0), 35 * 6 / 27);
  assert.ok(nodes.every(node => position.distanceTo(new flight.THREE.Vector3(...node)) > 6.5));
  assert.equal(position.x, 0); assert.equal(position.z, 0);
  assert.ok(Math.abs(position.y - 22.55) < 1e-8);
});

test("surface resume restores the ship pose directly and preserves ship resources and cooldown", () => {
  const pilot = Object.create(flight.PilotController.prototype);
  Object.assign(pilot, { pos: new flight.THREE.Vector3(), quat: new flight.THREE.Quaternion(), camQuat: new flight.THREE.Quaternion(),
    vel: new flight.THREE.Vector3(10, 20, 30), spin: new flight.THREE.Vector3(1, 2, 3), displayCorrection: new flight.THREE.Vector3(4, 5, 6),
    health: 63, shields: 17, energy: 0.42, heat: 0.38, ammunition: 9, cooldown: 0.12, firePending: true, firePendingCtrl: true, firing: true });
  pilot.enter = () => { pilot.cooldown = 0; };
  let rendered;
  pilot.updateCamera = () => { rendered = pilot.pos.clone(); };
  pilot.resumeFromSurface({ position: [100, 20, 30], rotation: [0, 0, 0, 1] });
  assert.deepEqual(rendered.toArray(), [100, 20, 30]);
  assert.deepEqual(pilot.vel.toArray(), [0, 0, 0]);
  assert.deepEqual(pilot.spin.toArray(), [0, 0, 0]);
  assert.deepEqual([pilot.health, pilot.shields, pilot.energy, pilot.heat, pilot.ammunition, pilot.cooldown], [63, 17, 0.42, 0.38, 9, 0.12]);
  assert.equal(pilot.firing || pilot.firePending || pilot.firePendingCtrl, false);
});

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

test("the shared flight controller matches upstream 0.4.1 controls and room speed", () => {
  assert.equal(flight.FLIGHT.roomCruise, 135);
  assert.equal(flight.FLIGHT.acceleration, 0.7);
  assert.equal(flight.FLIGHT.boostAcceleration, 10);
  assert.equal(flight.FLIGHT.chaseCameraResponse, 8);
  assert.equal(flight.FLIGHT.inputSmoothing, 90);
  assert.equal(flight.FLIGHT.response, 6);
  assert.equal(flight.FLIGHT.angularAcceleration, 4);
  assert.equal(flight.FLIGHT.mouseRadiansPerPixel, 0.0022);
  assert.equal(flight.FLIGHT.mouseMaxRate, 9);
});

test("steady-thrust speed agrees at 30, 60, and 144 frames per second", () => {
  const runs = [30, 60, 144].map(fps => simulate(fps, 12, 1).velocity.length());
  assert.ok(runs.every(speed => speed > 130 && speed <= 135.1), `expected cruise near 135 units/s: ${runs.join(", ")}`);
  assert.ok(Math.max(...runs) - Math.min(...runs) < 1.5, `frame-rate spread was too large: ${runs.join(", ")}`);
});

test("quicker forward pickup reaches ninety percent cruise in about one and a half seconds", () => {
  const times = [30, 60, 144].map(fps => {
    const velocity = new flight.THREE.Vector3(), rotation = new flight.THREE.Quaternion(), spin = new flight.THREE.Vector3();
    const input = { thrust: 1, strafe: 0, lift: 0, brake: false };
    for (let frame = 1; frame <= fps * 3; frame++) {
      flight.stepFlightVelocity(velocity, rotation, spin, input, 1 / fps, flight.FLIGHT.roomCruise, false);
      if (velocity.length() >= flight.FLIGHT.roomCruise * 0.9) return frame / fps;
    }
    return Infinity;
  });
  assert.ok(times.every(time => time >= 1.4 && time <= 1.6), `pickup times differed from the target: ${times.join(", ")}`);
  assert.ok(Math.max(...times) - Math.min(...times) < 0.08, `frame-rate variation was too large: ${times.join(", ")}`);
});

test("room boost resource replay uses the shared drain and does not refill during spectator ticks", () => {
  let state = { energy: 1, boostLocked: false, emptyWait: 0, regenDelay: 0, damagePause: 0 };
  let step = flight.stepBoostResources(state, { active: true, boost: true, thrust: 1 }, 1);
  assert.equal(step.energy, 0.72);
  assert.equal(step.regenDelay, 1.5);
  assert.equal(step.boosting, true);
  state = { ...state, ...step };
  const spectator = flight.stepBoostResources(state, { active: false, boost: false, thrust: 0 }, 1);
  assert.equal(spectator.energy, state.energy);
  assert.equal(spectator.regenDelay, state.regenDelay);
  assert.equal(spectator.emptyWait, state.emptyWait);
  assert.equal(spectator.boosting, false);
});

test("shared room star collision grid pushes out and reflects inward velocity", () => {
  const grid = new flight.StarCollisionGrid();
  grid.rebuild([new Float32Array([0, 0, 0])]);
  const position = new flight.THREE.Vector3(1, 0, 0), velocity = new flight.THREE.Vector3(-5, 0, 0);
  grid.resolve(position, velocity);
  assert.ok(position.x >= 6 - 1e-8);
  assert.ok(velocity.x > 0);
  const clear = new flight.THREE.Vector3(10, 0, 0), unchanged = new flight.THREE.Vector3(1, 2, 3);
  grid.resolve(clear, unchanged);
  assert.deepEqual(clear.toArray(), [10, 0, 0]);
  assert.deepEqual(unchanged.toArray(), [1, 2, 3]);
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

test("cursor-mode angular response eases back to neutral", () => {
  const rotation = new flight.THREE.Quaternion(), spin = new flight.THREE.Vector3();
  for (let i = 0; i < 60; i++) flight.stepFlightRotation(rotation, spin, { pitch: 0, yaw: 0.6, roll: 0 }, 1 / 60);
  assert.ok(Math.abs(spin.y) > 0.5, "the moderated turn has weight while the input is held");
  for (let i = 0; i < 120; i++) flight.stepFlightRotation(rotation, spin, { pitch: 0, yaw: 0, roll: 0 }, 1 / 60);
  assert.ok(Math.abs(spin.y) < 0.01, "the ship settles promptly after the mouse stops");
});

function upstreamCapturedStep(THREE, rotation, spin, state, dx, dy, roll, dt, sensitivity = 1.3, inputAgility = 1.25, turnAgility = 0.8, invertY = false) {
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const ease = 1 - Math.exp(-dt * 90);
  state.x += (dx - state.x) * ease;
  state.y += (dy - state.y) * ease;
  const gain = 0.0022 * sensitivity * (0.75 + 0.25 * inputAgility), inverse = invertY ? -1 : 1;
  spin.y = clamp(-state.x * gain / Math.max(dt, 1e-3), -9, 9);
  spin.x = clamp(-state.y * gain * inverse / Math.max(dt, 1e-3), -9, 9);
  const cap = 4 * turnAgility * dt, rollEase = 1 - Math.exp(-6 * dt);
  spin.z += clamp((roll * 3 * turnAgility - spin.z) * rollEase, -cap * 1.4, cap * 1.4);
  rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), spin.x * dt));
  rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), spin.y * dt));
  rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), spin.z * dt));
  rotation.normalize();
}

test("captured-mouse steering matches upstream 0.4.1 traces at 30, 60, and 144 FPS", () => {
  const results = [];
  for (const fps of [30, 60, 144]) {
    const actualQ = new flight.THREE.Quaternion(), expectedQ = new flight.THREE.Quaternion();
    const actualSpin = new flight.THREE.Vector3(), expectedSpin = new flight.THREE.Vector3();
    const actualState = { x: 0, y: 0 }, expectedState = { x: 0, y: 0 };
    const dt = 1 / fps;
    for (let frame = 0; frame < fps; frame++) {
      const dx = frame === Math.round(fps * 0.2) ? 42 : frame === Math.round(fps * 0.53) ? -19 : 0;
      const dy = frame === Math.round(fps * 0.2) ? -14 : frame === Math.round(fps * 0.53) ? 7 : 0;
      const roll = frame < Math.round(fps * 0.35) ? 0.7 : 0;
      flight.stepFlightRotation(actualQ, actualSpin, { pitch: 0, yaw: 0, roll }, dt, 0.8, {
        mode: "capture", mouseDX: dx, mouseDY: dy, sensitivity: 1.3, inputAgility: 1.25, invertY: false, mouseState: actualState,
      });
      upstreamCapturedStep(flight.THREE, expectedQ, expectedSpin, expectedState, dx, dy, roll, dt);
    }
    assert.ok(actualQ.angleTo(expectedQ) < 1e-8, `${fps} FPS quaternion differs from the upstream direct-aim trace`);
    assert.ok(actualSpin.distanceTo(expectedSpin) < 1e-8, `${fps} FPS angular velocity differs from upstream`);
    assert.ok(Math.abs(actualSpin.x) < 0.02 && Math.abs(actualSpin.y) < 0.02, `${fps} FPS leaves no captured-mouse turn inertia`);
    results.push(actualQ);
  }
  assert.ok(results[0].angleTo(results[1]) < 0.04 && results[1].angleTo(results[2]) < 0.04, "the recorded quick flicks remain close across frame rates");
});
