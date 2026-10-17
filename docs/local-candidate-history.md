# Unpublished candidate numbering

Candidates 0.7.8 through 0.7.14 were local development packages, never separate public releases. At the maintainer's request, their combined changes ship publicly as **0.7.8**, immediately after 0.7.7. Historical verification documents and ignored backup packages retain their original candidate numbers and hashes; these are evidence labels, not public release versions. The combined source before renumbering is commit 40182202f7c734693d1e1b9aa6e8d4147e202d2c.

## 0.7.14 — departure clearance and collision recovery (local candidate)

- Refresh paused flight collision data before solo undocking, using current node positions and actual neighbouring planet radii.
- Leave enough clearance for the ship at pole departures and recover exact-center overlaps without requiring movement input, in both solo and authoritative/predicted room collision handling.
- Cover both poles, moving large neighbours, forced and held-key departures, and idle collision recovery. Keep ordinary flight controls and multiplayer protocol 15.

## 0.7.13 — one multiplayer planet per hub (local candidate)

- Reuse the anonymous multiplayer hub identity when applying authoritative planet geometry, terrain sampling, frame positioning, occupied detail protection and flight collision radii. Docking synchronization replaces the existing planet instead of adding a second copy under its private note ID.
- Keep private IDs for local simulation envelopes and solo planets. Preserve graph motion, linked-wall movement, shared surface frames and protocol 15.
- Verify single-mesh scene ownership across repeated snapshots, cover movement, geometry replacement, topology republication and leave/rejoin, including resource disposal and distinct private/anonymous IDs.

## 0.7.12 — fresh-room docking revision synchronization (local candidate)

- Notify the renderer whenever the local anonymous topology is published, including the publication immediately after room creation/join and later layout republication. First docking no longer submits the renderer's previous revision against the session's new revision.
- Preserve committed publication revisions after presentation/transport errors, and leave topology and ID state unchanged when generation fails. Skip duplicate planet rebuilds for unchanged topology objects.
- Exercise the complete room-start path through authoritative surface entry and return, plus join, graph refresh, layout republication, leave/rejoin and stale-target rejection. Keep protocol 15 and existing admission checks.

## 0.7.11 — multiplayer planet docking (local candidate)

- Rebuild planet visuals when entering a room so docking targets use the room's anonymous IDs. Previously the initial lobby retained solo note IDs and rejected docking before sending a request.
- Show target, readiness, connection and admission failures in the docking HUD. Track acceptance through the surface update, time out incomplete requests after five seconds, ignore outdated results, and cancel requests on room or host changes.
- Add host-only room entry, docking, first-person transition and pole-return integration coverage, plus guest transport and failure/retry regressions. Preserve multiplayer protocol 15.

## 0.7.10 — surface pointer-lock ownership (local candidate)

- Keep graph orbit controls disabled after the mouse-look click is released or pointer capture is cancelled while walking. Right-click charge input and mouse movement remain owned by the surface controller, avoiding an OrbitControls `setPointerCapture` exception under pointer lock.
- Add a real pointer-lock/right-button/mouse-movement/charged-release browser regression. Retain the 0.7.9 bounded sky queries and multiplayer protocol 15.

## 0.7.9 — bounded sky occlusion (local candidate)

- Clip presentation visibility rays to conservative planet/cover bounds and traverse wall-grid cells along the segment. Distant sky nodes no longer expand a query into a multi-million-cell bounding box.
- Preserve terrain, ruin and moving-wall occlusion while leaving projectile/authority queries unchanged.
- Add sky, horizon, floor and independent all-label, graph, distant-detail and bloom diagnostic captures. Include bounded-query counters, complete world/viewmodel render counters and asynchronous GPU timings where supported.
- Cull entire off-screen planet groups, including their uncullable wall outlines. Prepare small distant-planet proxies with 32/48-pixel LOD hysteresis; enable LOD for a renderer session only after stable matched sky/detail-bypass captures show at least a 15% and 1 ms rendering gain.
- Make the preview create actual multiple groups/main planets and add reproducible view poses plus an isolated headless benchmark. Keep multiplayer protocol 15 and existing terrain definitions unchanged.

## 0.7.8 — physical terrain and planet performance

- Generate rolling hills and shallow, walkable crater bowls for new planets; retain version 2 terrain for stored arenas.
- Incrementally build detail meshes, skip flight collision-grid work while walking, and cull off-screen labels before terrain occlusion tests.
- Add local 20-second standing, looking, walking, and combat profiles with a 5-second warm-up; exports include aggregate graph counts and the installed bundle hash but no note data.
- Advance multiplayer room and combat checkpoint protocol to 15 so incompatible clients cannot silently share different terrain.
- Include configurable graph-size, hub-degree, animation, and bloom controls in the browser preview.

