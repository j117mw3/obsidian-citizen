# Obsidian Citizen 0.6.1

- Resolve one displayed arena center per frame for the planet, camera, weapon, cover, pickups, beacons, avatars, ships, dummy, bolts and positional audio. Keep graph motion and node-relative physics.
- Create exactly one wall per unique connected file, sampling incoming/outgoing file bearings when the first player docks. Freeze occupied layouts and preserve pickup timers across visits and migration. Empty mains have no walls.
- Grow planets above sixteen connections with full-size players and walls. Use radius-aware physics, docking, combat, departures and graph clearance, instanced cover and static collision indexing.
- Publish immutable geometry through acknowledged reliable chunks no larger than 16 KiB, with 4 MiB per-arena and 32 MiB checkpoint limits. Live snapshots carry geometry references. Shared wall associations contain anonymous IDs only.
- Target room protocol 9 and checkpoint format 9; incompatible clients must update together. Preserve the plugin ID, saved settings and J117W3 fork metadata.
- Testing candidate: automated verification passes; native moving-ground stability and six-wall traversal remain user acceptance after restart.

## Install

Download `main.js`, `manifest.json`, and `styles.css`, or extract `Obsidian-Citizen-0.6.1.zip` into `<vault>/.obsidian/plugins/constellation-graph/` with Obsidian closed. Back up your existing plugin and settings first. These original files retain the historical `constellation-graph` ID. All multiplayer participants need the same version. Requires desktop Obsidian 1.7.2 or newer.

## Verification and provenance

The original packaged files are preserved byte-for-byte. ZIP integrity, exact three-file membership, manifest version, private-path/credential-marker scan, and SHA-256 hashes were checked. Native Obsidian gameplay and cross-computer acceptance remain unverified for these archived candidates; see the version-specific verification document in the main branch.

This release restores a previously packaged update that was not committed separately at development time. Its tag records the recovered release files, license, and version notes; a matching historical TypeScript source snapshot is unavailable. GitHub's generated source archive contains this recovered package, not a reconstructed source history. The current development source will be committed with the upcoming completed update.

Independent MIT fork maintained by J117W3, based on Hunter / JusVibin's Constellation Graph. Original copyright notice preserved. No Community directory approval is implied.
