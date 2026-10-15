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
