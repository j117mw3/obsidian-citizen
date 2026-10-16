# Release downloads

Each update has its own GitHub release, containing main.js, manifest.json, styles.css, a versioned install ZIP, and SHA256SUMS.txt.

| Version | Release |
|---|---|
| 0.5.1 | [Obsidian Citizen 0.5.1](https://github.com/j117mw3/obsidian-citizen/releases/tag/0.5.1) |
| 0.5.2 | [Obsidian Citizen 0.5.2](https://github.com/j117mw3/obsidian-citizen/releases/tag/0.5.2) |
| 0.6.0 | [Obsidian Citizen 0.6.0](https://github.com/j117mw3/obsidian-citizen/releases/tag/0.6.0) |
| 0.6.1 | [Obsidian Citizen 0.6.1](https://github.com/j117mw3/obsidian-citizen/releases/tag/0.6.1) |
| 0.6.2 | [Obsidian Citizen 0.6.2](https://github.com/j117mw3/obsidian-citizen/releases/tag/0.6.2) |
| 0.6.3 | [Obsidian Citizen 0.6.3](https://github.com/j117mw3/obsidian-citizen/releases/tag/0.6.3) |
| 0.6.4 | [Obsidian Citizen 0.6.4](https://github.com/j117mw3/obsidian-citizen/releases/tag/0.6.4) |
| 0.6.5 | [Obsidian Citizen 0.6.5](https://github.com/j117mw3/obsidian-citizen/releases/tag/0.6.5) |
| 0.6.6 | [Obsidian Citizen 0.6.6](https://github.com/j117mw3/obsidian-citizen/releases/tag/0.6.6) |
| 0.6.7 | [Obsidian Citizen 0.6.7](https://github.com/j117mw3/obsidian-citizen/releases/tag/0.6.7) |
| 0.6.8 | [Obsidian Citizen 0.6.8](https://github.com/j117mw3/obsidian-citizen/releases/tag/0.6.8) |
| 0.7.0 | [Obsidian Citizen 0.7.0](https://github.com/j117mw3/obsidian-citizen/releases/tag/0.7.0) |
| 0.7.1 | [Obsidian Citizen 0.7.1](https://github.com/j117mw3/obsidian-citizen/releases/tag/0.7.1) |
| 0.7.2 | [Obsidian Citizen 0.7.2](https://github.com/j117mw3/obsidian-citizen/releases/tag/0.7.2) |

The recovered 0.5.1–0.7.1 packages are preserved byte-for-byte and retain the `constellation-graph` plugin ID. Close Obsidian, back up settings, and install their three files into `<vault>/.obsidian/plugins/constellation-graph/`. Version 0.7.2 is built from the tagged source in this repository and uses the independent `citizen` ID; see the README for its settings migration. Every multiplayer participant must use the same version.

The 0.5.1–0.7.1 releases recover previously packaged updates. Their version tags contain recovered plugin files, license, checksums, and notes. Matching historical TypeScript source snapshots were not saved; those releases do not claim reconstructed source history. Version 0.7.2 has a matching source tag and new `citizen` plugin identity. Git may normalize text line endings in generated source downloads; use each release's install ZIP and SHA256SUMS.txt for exact package bytes.

ZIP integrity, file membership, manifest versions, private-path/credential-marker scans, and SHA-256 checks passed for the recovered packages. Native gameplay and cross-computer acceptance remain separate from automated checks. The 0.7.2 bot combat and scoring update is documented in the current README, changelog, and version-specific release notes.
