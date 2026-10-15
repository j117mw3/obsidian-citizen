**Starfield Graph** (formerly Constellation Graph). Same plugin and same id, so your settings and updates carry over; the new name says what it has become.

Pilot mode becomes a sandbox, and you can now fly together.

**Fly together (multiplayer).** Make a room, send the ten-character code to up to three friends, and share one sky, each pilot with their own constellation. Only the shape of a constellation (anonymous points, links, colours) and your ship's position are shared; never note titles, paths, tags or contents. Connections are set up through a public relay (ntfy.sh by default, or your own), with every message sealed by the room code, then pilots talk directly. There is no server to run and nothing is set up for you; you can add your own TURN server if your network blocks direct connections. Outside a room the plugin still makes no network connections. Thanks to j117mw3 for the multiplayer protocol work this builds on.

**Pilot mode is a sandbox.** It never selects or opens notes, and the rest of the plugin works as before outside it. Animate and Supernova are off while you fly or are in a room.

- **Two weapons:** a blaster that runs hot and overheats, and a cannon that hits three times as hard but carries limited rounds per life (R switches).
- **Three ships to choose from:** Striker, Dart and Bulwark, each with its own look and its own cockpit view. Pick yours in the settings or in the Fly together panel.
- **Hits you can trust:** bolts now fly the same on everyone's screen (they keep your ship's speed and are not a moment behind), the target grows a little the further a bolt flew, and every gun has a best range: inside it a hit does a quarter more damage, past it the damage fades. The lead pip turns green when you are in range, and a hit flashes your crosshair.
- **One size for every ship:** your ship and everyone else's are the same size wherever they are, with a ring that stays visible on screen when a pilot is far away.
- **Direct mouse aim:** the nose now turns exactly as far as the mouse moves and stops when it stops, with a tighter chase camera, so lining up a shot is easy. Cursor steering is crisper too.
- **Kill announcements and a scoreboard:** when someone is destroyed everyone sees who did it, and holding Tab shows kills and deaths (also listed in the Fly together panel).
- **Names only where you look:** while flying, only the note you are aiming at or have locked, the notes close to your ship, and the vault's centre are named.
- **Layout controls:** new Node size, Link brightness and Spacing settings (like Obsidian's own graph forces) to tidy a vault whose groups sit too tight or too far apart.
- **No more white blobs:** crowded groups now blend like screen light, so overlapping notes keep their colour instead of clipping to white.
- **A clearer view when flying:** the group list is hidden in Pilot mode.
- **Lobbies keep your notes private:** the note list and group list are put away while you are in a room.
- **Calmer stars:** distant stars dim and bright ones level off instead of clipping to white, so a room with several constellations is no longer blinding.
- **Dogfighting in a room:** same-size ships with a ring that stays visible far away, nameplates with name, health and distance, arrows to pilots off-screen, and a lead pip for aiming at a moving target.
- **Spectator mode:** N watches the other pilots; after 30 seconds without input in a room you start watching automatically, and any flight key brings you back.
- **Smoother camera:** zooming with the wheel now glides instead of stepping, and a room no longer turns the camera smoothing off. The panels no longer blur the 3D view behind them, which was costly to draw.
- A new sound engine, speed effects, folded groups (shoot one to open it, B to fold), cursor steering and an on-screen controls panel.
- The flat map was removed. The README has a new look, with screenshots.
