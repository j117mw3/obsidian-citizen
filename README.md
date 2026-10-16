# Obsidian Citizen 0.6.0

- Show main-node docking readiness, surface distance, braking guidance and continuous 1.5-second J-hold progress in the flight HUD; expose host rejections there too. Solo ships collide with the actual main sphere instead of entering the opaque planet.
- Identify this fork as Obsidian Citizen by J117W3 in plugin details/settings, with its own repository and README while preserving upstream attribution and MIT notices.

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

## Install

Download `main.js`, `manifest.json`, and `styles.css`, or extract `Obsidian-Citizen-0.6.0.zip` into `<vault>/.obsidian/plugins/constellation-graph/` with Obsidian closed. Back up your existing plugin and settings first. These original files retain the historical `constellation-graph` ID. All multiplayer participants need the same version. Requires desktop Obsidian 1.7.2 or newer.

## Verification and provenance

The original packaged files are preserved byte-for-byte. ZIP integrity, exact three-file membership, manifest version, private-path/credential-marker scan, and SHA-256 hashes were checked. Native Obsidian gameplay and cross-computer acceptance remain unverified for these archived candidates; see the version-specific verification document in the main branch.

This release restores a previously packaged update that was not committed separately at development time. Its tag records the recovered release files, license, and version notes; a matching historical TypeScript source snapshot is unavailable. GitHub's generated source archive contains this recovered package, not a reconstructed source history. The current development source will be committed with the upcoming completed update.

Independent MIT fork maintained by J117W3, based on Hunter / JusVibin's Constellation Graph. Original copyright notice preserved. No Community directory approval is implied.
