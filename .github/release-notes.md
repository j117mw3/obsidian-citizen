OB Citizen 0.7.5 publishes the directory compliance source fixes while retaining the maintainer's selected OB Citizen display name and the citizen plugin ID.

- Move the player-indicator arrow reset into CSS; preserve offscreen rotation with a CSS custom property.
- Remove the redundant settings heading and name the command Open graph, since Obsidian already prefixes it with the plugin name.
- Point authorUrl at the maintainer's GitHub profile and enable repository issues for support.
- Schedule and cancel Hangar animation frames on the panel's owning window.
- Preserve settings, gameplay, room protocol 14, and checkpoint format 14.

The directory branch preview verified the technical fixes. Its separate naming check has rejected OB Citizen; retaining this name does not claim approval or an exception. The live release review remains the acceptance check.

Install main.js, manifest.json, and styles.css into <vault>/.obsidian/plugins/citizen/, or extract citizen-0.7.5.zip there. SHA256SUMS.txt records the asset hashes. Requires desktop Obsidian 1.7.2 or newer. See README.md, CHANGELOG.md, and docs/verification-0.7.5.md.
