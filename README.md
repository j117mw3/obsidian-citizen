# Obsidian Citizen 0.5.1

- Match upstream 0.4.1 flight controls: direct captured-mouse aiming, cursor steering, roll, braking, strafe, grip, speed-dependent agility, and 135-unit multiplayer cruise speed. Shared solo, prediction, and host movement constants now use the same implementation.
- Restore boosted world-space dust streaks and eased speed/afterburner field-of-view changes in chase and cockpit views, while respecting reduced-motion and restoring the configured field of view when flight ends.
- Send weapon selection as an ordered reliable command, acknowledge it in authoritative poses, and preserve unacknowledged choices during reconciliation. A regression test now exercises the actual client `R`-then-fire message order through the host control channel.
- Restore solo cannon-ammunition recovery, keep room ammunition limited to 36 per life, and preserve cooldowns when switching weapons. Chaser and cockpit weapon displays show selection, rate, ammunition or heat, readiness, cooldown, and dry/overheated states.
- Remove the redundant Scores toolbar button; hold Tab to show multiplayer standings. Keep the scoreboard bounded, scrollable, and keyboard accessible, and prevent pending clicks from firing during spectator transitions.
- Keep the 0.5.0 room protocol-5 clients isolated; 0.5.1 rooms use protocol 6 and checkpoint format 6. The Worker’s historical protocol-4 route and TURN credential routes remain unchanged.

## Install

Download `main.js`, `manifest.json`, and `styles.css`, or extract `Obsidian-Citizen-0.5.1.zip` into `<vault>/.obsidian/plugins/constellation-graph/` with Obsidian closed. Back up your existing plugin and settings first. These original files retain the historical `constellation-graph` ID. All multiplayer participants need the same version. Requires desktop Obsidian 1.7.2 or newer.

## Verification and provenance

The original packaged files are preserved byte-for-byte. ZIP integrity, exact three-file membership, manifest version, private-path/credential-marker scan, and SHA-256 hashes were checked. Native Obsidian gameplay and cross-computer acceptance remain unverified for these archived candidates; see the version-specific verification document in the main branch.

This release restores a previously packaged update that was not committed separately at development time. Its tag records the recovered release files, license, and version notes; a matching historical TypeScript source snapshot is unavailable. GitHub's generated source archive contains this recovered package, not a reconstructed source history. The current development source will be committed with the upcoming completed update.

Independent MIT fork maintained by J117W3, based on Hunter / JusVibin's Constellation Graph. Original copyright notice preserved. No Community directory approval is implied.
