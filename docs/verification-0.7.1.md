# Obsidian Citizen 0.7.1: visible relief and moving-cover correction

## Report and findings

The user reported no visible terrain change and stationary walls after 0.7.0. Disk verification confirmed that Testing contained the packaged 0.7.0 bundle; it does not establish which bundle Obsidian had loaded in memory. Saved graph motion was `calm` and was left unchanged.

Code reproduction found weak terrain relief and blockers in linked-wall tracking. Sampled 0.7.0 small planets had maximum slopes around 6–7 degrees. The six-unit flat pole pad blended over another twelve units, leaving the initial traversal visually very gentle. The new extra ruin components were deliberately static; they are separate from the twelve file-linked moving walls.

Moving walls chased raw file bearings even when those bearings fell inside permanently protected meridian/equator passages. Initial placement moved walls off those passages, then movement directed them straight back into a forbidden region. On meeting a route or permanent ruin, movement simply stopped. Initial placement also used great-circle ruin separation while movement used chord distance, causing a stricter overlap test after placement.

## Corrections

- Shorter, stronger landforms remain within the existing −0.8 to +1.6 surface-unit bounds. Pole pads retain six units of flat ground; their transition now completes after eight additional units. Hills and depressions are real geometry and collision changes, not just material paint.
- In 1,000 small-planet seeds sampled at 512 directions each, minimum total relief exceeds 1.6 units; the measured largest slope is about 19.6 degrees. Existing larger-radius slope, physics, ray and rendered-triangle accuracy tests remain in place.
- Linked-wall targets are projected to a reachable position on the wall's side of protected routes. Walls can steer around permanent structures using deterministic local steering with heading continuity. They still stop for players, other moving walls, resources and unsafe placements. They do not gain independent orbiting motion when the linked graph is still.
- Terrain/static-clearance tests use the same great-circle metric as initial placement. Permanent ruins remain fixed, and file-linked wall count/associations remain unchanged.
- A regression reproducing six linked files with changed directions checks actual movement over ten seconds: all twelve walls move more than 0.25 units and at least ten move more than one unit. Previously two were essentially stuck after one frame. An additional production-path regression feeds moving graph positions through the occupied solo world and renderer frame resolver, checks measurable wall movement, and verifies rendered matrices against physical boxes without rebuilding the arena. Existing tests retain the speed limit, player/lean clearance, physical/render alignment, protected passages, and network pose handling.

## Compatibility and verification

Plugin 0.7.1, terrain generator format 2, room protocol 13, checkpoint format 13. The terrain algorithm changed, so older clients/checkpoints must be rejected rather than mixing different ground in one room. Plugin identity, J117W3 metadata, saved settings, controls, weapon balance, movement speeds and graph-motion setting are preserved.

Type checking, production build and all 233 tests pass. Detailed network and benchmark evidence is in `terrain-combat-latency-0.7.1.json` and `terrain-benchmark-0.7.1.json`. The benchmark remains headless CPU/heap/geometry work, not native GPU frame rate. Maximum-degree generation remains about four seconds. Native rendering and gameplay were not observed.

The build is packaged and installed only after checks, with a full previous-plugin backup and hash verification recorded in `terrain-fix-install-verification.json`. No computer-use tools or automatic restart are used. Reload the plugin and redock to prepare a new terrain visit. All multiplayer participants need 0.7.1. Native acceptance should verify hills beyond the flat pole pad, stable ground collision, and linked-wall movement as linked-node bearings change; permanent ruins should remain fixed.
