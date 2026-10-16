# Citizen 0.7.6 verification

Citizen replaces the rejected OB Citizen display name. The plugin ID remains citizen; settings, room protocol, and checkpoint protocol remain unchanged at 14.

## Local checks

- Production build and TypeScript checking passed.
- ESLint checks all src and dev TypeScript with zero warnings, including typed unsafe-value and deprecated-API rules. CSS checks reject !important and :has.
- All 240 automated tests passed, including two new tests covering valid and malformed WebRTC statistics. Existing settings, anonymous topology, invalid network data, multiplayer, combat, and terrain checks passed.
- Network, real-time surface, surface preview, and lifecycle browser harness builds passed.
- Dependency audit reports zero vulnerabilities.
- Synthetic browser preview: graph and Hangar rendered; engine-preview control completed; staged surface docking rendered the HUD and hid graph controls. This is browser component evidence, not native Obsidian acceptance or proof of audible output.
- Native Obsidian capture failed twice with capture/channel timeouts. Native popout, live vault reload, cross-computer multiplayer, and audible-output acceptance are not claimed.

## Release acceptance

Directory branch preview, published release review, provenance, and downloaded asset verification are pending. This document will record the actual results after publication; local checks alone do not establish a directory Pass.

Vault enumeration remains necessary for the local graph. Clipboard access is limited to user-triggered room-code writes; no clipboard reads occur. Names, paths, tags, and note contents remain local.

The new release attaches only main.js, manifest.json, and styles.css. ZIP/checksums remain available as workflow artifacts. Historical releases, attribution, and untracked verification-0.7.2.1.md are preserved.
