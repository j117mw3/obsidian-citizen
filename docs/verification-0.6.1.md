# OB Citizen 0.6.1 verification

Implemented, packaged and installed into `<test-vault>\.obsidian\plugins\constellation-graph`. This is a local testing candidate, not a published release. Native acceptance remains pending the user's restart and gameplay observation. No computer-use tools were used and Obsidian was not restarted.

## Shared presentation frame

The renderer resolves one displayed arena center after graph updates and remote-map interpolation each frame. Ground, camera, weapon, cover, pickups, beacons, avatars, parked ships, dummy, bolts and positional audio use this center. Snapshot callbacks update authoritative state and geometry independently. Node-relative physics does not inherit graph translation. Missing remote-map frames retain the displayed center instead of snapping back to a delayed authority snapshot. Topology and pickup work remain separate from per-frame transforms.

Milestone 1 passed type checking and 161 tests. The frame regression covers solo, local-room and remote-room ownership, both poles, irregular frame intervals and delayed snapshots. Camera/ground and weapon offsets remain constant within 1e-9 without geometry rebuilds or physics-state mutation.

## Directional cover, occupied layouts and growth

Incoming/outgoing links are deduplicated, reciprocal links count once, and self-links are excluded. First docking into an empty arena samples linked-file directions in sorted connection-ID order. Each unique connection gets one physical wall with its source association. Coincident and polar bearings use deterministic safe slots. Occupied walls, radius and pickup layout stay fixed until the last player leaves; subsequent resampling changes geometry revision independently of topology revision. Pickup availability and respawn deadlines survive resampling, pending topology changes and migration. Unlinked mains have no walls, accessible open-ground pickups and a training dummy.

The Testing vault's synthetic Smoke Hub file contains six outgoing links, and each of those six files links back. Deduplication yields six connections and six physical walls, including walls beyond the local horizon. No new fixture notes were created or changed.

Radius is `27 * sqrt(max(1, N / 16))` surface units; scene scale remains `6 / 27`. Physics, surface and planet collision, rays, spawning, pole distances, camera conversion, docking, parked ships and departures use each arena's radius. Graph collision envelopes include 1.5 world units of clearance around main spheres. Wall rendering uses instanced opaque boxes and instanced outlines, with a static spatial index for capsule/projectile collision. Larger sphere meshes increase tessellation to keep surface chord error small. Movement speeds and weapon balance are unchanged.

Directional/indexing foundations passed type checking and 167 tests. Live integration then passed the full suite after updating obsolete wall-count and revision assumptions. Final integration passes 172 tests.

## Protocol 9 and bounded geometry

Plugin version is 0.6.1, room protocol is 9, and room checkpoint format is 9. Incompatible room/checkpoint messages request an update. The plugin ID, J117W3 author/repository and saved settings are preserved.

Host-published occupied geometry uses acknowledged reliable chunks of at most 16 KiB; live snapshots contain compact geometry references. Transfers assemble and validate completely before entering the cache. Geometry has compact connection dictionaries/numeric rows and bounded per-arena compression. Limits are 4 MiB per arena transfer and 32 MiB per checkpoint. Inflation is bounded, checksummed and validated; malformed or incomplete transfers fail closed. Cached deeply frozen geometry avoids full geometry validation on every live snapshot. Shared wall associations must be anonymous node IDs, never note paths or titles. Existing 20,000-node/100,000-link sharing limits remain unchanged.

Tests cover counts 0, 1, 2, 6, 16, 17, 1,000 and 19,999 (maximum degree in a supported 20,000-node map). They check exact counts, directional placement, shuffled links, pole exclusion, spacing, radius, movement, gravity, collision indexing, instanced rendering, chunk bounds, reordered/duplicate/malformed transfers, atomic late join and authoritative migration. A maximum-degree checkpoint with high-entropy anonymous connection IDs serializes to 1,150,494 bytes. An aggregate sizing envelope of 28 such dense geometry blocks is 32,178,144 bytes, below 33,554,432 bytes. This sizing envelope is not a claim of 28 simultaneous occupants.

Additional regressions compare walking/jumping state with an untranslated reference through moving centers and pause/resume, exercise both moving pole exits, preserve timer deadlines across visits/migration, and evacuate on owner departure. Existing combat, cover blocking, input replay, privacy, color, heat/TTK and bounded-rewind tests pass. Deterministic network smoke tests are not a new native WebRTC fairness certification.

## Final validation and rollout

- `npm run typecheck`: passed.
- `npm test`: 172 passed, zero failed; TAP evidence in `dist/verification-latest-tests.tap`.
- `npm run build`: passed.
- ZIP contains exactly `main.js`, `manifest.json`, `styles.css`; extracted-member hashes match staged and installed files.
- Known private path/fixture markers and source-map references were absent from distributed files. Fork and MIT/fflate notices are present. This marker scan supplements the network payload privacy tests; it is not a general secrets audit.
- Previous installed plugin directory was copied to a timestamped backup before replacing release files. Installed file hashes were read back; `data.json` SHA-256 is unchanged.

Package: `<checkout>\dist\obsidian-citizen-0.6.1-stable-planets\obsidian-citizen-0.6.1-stable-planets.zip`.

Backup: `<checkout>\dist\installed-backups\before-0.6.1-20261015-225157`.

ZIP SHA-256: `182D2E6B32D5A84E9214B4651F3622B36F17D5515070111ED847CBAFA353F613`.

Installed `main.js` SHA-256: `CBD8009DA32A63CF1E58E9EC25B030E8D11A2D8135499B4E74AABA74DEAB70F0`.

Machine-readable evidence: [stable-planets-install-verification.json](stable-planets-install-verification.json).

## User acceptance still required

Restart/reload Obsidian to load the installed candidate. Hold J to dock onto the moving Surface Smoke Hub. Stand still and watch for ground/camera sawtooth motion, then walk and jump across the sphere and visit both poles. Traverse the planet to find all six direction-associated walls; the horizon hides distant walls from any one spot. Repeat with another participant using the same 0.6.1 build, including a remote-owned moving arena. These native visual/gameplay checks, GPU appearance and cross-computer network behavior were not observed by the implementation tools.
