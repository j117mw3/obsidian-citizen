# Obsidian Citizen 0.6.5

- Stop first-person shot requests, recoil, muzzle flashes and blaster sounds while the host-timed vent is active or full heat awaits authoritative cooling. The threshold shot still fires; weapon balance and the two-second vent are unchanged.
- Show a bounded weapon-local steam effect during venting.
- Replace the single stationary solo dummy with four passive patrols: one near each pole and two on opposite hemispheres. Use fixed-step spherical movement, predictive capsule clearance, steering, pauses and stuck recovery; keep patrols out of the exit zones.
- Give each dummy independent damage and respawn state; reset/armor controls affect all four. Existing line-of-sight names, red HP bars and confirmed-hit feedback apply to every patrol.
- Add larger cosmetic technical sector markings to the opaque panel/circuit surface without introducing obstacles or changing cover generation.
- Keep settings and room/checkpoint protocol 9 unchanged; multiplayer receives no training NPC payloads.

## Install

Download `main.js`, `manifest.json`, and `styles.css`, or extract `Obsidian-Citizen-0.6.5.zip` into `<vault>/.obsidian/plugins/constellation-graph/` with Obsidian closed. Back up your existing plugin and settings first. These original files retain the historical `constellation-graph` ID. All multiplayer participants need the same version. Requires desktop Obsidian 1.7.2 or newer.

## Verification and provenance

The original packaged files are preserved byte-for-byte. ZIP integrity, exact three-file membership, manifest version, private-path/credential-marker scan, and SHA-256 hashes were checked. Native Obsidian gameplay and cross-computer acceptance remain unverified for these archived candidates; see the version-specific verification document in the main branch.

This release restores a previously packaged update that was not committed separately at development time. Its tag records the recovered release files, license, and version notes; a matching historical TypeScript source snapshot is unavailable. GitHub's generated source archive contains this recovered package, not a reconstructed source history. The current development source will be committed with the upcoming completed update.

Independent MIT fork maintained by J117W3, based on Hunter / JusVibin's Constellation Graph. Original copyright notice preserved. No Community directory approval is implied.
