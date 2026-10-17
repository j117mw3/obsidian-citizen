# 0.7.13 local candidate: unique multiplayer planet identity

## Reproduction and correction

The user confirmed docking in 0.7.12 and supplied images of overlapping, rapidly moving planet geometry. A scene regression reproduced the underlying duplication: multiplayer creation stored its group under an anonymous hub ID, but authoritative synchronization looked it up under a private simulation note ID and added another group. The pre-fix regression counted **two `surface-planet` meshes for one hub**. A moving-frame regression using distinct private/anonymous IDs also failed. Evidence: `dist/planet-0.7.13-before.log`.

Local multiplayer visual synchronization now uses the arena's anonymous hub ID, matching initial creation. Solo groups retain private local IDs. A private index-to-group helper supplies frame positioning and flight collision radii from the active topology. Occupied terrain lookup resolves that same hub group for geometry sampling and distant-detail protection. Local simulation envelope updates still receive the simulation's private IDs; no new identifiers are transmitted.

Geometry revision/seed changes replace and dispose the existing group under its hub key. Unchanged snapshots retain the same group and displayed terrain geometry. Graph motion, linked-wall movement, shared camera/object frames, authoritative gameplay, public interfaces, terrain definitions and multiplayer protocol 15 are unchanged.

## Verification

- The new duplicate-planet regression fails before the fix with `2 !== 1`, then passes with one mesh, one anonymous scene key, the previous group detached, and all previous geometry/material resources disposed.
- Thirty repeated actual surface snapshots exercise decoded moving-cover targets, graph translations, displayed-frame resolution and occupied terrain preparation. They retain one mesh and stable geometry. Wall instance and outline transforms agree, linked walls continue moving, and simulation envelope updates use private IDs only.
- A changed authoritative geometry revision disposes the previous displayed geometry and still leaves one group; topology republication likewise retains one anonymous planet.
- Three leave/rejoin cycles switch between solo private and multiplayer anonymous keys without retaining old scene copies. Flight radius lookups match each mode and return no planet radius for ordinary nodes.
- Existing moving-frame coverage now deliberately uses different private and anonymous IDs. Across solo/local-room/remote-room ownership, both poles, 90 moving frames and several update rates, camera, weapon, scene coordinates, occupied mesh lookup and displayed center stay aligned. The complete fresh-room docking, authoritative entry and undocking integration remains enabled.
- `node --test --import=./dist/worker-isolated-preload.mjs`: **269 passed, 0 failed**. The documented temporary Worker storage avoids the existing SQLite environment issue without modifying its previous database. Log: `dist/planet-0.7.13-tests.log`.
- `npm run lint`, including CSS review, passed. `npm run build`, including TypeScript checks, passed. `git diff --check` passed.

These are automated scene/integration results. They do not by themselves confirm that all user-visible flickering is resolved, nor establish native FPS acceptance.

## Package and installation

Only `main.js`, `manifest.json` and `styles.css` were copied into `T:\AI\ObsidianVault\Obsidian\.obsidian\plugins\citizen`. Each installed asset and ZIP entry was hash checked. The complete previous plugin folder was backed up and its files compared by hash; settings were preserved.

- Candidate: `dist/citizen-0.7.13-local-candidate.zip`, exactly three release members.
- ZIP SHA-256: `344D5BCEC26D2C561FC8F5FFFE2431753C972C8E111ED85A7B55D348559FBB10`.
- Installed bundle SHA-256: `C036BF807208CCDF1BE53413C787C4E619AF4A5799DB1C08D2FD519D9398F242`.
- Prior version: 0.7.12, bundle SHA-256 `FE93BFC86B3C026F393E3D134453B9664FD73FE73B6E131BF0B5965518DA5B8B`.
- Full backup: `dist/installed-backups/main-vault-before-0.7.13-20261017-a09ed600`.
- Settings unchanged at SHA-256 `B693C97B5000C1ABB4BEC17F1B6499E96973920909C7946613D7C86BFAD1B558`.
- Installation metadata: `dist/citizen-0.7.13-local-install.json`.

Existing uncommitted work was preserved. Nothing was published remotely.

## Native visual acceptance

Computer Use found the main-vault Obsidian window minimized. After activating it and refreshing the window, accessibility-only state inspection succeeded. The user then stopped Computer Use with the physical Escape key as the command-palette action was attempted. No further Computer Use calls were made. Reload and visual acceptance were not completed or claimed.

**Reload Citizen or restart Obsidian to load 0.7.13.** Native acceptance remains: dock, then stand, look around and walk on the occupied planet with graph motion enabled; observe moving walls and check that intersecting/flickering duplicate surfaces are absent. Also check docking/undocking and a remote player's planet. Sky FPS remains a separate acceptance item.
