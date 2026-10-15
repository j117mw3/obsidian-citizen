# Changelog

## 0.5.0 — Obsidian Citizen

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
| 0.3.0 | `6026da26df2a47dcc441feea998621051fd6d10a` | Earlier signaling; not compatible with 0.5.0 rooms. |
| 0.3.1 | `2eb87aba3a72d1ee6ac49487f33f82d8f741c809` | Earlier signaling; not compatible with 0.5.0 rooms. |
| 0.3.2 | `27e2f2473f015b81ffd0da0bfef4fef4a1575b93` | Protocol 2; not compatible with 0.5.0 rooms. |
| 0.3.3 | `fc420731e02901f0beb7845b97ca11512018a7b8` | Protocol 3; not compatible with 0.5.0 rooms. |
| 0.3.4 | `ce3eb7a2319ae3046b9888688917b13599ec971b` | Protocol 4; not compatible with 0.5.0 rooms. |
