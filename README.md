# Obsidian Citizen 0.7.0

- Procedural alien terrain with real hills/depressions, flat pole pads, permanent ruin cover, protected routes, and balanced resource approaches.
- Shared terrain collision/visibility for movement, bolts, labels, patrols, resources, and terrain-aware paired moving walls.
- Seeded terrain identity and bounded reliable transfer; room/checkpoint protocol 12 and terrain format 1.
- Local terrain LOD, instanced ruins, three stone/technology palettes, and expanded seed/movement/network verification.
- See `docs/verification-0.7.0.md` for measured preparation costs and pending native visual/performance acceptance.

## Install

Download `main.js`, `manifest.json`, and `styles.css`, or extract `Obsidian-Citizen-0.7.0.zip` into `<vault>/.obsidian/plugins/constellation-graph/` with Obsidian closed. Back up your existing plugin and settings first. These original files retain the historical `constellation-graph` ID. All multiplayer participants need the same version. Requires desktop Obsidian 1.7.2 or newer.

## Verification and provenance

The original packaged files are preserved byte-for-byte. ZIP integrity, exact three-file membership, manifest version, private-path/credential-marker scan, and SHA-256 hashes were checked. Native Obsidian gameplay and cross-computer acceptance remain unverified for these archived candidates; see the version-specific verification document in the main branch.

This release restores a previously packaged update that was not committed separately at development time. Its tag records the recovered release files, license, and version notes; a matching historical TypeScript source snapshot is unavailable. GitHub's generated source archive contains this recovered package, not a reconstructed source history. The current development source will be committed with the upcoming completed update.

Independent MIT fork maintained by J117W3, based on Hunter / JusVibin's Constellation Graph. Original copyright notice preserved. No Community directory approval is implied.
