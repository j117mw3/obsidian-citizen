# Multiplayer service deployment

## Current rooms in Citizen 0.7.2

Room discovery uses the public ntfy relay by default. Each room has a ten-character code; room messages are encrypted before they leave Obsidian. The relay carries only setup and recovery traffic. Maps, flight inputs, ships, weapons, and combat checkpoints travel over direct WebRTC data channels. Players do not need provider accounts or server setup.

The Cloudflare Worker at `https://constellation-rooms.mrassetto.workers.dev` serves the health check and TURN fallback routes. Room discovery uses encrypted ntfy messages; the Worker does not coordinate public-relay rooms. After eight seconds without a direct peer connection, the plugin requests a short-lived Worker-issued bearer token from `/turn/session`, then requests the available ICE servers from `/turn`. The Worker keeps refresh tokens in memory, rate-limits token issuance and refreshes, and does not log tokens or credential payloads. TURN credentials are issued through Metered's REST API, expire after one hour, and wait for provider propagation before they are returned. The TURN allowance is shared; provider limits can make relay connectivity unavailable while direct connections continue to work.

### Maintainer deployment

From this directory:

1. Install the locked Worker tooling with `npm ci`.
2. Confirm Wrangler is signed in with `npx wrangler whoami`. Keep the Cloudflare account on Workers Free, and keep Metered paid overages and automatic top-ups disabled.
3. Set the app name and Secret Key as Worker secrets through Wrangler's prompts. Do not place either value in source, command arguments, chat, or logs:

   ```powershell
   npx wrangler secret put METERED_APP --config wrangler.jsonc
   npx wrangler secret put METERED_SECRET_KEY --config wrangler.jsonc
   ```

4. Run `npm run build:hosted` from the repository root, then deploy with `npm --prefix server run deploy:hosted`.
5. Check `https://constellation-rooms.mrassetto.workers.dev/health`, then run `npm run check:hosted`. The check reports only service health and relay status; it does not create a room, start a WebRTC connection, or print temporary credentials.

No domain purchase is needed because Cloudflare supplies HTTPS for the `workers.dev` address. The Worker keeps only short-lived relay configuration and refresh-token state in memory; the Metered API key remains in Cloudflare secrets. Free-plan limits apply. Do not enable paid usage or automatic reload.

### Current protocol and legacy service boundary

Citizen 0.7.2 uses protocol 14 and checkpoint format 14 for public-relay rooms. Older protocol versions cannot join protocol-14 rooms. The hosted Worker still accepts the historical protocol-4 WebSocket route for older releases, and the Node.js/Docker service below also implements that older signaling protocol. These legacy services do not create or join current public-relay rooms. The plugin's **Custom relay** setting expects an HTTPS ntfy-compatible relay, not a WebSocket signaling server.
## Legacy protocol-4 Node.js service

The plugin uses direct WebRTC data channels for map and flight traffic. This Node.js service only creates in-memory rooms, relays WebRTC setup messages, issues short-lived TURN credentials, and keeps the host's latest small combat checkpoint so a remaining participant can take over. It does not log gameplay messages or credentials. A room and its checkpoint disappear when its last participant leaves or the service restarts.

### Docker Compose deployment for older clients

You need a Linux host with Docker Compose, a public IPv4 address, and DNS names for the signaling and TURN services. Open inbound TCP ports 80 and 443 for Caddy, TCP and UDP 3478 for TURN, TCP 5349 for TURN over TLS, and TCP and UDP ports 49160–49200 for relayed media/data. Adjust the relay range in both the firewall and Compose together if your host needs a different range.

From this directory:

1. Copy `.env.example` to `.env` and set `PUBLIC_DOMAIN` to a DNS name pointing at the host. Caddy obtains and renews HTTPS for this name; the plugin uses `wss://PUBLIC_DOMAIN` for signaling.
2. Set `TURN_REALM` to the TURN DNS name and `TURN_EXTERNAL_IP` to the host's public IPv4 address. If the host is behind NAT, configure coturn's external/private address mapping as described in the [coturn server options](https://github.com/coturn/coturn/wiki/turnserver).
3. Generate a strong shared secret (for example, `openssl rand -hex 32`) and put it in `TURN_SECRET`. Compose gives the same secret to coturn and the signaling service. The service derives TURN REST credentials that expire after one hour; the long-lived shared secret never goes to clients.
4. Place a publicly trusted `fullchain.pem` and `privkey.pem` for the TURN name in the directory selected by `TURN_TLS_CERT_DIR` (the example uses `server/certs/`). The files are mounted read-only into coturn and ignored by Git. Caddy independently manages the HTTPS certificate for `PUBLIC_DOMAIN`.
5. Confirm `TURN_URLS` names the same TURN host and ports. Keep the `turns:` URL if the certificate is configured; retain the UDP and TCP `turn:` URLs for ordinary relays.
6. Start the stack with `docker compose --env-file .env up -d --build`, then check `https://PUBLIC_DOMAIN/health`.

This endpoint is for older protocol-4 clients only. OB Citizen 0.6.0 cannot use it as a Custom relay; that setting expects an HTTPS ntfy-compatible relay. Do not expose the Node signaling port directly; Compose keeps it on the private bridge behind Caddy.

### Local protocol-4 service development

Use Node.js 20 or newer. From the repository root run `npm ci --prefix server`, then start the service in PowerShell:

```powershell
$env:PORT = "8787"
$env:TURN_SECRET = "local-development-secret"
npm --prefix server start
```

These commands support historical protocol-4 clients and the legacy service tests. The 0.6.0 Custom relay option does not accept `ws://localhost:8787`. The Node service's locally generated TURN credentials are separate from the hosted Worker route.

## Data and limits

- Room membership is held in memory, capped at four pilots per room. The service rate-limits room creation, connections, ICE-config requests, and signaling messages.
- The server sees room codes, display names, WebRTC offer/answer and ICE candidate messages, and the latest compact combat checkpoint. ICE candidates can reveal network addresses to the other peers, as they do in ordinary WebRTC.
- Note titles, paths, tags, and contents are never part of the plugin's network types. Vault shapes are shared as anonymous node IDs, group colors, links, and moving positions.
- Routine game inputs, ships, shots, and map positions travel over WebRTC data channels. The signaling service does not receive those snapshots. The host checkpoint contains only anonymous player IDs, flight state, health, boost, and in-flight shots.
- A WebRTC peer pair uses an ordered reliable channel for topology and an unordered, zero-retransmit channel for replaceable flight and position snapshots. Position snapshots are sequence-numbered binary chunks; incomplete, stale, or wrong-revision frames are dropped.

The synthetic tests cover protocol privacy, validated and late-joining pilot profiles, limits, stale snapshots, boost, accepted and rejected shots, hits, respawns, room capacity, legacy Worker room creation, host election, credential rotation, provider outages, and quota classification. They do not establish public DNS, forced TURN relay, or cross-internet Obsidian connectivity.

From the repository root, `npm run check:hosted` checks the current Worker health and TURN-token routes. It does not print credentials or create a room, and it does not make WebRTC/TURN media connections.

`npm run harness:network` builds a browser harness that needs no vault or WebGL. It can require TURN relay, send synthetic flight inputs, and display selected candidate types without exposing addresses or credentials. Forced relay consumes the real shared allowance while its clients are connected, so disconnect after testing. See [0.3.1 verification](../docs/verification-0.3.1.md) for observed browser results and the separate Obsidian verification boundary.
