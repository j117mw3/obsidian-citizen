import "./obsidian-shim";
import { connectionStats, connectionStatById } from "../src/rtcStats";
import { proxyStats, browserPost } from "./browser-http";
// Explicitly staged integration fixture. No vault reads, WebGL, clock overrides,
// direct damage calls, accelerated timers, or resource resets during fights.
import * as THREE from "three";
import { MultiplayerSession } from "../src/multiplayer";
import { SurfaceHistory } from "../src/surfaceHistory";
import { presentSurfacePlayers } from "../src/surfacePresentation";
import { createSurfacePlayerState } from "../src/surfacePhysics";
import { surfaceViewPose } from "../src/surfaceView";
import { validSurfaceNetworkSnapshot, type SurfaceNetworkSnapshot } from "../src/surfaceAuthority";
import type { RoundSnapshot } from "../src/rounds";
import type { GraphData, SimNode } from "../src/types";
import { proxyIceConnection } from "./network-impairment";

import { fixture, requireFixture, type SessionFixture, type AuthorityFixture } from "./fixture-access";
const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms));
const status = document.getElementById("status")!, output = document.getElementById("results")!, progress = document.getElementById("progress")!;
const query = new URLSearchParams(location.search), token = query.get("udp"), relay = query.get("relay");
let active: AbortController | null = null;
async function initialize() {
  if (!token || relay !== `${location.origin}/relay` || !/^http:\/\/127\.0\.0\.1:\d+$/.test(location.origin)) throw new Error("Use a dedicated loopback UDP server URL");
  const proxy = await proxyStats(`/udp/stats?token=${encodeURIComponent(token)}`);
  if (proxy.profile.rtt !== 200 || proxy.profile.jitter !== 25 || proxy.profile.loss !== 0.01) throw new Error("Lifecycle check requires 200 ms RTT, ±25 ms one-way jitter and 1% UDP loss");
  window.RTCPeerConnection = proxyIceConnection(window.RTCPeerConnection, token, () => { status.textContent = "UDP registration failed"; });
  document.getElementById("start")!.removeAttribute("disabled"); status.textContent = "Ready: dedicated real UDP 200 ms profile.";
}

async function run(signal: AbortSignal) {
  const sessions: MultiplayerSession[] = [], ids: string[] = [], snapshots: Array<SurfaceNetworkSnapshot | null> = [null, null, null, null];
  const histories = Array.from({ length: 4 }, () => new SurfaceHistory()), estimates = [0, 0, 0, 0], received = [0, 0, 0, 0];
  const rounds: Array<RoundSnapshot | null> = [null, null, null, null], nova = [0, 0, 0, 0], roundEvents: unknown[] = [], eliminations = Array.from({ length: 4 }, () => new Set<string>());
  const dispositions = new Map<string, boolean>(), sequence = [0, 0, 0, 0], interact = [false, false, false, false];
  const checks: string[] = [], pickupEvents: unknown[] = [], fireObservations: Array<{ player: string; sequence: number; accepted: boolean; reason?: string; viewAgeMs: number; rttMs: number | null }> = [], damageEvents: Array<{ target: string; applied: number; killed: boolean; at: number; lifeBefore: number; lifeAfter: number }> = [], respawns: Array<{ id: string; at: number }> = [];
  let inputs = 0, invalidSnapshots = 0, host: SessionFixture, authority: AuthorityFixture, arenaKey = "";
  const startedAt = Date.now(), deadline = startedAt + 360000;
  const graphs = Array.from({ length: 4 }, () => {
    const data: GraphData = { groups: [{ key: "fixture", label: "Fixture", color: "#8CECFF", count: 2 }],
      nodes: [{ id: "Lifecycle Main.md", name: "Main", group: "fixture", deg: 1 }, { id: "Lifecycle Link.md", name: "Link", group: "fixture", deg: 1 }],
      links: [{ source: "Lifecycle Main.md", target: "Lifecycle Link.md" }] };
    const nodes: SimNode[] = data.nodes.map((node, index) => ({ ...node, index, gi: 0, x: index * 40, y: 0, z: 0, vx: 0, vy: 0, vz: 0, phase: 0, speed: 0 }));
    return { data, nodes };
  });
  const assert = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };
  const checkpoint = (name: string) => { checks.push(name); progress.textContent = `${checks.length} checks: ${name}`; };
  const until = async (predicate: () => unknown, label: string, timeout = 12000) => {
    const end = Math.min(deadline, Date.now() + timeout);
    while (!predicate()) { if (signal.aborted) throw new Error("Cancelled; no acceptance result"); if (Date.now() >= end) throw new Error(`Timed out: ${label}`); await wait(20); }
  };
  const body = (index: number) => requireFixture(fixture(authority.world).players.get(ids[index]));
  const staged = (index: number, normal: readonly [number, number, number], forward?: readonly [number, number, number]) => { body(index).surface = createSurfacePlayerState(normal, forward); };
  const everySnapshot = (predicate: (snapshot: SurfaceNetworkSnapshot) => unknown) => snapshots.every(snapshot => snapshot && predicate(snapshot));
  const shoot = async (targetIndex: number, index = 1, obsoleteLife?: number) => {
    const snapshot = snapshots[index], shooter = snapshot?.players.find(player => player.id === ids[index]);
    assert(shooter?.surface && shooter.arenaKey, "Shooter has no surface view");
    const now = Date.now(), shown = presentSurfacePlayers(histories[index], snapshot!.players, new Map(snapshot!.arenas.map(arena => [arena.key, arena])), ids[index], shooter!.arenaKey,
      estimates[index] + Math.max(0, now - received[index]), snapshot!.hostTime);
    const target = shown.samples.find(sample => sample.player.id === ids[targetIndex]); assert(target, "Target has no presented pose");
    const muzzle = new THREE.Vector3(...surfaceViewPose(shooter!.surface!).muzzle), targetPosition = new THREE.Vector3(...target!.frame.state.position);
    const aim = targetPosition.clone().addScaledVector(targetPosition.clone().normalize(), 1.2).sub(muzzle).normalize().toArray();
    const next = ++sequence[index]; sessions[index].fireSurface(next, Math.floor(shown.representedAt), shooter!.arenaKey!, obsoleteLife ?? shooter!.lifeId, aim);
    if (obsoleteLife !== undefined) {
      // Current-life snapshot reconciliation intentionally cancels this local
      // pending command. Inspect the actual host receipt/rejection, not a
      // callback that the production client is required to retire.
      await until(() => fireObservations.some(item => item.player === ids[index] && item.sequence === next), "host rejection of obsolete life", 1800);
      return requireFixture(fireObservations.find(item => item.player === ids[index] && item.sequence === next)).accepted;
    }
    await until(() => dispositions.has(`${index}:${next}`), "authoritative fire disposition", 1800);
    return dispositions.get(`${index}:${next}`)!;
  };
  try {
    for (let index = 0; index < 4; index++) {
      const session = new MultiplayerSession({ status() {}, members(_members, self) { ids[index] = self; }, topology() {}, positions() {}, message() {}, removed() {}, authority() {}, playerState() {}, shotState() {},
        surfaceState(snapshot, hostNow) {
          if (!validSurfaceNetworkSnapshot(snapshot, 1)) { invalidSnapshots++; return; }
          snapshots[index] = snapshot; estimates[index] = hostNow; received[index] = Date.now();
          for (const player of snapshot.players) if (player.surface && player.arenaKey) histories[index].record({ playerId: player.id, arenaKey: player.arenaKey,
            arenaRevision: snapshot.arenas.find(arena => arena.key === player.arenaKey)?.revision, lifeId: player.lifeId, at: snapshot.hostTime, state: player.surface, protected: player.protectedUntil > snapshot.hostTime });
        },
        surfaceFireResult(seq, accepted) { dispositions.set(`${index}:${seq}`, accepted); },
        round(state) {
          if (rounds[index]?.phase !== state.phase || rounds[index]?.roundId !== state.roundId) roundEvents.push({ client: index, at: Date.now(), state });
          rounds[index] = state;
          if (state.phase === "supernova" && nova[index] !== state.roundId) {
            nova[index] = state.roundId;
            for (const node of graphs[index].nodes) node.x += 3;
            window.setTimeout(() => sessions[index]?.republishLocalLayout(), 0);
          }
        },
        elimination(event) { eliminations[index].add(event.id); },
      }, () => graphs[index], () => relay!, browserPost);
      sessions.push(session);
      if (index === 0) await session.create("Lifecycle Host"); else await session.join(sessions[0].room, `Lifecycle ${index}`);
    }
    await until(() => sessions.every(session => session.members.length === 4 && [...fixture(session).peers.values()].filter((peer) => peer.pc.connectionState === "connected").length === 3), "four-client native mesh", 30000);
    host = fixture(sessions[0]); authority = fixture(requireFixture(host.surfaceAuthority));
    const topology = sessions[0].localTopology!, hub = topology.nodes.find(node => node.dockable)!; arenaKey = `${ids[0]}/${hub.id}`;
    await until(() => authority.world.getArena(arenaKey), "host arena");
    const realUpdate = authority.world.updatePlayer.bind(authority.world), realDamage = authority.world.damage.bind(authority.world), realFire = authority.fire.bind(authority);
    authority.fire = (...args: Parameters<typeof realFire>) => { const result = realFire(...args); fireObservations.push({ player: args[0], sequence: args[1], accepted: result.accepted, reason: result.reason,
      viewAgeMs: args[5] - Number(args[2]), rttMs: authority.connectionTiming.get(args[0])?.measuredRtt(args[5]) ?? null }); return result; };
    authority.world.updatePlayer = (...args: Parameters<typeof realUpdate>) => { const result = realUpdate(...args); if (result === "pickup") pickupEvents.push({ id: args[0], at: args[3] }); if (result === "respawn") respawns.push({ id: args[0], at: args[3] }); return result; };
    authority.world.damage = (...args: Parameters<typeof realDamage>) => { const lifeBefore = authority.world.getPlayer(args[0])?.lifeId, result = realDamage(...args); if (result.applied) damageEvents.push({ target: args[0], applied: result.applied, killed: result.killed, at: args[3], lifeBefore: lifeBefore ?? 0, lifeAfter: authority.world.getPlayer(args[0])?.lifeId ?? 0 }); return result; };
    const dock = async (index: number) => {
      const centre = requireFixture(authority.world.getArena(arenaKey)).center, fighter = requireFixture(requireFixture(host.world).players.get(ids[index]));
      fighter.pos.set(centre[0], centre[1], centre[2] + 15); fighter.rot.set(0, 0, 0, 1); fighter.vel.set(0, 0, 0); fighter.active = true; fighter.input.active = true;
      await wait(150); sessions[index].requestSurfaceDock({ ownerId: ids[0], starId: hub.id, revision: sessions[0].localTopology!.revision });
      await until(() => authority.world.getPlayer(ids[index])?.mode === "surface", `normal docking request ${index}`);
    };
    for (let index = 0; index < 4; index++) await dock(index);
    await until(() => everySnapshot(snapshot => snapshot.players.length === 4 && snapshot.players.every(player => player.mode === "surface" && player.arenaKey === arenaKey)), "shared surface on all peers"); checkpoint("Four ordinary docking requests admitted to one arena");
    inputs = window.setInterval(() => { for (let index = 0; index < 4; index++) { const player = snapshots[index]?.players.find(player => player.id === ids[index]); if (player?.surface && player.arenaKey) sessions[index].sendSurfaceInput({ moveX: 0, moveY: 0, sprint: false, jump: false, crouch: false, yawDelta: 0, pitchDelta: 0, lean: 0, interact: interact[index] }, player.arenaKey, player.lifeId); } }, 1000 / 60);
    sessions[1].setSurfaceColor("#000000"); await until(() => everySnapshot(snapshot => snapshot.players.find(player => player.id === ids[1])?.laserColor === "#959595"), "approved color on every peer"); checkpoint("Approved dark color replicated");

    const arena = requireFixture(authority.world.getArena(arenaKey)), pickup = requireFixture(arena.arena.pickups.find((item) => item.kind === "small-health"));
    for (const index of [1, 2]) { staged(index, pickup.normal); body(index).health = 60; body(index).armor = 0; }
    await until(() => pickupEvents.length, "simultaneous pickup");
    assert(body(1).health + body(2).health === 145, "One small pickup must heal exactly one of two colocated players");
    staged(1, [0, 1, 0]); staged(2, [0, -1, 0]);
    await until(() => everySnapshot(snapshot => snapshot.pickups.some(item => item.arenaKey === arenaKey && item.id === pickup.id && !item.available)), "pickup hidden on all peers");
    const pickupTimer = authority.world.getPickups(arenaKey, Date.now()).find((item) => item.id === pickup.id)!.respawnAt;
    assert(pickupEvents.length === 1, "Simultaneous collection duplicated"); checkpoint("One collection, replicated unavailable pickup");
    await until(() => everySnapshot(snapshot => snapshot.hostTime >= pickupTimer && snapshot.pickups.some(item => item.arenaKey === arenaKey && item.id === pickup.id && item.available)), "real fifteen-second pickup respawn", 18000);
    assert(pickupEvents.length === 1, "Pickup collected twice while players were away"); checkpoint("Real pickup timer restored availability on all peers");

    staged(0, [1, 0, 0]); staged(2, [0, -1, 0]); staged(3, [0, 1, 0]);
    const angle = 3 / 27;
    staged(1, [0, Math.cos(angle), -Math.sin(angle)], [0, Math.sin(angle), Math.cos(angle)]);
    await wait(1200); interact[3] = true;
    await until(() => body(3).exitProgress >= 0.2, "pole hold begins", 2500);
    const beforeDamage = body(3).health, interruptDeadline = Date.now() + 1300;
    // Degraded UDP may reject a lost/retried old view. A new ordinary request
    // may still damage the body before the two-second hold finishes.
    while (body(3).health === beforeDamage && body(3).mode === "surface" && Date.now() < interruptDeadline) {
      if (await shoot(3)) break;
    }
    await until(() => body(3).health === beforeDamage - 10 && body(3).exitProgress === 0 && body(3).mode === "surface", "damage interrupts held pole return", 1400);
    interact[3] = false; checkpoint("Network blaster damage interrupted a held pole exit");
    await wait(3200); interact[3] = true;
    await until(() => body(3).mode === "ship", "continuous pole return", 5000); interact[3] = false;
    assert(body(3).health === 90 && !requireFixture(host.world).isSurfaceDocked(ids[3]), "Undocking must preserve surface health and restore ship mode");
    assert(requireFixture(host.world).poses(Date.now()).find((item) => item.id === ids[3])!.pose.velocity.every((value: number) => value === 0), "Returned ship must be at rest");
    await dock(3); assert(body(3).health === 90, "Redocking healed surface health"); staged(3, [-1, 0, 0]); checkpoint("Pole return and redocking preserve resources");

    staged(2, [0, 1, 0]); body(2).health = 100; body(2).armor = 50; body(1).health = 70;
    await wait(1200);
    for (let kill = 1; kill <= 5; kill++) {
      const lifeBefore = body(2).lifeId, damageStart = damageEvents.length;
      while (body(2).health > 0) { await shoot(2); await wait(600); }
      const thisKill = damageEvents.slice(damageStart).filter(item => item.target === ids[2]);
      assert(thisKill.length === (kill === 1 ? 15 : 10) && thisKill.every(item => item.applied === 10) && thisKill.filter(item => item.killed).length === 1, "Damage duplicated or armor/HP accounting changed");
      assert(body(1).health === 100 && body(1).kills === kill, "Confirmed elimination must score once and heal at most thirty HP");
      await until(() => rounds.every(round => round?.scores.find(score => score.playerId === ids[1])?.kills === kill), "replicated score"); checkpoint(`Confirmed surface elimination ${kill}/5`);
      if (kill === 5) break;
      const diedAt = thisKill.at(-1)!.at;
      await until(() => body(2).health === 100 && body(2).lifeId > lifeBefore, "natural five-second respawn", 7000);
      const respawn = respawns.at(-1)!; assert(respawn.at - diedAt >= 5000 && body(2).armor === 0, "Respawn timer/resources invalid");
      staged(2, [0, 1, 0]);
      if (kill === 1) { await wait(800); const before = body(2).health; assert(await shoot(1, 2, lifeBefore) === false, "Old-life fire request accepted"); assert(body(2).health === before, "Rejected old-life fire changed resources"); checkpoint("Old-life fire request rejected after real respawn"); }
      await until(() => Date.now() >= body(2).protectedUntil + 300, "natural spawn protection expires", 4500);
      await wait(800);
    }
    await until(() => rounds.every(round => round?.phase === "supernova" && round.winnerId === ids[1]), "five-kill shared supernova");
    await until(() => everySnapshot(snapshot => snapshot.players.every(player => player.mode === "ship")), "all surface occupants returned before round reset");
    assert(eliminations.every(events => events.size === 5), "Every client must receive five distinct elimination events"); checkpoint("All four clients observe five kills and return to ships");
    await until(() => rounds.every(round => round?.roundId === 2 && round.phase === "combat"), "new layouts and real countdown", 30000);
    await until(() => everySnapshot(snapshot => snapshot.players.every(player => player.mode === "ship" && player.health === 100 && player.armor === 0 && player.kills === 0 && player.deaths === 0) && snapshot.pickups.every(item => item.available)), "new-round surface resources");
    checkpoint("Republished layouts, countdown, round two and pickup/resource reset");
    assert(invalidSnapshots === 0, "Invalid surface snapshots received");
    const transport = [];
    for (const session of sessions) for (const peer of fixture(session).peers.values()) { const stats = await peer.pc.getStats(), selected = connectionStats(stats).find((item) => item.type === "transport" && item.selectedCandidatePairId);
      const pair = selected && connectionStatById(stats, selected.selectedCandidatePairId ?? ""), remote = pair && connectionStatById(stats, pair.remoteCandidateId); transport.push({ connected: peer.pc.connectionState === "connected", proxy: remote?.address === "127.0.0.1", rttMs: Math.round((pair?.currentRoundTripTime ?? 0) * 1000) }); }
    assert(transport.length === 12 && transport.every(item => item.connected && item.proxy), "All twelve local peer connections must retain proxy routes");
    return { passed: true, scope: "Four logical clients, real WebRTC/UDP; staged ship/body poses and explicit initial combat resources; ordinary requests, no direct damage, real timers. No native Obsidian/WebGL/audio/traversal claim.", checks, elapsedMs: Date.now() - startedAt, invalidSnapshots, pickupEvents, pickupTimer, fireObservations, damageEvents, respawns, roundEvents, transport };
  } catch (error) { return { passed: false, reason: error instanceof Error ? error.message : String(error), checks, elapsedMs: Date.now() - startedAt, invalidSnapshots, pickupEvents, fireObservations, damageEvents, respawns, roundEvents }; }
  finally { window.clearInterval(inputs); for (const session of sessions) session.leave(); }
}
document.getElementById("start")!.addEventListener("click", () => { if (active) return; const controller = active = new AbortController(); status.textContent = "Running staged lifecycle integration; real timers";
  void run(controller.signal).then(result => { output.textContent = JSON.stringify(result, null, 2); status.textContent = result.passed ? "PASS staged real-network lifecycle checks. No rendering claim." : `FAIL: ${result.reason}`; }).finally(() => { active = null; }); });
document.getElementById("cancel")!.addEventListener("click", () => active?.abort());
window.addEventListener("beforeunload", () => active?.abort());
void initialize().catch(error => { status.textContent = error instanceof Error ? error.message : String(error); });
