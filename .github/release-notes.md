OB Citizen 0.7.4 updates the plugin's display name across the manifest, commands, tab title, settings, messages, build banner, documentation, and release workflow.

- The plugin ID stays `citizen`, so existing Citizen installations keep their settings and update in place.
- The repository URL stays the same. Historical releases and their original packages remain available.
- Gameplay, room protocol 14, and checkpoint format 14 are unchanged from 0.7.3, including the patrol terrain-grounding fix.

Install `main.js`, `manifest.json`, and `styles.css` in `<vault>/.obsidian/plugins/citizen/`, or extract `citizen-0.7.4.zip` there. SHA256SUMS.txt records the asset hashes. Requires desktop Obsidian 1.7.2 or newer.

All 238 automated tests and the production build with TypeScript checking pass. See README.md, CHANGELOG.md, and docs/verification-0.7.4.md. GitHub release availability does not imply Community directory approval.
