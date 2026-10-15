// Synthetic health and TURN-token check for the current protocol-5 deployment.
// It does not create a room or open a WebRTC connection, and never prints tokens or ICE credentials.
import assert from "node:assert/strict";

const base = (process.argv[2] || process.env.CITIZEN_TURN_SERVICE_URL || "https://constellation-rooms.mrassetto.workers.dev").replace(/\/+$/, "");
const health = await fetch(`${base}/health`);
assert.equal(health.status, 200, "Hosted Worker health endpoint did not return HTTP 200.");
const healthBody = await health.json();
assert.equal(healthBody.ok, true, "Hosted Worker reported unhealthy.");

const unauthorized = await fetch(`${base}/turn`);
assert.equal(unauthorized.status, 401, "TURN configuration must reject requests without an issued token.");
const session = await fetch(`${base}/turn/session`);
assert.equal(session.status, 200, "TURN token endpoint did not return HTTP 200.");
const tokenBody = await session.json();
assert.equal(typeof tokenBody.token, "string", "TURN session omitted a refresh token.");
assert.match(tokenBody.token, /^[0-9a-f]{64}$/i, "TURN session returned an invalid refresh token.");
assert.ok(Number.isSafeInteger(tokenBody.expiresAt) && tokenBody.expiresAt > Date.now(), "TURN refresh token is not short-lived.");

const configuration = await fetch(`${base}/turn`, { headers: { Authorization: `Bearer ${tokenBody.token}` } });
assert.equal(configuration.status, 200, "Issued TURN token was not accepted.");
const relay = await configuration.json();
assert.ok(Array.isArray(relay.iceServers) && relay.iceServers.length <= 12, "TURN configuration exceeded the server limit.");
assert.ok(["ready", "pending", "unavailable", "quota", "direct-only"].includes(relay.relayStatus), "Worker returned an unknown relay state.");
console.log(`Hosted Worker check passed: health available, token issued and accepted, relay status ${relay.relayStatus}, ${relay.iceServers.length} ICE server entries.`);