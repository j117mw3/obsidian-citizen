import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { basename } from "node:path";

const built = await build({ entryPoints: ["src/pilotProfile.ts", "src/ship.ts", "src/cockpit.ts"], bundle: true, platform: "node", format: "esm", target: "node22", outdir: "test-bundles", write: false });
async function load(name) {
  const file = built.outputFiles.find(item => basename(item.path) === `${name}.js`);
  assert.ok(file, `missing bundled ${name} module`);
  return import(`data:text/javascript;base64,${Buffer.from(file.text).toString("base64")}`);
}
const profile = await load("pilotProfile");
const shipModule = await load("ship");
const cockpit = await load("cockpit");

test("pilot profiles accept six ships and three sounds per category", () => {
  assert.deepEqual(profile.SHIP_IDS, ["classic", "vector", "dart", "bulwark", "crescent", "revenant"]);
  assert.deepEqual(profile.ENGINE_SOUND_IDS, ["classic", "ion", "turbine"]);
  assert.deepEqual(profile.AFTERBURNER_SOUND_IDS, ["classic", "plasma", "fusion"]);
  assert.deepEqual(profile.LASER_SOUND_IDS, ["classic", "pulse", "arc"]);
  assert.equal(profile.validPilotProfile(profile.DEFAULT_PILOT_PROFILE), true);
  assert.equal(profile.validPilotProfile({ ...profile.DEFAULT_PILOT_PROFILE, ship: "unknown" }), false);
  assert.equal(profile.validPilotProfile({ ...profile.DEFAULT_PILOT_PROFILE, engine: "private-id" }), false);
});

test("all six procedural ship models share the same four cannon mounts", () => {
  const signatures = new Set();
  for (const id of profile.SHIP_IDS) {
    const ship = shipModule.buildShip(id);
    assert.deepEqual(ship.muzzles.map(muzzle => muzzle.toArray()), shipModule.SHIP_MUZZLES);
    const geometries = [];
    ship.group.traverse(object => { if (object.isMesh) geometries.push([object.geometry.type, object.geometry.getAttribute("position").count]); });
    signatures.add(JSON.stringify(geometries));
    ship.dispose();
  }
  assert.equal(signatures.size, 6, "each hangar choice has a distinct procedural silhouette");
});

test("cockpit screens remain inside the camera at narrow and wide aspect ratios", () => {
  for (const aspect of [0.5, 0.75, 1, 16 / 9, 2.4]) {
    const layout = cockpit.cockpitScreenLayout(aspect), scaleX = 2.2 * layout.horizontalScale;
    const displayOuter = (layout.centerX + 0.38) * scaleX;
    const cameraHalfWidth = Math.tan(55 * Math.PI / 360) * 0.975 * 2.2 * aspect;
    assert.ok(displayOuter < cameraHalfWidth, `screens fit at aspect ${aspect}`);
  }
});

test("multiplayer presentation lean is bounded and eases consistently", () => {
  const input = { yaw: 1, pitch: -1, strafe: 1, lift: 0 };
  const one = profile.stepPresentation(0, 0, input, 1 / 60);
  const two = profile.stepPresentation(0, 0, input, 1 / 60);
  assert.deepEqual(one, two);
  assert.ok(one[0] <= 0.55 && one[0] >= -0.55);
  assert.ok(one[1] <= 0.4 && one[1] >= -0.4);
});
