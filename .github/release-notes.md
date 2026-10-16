Obsidian Citizen 0.7.2 adds shared planet combat and pose-preserving ten-kill rounds. It is an independent MIT fork of Hunter / JusVibin’s Constellation Graph; original copyright notices remain.

- Four slow bots patrol occupied planets in solo and multiplayer. They attack visible players after a short delay, pursue their attacker briefly when damaged, and lose interest when line of sight breaks.
- Defeating a bot drops one +30 health pickup. Bot kills do not add player score or appear in the player elimination feed.
- Health pickups show +25, +50, or +30; shield pickups have a recognizable shield silhouette.
- Player eliminations share one ten-kill win target across ship and surface combat. Bot kills do not count toward the round.
- Victory freezes combat for the existing supernova transition. The next round keeps pilots at their existing space pose or docked planet position and facing, with transient combat cleared.
- Protocol and checkpoint format are 14. All room participants need 0.7.2. This changes compatibility with older rooms.
- Independent `citizen` plugin ID. Existing testers can copy the old `constellation-graph/data.json` into `citizen/` while Obsidian is closed; disable the old plugin first and keep a backup. See the README.

Install `main.js`, `manifest.json`, and `styles.css` in `<vault>/.obsidian/plugins/citizen/`, or extract the ZIP there. SHA256SUMS.txt records checksums. Requires desktop Obsidian 1.7.2 or newer.

All 237 automated tests, typecheck, production build, and network-harness build passed. Native visual/gameplay acceptance and cross-computer connectivity have not been verified. See docs/verification-0.7.2.md and CHANGELOG.md. The historical 0.3.x and 0.5.1–0.7.1 releases remain available. GitHub release availability does not imply Community directory approval.
