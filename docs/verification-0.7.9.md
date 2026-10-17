# 0.7.9 local candidate: sky-facing stalls

The previous candidate did not solve the reported live lag. The user reports that the floor view runs well while looking toward other sky nodes becomes slow; turning bloom off and setting label count to zero did not resolve it. Label count zero still permits active/selected/related labels, so this candidate provides a genuine complete label/occlusion bypass.

## Confirmed defect and correction

The former label path sampled all the way to a distant node and queried every spatial cell in the ray's enclosing 3D box. A synthetic 12-wall, 1,000-unit-per-axis ray visited 2,000,376 cells and took approximately 70.8 ms in the investigation. This is a demonstrated code defect, not proof of the entire native FPS bottleneck.

Presentation queries now clip to conservative bounds covering terrain and both dynamic/static walls. A conservative supercover segment traversal visits cells along the ray, including boundary/corner neighbours. Terrain/wall query work stops growing once the target extends beyond the planet. Combat and authority retain their existing queries.

## Validation

- `npm test`: 254 passed, 0 failed; log: `dist/sky-0.7.9-tests.log`.
- `npm run lint`: passed, including CSS review.
- `npm run build`: passed, including TypeScript checking; standalone typecheck also passed during implementation.
- New regression cases compare bounded visibility with brute-force box intersections and terrain rays, including generated ruins and moving walls. Cases also cover negative coordinates, exact grid boundaries, sphere tangents, inside cameras, and endpoints up to one million units away.
- New tests cover diagnostic bypasses, GPU query availability/disjoint handling/queue limits, actual 8/24/64-planet fixture selection, LOD hysteresis, occupied-planet detail, and visibility restoration.
- The former sphere-only visibility test fixture was completed with its required empty wall array and extended with sky/tangent checks.

## Local profiling and conditional LOD

Use **Capture sky performance**, **Capture horizon performance**, and **Capture floor performance** while standing at the same position. Each command warms up for 5 seconds and samples for 15 seconds. Keep the camera still for matched comparisons.

Additional independent commands are **Capture sky no labels performance**, **Capture sky no graph performance**, **Capture sky no distant details performance**, **Capture sky no bloom performance**, and **Capture sky bloom performance**. Overrides exist only during the capture and never update saved settings. The complete label bypass skips graph labels, player indicators, nameplates, and their occlusion checks. The graph bypass isolates sprite/link drawing; the detail bypass substitutes lightweight unoccupied planets.

Run an unchanged **sky** capture followed by **sky no distant details**. If the camera, arena, viewport and rendering settings match, the camera remained stable, and p95 CPU submission or GPU time improves by at least 15% and 1 ms, distance LOD enables for that renderer session. Enter the proxy below 32 projected pixels, restore full detail above 48 pixels, and always keep the occupied planet detailed. No multiplayer protocol or settings migration is involved.

JSON exports contain aggregate timings/counters, numeric camera pose, graph counts and the installed bundle hash. They omit note names, paths, links and contents. GPU times arrive asynchronously; unsupported/pending/disjoint samples are omitted. `renderMs` measures CPU submission, `worldCalls` includes all world/composer passes, and total calls also include the first-person viewmodel. `geometryCount` measures allocated GPU geometry resources; `visiblePlanets` counts conservative frustum candidates.

## Synthetic browser measurements

`node dev/build-surface-preview.mjs` then `node dev/run-sky-performance.mjs` exercises real selected planets at 850 nodes, hub degree 128, and 8/24/64 groups. Each capture has 5 seconds of warm-up and 15 seconds of sampling. The isolated headless Edge profile contains synthetic data only. Graph motion is disabled for these matched stationary comparisons. Reports: `dist/sky-performance-0.7.9.json`; baseline images: `dist/sky-{8,24,64}-{floor,horizon,sky}-0.7.9.png`.

| 24-planet sky case | p95 labels (ms) | p95 CPU submission (ms) | p95 GPU (ms) | p95 world draw calls |
| --- | ---: | ---: | ---: | ---: |
| Legacy unbounded graph-label query | 4.1 | 1.3 | 2.90 | 181 |
| Bounded query, full detail | 0.3 | 1.3 | 2.18 | 181 |
| Bloom forced on | 0.2 | 1.3 | 2.18 | 181 |
| Bloom forced off | 0.3 | 1.2 | 2.55 | 167 |
| All labels bypassed | 0 | 1.6 | 2.87 | 181 |
| Graph sprites/links bypassed | 0.2 | 1.3 | 2.78 | 179 |
| Unoccupied planet details bypassed | 0.3 | 0.8 | 3.15 | 32 |

The legacy/full-detail pair has identical world draw calls and numeric camera pose. Label p95 improves about 93%; this legacy toggle reproduces the old graph-label query, not an entire historical bundle. At 8 and 64 planets, bounded sky labels both measure 0.2 ms p95. Zero-label captures record zero occlusion queries and cells. World and total counters differ by 12 viewmodel calls in these captures, verifying both render passes are counted. The distant-detail comparison does not meet the minimum 1 ms timing gain, so session LOD remains disabled in this matrix.

All 15 matrix captures completed with no runtime exceptions. The first 8-planet floor capture has a headless scheduling anomaly (RAF p95 105.9 ms, p99 964.2 ms), despite 1.7 ms p95 CPU render submission and 4.05 ms p95 GPU time. Later captures show RAF p95 11.8 ms. These are headless browser observations, not native acceptance or evidence that every frame stall is fixed. The maximum measured bounded label-query time in the matrix is 1.1 ms; the synthetic grid regression separately verifies bounded work for endpoints up to one million units away.

For the supplied screenshot resolution, run `node dev/run-sky-performance.mjs --groups=24 --width=2313 --height=1323 --scenarios=sky,sky-no-bloom,sky-no-labels,sky-no-graph,sky-no-distant-details --output=dist/sky-performance-large-0.7.9.json`. The exported canvas dimensions are exactly 2313 by 1323 at pixel ratio 1. A synthetic staged scene cannot reproduce the vault's actual planet distribution or device pixel ratio. The runner also supports `--motion=true` and `--legacy=true` for independent motion and legacy-query captures. A compositor frame is requested before future captures to reduce fresh-headless-target startup throttling; recorded outliers are retained.

The five large-viewport captures completed without runtime exceptions. Full-detail sky measured 0.3 ms p95 labels, 1.7 ms p95 CPU submission, and 6.27 ms p95 GPU; detail bypass measured 0.2, 0.8, and 3.15 ms respectively. Its first capture also suffered headless startup scheduling (RAF p95 111.7 ms, p99 1005.5 ms). The renderer's numeric gate enabled LOD in that synthetic session, but the noisy baseline makes the apparent GPU gain inconclusive. A repeat (`dist/sky-performance-large-repeat-0.7.9.json`) still has first-capture scheduling outliers: full/detail-bypass CPU p95 1.5/0.8 ms and GPU p95 5.06/2.42 ms. These observations do not justify enabling LOD by default in the installed plugin; it starts disabled and requires its own local matched captures.

An independent bloom-off legacy run (`dist/sky-performance-legacy-no-bloom-0.7.9.json`) measured 4.7 ms p95 labels versus 0.3 ms in the bounded bloom-off matrix capture, both with 167 world calls, matching camera pose and graph motion disabled. Its first-target RAF scheduling is also anomalous, so this comparison supports the subsystem CPU correction rather than a native frame-rate claim.

The motion-enabled run (`dist/sky-performance-motion-0.7.9.json`) completed without runtime exceptions but collected only 32 sampled frames amid repeated approximately one-second RAF gaps. It measured labels at 0.6 ms p95 and CPU render submission at 2.9 ms p95. Main-thread work p95 was 34.3 ms, including 27.6 ms world update and 7 ms surface update (independent percentiles are not additive). Motion-enabled performance therefore remains an unresolved concern beyond the corrected label query. This run is inconclusive for native acceptance and is retained as a limitation rather than counted as a performance pass.

## Package and native boundary

- Candidate: `dist/citizen-0.7.9-local-candidate.zip`, containing exactly `main.js`, `manifest.json`, and `styles.css`.
- ZIP SHA-256: `7A13A5476BCB4523351EF1292A0D96343905B9859BE0F886C5478A496197461F`.
- Installed bundle SHA-256: `4A4BDEAD93B99DF1A0AB65C1BDF56DC89B2BB37E9CA67C625068F262E4594229`.
- Previous 0.7.8 plugin and settings backup: `dist/installed-backups/main-vault-citizen-0.7.8-before-0.7.9-20261016-211615`.
- Settings hash preserved: `B693C97B5000C1ABB4BEC17F1B6499E96973920909C7946613D7C86BFAD1B558`.

The candidate is copied to the main-vault plugin folder. Reload/redock and native 60 FPS / p95 ≤20 ms / p99 ≤33 ms acceptance remain unverified. The Windows Computer Use helper failed state capture, was refreshed/retried once, and still returned `window capture timed out: timed out waiting on channel`; no further live UI actions were attempted. No public release was made.

## 2026-10-17 right-click freeze follow-up

Subsequent input testing reproduced a separate OrbitControls pointer-capture error and led to [0.7.10](verification-0.7.10.md), now installed on disk. The account below records the initial installation discrepancy and restaging step.

The user reports a frozen/unresponsive sky view when right-clicking. Inspection found that the configured open main vault still points to `T:\AI\ObsidianVault\Obsidian`, but its installed Citizen files had changed since staging: manifest version **0.7.2.1**, bundle SHA-256 `926859361DBE1144E12CB4F7E431B7603121F418F1E4723EDCB4A58842529962`. This bundle contains none of the 0.7.9 sky capture/bounded-query markers. The reason for the older files returning is unknown; this discrepancy does not prove the cause of the reported freeze.

The entire current plugin folder was preserved at `dist/installed-backups/main-vault-0.7.2.1-before-restaging-0.7.9-20261017-3e943fc0`. The verified 0.7.9 candidate was restored using only `main.js`, `manifest.json`, and `styles.css`; all three were byte/hash checked. `data.json` stayed at SHA-256 `B693C97B5000C1ABB4BEC17F1B6499E96973920909C7946613D7C86BFAD1B558`. Deployment record: `dist/sky-freeze-restaging-20261017.json`. Production source and the candidate ZIP were unchanged by this follow-up.

Obsidian was not running at inspection and was launched after restaging. The returned window title became `Citizen - Obsidian - Obsidian 1.14.4`, but native screenshot capture failed with `FrameArrived timed out: timed out waiting on channel`, and selection-refresh/retry failed with `window capture timed out: timed out waiting on channel`. Live input testing stopped under the Computer Use recovery rule. No native crash, freeze resolution, version UI, or redock success is claimed.

The isolated synthetic runner now supports `--input=right-look`: acquire actual pointer lock, press and hold the right mouse button, send mouse movement, release after approximately 1.6 seconds, and verify that frames continue during hold and after release without WebGL context loss. Reproduce with `node dev/build-surface-preview.mjs` and `node dev/run-sky-performance.mjs --groups=24 --scenarios=sky --input=right-look --output=dist/sky-right-look-20261017.json`. This exercises the real input handlers, including charging/release, on 850 synthetic nodes and 24 planets with graph motion disabled. It does not reproduce the main vault's distribution or native runtime.
