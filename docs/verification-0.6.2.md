# Obsidian Citizen 0.6.2 verification

Implemented, packaged and installed in `<test-vault>\.obsidian\plugins\constellation-graph`. This is a local testing candidate. Protocol and room checkpoint format remain 9. No public release, native restart, computer-use session or native visual acceptance was performed.

## Controls and heat

Crouch defaults to `ControlLeft`. Settings schema 4 migrates an older `KeyC` default once, retaining other custom bindings and hold/toggle mode. Binding sanitization keeps actions unique; an already configured custom action on Left Control takes precedence and crouch receives a safe fallback shown in settings/HUD. Migration is saved on next plugin load. Installation itself leaves `data.json` unchanged.

The input handler now admits captured Ctrl+movement combinations and suppresses other captured Ctrl shortcuts. Previously it returned early for Ctrl-modified input, which would have prevented the new default from working correctly. Help, labels and settings placeholders use Left Control.

The shared `SURFACE_BLASTER.heatPerShot` is 7 and the authoritative world consumes that constant. Firing rate, damage, movement, cooling and vent duration are unchanged. Shots 10 and 14 reach 70 and 98 heat without venting; shot 15 fires and starts the two-second vent. Existing 1.8-second unarmored and 2.8-second armored first-hit-to-kill timings are retained, with the armored killing shot now triggering vent. Tests verify the vent deadline and the next seven-heat shot after completion.

## Operative and navigation

Remote avatars and the solo training dummy share a procedural fitted space-operative model: outlined dark suit, six-sided helmet, luminous visor, comms unit, belt pouches, articulated limbs, knee/shoulder plates, gloves, boots and pistol. The dummy adds an amber training target. Custom laser color accents the visor and weapon. Existing movement state drives stride, crouch, lean and aim presentation; authoritative hitboxes and network fields are unchanged. First-person glove, knuckle panel, slide and sight use the same visual language. Dummy facing now follows its saved forward vector.

Model tests cover named details, standing/crouched bounds, lean poses, color changes, bounded object count and geometry reuse across pose updates. These are source/geometry checks, not a judgment of rendered artistic quality.

Pole navigation uses prominent cyan North and amber South cards, tangent bearings, surface distances, a forward indicator, labeled directional markers and hold-interact progress at exits. Markers remain available beyond the horizon and label behind directions. Exact-pole singularities remain stable. Narrow-pane styles clamp markers inside the viewport and separate the training panel from navigation; high-contrast backgrounds remain available. Tests cover equator bearings, both exact poles, radius scaling, narrow camera aspect, marker bounds and exit progress. Native layout appearance remains unobserved.

## Smoke Hub investigation

The end-to-end test reads the actual six-link Smoke Hub and reciprocal Cover A–F notes in the Testing vault. It passes their resolved-link structure through production graph building, simulation endpoints, solo docking topology, occupied geometry generation, renderer synchronization, instanced transforms and projectile collision.

Result: **6 deduplicated connections, 6 physical walls, 6 rendered instances, 6 distinct source associations**, all with finite surface transforms and wall collision hits. Reciprocal links count once. Local excluded/unresolved counters are tested separately without broadening graph exclusions. A portable equivalent fixture is used only where this local vault is absent.

No connection-count loss was reproduced in that source-level path. The actual user's running-view cause therefore remains unconfirmed; this is not evidence that the horizon alone caused the report. Two presentation risks were addressed: graph fade/filter state could hide the occupied arena group, and visual refresh checked only the geometry seed. The occupied group is now kept visible and geometry revision also triggers rebuilding. Tests reproduce both safeguards, including a revision change with an unchanged seed.

Optional **Wall diagnostics** in the solo training panel shows current topology connections, frozen physical-wall count, rendered instance count, visibility, revisions, local excluded/unresolved counts, and numbered wall bearings/distances. It is off by default and refreshes at most four times per second. For dense arenas it lists the nearest 32 numbered walls while reporting full counts. Connection count can differ from a frozen occupied layout after topology changes; the separate revisions make this visible. Local link diagnostics are captured during graph rebuilds. Note names/paths remain local; anonymous topology serialization selects explicit public fields.

## Validation and rollout

- `npm run typecheck`: passed.
- `npm test`: **179 passed, zero failed**. Evidence: `dist/verification-0.6.2-tests.tap`.
- `npm run build`: passed.
- Existing moving-frame, radius, cover-blocking, combat, privacy, input-replay, late-join, migration and bounded-rewind tests pass.
- Candidate ZIP contains exactly `main.js`, `manifest.json`, `styles.css`; ZIP member hashes match staged and installed files.
- Known local path/fixture markers and source-map references are absent from distributed files. Fork identity and MIT/fflate notices remain present. This is a targeted marker scan, not a general secrets audit.
- The full previously installed plugin folder was backed up before replacement; all three installed file hashes were read back. Saved settings are unchanged on disk until the documented startup migration.

Backup: `<checkout>\dist\installed-backups\before-0.6.2-20261016-003614`.

Candidate: `<checkout>\dist\obsidian-citizen-0.6.2-surface-polish\obsidian-citizen-0.6.2-surface-polish.zip`.

ZIP SHA-256: `D08454FE6BBADF25B4B7A2C56E45000986D83D3EFA0CE3080717BE49513436E3`.

Installed main.js SHA-256: `6748B5DD99D3889DA1A3E107065C527FAA3169CF97E3715904401059E24736BA`.

Installation evidence: [surface-polish-install-verification.json](surface-polish-install-verification.json).

## Native acceptance

Restart/reload Obsidian when ready. Dock onto solo Surface Smoke Hub, confirm Left Control crouches while WASD still moves, inspect the new dummy and weapon, and navigate to both exits using the pole guide. Enable Wall diagnostics to check `6 / 6 / 6` and traverse toward the numbered bearings. Observe whether any wall or arena disappears. Test other players' operative crouch/lean and color accents using matching 0.6.2 builds. Visual appeal, actual HUD fit, six-wall traversal and cross-computer behavior remain user acceptance; no native observation is claimed.
