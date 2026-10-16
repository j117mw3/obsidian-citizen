# Obsidian Citizen 0.6.4: surface detail and combat feedback

Installed local testing candidate in `<test-vault>\.obsidian\plugins\constellation-graph`. Room/checkpoint protocol remain 9. Saved settings, movement, collision, weapon balance and occupied layout generation are unchanged. No public release, computer-use session or automatic restart was performed.

## Removed diagnostics

Removed the Wall diagnostics checkbox, overlay, counters, numbered bearings, renderer callback and supporting local graph-diagnostics fields. Graph exclusions and the six-file Smoke Hub regression remain. Current README/help no longer instruct users to enable diagnostics. Bundle checks confirm the old option/overlay strings are absent. Historical verification documents remain as history.

## Cosmetic surface detail

The existing opaque planet sphere now uses deterministic, seed-derived panel paint with subtle circuit traces, dashed cyan/amber meridians toward the North/South pole exits and exit-area rings. It uses the same sphere vertices and opaque depth writes; there is no displacement, obstacle, collider, geometry-transfer field or extra draw call. Panel size stays in surface units as the planet radius grows. The existing beacons, compass and paths remain separate from the physical cover layout.

Shader tests check deterministic seed/radius uniforms, opacity, depth writes and unchanged vertex positions. The build does not establish GPU compilation or artistic appearance in Obsidian; no native or headless GPU rendering was observed.

## Names and red health bars

Same-arena opponents show their existing public roster display name with a small red 0–100 HP bar directly underneath. The training dummy uses the same presentation with the name Training dummy. Armor remains a separate gameplay resource; the red bar reports HP only, so armor-only damage can confirm a hit without lowering it.

Every rendered frame uses the interpolated displayed target pose, current displayed moving arena center and current camera. The target's head/eye must be in view and its camera segment must clear the opaque planet and physical wall geometry before either name or health bar is created/displayed. This is a visibility test to the character's head, not to the label floating above a wall. Standing heads visible above low cover may show a name; crouched heads blocked by that cover do not. Far-hemisphere rejection precedes wall-grid queries to avoid large empty-space searches on dense planets.

Authoritative existing HP snapshots supply bar values; there is no client health prediction and no new wire data. Names use textContent, with no HTML interpretation. Labels are removed immediately when occluded, dead, outside the current arena/view, or absent. Local/dead viewers do not receive active surface labels. Enter/leave, room clear and renderer disposal clean up label elements.

## Confirmed-hit feedback

Solo dummy hits previously changed health but never requested a hit marker. Actual dummy damage now requests a deduplicated character-hit marker and hit cue. Multiplayer continues to use only host-confirmed positive damage events, including damage absorbed by armor. The marker is a clear centered white four-corner cross, with a 450 ms event lifetime instead of the prior small offset/short marker. Delayed confirmations retain the remaining lifetime and repeated snapshots cannot restart it.

Walls, the planet, misses, shot acceptance and predicted bolts never trigger character-hit feedback. Ordinary world impact effects/sounds remain separate. Death/protection/cover authority and weapon timing are unchanged.

## Verification

- `npm run typecheck`: passed.
- `npm test`: **188 passed, zero failed**; TAP evidence: `dist/verification-0.6.4-tests.tap`.
- `npm run build`: passed.
- New regressions cover head visibility through tall/low cover, crouching, curved ground, translated displayed centers, far-hemisphere early rejection, live HP fractions, safe name text, immediate occlusion/death/removal cleanup, same-arena roster names and interpolated states, solo confirmed damage, no hit markers for wall/floor impacts, duplicate confirmation suppression and deterministic cosmetic material properties.
- Existing combat, heat, cover blocking, privacy, pole navigation, graph/arena motion, geometry transport, rewind and migration tests pass. The Smoke Hub graph-to-six-instance regression remains intact.
- ZIP contains exactly main.js, manifest.json and styles.css. Extracted hashes match staged and installed files. Known local path/fixture markers and source-map references are absent; J117W3 and MIT/fflate notices remain. The targeted marker scan is not a general secrets audit.

## Rollout

Previous installed version: `0.6.3`.

Full plugin-folder backup: `<checkout>\dist\installed-backups\before-0.6.4-20261016-010001`.

Candidate: `<checkout>\dist\obsidian-citizen-0.6.4-surface-feedback\obsidian-citizen-0.6.4-surface-feedback.zip`.

ZIP SHA-256: `E3BE9326982BE5954C5069D6F65155D67AE62AFA1854CA7CB188F5CDDF11D234`.

Installed main.js SHA-256: `6F42B22BF6F827603CD9014D0F59B61059879CBA5BE2BF31350375B0973EE2A2`.

Installed hashes were read back; data.json stayed unchanged. Machine-readable evidence: [surface-feedback-install-verification.json](surface-feedback-install-verification.json).

## User acceptance

Reload/restart when ready. Dock in solo and inspect panel paint, circuit detail and pole routes. Confirm diagnostics are gone. Approach the dummy: its name and red HP bar should appear only when its head is visible. Fire at it, walls, the floor and empty space; only actual dummy hits should give the centered character-hit marker. Test the armored dummy too: the marker should appear while its HP bar stays full until armor is depleted.

With another pilot, test public names, HP reduction, crouch/lean peeking and disappearance behind tall walls, low cover and the horizon. Confirm no name/bar remains after death, departure or undocking. Native visibility, HUD readability, new shader appearance and cross-computer behavior remain user acceptance, not automated observations.
