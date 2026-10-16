# OB Citizen 0.6.8 verification

Installed in `<test-vault>`. Previous version: 0.6.7. Backup: `<checkout>\dist\installed-backups\before-0.6.8-20261016-022121`. Plugin ID, J117W3 fork metadata and saved settings were preserved.

## Behavior

- Exactly two separated walls per unique eligible linked file. Incoming/outgoing reciprocity counts once; self-links do not count. Six Smoke Hub files now produce twelve physical and rendered walls with two anonymous associations per file. Existing graph exclusions and sharing scope are unchanged.
- While occupied, walls glide toward their linked files' live graph bearings on the sphere, with safe paired offsets, at 0.8 surface units per second. This deliberately supersedes the earlier occupied-cover freeze. Exit/pickup clearances, spacing and standing/crouched/leaning player checks can pause a wall when its path is blocked. Walls remain indestructible and block both movement and laser traces.
- Radius remains `27 * sqrt(max(1, uniqueConnections / 16))`; connection membership, radius, pickup layout and pickup timers stay fixed during an occupied visit. Graph translation still uses one displayed center per rendered frame and does not alter an idle player's altitude or gravity state. Later visits preserve consumed-pickup timers.
- Solid wall instances and their wire outlines update in place. Existing collision grids update moved entries incrementally. The planet, pickups and full GPU geometry are not reconstructed per frame.
- Deterministic mineral scree adds low-profile, walk-over ground detail. It uses one bounded instanced batch, remains below the step allowance, and is cosmetic rather than additional combat cover.
- The host owns moving-wall collision. Compact nearby wall poses are published separately from acknowledged immutable geometry; distant cover presentation is predicted from existing anonymous graph positions. Nearby correction uses the same wall array for rendering and client collision. Pose payloads contain arena IDs, numeric indices and normals, with a global 2,048-row interest budget rather than a wall-count cap.
- Checkpoints retain current wall poses, associations and pickup timers. Geometry transfer uses the existing six-decimal normal/tangent precision; at the maximum supported radius, the regression verifies less than 0.001 surface units of position error after movement/restore. Repeated geometry definitions are deduplicated within a transfer. Geometry remains bounded to 4 MiB, chunks to 16 KiB and checkpoints to 32 MiB.
- Plugin 0.6.8, room protocol 11 and outer checkpoint format 11. Older rooms/checkpoints are explicitly rejected. Settings schema 5, weapon balance, movement speeds, character models, charge feedback and pole navigation remain unchanged.

## Verification

- Type checking: passed.
- Full suite: **215 passed, 0 failed** (`dist/verification-0.6.8-tests.tap`).
- Production build: passed.
- New focused moving-cover suite: nine passing tests (`dist/verification-0.6.8-motion.tap`). Covers paired directional drift, bounded speed, radial placement, blocked player/leaned upper body, poles and pickups, live spatial-index updates, solid/outline agreement, host/replica geometry identity, timers and migration, malformed pose rejection, deterministic mineral instances, delayed 200 ms RTT plus jitter with less than 0.25 units of disagreement, transfer-definition validation, and moved maximum-degree transfer precision/size.
- Existing regressions exercise degree counts 0, 1, 2, 6, 16, 17, 1,000 and 19,999 (up to 39,998 walls), reliable chunks, bounded checkpoints, late join, migration, normal/charged combat, fixed-cover rewind, actual damage, privacy, moving centers and frame rates. The real Testing-vault Smoke fixture flows through graph building, simulation, docking and instanced rendering and proves twelve walls with six paired associations.
- Earlier failures identified old one-wall assertions, latency fixtures with unpaired anonymous associations, and repeated dense geometry exceeding an aggregate transfer bound. Updated the assertions/fixtures and deduplicated repeated geometry. Focused-test fixture issues were corrected without weakening production validation. No failures remain.

## Package and installation

Package: `<checkout>\dist\obsidian-citizen-0.6.8-moving-cover\obsidian-citizen-0.6.8-moving-cover.zip`

- Bundle SHA-256: `BB2B79A699BA27FB396508F6D496CF0C7F14136DF05D6F46FD0D79FA3E28FC51`
- ZIP SHA-256: `802FF40F0F54A4E41BD967B4A0A1EBD6E07F53CC5209DA2AEBFC37FB84CC0999`
- ZIP contains exactly main.js, manifest.json and styles.css. All ZIP members and installed files were checked against the production-file hashes. Known local paths and Smoke fixture markers are absent from distributed files; required attribution remains present.
- The complete installed plugin folder was copied to the backup before updating the three release files. `data.json` was unchanged during installation. Full evidence: `docs/moving-cover-install-verification.json`.

## Verification limits and native acceptance

No computer-use tools, automatic restart or public release were used. No fresh cross-computer WebRTC gameplay session or native visual/FPS observation was performed. The 200 ms test is a deterministic pose-replication check, not a new 500-shot moving-cover fairness benchmark. Maximum-degree transfer/collision/render structure tests do not prove native frame-rate performance with every wall moving.

After reload, dock on Surface Smoke Hub: traverse the sphere to find twelve walls, see paired cover follow linked-file directions as graph positions change, confirm the ground/camera remain stable, and verify walls wait for standing/crouched/leaning players without blocking exits or pickup access. Check that normal and charged bolts stop at moving cover, and that the low mineral ground detail remains easy to walk over. Everyone in a multiplayer room must update to 0.6.8.
