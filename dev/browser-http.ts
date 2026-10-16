import { isRecord, isFiniteNumber } from "../src/validation";
export const browserRequest = (url: string | URL, init?: RequestInit): Promise<Response> => window.fetch(url, init);
export const browserPost = async (url: string, body: string): Promise<number> => (await browserRequest(url, { method: "POST", body, headers: { "Content-Type": "text/plain" } })).status;
export async function proxyStats(url: string) {
  const response = await browserRequest(url);
  if (!response.ok) throw new Error("UDP fixture unavailable");
  const value: unknown = await response.json();
  if (!isRecord(value) || !isRecord(value.profile) || !isFiniteNumber(value.profile.rtt) || !isFiniteNumber(value.profile.jitter) || !isFiniteNumber(value.profile.loss)) throw new Error("Invalid UDP proxy profile");
  const counters: Record<string, number> = {};
  for (const key of ["forwarded", "dropped", "pairedSockets", "sockets", "sendErrors", "meanDelayMs"]) { if (!isFiniteNumber(value[key])) throw new Error("Invalid UDP proxy counter"); counters[key] = value[key]; }
  return { forwarded: counters.forwarded, dropped: counters.dropped, pairedSockets: counters.pairedSockets, sockets: counters.sockets, sendErrors: counters.sendErrors, meanDelayMs: counters.meanDelayMs, profile: { rtt: value.profile.rtt, jitter: value.profile.jitter, loss: value.profile.loss } };
}
