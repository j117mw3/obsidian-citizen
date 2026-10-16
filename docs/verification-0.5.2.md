# OB Citizen 0.5.2 verification record

## Automated and hosted checks

- `npm test`: **60 passed, 0 failed**. Coverage includes a 120-tick empty-room host flight trace, one authoritative local host pose per 60 Hz tick, no backwards steps in the recorded straight-flight positions, and no local host pose reapplication from the 20 Hz peer snapshot path.
- The same suite checks fixed-tick acknowledgements, bounded and overlapping resend batches, duplicate rejection, checkpoint recovery, 100 ms remote pose interpolation, boost-resource parity, spectator resource preservation, star collision resolution, and throttle pickup at 30, 60, and 144 FPS.
- `npm run build`: passed TypeScript checking and the production plugin bundle.
- `npm --prefix server run build:hosted`: Worker dry-run build passed (20.96 KiB upload, 5.80 KiB gzip).
- `npm run check:hosted`: the hosted health endpoint responded; the Worker-issued token was accepted, relay status was ready, and six ICE server entries were returned. This check does not create a room or establish a peer connection.
- Privacy tests captured application messages from synthetic vault fixtures and confirmed that note names, paths, tags, and contents are omitted. Oversized maps, stale positions, and malformed message cases are covered by the test suite.
- The install ZIP contains only `manifest.json`, `main.js`, and `styles.css`; the manifest retains plugin ID `constellation-graph` and version `0.5.2`. The archive privacy scan passed. SHA-256: `2bd95ca7f95401ed2c82cba90c2ebf79214b3216a5654ba64239266889ca469b`.

## Runtime evidence boundary

These are synthetic code and service checks, not an Obsidian gameplay session. The HUD and Hangar have not been visually inspected in Obsidian at narrow pane sizes or increased UI scale. The empty-room trace verifies authoritative tick output, but does not measure pixels rendered by an actual Obsidian window. Four simultaneous browser WebRTC clients, delayed/reordered/lost packets under 0–200 ms RTT and 50 ms jitter, forced TURN media, authority transfer during live flight, and testing across two computers and networks remain unverified.

These automated and hosted checks do not establish native gameplay or cross-computer acceptance. The published 0.5.2 package remains an independently downloadable update; use matching versions on every multiplayer computer.
