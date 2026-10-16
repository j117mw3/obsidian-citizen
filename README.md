# Obsidian Citizen 0.5.2

- Run room movement at fixed 60 Hz, acknowledge sequenced per-tick controls, resend a bounded history, and replay peer prediction from exact host snapshots. The local host now renders directly from its own authoritative simulation instead of blending toward 20 Hz corrections.
- Buffer remote ship states for 100 ms and interpolate their displayed movement, with at most 100 ms of extrapolation. Player labels, distance, audio position, and lead pip use the presented ship motion.
- Increase forward pickup below cruise in solo and rooms while retaining cruise speed, boost rules, and other movement ratios. Reduce afterburner camera rattle and disable that rattle under reduced-motion preferences.
- Replace the long weapon text strip with selected blaster/cannon icons, circular cooldown arcs, one-decimal timers, heat and ammunition values. Include cooldown duration in room poses and checkpoints.
- Return the Hangar to a centered, content-sized panel around 440 px high, capped at 480 px, with a scrollable middle and fixed actions.
- Use room protocol 7 and checkpoint format 7 for tick acknowledgement, queued inputs, and cooldown duration. Mixed clients get an update-required error. The Worker’s legacy protocol-4 routes and TURN service are unchanged.
- Runtime acceptance in Obsidian and two-computer testing remain separate from the synthetic checks in `docs/verification-0.5.2.md`.

## Install

Download `main.js`, `manifest.json`, and `styles.css`, or extract `Obsidian-Citizen-0.5.2.zip` into `<vault>/.obsidian/plugins/constellation-graph/` with Obsidian closed. Back up your existing plugin and settings first. These original files retain the historical `constellation-graph` ID. All multiplayer participants need the same version. Requires desktop Obsidian 1.7.2 or newer.

## Verification and provenance

The original packaged files are preserved byte-for-byte. ZIP integrity, exact three-file membership, manifest version, private-path/credential-marker scan, and SHA-256 hashes were checked. Native Obsidian gameplay and cross-computer acceptance remain unverified for these archived candidates; see the version-specific verification document in the main branch.

This release restores a previously packaged update that was not committed separately at development time. Its tag records the recovered release files, license, and version notes; a matching historical TypeScript source snapshot is unavailable. GitHub's generated source archive contains this recovered package, not a reconstructed source history. The current development source will be committed with the upcoming completed update.

Independent MIT fork maintained by J117W3, based on Hunter / JusVibin's Constellation Graph. Original copyright notice preserved. No Community directory approval is implied.
