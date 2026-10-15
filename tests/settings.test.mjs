import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const built = await build({ entryPoints: ["src/settings.ts"], bundle: true, platform: "node", format: "esm", target: "node22", write: false });
const settingsModule = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);

test("legacy localhost signaling default migrates to hosted rooms", () => {
  const settings = settingsModule.sanitizeSettings({ multiplayerSignalingUrl: "ws://localhost:8787" });
  assert.equal(settings.multiplayerConnectionMode, "hosted");
  assert.equal(settings.multiplayerCustomServerUrl, "");
});

test("previous custom signaling addresses remain selected and unchanged", () => {
  const url = "wss://my-room.example.net/socket";
  const settings = settingsModule.sanitizeSettings({ multiplayerSignalingUrl: url });
  assert.equal(settings.multiplayerConnectionMode, "custom");
  assert.equal(settings.multiplayerCustomServerUrl, url);
});

test("fresh settings use the bundled hosted service", () => {
  const settings = settingsModule.sanitizeSettings({});
  assert.equal(settings.multiplayerConnectionMode, "hosted");
  assert.equal(settings.multiplayerCustomServerUrl, "");
});

test("new hangar choices default to Classic and sanitize invalid saved ids", () => {
  const defaults = settingsModule.sanitizeSettings({});
  assert.deepEqual([defaults.pilotShip, defaults.pilotEngineSound, defaults.pilotAfterburnerSound, defaults.pilotLaserSound], ["classic", "classic", "classic", "classic"]);
  const old = settingsModule.sanitizeSettings({ pilotShip: "not-a-ship", pilotEngineSound: "unlisted", pilotAfterburnerSound: "classic", pilotLaserSound: "pulse" });
  assert.deepEqual([old.pilotShip, old.pilotEngineSound, old.pilotAfterburnerSound, old.pilotLaserSound], ["classic", "classic", "classic", "pulse"]);
  assert.equal(old.pilotNearbyAudio, true);
});
