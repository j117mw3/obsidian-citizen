import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";

const args = Object.fromEntries(process.argv.slice(2).map(value => value.replace(/^--/, "").split("=")));
const shots = Number(args.shots ?? 500);
if (!Number.isSafeInteger(shots) || shots < 1) throw new Error("shots must be a positive integer");
const bundle = await build({ entryPoints: ["dev/surface-latency-harness.ts"], bundle: true, write: false, platform: "node", format: "esm", target: "node22" });
const { runSurfaceLatencyCase } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const rtts = args.rtt ? [Number(args.rtt)] : [0, 50, 100, 150, 200];
const stances = args.stance ? [args.stance] : ["standing", "crouched", "leaning", "crouched-leaning"];
const scenarios = args.scenario ? [args.scenario] : ["strafe", "reverse", "cover"];
const results = [];
for (const scenario of scenarios) for (const rttMs of rtts) for (const distance of args.distance ? [Number(args.distance)] : scenario === "strafe" ? [5, 10, 15] : [10]) for (const stance of stances) {
  const result = runSurfaceLatencyCase({ rttMs, distance, stance, scenario, shots, seed: 7319, terrain:args.terrain === "true" }); results.push(result);
  console.log(`${result.passed ? "PASS" : "FAIL"} ${scenario} RTT ${rttMs} ${distance}u ${stance}: ${result.accepted}/${result.attempts} accepted; agreement ${(result.agreement * 100).toFixed(2)}%; deficit ${(result.hitRateDeficit * 100).toFixed(2)}pp; p99 ${result.dispositionP99Ms}ms`);
}
const report = { generatedAt: new Date().toISOString(), model: {
  terrain:args.terrain === "true", clients: 4, shotsPerCase: shots, seed: 7319, oneWayJitterMs: 25, packetLoss: 0.01,
  reliableRetransmissionModelMs: 1000, reliableModelNote: "Conservative synthetic assumption, not measured SCTP behavior.",
  transport: "Virtual clock, production MultiplayerSession message handlers, authority, history, prediction, bolt presentation and hit-marker methods. Scripted target poses; no WebRTC sockets, Obsidian, DOM or WebGL.",
  resources: "Target resources reset between ticks to sustain trials; lifecycle and simultaneous pickups require separate tests.",
  oracle: "Displayed pose advanced along scripted trajectory during bolt travel, identical deterministic spread and firing-view inputs, no transport delay.",
}, eligible: shots >= 500, passed: results.every(result => result.passed), results };
await mkdir("dist", { recursive: true });
const output = args.output ?? "dist/surface-latency-results.json";
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${output}; ${results.filter(result => result.passed).length}/${results.length} cases passed${shots < 500 ? " (smoke only; insufficient acceptance sample)" : ""}.`);
if (!report.passed) process.exitCode = 1;
