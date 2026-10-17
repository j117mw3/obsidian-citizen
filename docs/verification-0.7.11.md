# 0.7.11 local candidate: multiplayer planet docking

## Confirmed defect and fix

The reported case was a host docking onto their own planet after entering a multiplayer room: hold F reaches 100%, then remains on “Docking requested.”

`ConstellationApp.onMembers` calls `setLocalTopology` before enabling multiplayer. That rebuild used solo note IDs because the renderer was still in solo mode. Enabling multiplayer did not rebuild the planet groups. The docking picker therefore returned a private solo ID instead of an anonymous topology ID. The renderer rejected that target before calling the network, and its status-only feedback left the docking HUD pending.

The new transition regression failed before the fix with no request emitted (`[]` instead of the anonymous destination). Enabling a room now rebuilds planet groups using the already-published anonymous topology. Renderer validation failures appear directly in the docking HUD.

Requests retain sequence, host, epoch, destination and start time until rejection or the matching authoritative surface snapshot. Acceptance alone does not complete the request. The existing 100 ms room timer expires incomplete requests after five seconds; room/host resets cancel them. Obsolete and duplicate results are ignored. Reliable-send failures return immediate feedback. A guest's result no longer changes the host's docking HUD. Failure feedback persists while F remains held; releasing F enables a fresh hold.

The existing 1.5-second hold, range, speed, damage, capacity and combat-round restrictions remain. Protocol 15 and anonymous network topology remain unchanged. Existing uncommitted work was preserved.

## Verification

- The renderer transition test follows the application's actual topology-before-mode order, uses real terrain-enabled surface admission and host snapshots, invokes surface-controller entry, then holds authoritative F input at a pole for 120 ticks to return to the ship. GPU, audio and DOM presentation effects are stubbed; this is integration evidence, not native UI acceptance.
- Guest coverage passes request/result traffic through reliable control and surface-state decoding. Additional cases cover stale topology, admission rejection, authority readiness, closed/congested/throwing channels, missing results, accepted requests without entry, timeout, retry, stale sequence/epoch, host change, and leave.
- `node --test --import=./dist/worker-isolated-preload.mjs`: **261 passed, 0 failed**. Log: `dist/docking-full-isolated-tests.log`.
- The first normal `npm test` run passed 260 tests and failed the hosted Worker startup with `SQLITE_READONLY`. A standalone retry reproduced that environmental failure. The verification-only preload supplies a fresh temporary `--persist-to` directory to Wrangler; the isolated standalone Worker test and complete suite passed without altering the checkout's previous Worker state. Logs: `dist/docking-full-tests.log`, `dist/docking-worker-retry.log`, `dist/docking-worker-isolated.log`.
- `npm run build`: passed, including TypeScript checks. `npm run lint`: passed. `git diff --check`: passed.

## Local installation

- Installed only `main.js`, `manifest.json`, and `styles.css` to `T:\AI\ObsidianVault\Obsidian\.obsidian\plugins\citizen`, version **0.7.11**. All three installed hashes match their build sources.
- The complete prior plugin directory was copied and hash-checked at `dist/installed-backups/main-vault-before-0.7.11-20261017-121957-644d047d`.
- `data.json` was preserved, SHA-256 `B693C97B5000C1ABB4BEC17F1B6499E96973920909C7946613D7C86BFAD1B558`.
- Installed bundle SHA-256: `94ADD581AE51C1E927E48F7621023559ADFBBEBE7FD00D327011BAAE396B5466`.
- Candidate archive: `dist/citizen-0.7.11-local-candidate.zip`, SHA-256 `1C9302B2B5D3F2298E5C657A801919CBF68A51B6E68C6770F53AEB1D7490B78E`. Exactly three release members were verified against their source hashes.
- Installation record: `dist/citizen-0.7.11-local-install.json`. Nothing was published remotely.

## Runtime limit

Windows Computer Use found the Obsidian windows, but state capture failed with `FrameArrived timed out: timed out waiting on channel`. A refreshed-window retry failed with `window capture timed out: timed out waiting on channel`. Native input stopped under the Computer Use recovery rule. Citizen was not reloaded automatically. **Reload Citizen or restart Obsidian to load 0.7.11. Native lobby docking, real pointer/key input, and two-computer acceptance remain unverified.**
