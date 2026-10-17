# 0.7.10 local candidate: surface pointer-lock input

## Report and confirmed defect

On 2026-10-17 the user reported an unresponsive sky view after right-clicking, then clarified that it happened only once. The full native freeze has not been reproduced or attributed conclusively.

A real browser input sequence on the previous 0.7.9 source did reproduce an uncaught `InvalidStateError: Failed to execute 'setPointerCapture' on 'Element'` in Three.js OrbitControls. While walking, the graph pointer-up handler also received the click used to acquire pointer lock. Its `endPress(null)` unconditionally enabled orbit controls. A subsequent right-click reached OrbitControls while pointer lock was active. The graph's right-click, context menu, and pointer-move handlers also continued handling surface input.

0.7.10 leaves surface pointer input with SurfacePilot, keeps orbit controls disabled during game-mode pointer cleanup, and prevents graph auto-rotation while walking. Map selection/orbit behavior remains available in graph mode. The 0.7.9 bounded sky queries and protocol 15 are retained. This fixes the reproduced input conflict; it does not establish the cause of the user's one-off freeze or resolve the separately observed motion-update cost.

## Verification

- `npm test`: **255 passed, 0 failed**, including graph pointer cleanup in map, flight, and surface modes. Log: `dist/sky-0.7.10-tests.log`.
- `npm run lint`: passed, including CSS review.
- `npm run build`: passed, including TypeScript checks.
- `node --check dev/run-sky-performance.mjs` and `git diff --check`: passed.
- Isolated headless Edge smoke: actual pointer lock, right-button down, 16 mouse movements while holding for about 1.6 seconds, and charged release. With 850 synthetic nodes and 24 planets, orbit controls stayed disabled throughout; charging was true after press and hold, false after release, and the fire sequence advanced from 0 to 1. Frames advanced 311 → 314 → 544 → 607; WebGL context was retained. The complete run recorded no runtime exceptions. Report: `dist/sky-right-look-0.7.10.json`.
- Before-fix report with the OrbitControls exception: `dist/sky-right-look-20261017.json`. This was an input-error reproduction, not an assertion that all rendering stopped.
- An initial strengthened post-fix smoke did not observe charging and failed its input assertion; the runner now records the post-press state and actual pointer events before proceeding. The successful run verifies both real charge handling and camera ownership rather than counting frames alone.

Reproduce: `node dev/build-surface-preview.mjs`, then `node dev/run-sky-performance.mjs --groups=24 --scenarios=sky --input=right-look --output=dist/sky-right-look-0.7.10.json`.

The subsequent 20-second synthetic sky profile still has headless scheduling outliers: RAF p95 258.8 ms and p99 1005.6 ms, while labels p95 is 0.3 ms, CPU render submission 2.2 ms, and GPU time 4.23 ms. This is not a native FPS pass. Graph motion was disabled for this input regression.

## Installed files and native boundary

Inspection initially found the configured main vault's plugin folder contained **0.7.2.1**, bundle SHA-256 `926859361DBE1144E12CB4F7E431B7603121F418F1E4723EDCB4A58842529962`, lacking the 0.7.9 bounded-query markers. The reason for the older files returning is unknown. That folder and its settings were preserved before restaging 0.7.9; see [the follow-up installation record](verification-0.7.9.md).

The new 0.7.10 candidate is copied to `T:\AI\ObsidianVault\Obsidian\.obsidian\plugins\citizen`. All three installed assets and ZIP entries were hash checked. No public release was made.

- Candidate: `dist/citizen-0.7.10-local-candidate.zip`, exactly `main.js`, `manifest.json`, `styles.css`.
- ZIP SHA-256: `F22A5B91D0A10B0200B4F5BA66A3B6C47684577ADA909932BAE05824C61B9FB2`.
- Installed bundle SHA-256: `8CB1EA8528879B4239B7809AF0AA93AC8320AC22EAD08D0030ECFF2F3C9FDB79`.
- Pre-0.7.10 full plugin/settings backup: `dist/installed-backups/main-vault-before-0.7.10-20261017-3fc07430`.
- Earlier 0.7.2.1 backup: `dist/installed-backups/main-vault-0.7.2.1-before-restaging-0.7.9-20261017-3e943fc0`.
- Settings preserved at SHA-256 `B693C97B5000C1ABB4BEC17F1B6499E96973920909C7946613D7C86BFAD1B558`.
- Deployment record: `dist/citizen-0.7.10-local-install.json`.

Obsidian was launched after the initial 0.7.9 restaging, before 0.7.10 was built. The helper returned the Citizen window title but failed screenshot capture and its required refresh/retry with `window capture timed out: timed out waiting on channel`. Further native input stopped under the Computer Use skill's recovery rule. **Reload Citizen or restart Obsidian to load the installed 0.7.10 files. Native reload/redock, recurrence of the one-off freeze, and FPS acceptance remain unverified.**
