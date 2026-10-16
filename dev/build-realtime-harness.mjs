import { build } from "esbuild";
import { writeFile } from "node:fs/promises";
const result = await build({ entryPoints: ["dev/realtime-harness.ts"], bundle: true, write: false, platform: "browser", format: "esm", target: "es2020", minify: true });
const js = result.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
await writeFile("dev/surface-latency.html", `<!doctype html><html lang="en"><meta charset="utf-8"><title>Real WebRTC surface oracle</title>
<style>body{font:16px system-ui;background:#10131a;color:#eee;max-width:1000px;margin:24px}label{display:block;margin:12px 0}button,input,select{font:inherit;margin:4px;padding:6px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>
<h1>Real WebRTC surface oracle</h1><p>Four logical room clients in one browser context, native WebRTC, and real UDP impairment. No vault access, TURN, or WebGL. The test scripts poses, installs fixed test walls, and resets HP each tick to sustain deterministic shots. These are fixture controls, not observed player movement or lifecycle gameplay.</p>
<p id="profile">Loading impairment profile</p><label>Sample unit <select id="sample-mode"><option value="accepted">Accepted shots</option><option value="attempts">Attempts (150–200 ms stability only)</option></select></label><label>Samples per case <input id="shots" type="number" value="500" min="1" max="500"></label>
<label>Distance <select id="distance"><option value="5">5 units</option><option value="10" selected>10 units</option><option value="15">15 units</option></select></label>
<label>Stance <select id="stance"><option>standing</option><option>crouched</option><option>leaning</option><option>crouched-leaning</option></select></label>
<label>Scenario <select id="scenario"><option value="strafe">Strafing</option><option value="reverse">Abrupt turns</option><option value="cover">Cover transitions</option></select></label>
<button id="start" disabled>Run case</button><button id="matrix" disabled>Run 20-case profile matrix</button><button id="cancel">Cancel</button>
<p>Each acceptance case needs roughly five minutes at a 600 ms cadence, longer if rejected attempts require retries. A profile matrix may take two hours. It stops on the first failed gate; cancelling produces no acceptance result.</p>
<p id="status" role="status">Initializing</p><pre id="progress">No attempts</pre><details><summary>Results JSON</summary><pre id="results">[]</pre></details><script type="module">${js}</script></html>`);
console.log("Built real WebRTC surface oracle (synthetic poses/resources; no vault data).");
