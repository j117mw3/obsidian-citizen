# Obsidian Citizen 0.5.0

Obsidian Citizen combines the constellation experience from the 0.3.4 feature branch with the spacecraft, weapon and multiplayer contributions from upstream 0.4.1. The plugin ID remains `constellation-graph`, so existing installations keep their settings. The original repository name and MIT license are unchanged.

## Multiplayer

- Create or join a four-player room with an encrypted ten-character code through the public ntfy relay. Players need no relay account or local server setup.
- Share anonymous constellation positions, links and colors; note names, paths, tags and contents remain on the owner's computer.
- Keep gameplay and checkpoints on WebRTC peer connections. The hosted Worker issues short-lived, authenticated TURN refresh tokens for networks that cannot connect directly.
- Preserve host-authoritative movement, shields, hull damage, weapon heat, cannon ammunition, rounds, and checkpoints. The first pilot to five confirmed eliminations wins; the shared supernova and countdown begin the next round.
- Retain the scoreboard, kill feed, navigation-only star targeting, ship labels, distance indicators and lead pip. Notes cannot be selected or opened during room membership.

## Flight and hangar

- Use one flight simulation for solo, host and client prediction, with moderated mouse steering and the existing boost drain, recharge delay and empty-tank hold.
- Choose eight fixed-size ships: Classic, Vector, Dart Freighter, Bulwark Cruiser, Crescent, Revenant, Dart Interceptor and Bulwark Gunship. The imported upstream models retain their distinct silhouettes and use the same gameplay collision and cannon rules.
- Choose among four synthesized sounds per category, including the upstream-derived Stellar drive, Stellar surge and Pulse XL, plus the heavy-cannon effect.
- Keep live cockpit instruments, saved Hangar choices, nearby-ship audio and independent engine/afterburner mutes.

## Compatibility

Protocol-5 public-relay rooms require version 0.5.0 on every participant. The hosted Worker continues to serve the historical protocol-4 WebSocket route for older builds. Old WebSocket addresses migrate to inactive legacy settings; new installs use the public relay. Historical 0.3.0–0.3.4 packages remain separate releases and retain their original contents.

## Credits

Thanks to xjusvibin for the upstream 0.4.1 ship models and gameplay work, and to everyone who helped test the constellation and multiplayer features. The integrated Dart and Bulwark models retain their upstream MIT attribution in source.