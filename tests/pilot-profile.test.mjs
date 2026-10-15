import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { basename } from "node:path";

const built = await build({ entryPoints: ["src/pilotProfile.ts", "src/ship.ts"], bundle: true, platform: "node", format: "esm", target: "node22", outdir: "test-bundles", write: false });
async function load(name) {
  const file = built.outputFiles.find(item => basename(item.path) === `${name}.js`);
  assert.ok(file, `missing bundled ${name} module`);
  return import(`data:text/javascript;base64,${Buffer.from(file.text).toString("base64")}`);
}
const profile = await load("pilotProfile");
const shipModule = await load("ship");

test("pilot profiles accept only five ships and two sounds per category", () => {
  assert.deepEqual(profile.SHIP_IDS, ["classic", "vector", "dart", "bulwark", "crescent"]);
  assert.deepEqual(profile.ENGINE_SOUND_IDS, ["classic", "ion"]);
  assert.deepEqual(profile.AFTERBURNER_SOUND_IDS, ["classic", "plasma"]);
  assert.deepEqual(profile.LASER_SOUND_IDS, ["classic", "pulse"]);
  assert.equal(profile.validPilotProfile(profile.DEFAULT_PILOT_PROFILE), true);
  assert.equal(profile.validPilotProfile({ ...profile.DEFAULT_PILOT_PROFILE, ship: "unknown" }), false);
  assert.equal(profile.validPilotProfile({ ...profile.DEFAULT_PILOT_PROFILE, engine: "private-id" }), false);
});

test("all five procedural ship models share the same four cannon mounts", () => {
  const signatures = new Set();
  for (const id of profile.SHIP_IDS) {
    const ship = shipModule.buildShip(id);
    assert.deepEqual(ship.muzzles.map(muzzle => muzzle.toArray()), shipModule.SHIP_MUZZLES);
    const geometries = [];
    ship.group.traverse(object => { if (object.isMesh) geometries.push([object.geometry.type, object.geometry.getAttribute("position").count]); });
    signatures.add(JSON.stringify(geometries));
    ship.dispose();
  }
  assert.equal(signatures.size, 5, "each hangar choice has a distinct procedural silhouette");
});

test("multiplayer presentation lean is bounded and eases consistently", () => {
  const input = { yaw: 1, pitch: -1, strafe: 1, lift: 0 };
  const one = profile.stepPresentation(0, 0, input, 1 / 60);
  const two = profile.stepPresentation(0, 0, input, 1 / 60);
  assert.deepEqual(one, two);
  assert.ok(one[0] <= 0.55 && one[0] >= -0.55);
  assert.ok(one[1] <= 0.4 && one[1] >= -0.4);
});
