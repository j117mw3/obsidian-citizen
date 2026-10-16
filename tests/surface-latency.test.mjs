import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const built = await build({ entryPoints: ["dev/surface-latency-harness.ts"], bundle: true, platform: "node", format: "esm", target: "node22", write: false });
const { runSurfaceLatencyCase } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);

test("four-session latency smoke is deterministic and cannot substitute for the 500-shot gate", () => {
  const config = { rttMs: 100, distance: 10, stance: "crouched-leaning", scenario: "strafe", shots: 10 };
  const first = runSurfaceLatencyCase(config), second = runSurfaceLatencyCase(config);
  assert.deepEqual(second, first);
  assert.equal(first.clients, 4); assert.equal(first.eligible, false);
  assert.equal(first.accepted, 10); assert.equal(first.dispositions, first.attempts);
  assert.equal(first.duplicateHits, 0); assert.equal(first.invalidSnapshots, 0);
  assert.equal(first.ghosts, 0); assert.ok(first.maxRewindMs <= 150);
});

test("cover-transition smoke checks actual damage segments against authoritative walls and sphere", () => {
  const result = runSurfaceLatencyCase({ rttMs: 200, distance: 10, stance: "standing", scenario: "cover", shots: 12 });
  assert.equal(result.accepted, 12); assert.equal(result.blockerViolations, 0);
  assert.equal(result.duplicateHits, 0); assert.equal(result.ghosts, 0);
  assert.ok(result.within1000Ms >= 0.99);
});

test("degraded attempt samples cannot replace the supported accepted-shot fairness gate", async () => {
  const realtime = await build({ entryPoints: ["dev/surface-realtime-case.ts"], bundle: true, platform: "node", format: "esm", target: "node22", write: false });
  const { runRealtimeSurfaceCase } = await import(`data:text/javascript;base64,${Buffer.from(realtime.outputFiles[0].text).toString("base64")}`);
  for (const rttMs of [0, 50, 100]) await assert.rejects(runRealtimeSurfaceCase({ rttMs, distance: 10, stance: "standing", scenario: "strafe", shots: 500 },
    "http://127.0.0.1/relay", new AbortController().signal, () => {}, "attempts"), /require accepted-shot samples/);
});
