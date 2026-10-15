# Obsidian Citizen

A 3D constellation of your Obsidian notes that you can explore on foot or fly through in Pilot mode. Notes appear as glowing stars coloured by folder or tag; clusters drift around their own centres as the camera moves through the graph. Obsidian Citizen keeps the existing `constellation-graph` plugin ID, so upgrades preserve saved settings.

**Release 0.5.0** combines the constellation renderer and multiplayer systems from both project histories. Multiplayer rooms share anonymous constellation geometry while note names, paths, tags and contents remain on each owner's computer.

## Screenshots

These views use a synthetic vault with four fictional notes; no personal vault names or paths are shown.

![Obsidian Citizen graph in a synthetic vault](docs/screenshots/synthetic-graph.png)


## Use

- Ribbon icon (orbit) or the command **Open constellation graph**.
- It updates live as you add, remove, rename and link notes. Your selection and any hidden groups are kept.

### Mouse

| Action | Result |
|---|---|
| Drag | Orbit |
| Scroll | Zoom |
| Click a note | Select it and fly to it |
| Drag a note | It follows your pointer, its linked notes are tugged along, and on release everything springs back into place with a small bounce |
| Double-click, or Ctrl/Cmd+click | Open the note (Ctrl/Cmd+click opens a new tab) |
| Click empty space | Deselect |
| Right-click | Clear selection and target lock, cancel pending double-click/double-shot actions, and close the details panel |

### Toolbar

| Button | What it does |
|---|---|
| Search | Highlights matching notes and lists them |
| Pause / play | Stops or resumes all motion |
| Reset view | Frames the whole graph again |
| **Animate** | A timelapse: every note disappears, then returns in the order it was created, and each link flashes as it forms. Press again to stop |
| **Supernova** | Solo only: everything is crushed into a point, detonates in one soft flash, re-forms from scratch, and a wave of light runs outward along the shortest paths from the most-connected note (or the note you have selected). Disabled while you are in a multiplayer room |
| Note list | A searchable list of notes, an alternative to the canvas |
| Hangar | Choose a spacecraft, engine, afterburner and blaster sound, and nearby-ship audio |
| Help | Keyboard shortcuts |

### Keyboard

The graph area is focusable. Press **?** for this list in the app.

| Key | Action |
|---|---|
| Left / Right | Previous / next note |
| Up / Down | Step through the selected note's connections |
| Enter (Shift+Enter) | Open the selected note (in a new tab) |
| Space | Pause or resume motion |
| A | Animate (timelapse) |
| N | Supernova (solo only) |
| R | Reset the view |
| L | Show or hide the note list |
| / | Focus search |
| Esc | Clear selection, close a panel |

### Pilot mode

Press **P** in the graph (or the plane button on the toolbar) and fly through your constellation. The **Hangar** offers eight fixed-size ships: Classic, Vector, Dart Freighter, Bulwark Cruiser, Crescent, Revenant, Dart Interceptor and Bulwark Gunship. Each keeps the same gameplay scale, collision size and four-gun firing order. Choose among four synthesized engine, afterburner and laser sounds, preview them, and toggle nearby-ship audio. The cockpit has live health, shields, boost, speed, weapon status and score instruments. Solo fire still selects a note and a second shot opens it; in a room, all notes are navigation targets only.

| Key | Action |
|---|---|
| W / S | Thrust / reverse |
| A / D | Strafe |
| Space / C | Up / down |
| Q / E | Roll |
| Shift | Afterburner (uses an energy tank; when it runs dry it stays empty for a few seconds before it refills) |
| X | Brake |
| Mouse | Steer (see **Mouse mode** below) |
| Click or F | Fire a blaster bolt at what is under the crosshair (6.25 shots per second) |
| T | Lock or unlock the target |
| G | Warp to the target (travel to the marked shared star in multiplayer) |
| H | Warp back out to see the whole graph (disabled in multiplayer) |
| V | Switch between chase and cockpit view |
| R | Switch between blaster and cannon |
| Tab | Open or close the multiplayer scores |
| K | Show or hide the controls panel |
| Esc | Free the mouse (a second Esc leaves) |
| P | Leave Pilot mode |

The controls are also shown on screen as a small panel of key caps that light up as you press them, and fades after a few seconds.

- **Mouse mode.** *Capture* hides the pointer and steers with its movement. *Cursor* keeps the pointer visible and steers by how far it is from the centre, with a dead zone and two faint rings to show it; over a panel or button it stops steering, so you can click the legend, toolbar and details panel while flying.
- **Scale.** Cruise speed is set from the size of your vault, so a bigger vault takes longer to cross: about 12 seconds across a 100-note vault at cruise speed, longer for larger ones. The *Flight speed* setting scales it. Warps take time in proportion to the distance.
- **Wireframes and sound.** The plane has a glowing wireframe outline, and target brackets, impact bursts and faint shells around each group are drawn in wireframe too (they can be turned off). Engine, afterburner, blaster and warp sounds are synthesised in the plugin with the Web Audio API; no audio files are loaded. The Pilot HUD has separate saved **Mute engine**, **Mute afterburner** and **Hangar** controls. The two mutes do not affect blasters, and the master sound and volume controls still apply. Sound mutes when the window loses focus.
- **Cockpit instruments.** The cockpit displays live hull, boost, recharge/lock, speed, weapon readiness, firing rate, protection or respawn time, and multiplayer score. A screen-reader text equivalent is available while cockpit view is active.
- Pilot mode needs motion, so it stays off when your system asks for reduced motion (the search, note list and details panel still work). It is not available without WebGL.

### Multiplayer rooms

The panel shows the version of the loaded plugin code, the selected connection mode, and the room-service hostname. Include those lines and the full status message when reporting a connection failure. A WebSocket close code is included when the server closes before room setup finishes.

Player rows say **Waiting for flight state** until their first authoritative update, then show **flying** or **spectator**. A timeout from one STUN or TURN endpoint is informational while other connection paths are still being tried; an actual peer-connection failure is shown separately.

Open the **Multiplayer** panel, enter a display name, and check the shared-data notice. Create a room to get a ten-character code, then share it with up to three other pilots; or enter a code to join. The panel includes **Copy code** and **Leave**, participant health and state, and connection status. The default ntfy relay carries only encrypted room discovery and WebRTC setup. Players do not need accounts or server setup. The Worker provides temporary TURN credentials after direct connection attempts fail.

Joining shares anonymous star positions, connections, group colors and a restricted pilot profile containing only the chosen ship and sound IDs. It never sends note titles, paths, tags, or contents. Remote constellations have circular stars and no labels, note details, search, selection, dragging, or opening actions. In a room, all note selection and opening is disabled, including for your own notes. Click a star in the shared map, or aim at one and press **T**, to mark it for navigation. Enter Pilot mode and press **G** to fast travel there; destinations may be any participant's anonymous stars. Press **T** again while aiming to change the target. Right-click clears it. **H** remains disabled in a room. Maps update as notes and links change. Each map spreads to twice its solo size around its region center, and ships appear twice as large. A subtle red marker points toward each other flying player and shows their name and distance. Sharing supports up to 20,000 stars and 100,000 links per vault; larger maps show an error instead of silently omitting notes.

Maps, inputs, flight state, combat and checkpoints travel over WebRTC data channels. ntfy is used for encrypted room discovery and peer setup only. If direct connectivity fails, the hosted Worker can issue short-lived TURN credentials; its free relay allowance is shared by all players and may be unavailable after provider limits are reached. Direct connectivity can continue when TURN is unavailable. Choose **Custom server** to use another compatible ntfy relay. See [server/README.md](server/README.md) for deployment notes and service limits.

Firing at other pilots is optional. The host resolves shields, hull damage, weapon heat and cannon ammunition. Destruction gives a five-second respawn and three seconds of protection; firing ends protection. A discreet kill feed and the leaderboard show kills and deaths. The first pilot to five confirmed eliminations wins, then the room pauses for an eight-second shared supernova, regenerates each owner's constellation, waits for maps to synchronize, and starts the next round after a three-second countdown. Manual supernova is disabled in a room. Boost drains at 28% per second, recharges at 8% after 1.5 seconds without boosting, and stays empty for three seconds when depleted. Leaving Pilot mode or hiding the game view makes you a spectator; returning takes five seconds and preserves health and boost. Public-relay rooms use protocol 5 and require version 0.5.0 or newer.

The Worker keeps temporary TURN credentials and refresh-token sessions in memory, and does not log credentials or gameplay payloads. ntfy can observe room-topic traffic and connection metadata but cannot read room messages without the code. The TURN provider can observe peer IP addresses and traffic volume. Outside an active room, the plugin makes no network connections.

### Accessibility

- **Reduced motion.** If your operating system requests reduced motion, flow, orbiting and camera flights are turned off: the layout settles once and stays still, dragged notes return at once instead of bouncing, and Supernova just recomputes the layout instantly without the show. Animate still works because you asked for it, but without the pop-in effects. You can also set motion to *Off* yourself, or pause at any time.
- **No strobing.** The Supernova has a single soft flash that fades over about a second, and it is skipped under reduced motion and in high-contrast mode.
- **Screen readers.** The canvas is hidden from assistive technology and replaced by a status region that announces the selected note, its group and link count. The note list, search, group legend and details panel are ordinary buttons and lists.
- **No colour-only meaning.** Group names are always shown in the legend, tooltip and details panel, and selected or open notes get a ring as well as a colour change.
- **Colour-blind palette** (Okabe-Ito), **high contrast** (also switched on by the system "more contrast" setting), and adjustable label size.
- **Without WebGL** the 3D view is replaced by the list, search and details panel.

## Settings

Open on startup (off by default), motion, camera, glow, palette, labels and grouping can be configured in plugin settings. Pilot mode adds mouse mode, sensitivity, flight speed and agility, view, sound, volume and separate engine and afterburner mutes. The Hangar saves ship and sound choices plus nearby-ship audio. Multiplayer settings include display name and Public or Custom relay. Earlier localhost WebSocket addresses are preserved as inactive legacy values; new installations use the public relay.

## Privacy and safety

When you explicitly join, peers receive anonymous star positions, links, colors, player IDs, display names, flight and combat state. Note names, paths, tags, file contents and Obsidian vault objects are excluded from network types. Remote stars cannot be selected or opened; a local application boundary also blocks note opening while joined. Map IDs are random for the session and the real file mapping stays local. Audio is synthesized in the plugin. The graph reads Obsidian's index and does not write to note files.

## Performance

Rendering uses point sprites and line segments rather than a mesh per note. A tick of the layout engine costs more as the vault grows, so above a few thousand notes it uses cheaper repulsion and runs at a lower rate when frames get slow, and the bloom pass is dropped first on slow machines. When nothing is moving (motion off or paused, and the camera at rest) it draws nothing.

## Known limitations

- Desktop only (it needs WebGL and a pointer), and Obsidian 1.7.2 or newer.
- Pop-out windows are not specifically supported yet.
- Very large vaults (roughly 10,000+ notes) will be slow to lay out; exclude folders to thin the graph.

## Development

```bash
npm install
npm ci --prefix server # signaling service dependency
npm run dev          # esbuild watch, writes main.js
npm run build        # type-check, then minified production main.js
npm test             # synthetic privacy, protocol, combat, and signaling tests
npm run build:hosted --prefix server  # validate the Cloudflare Worker bundle
npm run harness -- "<path to a vault>"   # builds dev/harness.html, a browser preview using that vault's notes as mock data
npm run install-local -- "<path to a vault>"   # build and copy into <vault>/.obsidian/plugins/constellation-graph
```

Source layout: `src/main.ts` (plugin), `view.ts` (Obsidian view), `data.ts` (vault-to-graph conversion), `app.ts` (UI and accessibility), `renderer.ts` and `sim.ts` (constellation rendering and motion), `pilot.ts` and `flight.ts` (shared flight simulation), `hangar.ts`, `ship.ts`, `importedShipModels.ts` and `cockpit.ts` (spacecraft), `sfx.ts` (synthesized audio), `room.ts` and `netcrypto.ts` (encrypted room discovery), `multiplayer.ts` (WebRTC mesh and anonymous map protocol), `combat.ts` (authoritative flight, weapons, rounds and checkpoints), `server/worker.js` (hosted TURN configuration endpoint), and `server/` (deployment files).

## Licence and third-party notices

MIT, see `LICENSE`. The bundled `main.js` includes:

- [Three.js](https://threejs.org), MIT licence, copyright the Three.js authors.
- [d3-force-3d](https://github.com/vasturiano/d3-force-3d), MIT licence, copyright Vasco Asturiano; it builds on [d3-force](https://github.com/d3/d3-force) (ISC licence, copyright Mike Bostock) and related d3 modules (ISC, BSD-3-Clause).
- [ws](https://github.com/websockets/ws), MIT licence, used by the separate signaling service.

Full licence text for each travels with its package under `node_modules` and is preserved at the end of `main.js`.
