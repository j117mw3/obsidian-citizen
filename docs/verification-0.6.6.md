# OB Citizen 0.6.6 verification

Implemented and installed in `<test-vault>`. Plugin ID and J117W3 fork metadata remain intact. The prior plugin folder is backed up at `<checkout>\dist\installed-backups\before-0.6.6-20261016-013845`.

## Gameplay

- Crouch is hold-only, default Left Control. Settings schema 5 changes legacy toggle preferences to hold; custom keys remain. Releasing crouch still respects the existing overhead clearance check.
- Hold right mouse for 1 second, then release: 50 damage and 55 heat. Early release cancels without damage or heat. Charging blocks normal fire and pauses cooling; two rapid charged shots force the unchanged two-second vent. Existing normal shots remain 10 damage, 7 heat and 5 shots per second.
- A charge percentage, growing muzzle energy, stronger recoil and a wider bolt distinguish charged fire. Holding longer than 5 seconds cancels. Blur, pointer-lock loss, leaving the arena, death/life change and host migration cancel unfinished charges.
- Host timing determines charge eligibility. Start, charged release and cancel use ordered reliable messages. Accepted-release retries reuse cached dispositions. Client fields never supply damage or heat. Existing projectile speed, range, spread, cover blocking, armor and bounded rewind remain shared with regular shots.
- Snapshot/checkpoint projectiles carry validated shot kind. Unfinished charge clocks do not transfer. Outer room protocol and checkpoint format are 10; old rooms/checkpoints are explicitly rejected. Immutable geometry encoding remains unchanged.

## Automated evidence

- `npm.cmd run typecheck`: passed.
- `npm.cmd test`: 203 passed, 0 failed; log `dist/verification-0.6.6-tests.tap`.
- `npm.cmd run build`: passed.
- Regressions cover legacy settings migration/idempotence, held crouch release and browser shortcut suppression; host charge time, partial/cancelled/expired/dead/old-life charges, primary-fire lock and second-charge vent; host and solo 50 damage, armor-first damage and exactly-once hit feedback; live-projectile transfer and malformed-kind rejection; reliable message ordering, stale epochs, release deduplication and privacy markers. Existing moving-center, geometry, visibility, normal combat and rewind tests remain passing.
- The initial run retained one obsolete toggle expectation; updated it for hold-only behavior. Two new checkpoint tests initially used the wrong API name; corrected them to exercise the production checkpoint API. No test failures remain.
- Package contains exactly main.js, manifest.json and styles.css. ZIP contents match source release files. Installed files were read back and matched by SHA-256. Known local path and Smoke fixture markers are absent from the distributed files; required attribution remains present.
- `data.json` was unchanged during installation. Schema 5 migration occurs when the plugin loads.

## Artifacts

- Package: `<checkout>\dist\obsidian-citizen-0.6.6-charged-shots\obsidian-citizen-0.6.6-charged-shots.zip`
- Bundle SHA-256: `785353729A5FE4245DC51FB1131C847CF4DE005265F7F3A1CAE3D34C4F0B6D48`
- ZIP SHA-256: `0D2F855C0C01714DFC2762DA25585DBA8647C8F454E155B163F091AEC9F59D64`
- Full checksums and installation record: `docs/charged-shot-install-verification.json`.

## Verification limits and user acceptance

No computer-use tools, automatic restart, or public release were used. No fresh cross-computer WebRTC or impaired-network gameplay run was performed; transport ordering was tested in process. Native controls, muzzle presentation and timing remain user acceptance after reload. All room participants must use 0.6.6.

After reloading, hold/release Left Control; then hold right mouse until CHARGED and release against a patrol. Two unarmored hits kill; two quick charged shots force steam venting and prevent further firing. Release before ready to cancel. Check that releasing Ctrl stands when there is overhead clearance and does not latch crouch.
