# 0.7.8 candidate verification

This is a local candidate record. Version 0.7.8 has not been published. Native performance acceptance remains open because the main-vault plugin had not yet been reloaded for captures.

## Automated checks

- `npm test`: 244 passed, 0 failed.
- `npm run typecheck`: passed.
- `npm run lint`: passed, including CSS review checks.
- `npm run build`: passed.
- `node --test tests/surface-terrain.test.mjs`: 22 passed, including 1,000-seed slope and terrain-bound checks, walk/jump grounding, legacy terrain version 2, mesh/collision agreement, repeated LOD patch reuse, combat intersections at sampled hills and crater lows, and protected routes.
- The browser preview builds and serves locally with HTTP 200. It uses synthetic graph data; its default graph size is 850 nodes, hub degree 128, motion enabled, and bloom enabled. It never reads vault files.

Existing headless rebuild timings were approximately 13 ms for a six-link arena and 25–33 ms for larger cases. These locate a mesh-preparation cost but do not establish the live FPS bottleneck.

## Candidate and installed backup

- Local package: `dist/citizen-0.7.8-local-candidate.zip`.
- ZIP SHA-256: `9ADCFE1AB63E79848A23F85F19A7D4632D737EBD3DDE853E7CAB77EB2A8EB0DD`.
- Main-vault installed-bundle SHA-256 after copying the candidate: `F416A8AA18759871E21BB9AE27F7F6C8DB5F9BF6AB256AD921755AD392915C8D`.
- Full previous plugin folder, including `data.json`: `dist/installed-backups/main-vault-citizen-0.7.7-before-0.7.8-20261016-203404`.
- The installed `data.json` hash remains `380DBEACB957AC673B4503B3BCB41FAC4B6E7563C90CA483E443668143F0BC72`.

The candidate files were copied while Obsidian was running. That process still has the old plugin bundle loaded until Citizen is reloaded. No graph files or note data are included in the profile output.

## Native run still required

After reloading Citizen in the main vault, run **Capture standing performance**, **Capture looking performance**, **Capture walking performance**, and **Capture combat performance** from the command palette while docked at the large node. Each profile warms up for 5 seconds, records 15 seconds, and downloads aggregate frame/subsystem timing, render counters, graph and geometry counts, planet radius, settings, and the installed bundle hash.

Compare matched before/after captures. The acceptance targets remain sustained 60 FPS, p95 frame time at or below 20 ms, p99 at or below 33 ms, and no recurring post-warm-up terrain-preparation stalls over 50 ms. The preview's live appearance, main-vault reload/redock, and those native metrics have not been visually or interactively verified in this run.
