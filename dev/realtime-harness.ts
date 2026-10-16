import { proxyIceConnection } from "./network-impairment";
import { runRealtimeSurfaceCase } from "./surface-realtime-case";
import type { SurfaceLatencyCase, SurfaceLatencyScenario, SurfaceLatencyStance } from "./surface-latency-harness";

const query = new URLSearchParams(location.search), token = query.get("udp"), relay = query.get("relay");
const status = document.getElementById("status")!, progress = document.getElementById("progress")!, output = document.getElementById("results")!, profile = document.getElementById("profile")!;
const Native = globalThis.RTCPeerConnection;
let running: AbortController | null = null, rtt = -1;
const results: unknown[] = [];
async function initialize(): Promise<void> {
  if (!token || relay !== `${location.origin}/relay` || !/^http:\/\/127\.0\.0\.1:\d+$/.test(location.origin) || !Native) throw new Error("Use the loopback UDP server's URL; native WebRTC is required");
  const response = await fetch(`/udp/stats?token=${encodeURIComponent(token)}`);
  if (!response.ok) throw new Error("UDP fixture unavailable");
  const stats = await response.json();
  if (![0, 50, 100, 150, 200].includes(stats.profile.rtt) || stats.profile.jitter !== 25 || stats.profile.loss !== 0.01) throw new Error("Acceptance requires ±25 ms one-way jitter and 1% UDP loss");
  rtt = stats.profile.rtt;
  (document.querySelector('#sample-mode option[value="attempts"]') as HTMLOptionElement).disabled = rtt <= 100;
  profile.textContent = `${rtt} ms nominal RTT; ±25 ms one-way jitter; 1% real UDP loss`;
  globalThis.RTCPeerConnection = proxyIceConnection(Native, token, () => { status.textContent = "UDP registration failed; the case cannot pass."; });
  document.getElementById("start")!.removeAttribute("disabled"); document.getElementById("matrix")!.removeAttribute("disabled");
  status.textContent = "Ready. Four logical clients will use native WebRTC in this one browser context.";
}
async function run(matrix: boolean): Promise<void> {
  if (running || rtt < 0 || !relay) return;
  const shots = Number((document.getElementById("shots") as HTMLInputElement).value);
  const sampleMode = (document.getElementById("sample-mode") as HTMLSelectElement).value as "accepted" | "attempts";
  if (!["accepted", "attempts"].includes(sampleMode) || sampleMode === "attempts" && rtt <= 100) { status.textContent = "0–100 ms fairness requires accepted-shot samples; attempt samples are only for degraded 150–200 ms stability."; return; }
  if (!Number.isSafeInteger(shots) || shots < 1 || shots > 500 || matrix && shots < 500) { status.textContent = "Use 1–500 shots; the matrix requires 500 accepted shots per case."; return; }
  const cases: SurfaceLatencyCase[] = [];
  const stances: SurfaceLatencyStance[] = ["standing", "crouched", "leaning", "crouched-leaning"];
  if (matrix) {
    for (const distance of [5, 10, 15]) for (const stance of stances) cases.push({ rttMs: rtt, distance, stance, scenario: "strafe", shots });
    for (const scenario of ["reverse", "cover"] as const) for (const stance of stances) cases.push({ rttMs: rtt, distance: 10, stance, scenario, shots });
  } else cases.push({ rttMs: rtt, distance: Number((document.getElementById("distance") as HTMLSelectElement).value), stance: (document.getElementById("stance") as HTMLSelectElement).value as SurfaceLatencyStance,
    scenario: (document.getElementById("scenario") as HTMLSelectElement).value as SurfaceLatencyScenario, shots });
  const abort = running = new AbortController(); results.length = 0; output.textContent = "[]"; progress.textContent = "Connecting four clients";
  try {
    for (const [index, config] of cases.entries()) {
      status.textContent = `Running case ${index + 1}/${cases.length}; ${shots < 500 ? "SMOKE ONLY" : sampleMode === "attempts" ? "degraded stability sample" : "acceptance sample"}`;
      const result = await runRealtimeSurfaceCase(config, relay, abort.signal, text => { progress.textContent = text; }, sampleMode);
      const proxy = await (await fetch(`/udp/stats?token=${encodeURIComponent(token!)}`)).json();
      results.push({ ...result, proxy }); output.textContent = JSON.stringify(results, null, 2);
      if (!result.passed) { status.textContent = `FAIL case ${index + 1}/${cases.length}; thresholds are unchanged. Inspect the result before continuing.`; return; }
    }
    status.textContent = `Complete: ${cases.length} cases passed${shots < 500 ? "; SMOKE ONLY, insufficient acceptance sample" : ""}. No rendering or lifecycle claim.`;
  } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); }
  finally { running = null; }
}
document.getElementById("start")!.addEventListener("click", () => void run(false));
document.getElementById("matrix")!.addEventListener("click", () => void run(true));
document.getElementById("cancel")!.addEventListener("click", () => running?.abort());
window.addEventListener("beforeunload", () => running?.abort());
void initialize().catch(error => { status.textContent = error instanceof Error ? error.message : String(error); });
