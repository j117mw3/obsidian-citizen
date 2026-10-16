# Obsidian Citizen 0.6.3: opaque surface visibility

Installed local testing candidate in `<test-vault>\.obsidian\plugins\constellation-graph`. Protocol/checkpoint remain 9. Gameplay and settings are unchanged. No public release, computer-use session or automatic Obsidian restart was performed.

## Cause and fix

The opaque planet already writes scene depth, but the local graph ShaderMaterial and link LineBasicMaterial explicitly disabled depth testing. Remote star sprites and some world navigation/flight effects also used overlay-style depth settings. Consequently those objects could draw over the planet even while physically underneath it. Projectile floor collision is independent and was already functioning.

The surface world draw now temporarily enables depth testing on visible scene materials that previously disabled it, without changing their blending or depth-write flags. The opaque planet and cover then occlude graph stars, links and world effects naturally, while unobstructed exterior objects remain visible. This scope includes the entire composer/bloom draw and restores original material flags in a finally block, including on render failure. Ordinary map/flight rendering retains its prior style. This walks scene objects, not graph files or wall instances, and neither rebuilds geometry nor changes simulation state.

The separate first-person viewmodel pass retains its intentional depth reset and runs after the world pass. Intentional HUD navigation markers, including beyond-horizon pole directions, remain available. DOM graph labels and ship indicators are skipped when their camera segment crosses a known arena sphere, using displayed moving centers and each arena's radius. DOM sphere rejection does not constitute a general pixel-perfect cover visibility query; actual world geometry uses the scene depth buffer.

## Verification

- `npm run typecheck`: passed.
- `npm test`: **181 passed, zero failed**; TAP evidence: `dist/verification-0.6.3-tests.tap`.
- `npm run build`: passed.
- Added regressions check local/remote sprites, shared link materials and navigation-marker depth flags during direct and multiple bloom-style world draws. Original flags and depth-write behavior are restored afterward and on failure; non-surface draws are unaffected.
- Added camera-to-sphere visibility regressions for the original buried node, the far side, unobstructed sky/tangent directions, both poles, multiple radii and translated displayed centers. Surface-only DOM rejection is covered.
- Existing viewmodel-depth restoration, moving-planet stability, combat, graph privacy, wall generation, migration and input tests pass.
- Tests inspect render-pass/material state and geometric visibility. No native or headless GPU pixels were captured, so native floor/horizon appearance still requires user observation.
- Candidate ZIP contains exactly the three plugin release files; decompressed member hashes match staged and installed files. Known local path/fixture markers and source-map references are absent. Fork and MIT/fflate notices remain present. This is a targeted marker scan, not a general secrets audit.

## Rollout

Previous installed version: `0.6.2`.

Full plugin-folder backup: `<checkout>\dist\installed-backups\before-0.6.3-20261016-004204`.

Candidate: `<checkout>\dist\obsidian-citizen-0.6.3-surface-occlusion\obsidian-citizen-0.6.3-surface-occlusion.zip`.

ZIP SHA-256: `2CF9DF6C7C27DF0A4D3FA1885BFE38C0846F7D47F44905DC956D1EDF65AFD50A`.

Installed main.js SHA-256: `EA04814416CD026CDED2229BA71D0EA5682B17AB614BA01055F247E4545C97F4`.

`data.json` remained unchanged during installation. Installed file hashes were read back. Machine-readable record: [surface-occlusion-install-verification.json](surface-occlusion-install-verification.json).

## User acceptance

Restart/reload the plugin, dock on Smoke Hub, then look downward, across the horizon and upward. The original node and links below the floor should be hidden; unobstructed exterior space should remain visible. Walk and jump around the moving planet and check both poles, with bloom on/off if convenient. Confirm the weapon and intentional pole guidance remain visible. Repeat on a remote-owned node when available. These native observations were not performed by the implementation tools.
