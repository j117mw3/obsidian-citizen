# Remaining surface acceptance

These checks are pending. This checklist is a procedure, not evidence that any check passed. The automated results and historical runtime observations are in [the verification record](verification-0.6.0.md).

## Candidate and scope

- Use the latest review ZIP identified in the verification record. Match its `main.js` hash; version `0.6.0` alone does not identify the candidate.
- The later docking/fork request authorized installing the current files in `<test-vault>`, with backup and hash verification. Restart Obsidian before testing so the new code and metadata load; the agent has not performed that restart.
- Record the candidate hash, Obsidian version, display size, relevant settings, player count, and whether browser focus emulation was used.
- Preserve failed runs and record reproduction steps. A cancelled or throttled run is not acceptance.

## Native Obsidian gameplay

Record an observed result for each row. Use the default bindings below or record the saved replacements.

| Check | Expected result |
|---|---|
| Approach and dock | In flight, aim the ship at a main sphere, use X to brake and hold J for 1.5 seconds. The docking HUD shows range, speed requirements and hold progress. Admission requires distance within 12 world units of its surface, speed at most 10, and three seconds without damage. Releasing J, switching main or losing readiness cancels progress. An off-centre aim that intersects the sphere works. Ordinary nodes and a missed sphere do not accept docking. |
| Spherical travel | Walk across both poles, sprint, jump and land. The camera stays aligned to local up, does not flip at a pole, and never drops below the surface. Record horizon comfort separately. |
| Cover and stance | Hold C to crouch and Q/E to lean, including crouched lean. Compare visible cover edges, camera, remote upper body and exposed hitboxes. Cover blocks bolts. Overhead cover prevents standing and crouch-jumping; a low wall cannot be cleared by the 1.2-unit jump. |
| Return to ship | Within three surface units of either pole, hold F for two seconds. Releasing F, leaving range, damage or death cancels the hold. Damage prevents restarting for three seconds. Return preserves resources and places the ship clear of nodes with zero velocity. |
| Surface fight | Use a second player on the same main. Confirm ten-point damage, armor absorption, one score per elimination, healing only for a living killer, a five-second respawn, and protection that ends on firing. Menus and pointer release leave a vulnerable body. |
| Pickups | Check near-cover and exposed health/armor pickups. Full resources leave the corresponding pickup available; a partial benefit consumes it. Two simultaneous collectors receive one award. Observe the actual 15/30-second timers. |
| Training | In solo, select either dummy armor configuration, reset it, destroy it and observe the two-second reset. It grants no score/healing and is absent in multiplayer. |
| HUD and sound | Check HP/armor/heat, vent, confirmed hit markers, incoming damage directions including vertical hits, opponent sectors, pole compass, exit progress, protection/respawn and kill feed. Remote damage sounds once at the body position; confirm blaster, vent, movement, impacts and pickups are audible and spatially appropriate. |
| Readability and settings | Check moving bolts at 5/10/15 surface units, bloom on/off, high contrast and a narrow pane. Dark color inputs produce readable approved colors visible to other players. Check sensitivity, invert-Y, FOV, head bob, crouch mode and rebinding after saving/reopening settings. |
| Space boundary | Confirm visible parked ships and geometry, ship collision with planets, ship shots terminating on planets/parked ships, invulnerable nonblocking parked ships, and space audio at reduced gain while on the surface. Surface shots never damage ships. |
| Lifecycle and presentation | Observe joining, leaving, owner departure, host transfer, node deletion and round return/reset during a rendered fight. Rejected, lost and expired predicted shots leave no persistent bolts or hit markers. |

## Native WebRTC profiles

This fixture runs four logical clients in one browser context with real WebRTC sockets and impaired UDP. It scripts target poses and resets target resources. It does not test human movement, native Obsidian rendering, audio quality, cross-device clocks or the complete death/round lifecycle.

From the repository directory, build the existing harness:

```powershell
node dev/build-realtime-harness.mjs
```

Start a dedicated fixture on an unused port, for example:

```powershell
node dev/serve-network-smoke.mjs 8880 100 25 0.01
```

Open the URL printed by that process manually. Replace only `/network-harness.html` with `/surface-latency.html`, preserving the full query string. The token changes when a new server starts.

1. For supported RTTs 0, 50 and 100 ms, use a fresh server/profile with the corresponding RTT argument, keeping jitter `25` and loss `0.01`. Run profiles sequentially or on separate unused ports; do not disturb an existing fixture server or the user's room.
2. Select **Accepted shots**, set **Samples per case** to **500**, and use **Run 20-case profile matrix**. A profile can take about two hours. Keep its browser page active; minimizing, sleep or hidden-page throttling can invalidate simulation/publication cadence.
3. The twenty cases comprise strafing at 5/10/15 units in four stances, plus abrupt turns and cover transitions at 10 units in four stances. Every case needs at least 500 accepted shots, at least 90% agreement and at most a five-point hit-rate deficit. Do not substitute attempt-count samples at supported RTTs.
4. Save **Results JSON** before starting another run: starting a case or matrix clears the displayed results. Preserve failures. Inspect native proxy routes, measured RTT, cadence, hidden-publication counters, duplicates, blockers, invalid snapshots, mode divergence and rewind alongside the overall pass flag.
5. At 150/200 ms, **Attempts (150–200 ms stability only)** permits 500-attempt degraded samples. Report acceptance and accuracy loss. At 200 ms, require at least 95% authoritative dispositions within 600 ms and 99% within one second, plus the plan's zero-duplicate/cross-life/mode-divergence and 150 ms rewind bounds. Neither this fixture nor a disposition pass establishes rendered ghost cleanup.
6. Stop only the dedicated server started for this run with Ctrl+C when finished.

Existing native supported profiles contain four completed cases per RTT and predate the latest source fixes. Keep their historical scope explicit; the completed virtual matrix does not fill the missing native cases. The plan's thresholds remain unchanged.

## Results to return

Provide the candidate hash, each checklist row's result, exact failure steps, and saved native profile JSON. Mark anything not observed as unverified. Full acceptance remains incomplete until the evidence covers the original plan.
