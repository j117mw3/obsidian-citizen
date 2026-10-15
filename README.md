# Constellation Graph

A fluid, slowly orbiting 3D map of your notes for [Obsidian](https://obsidian.md), with a **Pilot mode**: a flying sandbox where you pilot a small starfighter through it, alone or with up to three friends. Notes glow as points of light, coloured by folder (or tag). Clusters swirl around their own centres and drift past one another, like a screensaver for your vault, while the camera slowly circles. Everything is built to stay usable: full keyboard control, screen-reader announcements, a searchable note list, a colour-blind-safe palette, a high-contrast mode, and no motion at all if your system asks for reduced motion.

> Early release. Listing and install details: [Constellation Graph on the Obsidian community site](https://community.obsidian.md/plugins/constellation-graph).

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

### Toolbar

| Button | What it does |
|---|---|
| Search | Highlights matching notes and lists them |
| Pause / play | Stops or resumes all motion |
| Reset view | Frames the whole graph again |
| **Animate** | A timelapse: every note disappears, then returns in the order it was created, and each link flashes as it forms. Press again to stop |
| **Supernova** | Everything is crushed into a point, detonates in one soft flash, re-forms from scratch, and a wave of light then runs outward along the shortest paths from the most-connected note (or the note you have selected). Press again to stop |
| **Pilot** (plane) | Fly through your notes in a sandbox (see below) |
| **Fold** (circled plus) | Fold every group into one point, or open them all |
| **Fly together** (people) | Make or join a multiplayer room (see below) |
| Note list | A searchable list of notes, an alternative to the canvas |
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
| G | Fold every group into one point, or open them all |
| N | Supernova |
| R | Reset the view |
| L | Show or hide the note list |
| / | Focus search |
| Esc | Clear selection, close a panel |

### Pilot mode (a flying sandbox)

Press **P** in the graph (or the plane button on the toolbar) and fly a small four-winged fighter through your notes. Pilot mode is a **sandbox**: it never selects, opens or changes a note, and the rest of the plugin works exactly as before outside it. The plane has weight: it takes a moment to start and stop a turn, it coasts when you let go of the throttle, a trailing camera follows it, and the afterburner draws on an energy tank. Notes are solid, so you bounce off them. Blaster bolts make a splash where they land and can open a folded group (below), nothing more.

| Key | Action |
|---|---|
| W / S | Thrust / reverse |
| A / D | Strafe |
| Space / C | Up / down |
| Q / E | Roll |
| Shift | Afterburner (uses an energy tank; when it runs dry it stays empty for three seconds before it refills) |
| X | Brake |
| Mouse | Steer (see **Mouse mode** below) |
| Click or F | Fire a blaster |
| T | Lock the note under the crosshair as a flight target (T again lets go) |
| G | Warp to the target |
| H | Warp back out to see the whole graph |
| B | Fold the group of the note you are aiming at into one point (Shift+B folds every group, or opens them all) |
| V | Switch between chase and cockpit view |
| R | Switch blaster / cannon |
| N | Watch other pilots (in a room) |
| K | Show or hide the controls panel |
| Esc | Free the mouse (a second Esc leaves) |
| P | Leave Pilot mode |

The controls are also shown on screen as a small panel of key caps that light up as you press them, and fades after a few seconds.

- **Mouse mode.** *Capture* hides the pointer and steers with its movement. *Cursor* keeps the pointer visible and steers by how far it is from the centre, with a dead zone and two faint rings to show it; over a panel or button it stops steering, so you can click the legend, toolbar and details panel while flying.
- **Scale.** Cruise speed is set from the size of your vault, so a bigger vault takes longer to cross: about 12 seconds across a 100-note vault at cruise speed, longer for larger ones. The *Flight speed* setting scales it. Warps take time in proportion to the distance.
- **Folded groups.** Each group (a folder, or a tag) can be folded into one glowing point with its name and size. Shoot a folded group, or click it in the normal view, to open it and watch its notes fly back out. A vault of more than 400 notes starts folded the first time you fly (a setting). In the normal view, the toolbar button or **G** folds every group, or opens them all.
- **Weapons.** The blaster is quick and runs hot: hold the trigger and it overheats, then goes cold for a moment. The cannon hits three times as hard but each life carries a limited number of rounds (they return when you respawn).
- **Ships.** Choose a Striker (four wings), Dart (delta wing) or Bulwark (heavy gunship) in the settings. They look different and fly and fight the same; other pilots see your choice.
- **In a room.** Other ships are drawn larger the further away they are, with a nameplate (name, health, distance) and an edge arrow when off-screen. A lead pip shows where to aim at a moving pilot. **N** watches the other pilots; after 30 seconds without a key in a room you start watching automatically, and any flight key brings you back.
- **Speed you can see.** The view widens under afterburner, and dust streaks past as you go faster.
- **Wireframes and sound.** The plane has a glowing wireframe outline, and target brackets, impact bursts and faint shells around each group are drawn in wireframe too (they can be turned off). Engine, blaster, impact and warp sounds are synthesised in the plugin with the Web Audio API, nothing is loaded from a file, and they can be turned off or turned down. Sound mutes when the window loses focus.
- Pilot mode needs motion, so it stays off when your system asks for reduced motion (the search, note list and details panel still work). It is not available without WebGL.

### Fly together (multiplayer)

Up to four pilots can share one sky, each with their own constellation. Click the people button on the toolbar, choose **Make a room**, and send the ten-character room code to your friends; they paste it under **Join**. Then everyone presses **P** to fly.

- **What is shared:** the *shape* of your constellation (anonymous points, links and group colours) and where your ship is. **Never** note titles, paths, tags or contents: remote constellations have no labels, and nothing a remote pilot sends can reach a note, a file or Obsidian itself.
- **How it connects:** there is no server to run. Pilots find each other through a public relay (the free [ntfy.sh](https://ntfy.sh) service by default, or one you choose in the settings). Every message through the relay is sealed with a key made from the room code, so the relay sees only noise, and nobody without the code can listen or take part. The relay carries only a handful of connection-setup messages; after that, pilots talk to each other directly (WebRTC), and your computer's address is visible to the other pilots and to the STUN servers that help the connection through your router.
- **The rules in a room:** every pilot flies their own ship with the full flight model, at the same cruise speed. Each constellation sits still in its own corner of the sky, and there is no warping. Ships can shoot each other: a blaster hit costs 10 of 100 health and a cannon round 30, a destroyed ship comes back after five seconds with three seconds when nothing can hit it, and each pilot's own computer decides whether *they* were hit. There is no score. Ships pass through one another.
- **If it will not connect:** some networks block direct connections. You can enter your own TURN server in the settings and it will be used when a direct connection fails; nothing is set up for you. The free relay has usage limits, so a very busy day may need a different relay.
- A room closes when the last pilot leaves. Your vault is never changed, and changes you make to it while in a room appear when you leave.

### Accessibility

- **Reduced motion.** If your operating system requests reduced motion, flow, orbiting and camera flights are turned off: the layout settles once and stays still, dragged notes return at once instead of bouncing, and Supernova just recomputes the layout instantly without the show. Animate still works because you asked for it, but without the pop-in effects. You can also set motion to *Off* yourself, or pause at any time.
- **No strobing.** The Supernova has a single soft flash that fades over about a second, and it is skipped under reduced motion and in high-contrast mode.
- **Screen readers.** The canvas is hidden from assistive technology and replaced by a status region that announces the selected note, its group and link count. The note list, search, group legend and details panel are ordinary buttons and lists.
- **No colour-only meaning.** Group names are always shown in the legend, tooltip and details panel, and selected or open notes get a ring as well as a colour change.
- **Colour-blind palette** (Okabe-Ito), **high contrast** (also switched on by the system "more contrast" setting), and adjustable label size.
- **Without WebGL** the 3D view is replaced by the list, search and details panel.

## Settings

Open on startup (off by default; saved in the vault, so it applies to anyone who opens it), flow (off, calm, lively), camera rotation and speed, glow and bloom, palette, label size and count, grouping (folder, first tag, none), folder depth, excluded folders, whether to show notes with no links, and whether to ring the open note. Pilot mode has its own section: enable, fold groups when flying, ship, mouse mode (capture or cursor), mouse sensitivity, invert vertical look, flight speed, agility, view (chase or cockpit), wireframe effects, sound and volume. Multiplayer has its own too: your name, the relay, and an optional TURN server.

## Privacy and safety

**Outside a multiplayer room the plugin makes no network connections**, has no telemetry and loads no remote code. Everything, including Three.js, is bundled into `main.js`. Note titles are only ever written as text, never as HTML. Pilot mode's sound is generated by the plugin itself; no audio files are loaded or sent anywhere. The plugin reads your notes' names and links (from Obsidian's own index) and, when grouping by tag, their first tag. It does not read note contents or write to your vault, and Pilot mode never selects or opens a note.

**When you make or join a multiplayer room**, and only then, the plugin uses the network like this:

- a few small, sealed messages go through the relay you chose (ntfy.sh by default) to set up connections. They are encrypted with a key made from the room code, so the relay cannot read or change them, but it can see that *something* was sent, when, and from which address;
- public STUN servers (Google's and Cloudflare's) help your connection through your router, and see your address;
- the other pilots in the room receive an anonymous map of your constellation (points, links, colours, no names of any kind) and your ship's position, and can see your address, as with any direct connection;
- if you have entered your own TURN server in the settings, it is used when a direct connection fails.

Display names are cleaned before anyone sees them. Everything a remote pilot can send is checked and size-limited before it is used.

## Performance

Rendering uses point sprites and line segments rather than a mesh per note. A tick of the layout engine costs more as the vault grows, so above a few thousand notes it uses cheaper repulsion and runs at a lower rate when frames get slow, and the bloom pass is dropped first on slow machines. When nothing is moving (motion off or paused, and the camera at rest) it draws nothing.

## Known limitations

- Desktop only (it needs WebGL and a pointer), and Obsidian 1.7.2 or newer.
- Pop-out windows are not specifically supported yet.
- Very large vaults (roughly 10,000+ notes) will be slow to lay out; exclude folders to thin the graph. A room shares up to 20,000 notes and 100,000 links per vault.
- Multiplayer needs a network that allows direct connections, unless you set up your own TURN server. It has been tested with two pilots on one computer, and with the unit tests, but not yet across the internet between real Obsidian installs.

## Development

```bash
npm install
npm run dev          # esbuild watch, writes main.js
npm run build        # type-check, then minified production main.js
npm test             # unit tests for the room, encryption and what is shared
npm run harness -- "<path to a vault>"   # builds dev/harness.html, a browser preview using that vault's notes as mock data
npm run install-local -- "<path to a vault>"   # build and copy into <vault>/.obsidian/plugins/constellation-graph
```

Source layout: `src/main.ts` (plugin), `view.ts` (Obsidian view), `data.ts` (vault to graph), `app.ts` (UI, keyboard, accessibility), `renderer.ts` (Three.js), `sim.ts` (layout and flow), `pilot.ts` (Pilot mode: flight, aiming, collisions, HUD), `ship.ts` and `cockpit.ts` (the plane and its cockpit, built from primitives), `speedfx.ts` (speed dust), `weapons.ts` (blaster, cannon, lead pip), `sfx.ts` (synthesised sound), `multiplayer.ts` (the room session: anonymous topology, position frames, checks), `room.ts`, `relay.ts` and `netcrypto.ts` (finding other pilots through a relay, sealed with the room code), `remote.ts` (other pilots' constellations, ships and bolts), `multiplayerUi.ts` (the Fly together panel), `fallback.ts` (no-WebGL mode), `settings.ts`, `palette.ts`.

## Credits

The multiplayer anonymous-topology format, binary position frames, chunked transfers and the checks on everything a remote pilot can send are adapted from the multiplayer work by [j117mw3](https://github.com/j117mw3) in [pull request #1](https://github.com/xjusvibin/obsidian-constellation-graph/pull/1), with thanks. The connection set-up (a code-sealed public relay instead of a hosted server) and the flight and combat rules are different.

## Licence and third-party notices

MIT, see `LICENSE`. The bundled `main.js` includes:

- [Three.js](https://threejs.org), MIT licence, copyright the Three.js authors.
- [d3-force-3d](https://github.com/vasturiano/d3-force-3d), MIT licence, copyright Vasco Asturiano; it builds on [d3-force](https://github.com/d3/d3-force) (ISC licence, copyright Mike Bostock) and related d3 modules (ISC, BSD-3-Clause).

Full licence text for each travels with its package under `node_modules` and is preserved at the end of `main.js`.
