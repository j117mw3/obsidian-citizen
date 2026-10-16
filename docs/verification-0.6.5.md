# Obsidian Citizen 0.6.5: vent lock and wandering patrols

Installed local testing candidate in `<test-vault>\.obsidian\plugins\constellation-graph`. Room/checkpoint remain 9; settings, player movement, weapon balance and cover generation are unchanged. No public release, computer-use session or automatic restart was performed.

## Vent lock and steam

The authoritative world already rejected shots during venting. The first-person fire method did not check the vent deadline before playing sound, recoil and muzzle effects, which could appear to keep firing despite rejected damage. It now refuses firing while host-time ventUntil is active or heat remains full pending authoritative cooling. The multiplayer renderer also refuses shot requests/predicted bolts from a known venting/full-heat local view.

The threshold shot still fires normally, starting the existing two-second vent. During venting the muzzle flash is suppressed, no further local firing effects or callbacks occur, and a fixed 12-puff weapon-local steam effect rises from the receiver. Steam follows host deadlines, fades at the end, hides on death/exit, and is disposed with the viewmodel. It adds no network state. Holding the trigger resumes firing after authoritative cooling; no release/repress is required. Seven heat per shot, damage, cadence, cooling and vent duration remain unchanged.

## Four passive solo patrols

The single stationary dummy is replaced with four independently named, damageable operatives:

- North patrol: a cap near the North pole, avoiding the exit zone.
- South patrol: the equivalent South cap.
- East patrol and West patrol: separate broad regions in opposite hemispheres.

Pole patrol goals stay more than four surface units from either pole, with a cap radius up to twelve units. Hemisphere patrols stay within 1.15 radians of their opposite home axes, maintaining separate hemispheres as arenas grow. Initial capsules are checked against cover; spawn attempts also keep the four dummies apart.

Movement uses deterministic arena-seeded wandering goals and the existing spherical physics at a fixed 60 Hz. Dummies walk at approximately 2.16 surface units/second, pause briefly at destinations, turn in place for sharp changes, check prospective capsule clearance at three lookahead distances, steer among clear headings and repath after lack of progress. Existing swept wall collision remains the final physical guard. Large maps use the existing static cover index. No navigation or AI payloads are added to multiplayer, and dummies do not shoot, consume pickups or affect player scoring.

Displayed model position/orientation and gait follow the current state and shared moving arena center. Every living patrol is included in solo projectile traces and line-of-sight name/HP presentation. Damage and the two-second respawn timer are independent per dummy; armor choice and **Reset all dummies** affect all four and persist for later solo docking within the current view. Undocking/disposal clears all models and patrol state.

## Additional surface detail

Opaque panel paint gains larger technical sector rings and striped trim to break up open ground. The change remains cosmetic: identical sphere positions, floor collision, wall counts, pickup placement and pole interactions. Moving patrols also add activity without inventing extra linked-file walls.

## Verification

- `npm run typecheck`: passed.
- `npm test`: **196 passed, zero failed**; TAP evidence: `dist/verification-0.6.5-tests.tap`.
- `npm run build`: passed.
- Vent regression fires the threshold shot, then repeatedly attempts to fire during the vent and with stale full heat. It verifies one request/blaster sound, no renewed recoil/muzzle effects, and resumed firing after cooled authoritative state. Existing host vent/heat tests pass.
- Steam tests cover fixed particle count, bounded fades, movement and visibility against host deadlines.
- Patrol tests cover deterministic state, four regions, pole exclusion, radius/clear capsule invariants through twenty simulated seconds on 0/6/17-link arenas, turning away from a directly blocking wall over thirty simulated seconds, and dense 1,000-wall cover.
- Renderer tests verify four distinct IDs/names, independent health/respawn, reset-all armor, teardown, moving-center translation, identical body states at 30/144 rendered FPS, and confirmed damage/feedback for each actual moving patrol.
- Existing line-of-sight labels, wall/floor no-hit feedback, combat, privacy, moving planets, pole navigation, geometry transport, rewind and migration regressions pass.
- These tests inspect source behavior, geometry and timing. Native patrol appearance, steam GPU rendering, prolonged in-game avoidance and surface artistic quality remain user observation.
- ZIP contains exactly main.js, manifest.json and styles.css; extracted hashes match staged and installed files. Known private path/fixture markers and source-map references are absent; J117W3 and MIT/fflate notices remain. This targeted marker scan is not a general secrets audit.

## Rollout

Previous installed version: `0.6.4`.

Full plugin-folder backup: `<checkout>\dist\installed-backups\before-0.6.5-20261016-011455`.

Candidate: `<checkout>\dist\obsidian-citizen-0.6.5-vent-and-patrols\obsidian-citizen-0.6.5-vent-and-patrols.zip`.

ZIP SHA-256: `7293B18AFCE37C9AE7807E739B364A1D1566FEC894269419CEFCE0625B8A3020`.

Installed main.js SHA-256: `1CBE758B2CDBCBAC7C42B6C359F72BB43EE1889DCDD3A76E4E69CF386E7BCA24`.

Installed hashes were read back; data.json stayed unchanged. Machine-readable record: [vent-patrol-install-verification.json](vent-patrol-install-verification.json).

## User acceptance

Reload when ready. Hold fire until the fifteenth shot starts venting: firing should stop, steam should appear, and holding fire should resume only after cooling. Repeat in a room using the current candidate. In solo, find both pole patrols and the opposite-hemisphere patrols, watch walking/turning near walls, shoot each, and try the 150-HP/armor option and Reset all dummies. Check death/respawn, health bars, pole access, surface motion and the larger sector markings. No native gameplay observation was performed by the tools.
