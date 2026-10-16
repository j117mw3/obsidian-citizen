# Obsidian Citizen 0.6.2

- Default crouch to Left Control, migrate old C defaults once, retain custom bindings and prevent Ctrl movement combinations from invoking captured-gameplay shortcuts.
- Increase shared pistol heat to seven points per shot; the fifteenth uninterrupted shot fires and then vents.
- Replace capsule avatar/dummy visuals with an articulated, outlined space-operative suit, helmet, visor, utility equipment and pistol; match first-person glove and weapon detailing.
- Add prominent cyan North/amber South navigation cards, distances, exit progress and offscreen direction markers.
- Protect occupied arena visibility from graph fade/filter state and refresh presentation using geometry revision as well as seed.
- Add optional solo wall diagnostics with numbered bearings and local excluded/unresolved link counts. An end-to-end Smoke Hub test verifies six connections, physical walls, rendered instances, associations and wall hits.
- Keep protocol/checkpoint 9 and existing movement/damage geometry. Native visual acceptance remains user-observed after restart.

## Install

Download `main.js`, `manifest.json`, and `styles.css`, or extract `Obsidian-Citizen-0.6.2.zip` into `<vault>/.obsidian/plugins/constellation-graph/` with Obsidian closed. Back up your existing plugin and settings first. These original files retain the historical `constellation-graph` ID. All multiplayer participants need the same version. Requires desktop Obsidian 1.7.2 or newer.

## Verification and provenance

The original packaged files are preserved byte-for-byte. ZIP integrity, exact three-file membership, manifest version, private-path/credential-marker scan, and SHA-256 hashes were checked. Native Obsidian gameplay and cross-computer acceptance remain unverified for these archived candidates; see the version-specific verification document in the main branch.

This release restores a previously packaged update that was not committed separately at development time. Its tag records the recovered release files, license, and version notes; a matching historical TypeScript source snapshot is unavailable. GitHub's generated source archive contains this recovered package, not a reconstructed source history. The current development source will be committed with the upcoming completed update.

Independent MIT fork maintained by J117W3, based on Hunter / JusVibin's Constellation Graph. Original copyright notice preserved. No Community directory approval is implied.
