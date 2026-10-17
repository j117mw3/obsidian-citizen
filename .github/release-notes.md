Citizen 0.7.8 combines the terrain, performance, multiplayer docking and departure fixes developed since 0.7.7. Unpublished local candidate numbers 0.7.8–0.7.14 are consolidated into this release.

- Walk across real rolling hills and shallow crater bowls, with protected pole routes and shared terrain collision.
- Bound sky occlusion queries, cull off-screen planets and add opt-in private CPU/GPU diagnostics. Native FPS acceptance remains pending; no sustained-60-FPS claim is made.
- Keep pointer lock stable during right-click charging; synchronize fresh-room docking revisions and show actionable docking failures.
- Reuse one planet per anonymous multiplayer hub, preserving graph and wall motion.
- Refresh ship departure obstacles, reserve clearance and recover exact-center overlaps without corrective input.

**Multiplayer compatibility:** room/checkpoint protocol 15 replaces 14. Every player must update. The plugin ID remains citizen; saved settings are preserved and private note data stays local.

Requires desktop Obsidian 1.7.2 or newer. Update through your existing Citizen updater, or copy main.js, manifest.json and styles.css from the ZIP into your vault's .obsidian/plugins/citizen folder, then reload the plugin. Do not copy settings from another player.

Validation and native acceptance limits: [release verification](https://github.com/j117mw3/obsidian-citizen/blob/0.7.8/docs/release-0.7.8.md). Assets include the three plugin files, citizen-0.7.8.zip and SHA256SUMS.txt.

**Local testers:** builds previously numbered 0.7.9–0.7.14 were unpublished candidates. Install 0.7.8 manually once, since an updater will not offer a lower version number. Public 0.7.7 installations can update normally.
