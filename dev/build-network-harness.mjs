import { build } from "esbuild";
import { writeFile } from "node:fs/promises";

const bundle = await build({ entryPoints: ["dev/network-harness.ts"], bundle: true, write: false, platform: "browser", format: "esm", target: "es2020", minify: true });
const js = bundle.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
await writeFile("dev/network-harness.html", `<!doctype html><html lang="en"><meta charset="utf-8"><title>Constellation synthetic network test</title>
<style>body{font:16px system-ui;background:#10131a;color:#eee;max-width:760px;margin:24px}label{display:block;margin:12px 0}input,button{font:inherit;margin:4px;padding:6px}pre{white-space:pre-wrap}.error{color:#ff927e}</style>
<h1>Synthetic network test</h1><p>No vault access. Uses two synthetic stars. Forced relay sends real TURN traffic only while clients are connected.</p>
<label>Name <input id="name" value="Synthetic Pilot"></label><label><input id="relay" type="checkbox">Force TURN relay</label><label><input id="flying" type="checkbox" checked>Flying</label>
<button id="create">Create room</button><label>Room code <input id="code" maxlength="14"></label><button id="join">Join room</button><button id="leave">Leave room</button>
<fieldset><legend>Surface transport smoke test</legend><p>Each synthetic main node starts within docking range of its owner's ship. These controls send ordinary production requests.</p>
<button id="dock">Dock my main node</button><label><input id="exit" type="checkbox">Hold F at pole</label>
<details open><summary>Shared arena fixture</summary><p>Move your published main node near another pilot's spawn; existing occupants follow it. Avatar positions and combat resources are never edited.</p>
<label>Arena owner <select id="arena-owner"></select></label><button id="dock-selected">Dock selected owner's main</button>
<label>Move my main near <select id="visit-player"></select></label><button id="move-main">Move my published main</button>
<button id="fire-nearest">Fire at visible player</button><label><input id="walk" type="checkbox">Walk forward</label></details>
<label><input id="crouch" type="checkbox">Crouch</label><label>Lean <select id="lean"><option value="0">Neutral</option><option value="-1">Left</option><option value="1">Right</option></select></label>
<button id="surface-fire">Fire surface blaster</button><label>Laser color <input id="color" value="#000000"></label><button id="set-color">Set laser color</button>
<details><summary>Disposition timing trial</summary><p>500 forward shots at 220 ms intervals. Uses ordinary weapon resources and counts rejections. Requires four docked players and a stable authority; does not measure hit fairness.</p><button id="fire-trial">Run 500 attempts</button><pre id="fire-trial-summary">No timing trial</pre><details><summary>Shot samples</summary><pre id="fire-trial-data"></pre></details></details>
<pre id="surface">No surface snapshots</pre><p id="surface-result">No surface requests</p><pre id="host-fire-diagnostics">No host fire decisions</pre></fieldset>
<p id="status" role="status">Ready</p><ul id="players"></ul><p id="maps"></p><pre id="transport">No peer connection</pre><pre id="impairment">No UDP impairment requested</pre><script type="module">${js}</script></html>`);
console.log("Built synthetic network harness (no vault data).");
