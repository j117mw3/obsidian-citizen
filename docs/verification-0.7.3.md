# Obsidian Citizen 0.7.3 verification

This release fixes patrol bot display interpolation over uneven terrain. The authoritative bot positions already followed the terrain; client rendering flattened each interpolated pose to the planet's base radius. The interpolation now follows terrain height from the pole toward the equator. Room protocol and checkpoint format remain 14.

## Automated checks and package

- The East Patrol regression crosses a seeded equatorward terrain-height change and checks seven interpolated poses against the terrain surface.
- All 238 tests pass. TypeScript checking, the production build, and the network-harness build pass.
- The release ZIP contains exactly `main.js`, `manifest.json`, and `styles.css`. The manifest declares plugin ID `citizen` and version `0.7.3`.
- Release assets and their SHA-256 hashes are listed in `SHA256SUMS.txt`.

## Runtime boundary

Automated checks do not establish native Obsidian visual behavior or cross-computer connectivity. Those remain to be verified separately.
