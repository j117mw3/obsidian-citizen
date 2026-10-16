# Changelog

## Publication history

Versions **0.5.1 through 0.7.5** are published as individual [GitHub releases](https://github.com/j117mw3/obsidian-citizen/releases), each with its own version tag, plugin files, ZIP, checksums, and update notes. Recovered 0.5.1–0.7.1 packages retain the `constellation-graph` ID. Their tags preserve recovered release files because matching historical TypeScript source snapshots were not saved. Existing 0.3.x releases and the superseded 0.5.0 draft are retained. Version 0.7.2 begins the independent `citizen` plugin identity; manual settings migration is described in the README. The patrol-grounding fix was initially tested as a local 0.7.2.1 package; its public release is 0.7.3 to use Obsidian's required three-part version format.

## 0.7.6 — Citizen review compliance

- Adopt Citizen as the current display name; preserve the citizen ID, settings, room and checkpoint protocol 14.
- Resolve typed-code, DOM-helper, timer, audio-deprecation, and CSS review warnings, including browser fixtures.
- Add repeatable lint checks and validated JSON/statistics boundaries.
- Release only the three supported plugin assets, with provenance attestations; retain ZIP/checksums as workflow artifacts.
- Retain the local note graph and user-triggered room-code copying, with explicit behavior disclosures.

## 0.7.5 — directory review corrections

- Publish the source corrections previously checked with directory branch previews.
- Move the player-indicator arrow reset into CSS and preserve dynamic offscreen rotation with a CSS custom property.
- Remove the redundant settings introduction heading and use Open graph for the command name.
- Point the author URL at the maintainer's profile and enable repository issues for support.
- Schedule Hangar animation frames on the panel's owning window.
- Keep the citizen plugin ID, settings format, room protocol 14, and checkpoint format 14.

## 0.7.4 — OB Citizen name

- Rename the plugin to **OB Citizen** in its manifest, commands, tab title, settings, messages, build banner, documentation, and release workflow.
- Keep the `citizen` plugin ID, settings format, repository URL, room protocol 14, and checkpoint format 14. Existing Citizen installations update in place.
- Preserve original historical release archives, checksums, and archived manifest metadata. Earlier releases used the former display name.

## 0.7.3 — patrol terrain-grounding hotfix

- Keep interpolated patrol bot positions on the terrain surface instead of flattening them to the planet's base radius. This prevents bots sinking into raised terrain and appearing too high over depressions as they move across latitude.
- Preserve room protocol 14 and checkpoint format 14; authoritative bot and player state is unchanged.
- Add an East Patrol regression across an equatorward terrain-height change. Typecheck, production build, automated tests, network harness, and package integrity are recorded in [0.7.3 verification](docs/verification-0.7.3.md).


## 0.7.2 — shared planet combat and ten-kill rounds

- Add four slow, host-controlled bots per occupied planet in solo and multiplayer. Bots patrol, require line of sight and a one-second acquisition delay before firing inaccurate 10-damage shots, and obey surface terrain and moving cover.
- Attacking a bot makes it pursue its attacker briefly, show red aggression accents, and return to patrol after losing interest. Bot kills never enter player scores or the elimination feed.
- Each defeated bot drops one +30 health pickup. The pickup heals injured players up to 100, remains available to full-health players, and expires after 30 seconds; bots respawn after 15 seconds.
- Show recognizable health-cross and shield pickup silhouettes. Health pickups display +25 and +50 amounts; bot drops display +30.
- Use a shared ten-player-kill round limit across ship and surface combat. Bot eliminations do not count toward the limit.
- Freeze movement, bots, and collection during round transitions. Reset transient combat and resources for the next round while keeping each pilot in space or at the same docked planet position and facing.
- Include bot, projectile, aggression, and drop state in host snapshots and checkpoints. Bump multiplayer room protocol and combat checkpoint format to 14; older builds cannot join these rooms.
- Verification: 237 automated tests, TypeScript check, production build, and network-harness build pass. Native visual/gameplay inspection and two-computer testing remain unverified.

## 0.7.1

- Prepare independent OB Citizen identity, repository, installation instructions, fork credits, and network disclosures for public distribution.

- Strengthen actual terrain relief and shorten pole transition blending while preserving elevation and slope limits.
- Project linked-wall targets out of protected routes, steer around permanent ruins, and unify placement/motion clearance distances.
- Add minimum-relief and measurable blocked-wall movement regressions; preserve static ruins, controls, movement, weapons, and settings.
- Terrain format 2, room/checkpoint protocol 13; mixed older versions are rejected.

## 0.7.0

- Procedural alien terrain with real hills/depressions, flat pole pads, permanent ruin cover, protected routes, and balanced resource approaches.
- Shared terrain collision/visibility for movement, bolts, labels, patrols, resources, and terrain-aware paired moving walls.
- Seeded terrain identity and bounded reliable transfer; room/checkpoint protocol 12 and terrain format 1.
- Local terrain LOD, instanced ruins, three stone/technology palettes, and expanded seed/movement/network verification.
- Headless measurements recorded in the release notes are not native GPU or Obsidian performance claims; visual and performance acceptance remains separate.

## 0.6.8 — paired moving cover and mineral ground detail

- Generate exactly two separated walls per unique linked file, retaining reciprocal/self-link deduplication and anonymous associations. The six-file Smoke Hub has twelve physical and rendered walls. Keep the existing radius formula based on file count, with no additional cover cap.
- Drive cover toward the live file bearings on the sphere at 0.8 surface units per second. Keep exit/pickup clearance, avoid overlapping walls, and stop before standing, crouched or leaning players. Preserve immutable geometry identity, radius, pickup layout and consumed-pickup timers while moving.
- Update existing solid instances and wire outlines together; maintain collision indices incrementally rather than rebuilding scene geometry every frame. Add deterministic instanced mineral scree as low-profile walk-over ground detail.
- Publish bounded compact host cover poses near players separately from acknowledged immutable geometry; predict distant presentation from anonymous graph positions. Preserve current collision poses on checkpoint migration and deduplicate repeated geometry definitions in bounded reliable transfers.
- Bump plugin to 0.6.8 and room/checkpoint contracts to 11; reject incompatible rooms/checkpoints. Keep settings schema 5, movement and weapon balance unchanged.

## 0.6.7 — charged weapon sound and animation

- Add a two-tone electronic charge hum with a rising pitch and volume, a sustained ready tone and a one-time ready chime. Stop it on firing, cancellation, focus loss, expiry, mute and disposal; cap every voice lifetime. Respect existing sound and volume settings.
- Add three animated energy coils and twelve inward-moving sparks, tinted to the selected laser color. Lift and brace the weapon with restrained vibration while charging; keep camera, physical muzzle and hit geometry unchanged.
- Preserve damage, heat, charge time, hold crouch, settings schema 5 and room/checkpoint protocol 10.

## 0.6.6 — hold crouch and charged alternate fire

- Make crouch hold-only. Settings schema 5 migrates toggle preferences to hold and retains custom key bindings; remove the obsolete mode selector.
- Hold right mouse for one second and release a 50-damage, 55-heat charged bolt. Early release cancels; charging pauses cooling and blocks primary fire. Two quick charged shots force the existing two-second vent. Normal-shot balance remains unchanged.
- Show charge percentage, muzzle energy buildup, stronger recoil and a thicker charged bolt. Cancel charges on focus loss, death, exit, host migration or five-second expiration.
- Validate charge duration on the host; send start/release/cancel through ordered reliable transport, preserve retried-fire deduplication, wall blocking, armor, confirmed hits and bounded rewind. Preserve shot kind in snapshots and migrated in-flight bolts; unfinished charges do not migrate.
- Bump plugin to 0.6.6 and room/checkpoint contracts to 10, rejecting old rooms/checkpoints. Geometry encoding and privacy boundaries remain unchanged.

## 0.6.5 — visible venting and wandering training patrols

- Stop first-person shot requests, recoil, muzzle flashes and blaster sounds while the host-timed vent is active or full heat awaits authoritative cooling. The threshold shot still fires; weapon balance and the two-second vent are unchanged.
- Show a bounded weapon-local steam effect during venting.
- Replace the single stationary solo dummy with four passive patrols: one near each pole and two on opposite hemispheres. Use fixed-step spherical movement, predictive capsule clearance, steering, pauses and stuck recovery; keep patrols out of the exit zones.
- Give each dummy independent damage and respawn state; reset/armor controls affect all four. Existing line-of-sight names, red HP bars and confirmed-hit feedback apply to every patrol.
- Add larger cosmetic technical sector markings to the opaque panel/circuit surface without introducing obstacles or changing cover generation.
- Keep settings and room/checkpoint protocol 9 unchanged; multiplayer receives no training NPC payloads.

## 0.6.4 — surface detail and combat feedback

- Remove the wall diagnostics checkbox, overlay, counters and callback.
- Add cosmetic opaque panel/circuit surface paint and cyan/amber pole routes without changing movement, cover, geometry identity or collision.
- Show public pilot names above red HP bars for visible same-arena opponents and the training dummy. Test displayed head line of sight against physical walls and planet curvature before revealing either label.
- Add actual-damage feedback for solo dummy hits and make confirmed multiplayer hit feedback clearer: a centered white marker with up to 450 ms visibility. Walls, floor, misses and predicted shots never trigger character-hit feedback.
- Reuse existing authoritative health and hit confirmations; room/checkpoint protocol 9, weapon balance and saved settings remain unchanged.

## 0.6.3 — opaque surface visibility

- Make graph nodes, links, navigation markers and other world overlays respect scene depth during the surface world draw, including bloom rendering. Opaque planets and cover hide geometry behind them while unobstructed exterior space stays visible.
- Restore original material depth settings after each world draw, preserving orbit/flight appearance and the separate first-person viewmodel overlay.
- Hide graph-node labels and ship indicators whose camera ray intersects an arena sphere, using the current displayed center and radius.
- Keep gameplay, weapon balance, physics, settings and room/checkpoint protocol 9 unchanged. Native pixel verification remains user-observed after restart.

## 0.6.2 — surface controls, operatives and navigation

- Default crouch to Left Control, migrate old C defaults once, retain custom bindings and prevent Ctrl movement combinations from invoking captured-gameplay shortcuts.
- Increase shared pistol heat to seven points per shot; the fifteenth uninterrupted shot fires and then vents.
- Replace capsule avatar/dummy visuals with an articulated, outlined space-operative suit, helmet, visor, utility equipment and pistol; match first-person glove and weapon detailing.
- Add prominent cyan North/amber South navigation cards, distances, exit progress and offscreen direction markers.
- Protect occupied arena visibility from graph fade/filter state and refresh presentation using geometry revision as well as seed.
- Add optional solo wall diagnostics with numbered bearings and local excluded/unresolved link counts. An end-to-end Smoke Hub test verifies six connections, physical walls, rendered instances, associations and wall hits.
- Keep protocol/checkpoint 9 and existing movement/damage geometry. Native visual acceptance remains user-observed after restart.

## 0.6.1 — stable moving planets and file-directed cover

- Resolve one displayed arena center per frame for the planet, camera, weapon, cover, pickups, beacons, avatars, ships, dummy, bolts and positional audio. Keep graph motion and node-relative physics.
- Create exactly one wall per unique connected file, sampling incoming/outgoing file bearings when the first player docks. Freeze occupied layouts and preserve pickup timers across visits and migration. Empty mains have no walls.
- Grow planets above sixteen connections with full-size players and walls. Use radius-aware physics, docking, combat, departures and graph clearance, instanced cover and static collision indexing.
- Publish immutable geometry through acknowledged reliable chunks no larger than 16 KiB, with 4 MiB per-arena and 32 MiB checkpoint limits. Live snapshots carry geometry references. Shared wall associations contain anonymous IDs only.
- Target room protocol 9 and checkpoint format 9; incompatible clients must update together. Preserve the plugin ID, saved settings and J117W3 fork metadata.
- Testing candidate: automated verification passes; native moving-ground stability and six-wall traversal remain user acceptance after restart.

## 0.6.0 — spherical node arenas and first-person combat

- Show main-node docking readiness, surface distance, braking guidance and continuous 1.5-second J-hold progress in the flight HUD; expose host rejections there too. Solo ships collide with the actual main sphere instead of entering the opaque planet.
- Identify this fork as OB Citizen by J117W3 in plugin details/settings, with its own repository and README while preserving upstream attribution and MIT notices.

- Dock at eligible main nodes and explore their deterministic spherical arenas with radial gravity, surface walking, jumping, crouch, lean, beacons, safe respawns, and two-pole ship return.
- Add opaque indestructible cover, 10-damage laser bolts, armor and health pickups, a solo training dummy, configurable readable laser colors, and surface audio and HUD feedback.
- Use host-timestamped surface snapshots and bounded target-hitbox rewind capped at 150 ms. The design targets fair registration through 100 ms RTT; 150–200 ms remains degraded and is tested for disposition and stability rather than competitive parity.
- Preserve surface resources, arena transitions, pickup timers, custom colors, and live bolts across host checkpoints; migration clears old rewind history and held input.
- Coalesce replaceable network state, compress bounded JSON payloads, acknowledge immutable arena geometry, and batch ship poses without changing simulation or publication rates. Real impaired-network acceptance remains gated.
- Preserve the 50 ms publication phase across the host polling clock, skip missed publication slots, and admit replaceable live messages only after the previous queued message drains.
- Restore solo main-node docking, share represented firing-view timing with the network fixture, zero the physical pistol toward the reticle at ten units, and keep the surface HUD and weapon readable in narrow panes.
- Keep both pole beacon caps outside the opaque planet; the south cap no longer applies the hemisphere rotation twice.
- Dock against the visible main sphere from the ship's aim, including remote main nodes, without relying on point-sprite selection.
- Use synchronized host time for surface vent, protection and respawn feedback; delayed combat events retain their original expiry and repeated snapshots do not restart hit markers.
- Give deterministic pickups a separate random stream from walls, with generated-arena checks for collection clearance, spacing and cover placement.
- Keep dead shooters at zero HP when an already-traveling bolt earns an elimination, preserving the original five-second respawn deadline.
- Play each remote damage sound once from its confirmed event, with positional audio and expiry, instead of duplicating it from health/armor reconciliation.
- Bump public rooms to protocol 8 and checkpoint format 8. Mixed versions receive an update-required message; the hosted Worker's historical protocol-4 route and TURN service remain unchanged.
- Automated checks cover geometry, time-to-kill, rewind bounds, checkpoint recovery, color readability, and privacy. Obsidian visual checks and four-client impaired-network acceptance remain separate runtime gates.

## 0.5.2 — smoother rooms and clearer flight HUD

- Run room movement at fixed 60 Hz, acknowledge sequenced per-tick controls, resend a bounded history, and replay peer prediction from exact host snapshots. The local host now renders directly from its own authoritative simulation instead of blending toward 20 Hz corrections.
- Buffer remote ship states for 100 ms and interpolate their displayed movement, with at most 100 ms of extrapolation. Player labels, distance, audio position, and lead pip use the presented ship motion.
- Increase forward pickup below cruise in solo and rooms while retaining cruise speed, boost rules, and other movement ratios. Reduce afterburner camera rattle and disable that rattle under reduced-motion preferences.
- Replace the long weapon text strip with selected blaster/cannon icons, circular cooldown arcs, one-decimal timers, heat and ammunition values. Include cooldown duration in room poses and checkpoints.
- Return the Hangar to a centered, content-sized panel around 440 px high, capped at 480 px, with a scrollable middle and fixed actions.
- Use room protocol 7 and checkpoint format 7 for tick acknowledgement, queued inputs, and cooldown duration. Mixed clients get an update-required error. The Worker’s legacy protocol-4 routes and TURN service are unchanged.
- Runtime acceptance in Obsidian and two-computer testing remain separate from the synthetic checks in `docs/verification-0.5.2.md`.

## 0.5.1 — controls and regression repairs

- Match upstream 0.4.1 flight controls: direct captured-mouse aiming, cursor steering, roll, braking, strafe, grip, speed-dependent agility, and 135-unit multiplayer cruise speed. Shared solo, prediction, and host movement constants now use the same implementation.
- Restore boosted world-space dust streaks and eased speed/afterburner field-of-view changes in chase and cockpit views, while respecting reduced-motion and restoring the configured field of view when flight ends.
- Send weapon selection as an ordered reliable command, acknowledge it in authoritative poses, and preserve unacknowledged choices during reconciliation. A regression test now exercises the actual client `R`-then-fire message order through the host control channel.
- Restore solo cannon-ammunition recovery, keep room ammunition limited to 36 per life, and preserve cooldowns when switching weapons. Chaser and cockpit weapon displays show selection, rate, ammunition or heat, readiness, cooldown, and dry/overheated states.
- Remove the redundant Scores toolbar button; hold Tab to show multiplayer standings. Keep the scoreboard bounded, scrollable, and keyboard accessible, and prevent pending clicks from firing during spectator transitions.
- Keep the 0.5.0 room protocol-5 clients isolated; 0.5.1 rooms use protocol 6 and checkpoint format 6. The Worker’s historical protocol-4 route and TURN credential routes remain unchanged.

## 0.5.0 — OB Citizen

This release combines the multiplayer and presentation work from the `feat/multiplayer-and-pilot` history with the upstream 0.4.1 flight, weapon, ship, and audio work. The plugin ID remains `constellation-graph`, so Obsidian keeps the existing plugin settings directory.

- Adds eight selectable spacecraft, four engine sounds, four afterburner sounds, and four blaster sounds, plus the heavy-cannon effect.
- Adds the upstream shield, hull, heat, ammunition, weapon-selection, damage, and kill-healing systems to authoritative combat and checkpoints.
- Keeps first-to-five rounds, the leaderboard, kill feed, shared supernova transition, anonymous constellation maps, navigation-only targeting, and the owner's private notes.
- Uses the public ntfy relay only for encrypted room discovery and WebRTC setup. Room simulation, map updates, flight state, combat, and checkpoints travel over peer data channels.
- Adds short-lived Worker-issued TURN refresh tokens for automatic relay fallback after direct connectivity fails. The Worker keeps the protocol-4 WebSocket route for older clients.
- Uses a shared flight simulation with the 0.5.0 multiplayer movement compromise and preserves the existing boost drain, recharge delay, empty-tank hold, and restart threshold.
- Migrates existing Citizen and upstream settings while preserving the plugin ID and existing ship, sound, and mute choices.

Network compatibility changed in this release. The public-relay room protocol is version 5; every participant in a room must use a compatible 0.5.0 client. Earlier 0.3.x ZIPs use older room protocols and signaling paths and cannot join protocol-5 rooms.

## Historical 0.3.x releases

These archives are retained byte-for-byte from the project's existing `dist/` directory. The source commit is recorded for each archive.

| Release | Source commit | Multiplayer compatibility |
| --- | --- | --- |
| 0.3.0 | `6026da26df2a47dcc441feea998621051fd6d10a` | Earlier signaling; not compatible with 0.5.2 rooms. |
| 0.3.1 | `2eb87aba3a72d1ee6ac49487f33f82d8f741c809` | Earlier signaling; not compatible with 0.5.2 rooms. |
| 0.3.2 | `27e2f2473f015b81ffd0da0bfef4fef4a1575b93` | Protocol 2; not compatible with 0.5.2 rooms. |
| 0.3.3 | `fc420731e02901f0beb7845b97ca11512018a7b8` | Protocol 3; not compatible with 0.5.2 rooms. |
| 0.3.4 | `ce3eb7a2319ae3046b9888688917b13599ec971b` | Protocol 4; not compatible with 0.5.2 rooms. |
