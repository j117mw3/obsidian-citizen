# Obsidian Citizen 0.7.0 verification

Candidate: plugin 0.7.0, room protocol 12, checkpoint format 12, terrain format 1. Plugin ID `constellation-graph`, J117W3 fork identity, and settings schema 5 are retained. No computer-use tools, automatic restart, public release, or Git reset were used.

## Implemented behavior

- A deterministic radial heightfield supplies real broad hills, raised shoulders, and shallow depressions. Pole pads remain flat within six surface units; surrounding relief blends smoothly. Radial gravity and camera up are retained. Existing movement speeds, jump height, step allowance, crouch, lean, weapon damage, heat, cooldown, and rewind cap are unchanged.
- Terrain queries drive grounding, sweep resolution, spawning, pickups, patrols, cover placement, and projectile obstruction. Snapshot/checkpoint validation associates a player's terrain hash with its arena. Names/health bars and graph labels test the actual terrain and physical cover; the early far-hemisphere rejection uses only the guaranteed inner sphere. Terrain rendering replaces the old sphere and its wire shell, allowing visible crater depressions.
- The coarse navigation layout has four independent meridian branches between pole regions, connected by an equatorial resource route. Fine route-edge sampling measures slope and travel cost. Both poles have multiple exits; resources have comparable route access within ten percent. Open walkable hill surfaces retain alternate approaches. Ruins contain deliberate openings rather than closed rooms or mandatory jumping routes.
- Seeded spatial cells assemble broken spires, fractured rings with opposing gaps, and courtyard fragments from solid boxes. Components provide 1.3-unit crouch cover and 2.2-unit standing cover. Protected route passages remain at least three units wide. Static cover remains available when linked walls move away. Some resources sit beside fixed cover; others require exposed approaches. This is a procedural rule system, not a library of premade maps.
- Exactly two moving walls remain associated with each eligible unique connected file. Six Smoke Hub files produce twelve physical and rendered file walls, separately from permanent ruins. Moving walls follow terrain elevation and wait at protected routes, static structures, other walls, resources, and player hitboxes. Terrain, radius, connection membership, and resource layout freeze during occupancy; resource IDs and consumed-pickup timers survive later visits.
- Entire layout candidates receive up to 32 deterministic attempts, then a deterministic reduced-relief repair. Failure rejects preparation with a specific docking message. Planet growth remains `27 × sqrt(max(1, N/16))` and the existing world scale/graph clearance remain intact. No restricted combat region, new sharing scope, or separate wall-count cap was introduced.
- Immutable terrain definitions carry generator/format version, seed, parameters, descriptor identity and six canonical cube-face hashes. Peers validate before committing geometry; analytic collision is immediately available and pole-region static data is prepared before acknowledgement. Subsequent local regions are derived from the same validated definition. Terrain does not add live pose traffic. Existing acknowledged reliable geometry chunks remain below 16 KiB, arenas below 4 MiB, and checkpoints below 32 MiB. Incompatible room/checkpoint versions are rejected.
- Terrain uses cube-sphere patches with local detail and distant LOD, skirts, and one merged ground draw. LOD preparation is spread over frame work after initial preparation and committed atomically. Spatial cells and existing wall indices keep collision queries local. Ruins use one bounded instanced batch, with no scene subtree per structure. Nearby top triangles are checked against the analytic collision surface within 0.02 units. Ground and ruins use basalt/cyan, ochre/amber, or pale/violet treatment, quiet strata/circuit detail, and unchanged cyan North/amber South navigation.

## Automated evidence

Milestone 1: typecheck and 219/219 tests passed. Milestone 2: typecheck and 219/219 tests passed. Integration/visual milestone: 224/224 passed, then expanded final acceptance coverage to 230/230. Final typecheck and production build pass. TAP: `dist/verification-0.7.0-tests.tap`.

Terrain regressions cover 1,000 terrain seeds across the required radius classes and another 1,000 complete encounter layouts with zero links, coincident/polar bearings, and degrees through seventeen. Separate production geometry/transfer cases exercise degrees 0, 1, 2, 6, 16, 17, 1,000, and maximum supported degree 19,999 (39,998 file walls). They validate wall associations/count, routes, resource access, flat poles, slope bounds, terrain identity, and transfer bounds. The real Testing-vault Smoke files pass through graph building, simulation, docking, physical cover, and renderer instance construction.

Movement checks include 30/60/144 FPS, irregular frame durations, idle moving centers with delayed map updates, crouch, lean, jumping/landing, both poles, pause, owner departure, docking/undocking, migration, and four terrain-aware patrols. Further checks cover terrain ray/sweep agreement, permanent ruin obstruction, protected moving-cover routes, terrain hashes, private-field rejection, acknowledged chunk transfer, delayed snapshots at simulated 200 ms RTT, late join, and collision binding after cached snapshot copies.

The terrain-enabled four-session combat harness ran three 500-accepted-shot standing scenarios at ten units: strafe, reversal, and cover. RTT 200 ms, jitter ±25 ms, loss 1%. All three passed the existing 200 ms disposition/blocking criteria: 100% within 600 ms and 1,000 ms, p99 346 ms, no duplicate hits, no blocker violations. Oracle agreement was 72.80%, 72.99%, and 84.48%; hit-rate deficits were 11.49, 7.47, and 4.41 percentage points. These numbers do not claim high-latency aiming parity. The existing rewind cap remains 150 ms. Report: `docs/terrain-combat-latency-0.7.0.json`.

An initial extended harness run failed because its scripted firing bypassed the client vent lock and counted locally blocked attempts as sent shots. Its scheduling now honors the existing vent/heat gate. Passing thresholds and weapon balance were not changed.

## Same-hardware benchmark

CPU: AMD Ryzen 9 9950X 16-Core Processor. Node v22.13.0. The 0.6.8 reference was bundled before terrain source edits and retained locally as `dist/terrain-baseline-0.6.8.mjs`. Measurements are headless CPU, transient heap, geometry allocation, and scene draw estimates on the same machine, not GPU frame times. The four-player frame workload samples movement/jumping for 180 frames; values are median run time divided by frames, not whole-application frame time.

| Version | Degree | Layout preparation ms | Four-player physics ms/frame | Initial local mesh ms | Scene draw estimate |
|---|---:|---:|---:|---:|---:|
| 0.6.8 | 0 | 0.5 | 0.014 | — | 19 |
| 0.6.8 | 6 | 2.0 | 0.020 | — | 21 |
| 0.6.8 | 1,000 | 30.9 | 0.063 | — | 21 |
| 0.6.8 | 19,999 | 683.5 | 0.026 | — | 21 |
| 0.7.0 | 0 | 3.6 | 0.141 | 13.7 | 19 |
| 0.7.0 | 6 | 4.0 | 0.120 | 12.6 | 21 |
| 0.7.0 | 1,000 | 126.6 | 0.336 | 36.4 | 21 |
| 0.7.0 | 19,999 | 3725.9 | 0.986 | 41.2 | 21 |

Raw memory/geometry/triangle counts are in `docs/terrain-benchmark-0.7.0.json`. Maximum-degree preparation remains a noticeable synchronous cost of roughly 3.7 seconds in this run, versus about 0.75 seconds for 0.6.8. Local mesh preparation is about 13–41 ms and later LOD work is staged; final buffer assembly/upload is not a guaranteed two-millisecond operation. Native GPU frame time, actual draw calls, peak memory, and maximum-degree responsiveness require observation. This is not a native performance certification.

## Rollout and native acceptance

Installation path, backup, package, SHA-256 values, and settings-preservation evidence are recorded in `docs/terrain-install-verification.json`. Only the three distributable plugin files are copied after validation. Reload is left to the user.

After reload, dock on Surface Smoke Hub. Walk/sprint around ridges and crater rims, crouch and lean behind ruins, jump/land, and traverse both poles. Confirm the ground stays opaque and stable while the graph moves; all twelve linked walls remain discoverable alongside permanent structures. Verify shots and labels respect ridges/ruins/walls, patrols move around obstacles, and pole navigation remains readable. Compare palettes, silhouettes, terrain feel, narrow panes and performance natively. Everyone in a multiplayer room must update to 0.7.0.

No new cross-computer WebRTC session, native shader/GPU rendering, screenshot, or Obsidian visual/FPS acceptance was performed. The latency harness uses production message handlers with synthetic transport and scripted target poses; the benchmark does not render WebGL. Very large four-player planets still have long travel times by design.
