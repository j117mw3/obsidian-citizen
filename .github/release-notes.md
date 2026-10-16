Obsidian Citizen 0.7.3 fixes patrol bot rendering over uneven terrain. The displayed bot pose now follows the arena's terrain elevation throughout interpolation instead of flattening to the planet's base radius. Authoritative bot state and multiplayer protocol 14 are unchanged.

- Fix East Patrol appearing partly buried or too high as it moves between latitudes with different terrain height.
- Add a regression that checks seven interpolated poses across a seeded equatorward terrain-height change.
- Keep room protocol and checkpoint format at 14. Use version 0.7.3 on all clients to receive the display fix.
- Continue to use the independent `citizen` plugin ID. See the README for migration from the historical `constellation-graph` ID.

Install `main.js`, `manifest.json`, and `styles.css` in `<vault>/.obsidian/plugins/citizen/`, or extract `citizen-0.7.3.zip` there. SHA256SUMS.txt records the asset hashes. Requires desktop Obsidian 1.7.2 or newer.

All 238 automated tests, TypeScript checking, production build, and network-harness build pass. Native visual/gameplay acceptance and cross-computer connectivity have not been verified. See docs/verification-0.7.3.md and CHANGELOG.md. GitHub release availability does not imply Community directory approval.
