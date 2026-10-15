Pilot mode becomes a sandbox, and you can now fly together.

**Fly together (multiplayer).** Make a room, send the ten-character code to up to three friends, and share one sky, each pilot with their own constellation. Only the shape of a constellation (anonymous points, links, colours) and your ship's position are shared; never note titles, paths, tags or contents. Connections are set up through a public relay (ntfy.sh by default, or your own), with every message sealed by the room code, then pilots talk directly. There is no server to run and nothing is set up for you; you can add your own TURN server if your network blocks direct connections. Outside a room the plugin still makes no network connections. Thanks to j117mw3 for the multiplayer protocol work this builds on.

**Pilot mode is a sandbox.** It never selects or opens notes, and the rest of the plugin works as before outside it. Animate and Supernova are off while you fly or are in a room.

- **Two weapons:** a blaster that runs hot and overheats, and a cannon that hits three times as hard but carries limited rounds per life (R switches).
- **Three ships to choose from:** Striker, Dart and Bulwark, each with its own look and its own cockpit view. Pick yours in the settings or in the Fly together panel.
- **Dogfighting in a room:** larger ships that grow with distance, nameplates with name, health and distance, arrows to pilots off-screen, and a lead pip for aiming at a moving target.
- **Spectator mode:** N watches the other pilots; after 30 seconds without input in a room you start watching automatically, and any flight key brings you back.
- **Smoother camera:** zooming with the wheel now glides instead of stepping, and a room no longer turns the camera smoothing off. The panels no longer blur the 3D view behind them, which was costly to draw.
- A new sound engine, speed effects, folded groups (shoot one to open it, B to fold), cursor steering and an on-screen controls panel.
- The flat map was removed. The README has a new look, with screenshots.
