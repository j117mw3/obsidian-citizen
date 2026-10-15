import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { basename } from "node:path";

const compiled = await build({ entryPoints: ["src/room.ts", "src/netcrypto.ts", "src/relay.ts"], bundle: true, platform: "node", format: "esm", target: "node22", outdir: "room-test-bundles", write: false });
async function load(name) {
  const file = compiled.outputFiles.find(item => basename(item.path) === `${name}.js`);
  assert.ok(file, `missing bundled ${name}`);
  return import(`data:text/javascript;base64,${Buffer.from(file.text).toString("base64")}`);
}
const roomApi = await load("room"), cryptoApi = await load("netcrypto"), relayApi = await load("relay");
const originalWindow = globalThis.window;
globalThis.window = globalThis;
test.after(() => { if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; });

function makeBus() {
  const topics = new Map(), published = [];
  function transportFactory(topic, onText, onProblem) {
    const transport = {
      stopped: true,
      start() { this.stopped = false; const list = topics.get(topic) ?? new Set(); list.add(this); topics.set(topic, list); },
      stop() { this.stopped = true; topics.get(topic)?.delete(this); },
      async publish(text) {
        published.push(text);
        for (const client of [...(topics.get(topic) ?? [])]) if (!client.stopped) queueMicrotask(() => { void client.onText(text); });
      },
      onText, onProblem,
    };
    return transport;
  }
  return { transportFactory, published };
}

const waitFor = async (predicate, details = "") => {
  const until = Date.now() + 1500;
  while (!predicate()) { if (Date.now() > until) throw new Error(`Timed out waiting for synthetic relay delivery. ${typeof details === "function" ? details() : details}`); await new Promise(resolve => setTimeout(resolve, 5)); }
};

test("room codes are ten characters, formatted for people, and reject old or malformed codes", () => {
  const code = cryptoApi.makeRoomCode();
  assert.equal(code.length, 10);
  assert.equal(cryptoApi.formatRoomCode(code).length, 11);
  assert.equal(cryptoApi.parseRoomCode(` ${code.slice(0, 5)}-${code.slice(5).toLowerCase()} `), code);
  assert.equal(cryptoApi.parseRoomCode("YJTV9PXM"), null, "eight-character protocol 4 codes receive the update-required path");
  assert.equal(cryptoApi.parseRoomCode("00000-11111"), null);
});

test("ntfy discovery is encrypted, joins with the full validated roster, and fragments setup within relay limits", async () => {
  const bus = makeBus(), markers = ["PRIVATE_TITLE_CobaltVault", "PRIVATE_PATH_Secrets/Bluebird.md", "PRIVATE_TAG_Clinical"];
  let resolveSignal;
  const cb = signal => ({ roster() {}, signal: (_from, data) => signal(data), status(text, error) { if (error) throw new Error(text); } });
  const host = new roomApi.RelayRoom("https://ntfy.sh", cb(() => {}), bus.transportFactory);
  const guest = new roomApi.RelayRoom("https://ntfy.sh", cb(data => resolveSignal?.(data)), bus.transportFactory);
  await host.create("Host Private Name", { revision: 1, ship: "dart-interceptor", engine: "stellar", afterburner: "stellar", laser: "pulse-xl" });
  const hostCode = host.code;
  await guest.join(cryptoApi.formatRoomCode(hostCode), "Guest Private Name", { revision: 1, ship: "bulwark-gunship", engine: "turbine", afterburner: "fusion", laser: "arc" });
  await waitFor(() => host.members.length === 2 && guest.members.length === 2);
  assert.deepEqual(host.members.map(member => member.profile.ship).sort(), ["bulwark-gunship", "dart-interceptor"]);
  assert.equal(guest.members.find(member => member.id === host.selfId).profile.laser, "pulse-xl");

  let seed = 20261015;
  const sdp = Array.from({ length: 18_000 }, () => { seed = (seed * 48271) % 0x7fffffff; return String.fromCharCode(33 + (seed % 90)); }).join("");
  const received = new Promise(resolve => { resolveSignal = resolve; });
  host.signal(guest.selfId, { description: { type: "offer", sdp } });
  const signal = await Promise.race([received, new Promise((_, reject) => setTimeout(() => reject(new Error("fragmented signal timed out")), 3000))]);
  assert.equal(signal.description.sdp, sdp);
  assert.ok(bus.published.every(text => text.length <= 4096), "each relay publish fits ntfy's message limit");
  for (const marker of ["Host Private Name", "Guest Private Name", ...markers]) assert.equal(bus.published.join("").includes(marker), false, "room metadata is sealed before publication");
  host.leave(); guest.leave();
});

test("public-relay rooms enforce four pilots and reject a fifth with a clear capacity error", async () => {
  const bus = makeBus();
  const callbacks = { roster() {}, signal() {}, status() {} };
  const host = new roomApi.RelayRoom("https://ntfy.sh", callbacks, bus.transportFactory);
  await host.create("Synthetic Host");
  const members = [host];
  for (let i = 2; i <= 4; i++) {
    const pilot = new roomApi.RelayRoom("https://ntfy.sh", callbacks, bus.transportFactory);
    await pilot.join(host.code, `Synthetic Pilot ${i}`);
    members.push(pilot);
    await waitFor(() => members.every(room => room.members.length === i), () => `roster sizes: ${members.map(room => room.members.length).join(",")}`);
  }
  const overflow = new roomApi.RelayRoom("https://ntfy.sh", callbacks, bus.transportFactory);
  await assert.rejects(overflow.join(host.code, "Synthetic Fifth"), /already has four pilots/);
  for (const member of [...members, overflow]) member.leave();
});

test("relay rate limits are reported and retried without opening a gameplay transport", async () => {
  const problems = [], statuses = [429, 200];
  const oldSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = callback => { queueMicrotask(callback); return 0; };
  try {
    const channel = new relayApi.RelayChannel("https://ntfy.sh", "cg-test-topic", async () => statuses.shift(), () => {}, text => problems.push(text));
    await channel.publish("sealed-setup-message");
  } finally { globalThis.setTimeout = oldSetTimeout; }
  assert.equal(problems.length, 1);
  assert.match(problems[0], /limiting requests/);
});
