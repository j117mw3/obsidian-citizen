# Obsidian Citizen 0.6.4

- Remove the wall diagnostics checkbox, overlay, counters and callback.
- Add cosmetic opaque panel/circuit surface paint and cyan/amber pole routes without changing movement, cover, geometry identity or collision.
- Show public pilot names above red HP bars for visible same-arena opponents and the training dummy. Test displayed head line of sight against physical walls and planet curvature before revealing either label.
- Add actual-damage feedback for solo dummy hits and make confirmed multiplayer hit feedback clearer: a centered white marker with up to 450 ms visibility. Walls, floor, misses and predicted shots never trigger character-hit feedback.
- Reuse existing authoritative health and hit confirmations; room/checkpoint protocol 9, weapon balance and saved settings remain unchanged.

## Install

Download `main.js`, `manifest.json`, and `styles.css`, or extract `Obsidian-Citizen-0.6.4.zip` into `<vault>/.obsidian/plugins/constellation-graph/` with Obsidian closed. Back up your existing plugin and settings first. These original files retain the historical `constellation-graph` ID. All multiplayer participants need the same version. Requires desktop Obsidian 1.7.2 or newer.

## Verification and provenance

The original packaged files are preserved byte-for-byte. ZIP integrity, exact three-file membership, manifest version, private-path/credential-marker scan, and SHA-256 hashes were checked. Native Obsidian gameplay and cross-computer acceptance remain unverified for these archived candidates; see the version-specific verification document in the main branch.

This release restores a previously packaged update that was not committed separately at development time. Its tag records the recovered release files, license, and version notes; a matching historical TypeScript source snapshot is unavailable. GitHub's generated source archive contains this recovered package, not a reconstructed source history. The current development source will be committed with the upcoming completed update.

Independent MIT fork maintained by J117W3, based on Hunter / JusVibin's Constellation Graph. Original copyright notice preserved. No Community directory approval is implied.
