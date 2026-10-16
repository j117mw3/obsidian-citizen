# Obsidian Citizen 0.6.3

- Make graph nodes, links, navigation markers and other world overlays respect scene depth during the surface world draw, including bloom rendering. Opaque planets and cover hide geometry behind them while unobstructed exterior space stays visible.
- Restore original material depth settings after each world draw, preserving orbit/flight appearance and the separate first-person viewmodel overlay.
- Hide graph-node labels and ship indicators whose camera ray intersects an arena sphere, using the current displayed center and radius.
- Keep gameplay, weapon balance, physics, settings and room/checkpoint protocol 9 unchanged. Native pixel verification remains user-observed after restart.

## Install

Download `main.js`, `manifest.json`, and `styles.css`, or extract `Obsidian-Citizen-0.6.3.zip` into `<vault>/.obsidian/plugins/constellation-graph/` with Obsidian closed. Back up your existing plugin and settings first. These original files retain the historical `constellation-graph` ID. All multiplayer participants need the same version. Requires desktop Obsidian 1.7.2 or newer.

## Verification and provenance

The original packaged files are preserved byte-for-byte. ZIP integrity, exact three-file membership, manifest version, private-path/credential-marker scan, and SHA-256 hashes were checked. Native Obsidian gameplay and cross-computer acceptance remain unverified for these archived candidates; see the version-specific verification document in the main branch.

This release restores a previously packaged update that was not committed separately at development time. Its tag records the recovered release files, license, and version notes; a matching historical TypeScript source snapshot is unavailable. GitHub's generated source archive contains this recovered package, not a reconstructed source history. The current development source will be committed with the upcoming completed update.

Independent MIT fork maintained by J117W3, based on Hunter / JusVibin's Constellation Graph. Original copyright notice preserved. No Community directory approval is implied.
