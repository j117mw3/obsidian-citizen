# Obsidian Citizen 0.6.6

- Make crouch hold-only. Settings schema 5 migrates toggle preferences to hold and retains custom key bindings; remove the obsolete mode selector.
- Hold right mouse for one second and release a 50-damage, 55-heat charged bolt. Early release cancels; charging pauses cooling and blocks primary fire. Two quick charged shots force the existing two-second vent. Normal-shot balance remains unchanged.
- Show charge percentage, muzzle energy buildup, stronger recoil and a thicker charged bolt. Cancel charges on focus loss, death, exit, host migration or five-second expiration.
- Validate charge duration on the host; send start/release/cancel through ordered reliable transport, preserve retried-fire deduplication, wall blocking, armor, confirmed hits and bounded rewind. Preserve shot kind in snapshots and migrated in-flight bolts; unfinished charges do not migrate.
- Bump plugin to 0.6.6 and room/checkpoint contracts to 10, rejecting old rooms/checkpoints. Geometry encoding and privacy boundaries remain unchanged.

## Install

Download `main.js`, `manifest.json`, and `styles.css`, or extract `Obsidian-Citizen-0.6.6.zip` into `<vault>/.obsidian/plugins/constellation-graph/` with Obsidian closed. Back up your existing plugin and settings first. These original files retain the historical `constellation-graph` ID. All multiplayer participants need the same version. Requires desktop Obsidian 1.7.2 or newer.

## Verification and provenance

The original packaged files are preserved byte-for-byte. ZIP integrity, exact three-file membership, manifest version, private-path/credential-marker scan, and SHA-256 hashes were checked. Native Obsidian gameplay and cross-computer acceptance remain unverified for these archived candidates; see the version-specific verification document in the main branch.

This release restores a previously packaged update that was not committed separately at development time. Its tag records the recovered release files, license, and version notes; a matching historical TypeScript source snapshot is unavailable. GitHub's generated source archive contains this recovered package, not a reconstructed source history. The current development source will be committed with the upcoming completed update.

Independent MIT fork maintained by J117W3, based on Hunter / JusVibin's Constellation Graph. Original copyright notice preserved. No Community directory approval is implied.
