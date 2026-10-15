import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const built = await build({
  stdin: {
    contents: 'export * from "./src/weapons";',
    resolveDir: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    loader: "ts",
  },
  bundle: true, platform: "node", format: "esm", target: "node22", write: false,
});
globalThis.window = globalThis;
const w = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);

test("a hit in the gun's best range does the most damage, and one at the limit the least", () => {
  for (const kind of [0, 1]) {
    const [lo, hi] = w.SWEET_SPOT[kind], base = w.weaponStats(kind).damage;
    assert.ok(w.damageAt(kind, (lo + hi) / 2) > base, "a bonus inside the best range");
    assert.equal(w.damageAt(kind, lo / 2), base, "full damage when closer");
    assert.ok(w.damageAt(kind, hi + 50) < base && w.damageAt(kind, hi + 50) > w.damageAt(kind, w.BOLT_REACH), "fading beyond it");
    assert.ok(w.damageAt(kind, w.BOLT_REACH) >= base * 0.44, "never below about half");
  }
});

test("a shot may carry its shooter's speed, and nothing silly", () => {
  const base = { id: "s", o: [0, 0, 0], d: [0, 0, 1] };
  assert.ok(w.validShot({ ...base, s: 120 }));
  assert.equal(w.validShot({ ...base, s: -1 }), false);
  assert.equal(w.validShot({ ...base, s: 1e9 }), false);
  assert.equal(w.validShot({ ...base, s: "fast" }), false);
});

test("the lead pip aims ahead of a moving target and refuses one that cannot be caught", () => {
  const out = { x: 0, y: 0, z: 0, t: 0 };
  assert.ok(w.interceptPoint({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { x: 0, y: 0, z: 50 }, 1500, out));
  assert.ok(out.z > 0 && out.t > 0, "aims where the target will be");
  assert.equal(w.interceptPoint({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { x: 5000, y: 0, z: 0 }, 1500, out), false);
});

test("all ships use a fixed world-space hitbox regardless of distance or speed", () => {
  assert.equal(w.SHIP_HIT_RADIUS, 4);
});
