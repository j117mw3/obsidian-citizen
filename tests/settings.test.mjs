import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const built = await build({ entryPoints: ["src/settings.ts"], bundle: true, platform: "node", format: "esm", target: "node22", write: false });
const settingsModule = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);

test("legacy localhost signaling address is preserved but inactive after ntfy migration", () => {
  const settings = settingsModule.sanitizeSettings({ multiplayerSignalingUrl: "ws://localhost:8787" });
  assert.equal(settings.multiplayerConnectionMode, "public");
  assert.equal(settings.multiplayerCustomServerUrl, "");
  assert.equal(settings.multiplayerLegacyServerUrl, "ws://localhost:8787");
});

test("previous custom websocket addresses remain inactive legacy settings", () => {
  const url = "wss://my-room.example.net/socket";
  const settings = settingsModule.sanitizeSettings({ multiplayerSignalingUrl: url });
  assert.equal(settings.multiplayerConnectionMode, "public");
  assert.equal(settings.multiplayerCustomServerUrl, "");
  assert.equal(settings.multiplayerLegacyServerUrl, url);
});

test("fresh settings use ntfy public relay discovery", () => {
  const settings = settingsModule.sanitizeSettings({});
  assert.equal(settings.multiplayerConnectionMode, "public");
  assert.equal(settings.multiplayerCustomServerUrl, "");
  assert.equal(settings.multiplayerRelayUrl, "https://ntfy.sh");
});

test("upstream-only settings preserve its Dart and Bulwark meanings", () => {
  const imported = settingsModule.sanitizeSettings({ pilotShip: "dart", pilotCollapse: "auto" });
  assert.equal(imported.pilotShip, "dart-interceptor");
  assert.equal(settingsModule.sanitizeSettings({ pilotShip: "bulwark", pilotCollapse: "auto" }).pilotShip, "bulwark-gunship");
  assert.equal(settingsModule.sanitizeSettings({ pilotShip: "dart", settingsSchemaVersion: 1 }).pilotShip, "dart");
});

test("new hangar choices default to Classic and sanitize invalid saved ids", () => {
  const defaults = settingsModule.sanitizeSettings({});
  assert.deepEqual([defaults.pilotShip, defaults.pilotEngineSound, defaults.pilotAfterburnerSound, defaults.pilotLaserSound], ["classic", "classic", "classic", "classic"]);
  const old = settingsModule.sanitizeSettings({ pilotShip: "not-a-ship", pilotEngineSound: "unlisted", pilotAfterburnerSound: "classic", pilotLaserSound: "pulse" });
  assert.deepEqual([old.pilotShip, old.pilotEngineSound, old.pilotAfterburnerSound, old.pilotLaserSound], ["classic", "classic", "classic", "pulse"]);
  assert.equal(old.pilotNearbyAudio, true);
});

test("surface controls persist a readable laser color and repair unsafe key bindings", () => {
  const settings = settingsModule.sanitizeSettings({
    surfaceLaserColor: "#000000", surfaceSensitivity: 5, surfaceFov: 120, surfaceCrouchMode: "toggle",
    surfaceForwardKey: "KeyW", surfaceBackKey: "KeyW", surfaceInteractKey: "not-a-code",
  });
  assert.equal(settings.surfaceLaserColor, "#959595");
  assert.equal(settings.surfaceSensitivity, 3);
  assert.equal(settings.surfaceFov, 100);
  assert.equal(settings.surfaceCrouchMode, "hold");
  assert.equal(settings.surfaceInteractKey, "KeyF");
  const codes = [settings.surfaceForwardKey, settings.surfaceBackKey, settings.surfaceLeftKey, settings.surfaceRightKey,
    settings.surfaceJumpKey, settings.surfaceSprintKey, settings.surfaceCrouchKey, settings.surfaceLeanLeftKey,
    settings.surfaceLeanRightKey, settings.surfaceInteractKey];
  assert.equal(new Set(codes).size, codes.length);
  assert.equal(settings.settingsSchemaVersion, 5);
});


test("crouch migrates once to Left Control and preserves custom and conflicting bindings", () => {
 const migrate = settingsModule.sanitizeSettings;
 assert.equal(migrate({settingsSchemaVersion:3,surfaceCrouchKey:"KeyC"}).surfaceCrouchKey,"ControlLeft");
 assert.equal(migrate({settingsSchemaVersion:4,surfaceCrouchKey:"KeyC"}).surfaceCrouchKey,"KeyC");
 assert.equal(migrate({settingsSchemaVersion:3,surfaceCrouchKey:"KeyV"}).surfaceCrouchKey,"KeyV");
 const conflict=migrate({settingsSchemaVersion:3,surfaceCrouchKey:"KeyC",surfaceSprintKey:"ControlLeft"});
 assert.equal(conflict.surfaceSprintKey,"ControlLeft"); assert.notEqual(conflict.surfaceCrouchKey,"ControlLeft");
 assert.deepEqual(migrate(conflict),conflict);
});

test("schema five changes only crouch mode for an existing custom toggle profile",()=>{
 const before=settingsModule.sanitizeSettings({settingsSchemaVersion:4,surfaceCrouchMode:"toggle",surfaceCrouchKey:"KeyV",surfaceInteractKey:"KeyG",surfaceFov:85,surfaceLaserColor:"#FF8800"});
 assert.equal(before.settingsSchemaVersion,5);assert.equal(before.surfaceCrouchMode,"hold");assert.equal(before.surfaceCrouchKey,"KeyV");assert.equal(before.surfaceInteractKey,"KeyG");assert.equal(before.surfaceFov,85);assert.equal(before.surfaceLaserColor,"#FF8800");
 assert.deepEqual(settingsModule.sanitizeSettings(before),before,"migration is idempotent");
});
