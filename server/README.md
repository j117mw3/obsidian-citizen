# Self-hosted multiplayer service

The plugin uses direct WebRTC data channels for map and flight traffic. This Node.js service only creates in-memory rooms, relays WebRTC setup messages, issues short-lived TURN credentials, and keeps the host's latest small combat checkpoint so a remaining participant can take over. It does not log gameplay messages or credentials. A room and its checkpoint disappear when its last participant leaves or the service restarts.

## Docker Compose deployment

You need a Linux host with Docker Compose, a public IPv4 address, and DNS names for the signaling and TURN services. Open inbound TCP ports 80 and 443 for Caddy, TCP and UDP 3478 for TURN, TCP 5349 for TURN over TLS, and TCP and UDP ports 49160–49200 for relayed media/data. Adjust the relay range in both the firewall and Compose together if your host needs a different range.

From this directory:

1. Copy `.env.example` to `.env` and set `PUBLIC_DOMAIN` to a DNS name pointing at the host. Caddy obtains and renews HTTPS for this name; the plugin uses `wss://PUBLIC_DOMAIN` for signaling.
2. Set `TURN_REALM` to the TURN DNS name and `TURN_EXTERNAL_IP` to the host's public IPv4 address. If the host is behind NAT, configure coturn's external/private address mapping as described in the [coturn server options](https://github.com/coturn/coturn/wiki/turnserver).
3. Generate a strong shared secret (for example, `openssl rand -hex 32`) and put it in `TURN_SECRET`. Compose gives the same secret to coturn and the signaling service. The service derives TURN REST credentials that expire after one hour; the long-lived shared secret never goes to clients.
4. Place a publicly trusted `fullchain.pem` and `privkey.pem` for the TURN name in the directory selected by `TURN_TLS_CERT_DIR` (the example uses `server/certs/`). The files are mounted read-only into coturn and ignored by Git. Caddy independently manages the HTTPS certificate for `PUBLIC_DOMAIN`.
5. Confirm `TURN_URLS` names the same TURN host and ports. Keep the `turns:` URL if the certificate is configured; retain the UDP and TCP `turn:` URLs for ordinary relays.
6. Start the stack with `docker compose --env-file .env up -d --build`, then check `https://PUBLIC_DOMAIN/health`.

Set the plugin's **Signaling server** setting to `wss://PUBLIC_DOMAIN`. Both players need the same service URL, but only the room creator shares the room code with the other pilots. Do not expose the Node signaling port directly; Compose keeps it on the private bridge behind Caddy.

## Local service development

Use Node.js 20 or newer. From the repository root run `npm ci --prefix server`, then start the service in PowerShell:

```powershell
$env:PORT = "8787"
$env:TURN_SECRET = "local-development-secret"
npm --prefix server start
```

Use `ws://localhost:8787` in Obsidian on the same computer. Local testing can use STUN only; one-hour TURN credentials are included only in a successful room-create or room-join response when both `TURN_SECRET` and `TURN_URLS` are set. There is no public credential-issuance endpoint. For internet use, serve the room endpoint over WSS and provide a reachable TURN service.

## Data and limits

- Room membership is held in memory, capped at four pilots per room. The service rate-limits room creation, connections, ICE-config requests, and signaling messages.
- The server sees room codes, display names, WebRTC offer/answer and ICE candidate messages, and the latest compact combat checkpoint. ICE candidates can reveal network addresses to the other peers, as they do in ordinary WebRTC.
- Note titles, paths, tags, and contents are never part of the plugin's network types. Vault shapes are shared as anonymous node IDs, group colors, links, and moving positions.
- Routine game inputs, ships, shots, and map positions travel over WebRTC data channels. The signaling service does not receive those snapshots. The host checkpoint contains only anonymous player IDs, flight state, health, boost, and in-flight shots.
- A WebRTC peer pair uses an ordered reliable channel for topology and an unordered, zero-retransmit channel for replaceable flight and position snapshots. Position snapshots are sequence-numbered binary chunks; incomplete, stale, or wrong-revision frames are dropped.

The synthetic tests cover protocol privacy, limits, stale snapshots, boost, hits, respawns, room capacity, TURN credential generation, and host election. They run locally and do not establish public DNS, forced TURN relay, or cross-internet Obsidian connectivity.
