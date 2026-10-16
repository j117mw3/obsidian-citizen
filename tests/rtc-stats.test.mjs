import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const built = await build({ entryPoints: ["src/rtcStats.ts"], bundle: true, platform: "node", format: "esm", write: false });
const { connectionStats, connectionStatById } = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);

test("connection statistics preserve selected WebRTC timing and candidate counters", () => {
  const report = new Map([
    ["transport", { type: "transport", selectedCandidatePairId: "pair" }],
    ["pair", { type: "candidate-pair", state: "succeeded", nominated: true, currentRoundTripTime: 0.125, bytesSent: 123, remoteCandidateId: "remote" }],
    ["remote", { type: "remote-candidate", candidateType: "relay", address: "127.0.0.1" }],
  ]);
  const selected = connectionStats(report).find(stat => stat.type === "transport").selectedCandidatePairId;
  assert.equal(connectionStatById(report, selected).currentRoundTripTime, 0.125);
  assert.equal(connectionStatById(report, "remote").candidateType, "relay");
  assert.equal(connectionStatById(report, undefined), undefined);
});

test("malformed browser statistics cannot supply timing, candidate IDs or counters", () => {
  const report = new Map([
    ["bad-time", { type: "candidate-pair", currentRoundTripTime: NaN }],
    ["bad-id", { type: "transport", selectedCandidatePairId: { token: "private" } }],
    ["bad-bytes", { type: "candidate-pair", bytesSent: "123" }],
    ["bad-flag", { type: "candidate-pair", nominated: "true" }],
    ["null", null],
  ]);
  assert.deepEqual(connectionStats(report), []);
  for (const id of report.keys()) assert.equal(connectionStatById(report, id), undefined);
});
