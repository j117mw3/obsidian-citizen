# Citizen 0.7.6 verification

Citizen replaces the rejected OB Citizen display name. The plugin ID remains citizen; settings, room protocol, and checkpoint protocol remain unchanged at 14.

## Local checks

- Production build and TypeScript checking passed.
- ESLint checks all src and dev TypeScript with zero warnings, including typed unsafe-value and deprecated-API rules. CSS checks reject !important and :has.
- All 240 automated tests passed, including two new tests covering valid and malformed WebRTC statistics. Existing settings, anonymous topology, invalid network data, multiplayer, combat, and terrain checks passed.
- Network, real-time surface, surface preview, and lifecycle browser harness builds passed.
- Dependency audit reports zero vulnerabilities.
- Two logical clients on the loopback signaling fixture established native browser WebRTC, joined one room, received anonymous maps/positions, docked independently, accepted an authoritative surface shot, and left cleanly. The preview and both room clients logged zero browser warnings/errors. This does not establish cross-computer connectivity.
- Synthetic browser preview: graph and Hangar rendered; engine-preview control completed; staged surface docking rendered the HUD and hid graph controls. This is browser component evidence, not native Obsidian acceptance or proof of audible output.
- Native Obsidian capture failed twice with capture/channel timeouts. Native popout, live vault reload, cross-computer multiplayer, and audible-output acceptance are not claimed.

## Release acceptance

Directory preview of commit 6d37f8f3ceaeafec8de6dedec65d54ef5942185f completed with zero errors. It cleared the original CSS findings and dependency findings. The remaining source warnings were five Array.at calls (and downstream typing effects) in surface lifecycle/realtime fixtures and pickup presentation; those calls have now been replaced by equivalent indexed access for the scanner's ES2020 type environment. A second preview is pending.

The preview also warned that Citizen differs from the existing OB Citizen listing name. The listing edit form exposes descriptions but no display-name field; the name must be reconciled through release metadata. This warning is separate from the original trademark rejection, which is absent in the new preview.

The desktop tool can read directory results, but screenshot capture times out and coordinate input geometry is unavailable. The user submitted the first preview. Version 0.7.6 has not been tagged or published; published review, provenance, and downloaded asset verification remain pending.

Vault enumeration remains necessary for the local graph. Clipboard access is limited to user-triggered room-code writes; no clipboard reads occur. Names, paths, tags, and note contents remain local.

The new release attaches only main.js, manifest.json, and styles.css. ZIP/checksums remain available as workflow artifacts. Historical releases, attribution, and untracked verification-0.7.2.1.md are preserved.
