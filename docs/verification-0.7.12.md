# 0.7.12 local candidate: fresh-room docking revisions

## Reproduced failure and correction

The user reports that the first attempt to dock on their own planet in a fresh room fails with “Dock target changed.” In 0.7.11, the initial room-members callback gives the renderer topology revision 1. `ConstellationApp.startRoom()` then calls `setLocalGraph()` after creation/join, advancing the session to revision 2 without notifying the renderer. Anonymous planet IDs are unchanged, but the host correctly rejects the old revision.

The extended startup regression failed on the pre-fix source with renderer revision 1 versus session revision 2. Logs: `dist/docking-0.7.12-before.log` and `dist/docking-0.7.12-after.log`.

`MultiplayerCallbacks.localTopology?(playerId, topology)` now reports every successful local publication to the application, which forwards it to `renderer.setLocalTopology()`. This covers the post-create/join publication, graph refreshes, and layout republication after a supernova. Initial `onMembers()` synchronization is retained. The redundant graph-refresh setter was removed, and identical owner/topology-object notifications do not regenerate planet geometry.

Generation uses a staged copy of anonymous IDs and the next revision. Generation failure preserves the previous IDs, revision and topology without notifying the renderer. Once committed, a later presentation/transport failure does not decrement the revision behind the renderer's publication notification. Strict host revision checks, docking admission, anonymous network IDs, release-F-before-retry and protocol 15 remain unchanged. No automatic stale-request acceptance or retry was added.

## Validation

- The startup integration regression now invokes the actual `startRoom("create")` post-creation path, checks the published topology object/revision, sends the first docking request through the real session and terrain-enabled authority, observes surface-controller entry from an authoritative snapshot, and returns to the ship through pole input. Initial room/transport setup is represented by fixtures; GPU/audio/DOM effects are stubbed. This is integration evidence, not a native UI result.
- Additional cases exercise `startRoom("join")`, repeated graph publication, supernova's layout-republication method, leave/rejoin with new anonymous IDs, duplicate notification suppression, generation failure, and errors after publication.
- A host republishing from revision 1 to 2 rejects revision 1 and accepts revision 2. Existing guest reliable-lane, timeout, host-transfer, admission and retry tests remain enabled.
- `npm test` initially passed 264 of 265 tests and reproduced the previously documented Worker startup failure, `SQLITE_READONLY`. The existing verification-only isolated Worker preload avoids modifying the checkout's previous Worker database. After adding the explicit prior-revision rejection regression, `node --test --import=./dist/worker-isolated-preload.mjs` passed **266 tests, 0 failures**. Logs: `dist/docking-0.7.12-full.log`, `dist/docking-0.7.12-full-isolated.log`, and `dist/docking-0.7.12-full-isolated-final.log`.
- `npm run typecheck`, `npm run lint` (including CSS review), `npm run build`, and `git diff --check` passed.

Sky FPS and the earlier one-off pause have separate acceptance criteria and are not claimed fixed by this docking change. Existing uncommitted changes were preserved.

## Candidate and installation

Only `main.js`, `manifest.json`, and `styles.css` were installed in `T:\AI\ObsidianVault\Obsidian\.obsidian\plugins\citizen`. Source, archive-entry and installed asset hashes were compared. The complete previous plugin directory, including settings, was backed up and every backed-up file was hash checked.

- Candidate: `dist/citizen-0.7.12-local-candidate.zip`, exactly three release members.
- ZIP SHA-256: `E67FDB5A39ADB7489EFC51BCF3F905EAD62ABB5B95A1FA31C537B2A5358D0F5E`.
- Installed bundle SHA-256: `FE93BFC86B3C026F393E3D134453B9664FD73FE73B6E131BF0B5965518DA5B8B`.
- Backup: `dist/installed-backups/main-vault-before-0.7.12-20261017-abd09aca`.
- Settings unchanged, SHA-256 `B693C97B5000C1ABB4BEC17F1B6499E96973920909C7946613D7C86BFAD1B558`.
- Full installation metadata: `dist/citizen-0.7.12-local-install.json`.

Nothing was published remotely.

## Native acceptance boundary

Computer Use located the main-vault Citizen window. State capture failed with `FrameArrived timed out: timed out waiting on channel`; refreshed-window selection and the required retry failed with `window capture timed out: timed out waiting on channel`. Native input stopped under the skill's recovery instruction to refresh selection and retry once. No native reload or docking success is claimed.

**Reload Citizen or restart Obsidian to load 0.7.12.** The remaining native check is: create a fresh room, enter flight, aim at the host's own main sphere within the existing range/speed limits, hold F once, and observe authoritative surface entry without the target-changed rejection. Guest/two-computer native acceptance also remains pending.
