# Obsidian Citizen 0.7.2.2 verification

This is a local Testing-vault hotfix for patrol ground contact. Bot presentation now samples the active terrain mesh triangles, aligns the operative to that visible surface, and keeps its lowest animated boot sole 0.012 surface units above the mesh. The health/name label uses the same corrected display pose and the rendered helmet anchor. Authoritative patrol state, room protocol 14, and checkpoint version 14 are unchanged.

## Automated checks and package

- The rendered-contact regression uses interpolated patrol states, the actual operative and terrain mesh, twelve terrain-height/viewer-LOD combinations, animated walking poses, transformed boot vertices, and raycasts against the rendered triangles. It also checks six cube-sphere faces and verifies the name label projects from the rendered helmet anchor.
- All 241 tests pass. TypeScript checking, ESLint/CSS checks, the production build, and the synthetic network-harness build pass.
- The ZIP contains exactly `main.js`, `manifest.json`, and `styles.css`. Its manifest declares plugin ID `citizen`, version `0.7.2.2`.
- ZIP SHA-256: `01B5EDA9FBE87A81273C7C32E329BBF6DBFED170F088B8C5DCDC9B6672D38787`.
- Package and installed file SHA-256 values match:
  - `main.js`: `71414870AC7241B7203EEFA0EEA76F2DD05E50C108B5D8BC648B60949A967806`
  - `manifest.json`: `E0B4AD1F28293585F3FDBDCFCECD8EB07E7F3ABC619AEA98F65270C3184C1F93`
  - `styles.css`: `E8400891C760CDC3737C8CBFE55A2F00411FCE546E7E8E44F391C591280D2B7E`
- The Testing-vault `data.json` hash remains `98B6CA22A3F93C7A0BF7D4F4105FEDCDC581976CA7B090AC3F8C7D97A9719650`. The pre-install backup is `constellation-graph.backup-before-0.7.2.2-20261016` beside the installed plugin folder.
- The build-generated root `main.js` and `dev/network-harness.html` were restored byte-for-byte after packaging and harness verification.

## Runtime boundary

The Testing-vault plugin files were updated on disk. Obsidian was not restarted or reloaded, so live visual gameplay has not been observed. Reload the plugin or restart Obsidian before checking West Patrol in the docked view.
