# Obsidian Citizen 0.6.8

- Generate exactly two separated walls per unique linked file, retaining reciprocal/self-link deduplication and anonymous associations. The six-file Smoke Hub has twelve physical and rendered walls. Keep the existing radius formula based on file count, with no additional cover cap.
- Drive cover toward the live file bearings on the sphere at 0.8 surface units per second. Keep exit/pickup clearance, avoid overlapping walls, and stop before standing, crouched or leaning players. Preserve immutable geometry identity, radius, pickup layout and consumed-pickup timers while moving.
- Update existing solid instances and wire outlines together; maintain collision indices incrementally rather than rebuilding scene geometry every frame. Add deterministic instanced mineral scree as low-profile walk-over ground detail.
- Publish bounded compact host cover poses near players separately from acknowledged immutable geometry; predict distant presentation from anonymous graph positions. Preserve current collision poses on checkpoint migration and deduplicate repeated geometry definitions in bounded reliable transfers.
- Bump plugin to 0.6.8 and room/checkpoint contracts to 11; reject incompatible rooms/checkpoints. Keep settings schema 5, movement and weapon balance unchanged.

## Install

Download `main.js`, `manifest.json`, and `styles.css`, or extract `Obsidian-Citizen-0.6.8.zip` into `<vault>/.obsidian/plugins/constellation-graph/` with Obsidian closed. Back up your existing plugin and settings first. These original files retain the historical `constellation-graph` ID. All multiplayer participants need the same version. Requires desktop Obsidian 1.7.2 or newer.

## Verification and provenance

The original packaged files are preserved byte-for-byte. ZIP integrity, exact three-file membership, manifest version, private-path/credential-marker scan, and SHA-256 hashes were checked. Native Obsidian gameplay and cross-computer acceptance remain unverified for these archived candidates; see the version-specific verification document in the main branch.

This release restores a previously packaged update that was not committed separately at development time. Its tag records the recovered release files, license, and version notes; a matching historical TypeScript source snapshot is unavailable. GitHub's generated source archive contains this recovered package, not a reconstructed source history. The current development source will be committed with the upcoming completed update.

Independent MIT fork maintained by J117W3, based on Hunter / JusVibin's Constellation Graph. Original copyright notice preserved. No Community directory approval is implied.
