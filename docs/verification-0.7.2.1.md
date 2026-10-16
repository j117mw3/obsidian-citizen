# Obsidian Citizen 0.7.2.1 verification

This local hotfix fixes patrol bot rendering over uneven terrain. The bots' authoritative positions already followed terrain height; renderer interpolation flattened every displayed pose to the planet's base radius. Interpolation now keeps each displayed pose on the terrain surface, including during multiplayer smoothing. Room protocol and checkpoint format remain 14.

## Automated checks and package

- The East Patrol regression crosses a seeded equatorward terrain-height change and checks its interpolated ground distance at seven points along the transition.
- All 238 tests pass. TypeScript checking, the production build, and the network-harness build pass.
- The install ZIP contains exactly `main.js`, `manifest.json`, and `styles.css`; the manifest declares plugin ID `citizen`, version `0.7.2.1`.
- ZIP SHA-256: `E3C23218FE03843E34CCF0F84A17EDE7382A593874B692210315DF518FA97ADD`.
- The installed `main.js`, `manifest.json`, and `styles.css` hashes match the ZIP payload. The existing `data.json` hash was unchanged. A pre-install backup is at `constellation-graph.backup-before-0.7.2.1-20261016` beside the Testing vault's plugin folder.

## Runtime boundary

The Testing-vault plugin files were updated on disk. Obsidian was not restarted or reloaded, and live visual gameplay was not observed in this verification. Reload the plugin or restart Obsidian before checking the fix in the test vault.
