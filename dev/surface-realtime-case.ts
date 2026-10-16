// Four real room clients and native WebRTC connections, sharing one browser event
// loop. Only fixture poses/resources are controlled; transport and host timing are real.
import * as THREE from "three";
import { MultiplayerSession } from "../src/multiplayer";
import { SurfaceAuthority, validSurfaceNetworkSnapshot, type SurfaceNetworkSnapshot } from "../src/surfaceAuthority";
import { SurfaceHistory } from "../src/surfaceHistory";
import { presentSurfacePlayers } from "../src/surfacePresentation";
import { createSurfacePlayerState } from "../src/surfacePhysics";
import { surfaceViewPose } from "../src/surfaceView";
import { traceSurfaceSegment, SURFACE_BLASTER } from "../src/surfaceCombat";
import { SURFACE } from "../src/surface";
import { latencyTargetState, latencyWalls, latencyOracle, type SurfaceLatencyCase } from "./surface-latency-harness";
import type { GraphData, SimNode } from "../src/types";

type Attempt = { sequence: number; at: number; representedAt: number; oracle: boolean; accepted?: boolean; reason?: string; dispositionAt?: number; hits: Set<string>; viewExhausted: boolean; snapshotAgeMs: number; estimatedOffsetMs: number };
const fixture = (value: unknown): any => value;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const unit = (value: THREE.Vector3) => value.lengthSq() ? value.normalize() : value.set(0, 1, 0);

export async function runRealtimeSurfaceCase(config: SurfaceLatencyCase, relay: string, signal: AbortSignal, progress: (value: string) => void, sampleMode: "accepted" | "attempts" = "accepted") {
  if (sampleMode === "attempts" && config.rttMs <= 100) throw new Error("0–100 ms fairness cases require accepted-shot samples");
  const required = config.shots ?? 500, sessions: MultiplayerSession[] = [], ids: string[] = [], snapshots: Array<SurfaceNetworkSnapshot | null> = [null, null, null, null];
  const histories = Array.from({ length: 4 }, () => new SurfaceHistory());
  const estimates = [0, 0, 0, 0], receivedAt = [0, 0, 0, 0], attempts = new Map<number, Attempt>(), seenHits = new Set<string>();
  let running = false, invalidSnapshots = 0, modeDivergence = 0, blockerViolations = 0, maxRewindMs = 0, tick = 0;
  let setupAt = Infinity;
  let authority: SurfaceAuthority | null = null, arenaKey = "", simulationTimer = 0;
  const walls = latencyWalls(config), rejected: Record<string, number> = {};
  const viewTimeRejections: unknown[] = [];
  const publicationTail: Array<{ receivedAt: number; hostTime: number }> = [], receptionTail: Array<{ receivedAt: number; hostTime: number }> = [];
  const cadence = { publications: 0, gapsOver125Ms: 0, maxGapMs: 0, hiddenPublications: 0, firstPublicationAt: 0, lastPublicationAt: 0,
    simulationSteps: 0, firstStepAt: 0, lastStepAt: 0, maxStepGapMs: 0 };
  const data: GraphData = { groups: [{ key: "fixture", label: "Fixture", color: "#8CECFF", count: 2 }], nodes: [
    { id: "Fixture Main.md", name: "Fixture Main", group: "fixture", deg: 1 }, { id: "Fixture Link.md", name: "Fixture Link", group: "fixture", deg: 1 },
  ], links: [{ source: "Fixture Main.md", target: "Fixture Link.md" }] };
  const nodes: SimNode[] = data.nodes.map((node, index) => ({ ...node, index, gi: 0, x: index * 8, y: 0, z: 0, vx: 0, vy: 0, vz: 0, phase: 0, speed: 0 }));
  const assertRunning = () => { if (signal.aborted) throw new Error("Trial cancelled; no acceptance result"); };
  try {
    for (let index = 0; index < 4; index++) {
      const session = new MultiplayerSession({ status() {}, members(_members, selfId) { ids[index] = selfId; }, topology() {}, positions() {}, message() {}, removed() {}, authority() {}, playerState() {}, shotState() {},
        surfaceState(snapshot, hostNow) {
          // Packets queued before fixture setup describe the legitimate ship ->
          // surface transition, not divergence during the measured case.
          if (!running || snapshot.hostTime <= setupAt) return;
          if (!validSurfaceNetworkSnapshot(snapshot, 1)) { invalidSnapshots++; return; }
          if (index === 0 || index === 1) {
            const tail = index === 0 ? publicationTail : receptionTail, at = Date.now();
            if (index === 0) {
              const previous = tail.at(-1); cadence.publications++;
              cadence.firstPublicationAt ||= at; cadence.lastPublicationAt = at;
              if (document.visibilityState === "hidden") cadence.hiddenPublications++;
              if (previous) { const gap = at - previous.receivedAt; cadence.maxGapMs = Math.max(cadence.maxGapMs, gap); if (gap > 125) cadence.gapsOver125Ms++; }
            }
            tail.push({ receivedAt: at, hostTime: snapshot.hostTime }); if (tail.length > 8) tail.shift();
          }
          snapshots[index] = snapshot; estimates[index] = hostNow; receivedAt[index] = Date.now();
          for (const player of snapshot.players) {
            if (player.mode !== "surface" || player.arenaKey !== arenaKey) modeDivergence++;
            if (player.surface && player.arenaKey) histories[index].record({ playerId: player.id, arenaKey: player.arenaKey,
              arenaRevision: snapshot.arenas.find(arena => arena.key === player.arenaKey)?.revision, lifeId: player.lifeId, at: snapshot.hostTime,
              state: player.surface, protected: player.protectedUntil > snapshot.hostTime });
          }
          if (index === 0) for (const hit of snapshot.hitConfirmations) if (!seenHits.has(hit.id)) {
            seenHits.add(hit.id);
            if (hit.ownerId === ids[1] && hit.targetId === ids[2]) attempts.get(hit.sequence)?.hits.add(hit.id);
          }
        },
        surfaceFireResult(sequence, accepted) {
          if (index !== 1) return;
          const attempt = attempts.get(sequence);
          if (attempt && attempt.dispositionAt === undefined) { attempt.dispositionAt = Date.now(); attempt.accepted ??= accepted; }
        },
      }, () => ({ data, nodes }), () => relay);
      sessions.push(session);
      if (index === 0) await session.create("Oracle Host"); else await session.join(sessions[0].room, `Oracle ${index}`);
    }
    const bootUntil = Date.now() + 30000;
    while (!sessions.every(session => session.members.length === 4 && [...fixture(session).peers.values()].filter((peer: any) => peer.pc.connectionState === "connected").length === 3)) {
      assertRunning(); if (Date.now() > bootUntil) throw new Error("Four-client WebRTC mesh did not become ready"); await sleep(100);
    }
    const host = fixture(sessions[0]), hub = sessions[0].localTopology?.nodes.find(node => node.dockable);
    if (!hub || !host.world || !ids.every(Boolean)) throw new Error("Fixture room authority unavailable");
    authority = new SurfaceAuthority(); host.surfaceAuthority = authority; host.surfaceRoundId = host.world.currentRoundId;
    const startAt = setupAt = Date.now(); config = { ...config, referenceAt: startAt };
    authority.setOwnerMap(ids[0], { revision: sessions[0].localTopology!.revision, nodes: [{ id: hub.id, group: 0, degree: 0, dockable: true }], links: [] }, new Float32Array([0, 0, 0]));
    arenaKey = `${ids[0]}/${hub.id}`;
    for (const id of ids) {
      authority.addPlayer(id, { position: [0, 0, 38 * SURFACE.worldRadius / SURFACE.radius], rotation: [0, 0, 0, 1], velocity: [0, 0, 0] });
      const flightPlayer = host.world.players.get(id); flightPlayer.active = true; flightPlayer.input.active = true;
      if (!authority.dock(id, ids[0], hub.id, startAt) || !host.world.setSurfaceDocked(id, true, undefined, startAt)) throw new Error("Fixture docking failed");
    }
    fixture(authority.world).arenas.get(arenaKey).arena.walls = walls.map((wall, index) => ({ ...wall, connectionId: `n-00000000-0000-4000-8000-${String(Math.floor(index / 2)).padStart(12, "0")}` }));
    fixture(authority.world).arenas.get(arenaKey).arena.pickups.forEach((pickup: any) => { if (pickup.kind === "small-health") pickup.placement = "cover"; });
    const realUpdate = authority.world.updatePlayer.bind(authority.world);
    authority.world.updatePlayer = (id, controls, dt, now) => {
      const player = fixture(authority!.world).players.get(id);
      player.health = 100; player.armor = 0; player.protectedUntil = 0;
      const result = realUpdate(id, controls, dt, now);
      if (id === ids[2]) player.surface = latencyTargetState(config, now);
      else if (id === ids[1]) player.surface = { ...createSurfacePlayerState(), crouched: config.stance.includes("crouched"), lean: config.stance.includes("leaning") ? 0.35 : 0 };
      else player.surface = createSurfacePlayerState(id === ids[0] ? [1, 0, 0] : [-1, 0, 0]);
      return result;
    };
    const realFire = authority.fire.bind(authority);
    authority.fire = (...args) => {
      const result = realFire(...args), attempt = args[0] === ids[1] ? attempts.get(args[1]) : null;
      if (attempt) {
        attempt.accepted = result.accepted; attempt.reason = result.reason;
        if (result.reason) rejected[result.reason] = (rejected[result.reason] ?? 0) + 1;
        if (result.reason === "view-time" && viewTimeRejections.length < 1000) {
          const measuredRttMs = fixture(authority).connectionTiming.get(args[0])?.measuredRtt(args[5]) ?? null;
          const viewTime = Number(args[2]), issued = args[4].filter(time => Number.isSafeInteger(time) && time <= args[5]).slice().sort((a, b) => a - b);
          const before = issued.filter(time => time <= viewTime).at(-1), after = issued.find(time => time >= viewTime);
          viewTimeRejections.push({ sequence: args[1], hostAgeMs: args[5] - viewTime, requestDelayMs: args[5] - attempt.at,
            measuredRttMs, expectedAgeMs: measuredRttMs === null ? null : 75 + measuredRttMs / 2,
            issuedBeforeMs: before === undefined ? null : viewTime - before, issuedAfterMs: after === undefined ? null : after - viewTime,
            viewExhausted: attempt.viewExhausted, snapshotAgeMs: attempt.snapshotAgeMs, estimatedOffsetMs: attempt.estimatedOffsetMs,
            visibility: document.visibilityState, publicationTail: publicationTail.map(item => ({ ...item })), receptionTail: receptionTail.map(item => ({ ...item })),
            channels: [sessions[0], sessions[1]].map((session, index) => {
              const peer = fixture(session).peers.get(ids[index === 0 ? 1 : 0]);
              return { side: index === 0 ? "host" : "shooter", liveBuffered: peer?.live?.bufferedAmount ?? null, reliableBuffered: peer?.control?.bufferedAmount ?? null,
                pendingStreams: fixture(session).liveLatest.get(ids[index === 0 ? 1 : 0])?.size ?? 0 };
            }) });
        }
      }
      if (result.projectile) maxRewindMs = Math.max(maxRewindMs, fixture(authority).projectiles.find((shot: any) => shot.id === result.projectile!.id)?.rewindMs ?? 0);
      return result;
    };
    const realStep = authority.step.bind(authority);
    authority.step = (dt, now) => {
      const wallNow = Date.now(); cadence.simulationSteps++; cadence.firstStepAt ||= wallNow;
      if (cadence.lastStepAt) cadence.maxStepGapMs = Math.max(cadence.maxStepGapMs, wallNow - cadence.lastStepAt);
      cadence.lastStepAt = wallNow;
      const starts = new Map<string, [number, number, number]>(fixture(authority).projectiles.filter((shot: any) => !shot.stoppedAt).map((shot: any) => [shot.id, [...shot.position]]));
      realStep(dt, now);
      for (const shot of fixture(authority).projectiles) {
        const start = starts.get(shot.id);
        if (!start || !shot.stoppedAt || !fixture(authority).hitConfirmations.some((hit: any) => hit.at === now && hit.sequence === shot.sequence && hit.ownerId === shot.ownerId)) continue;
        const blocker = traceSurfaceSegment(start, shot.position, walls, []); if (blocker && blocker.t < 1 - 1e-6) blockerViolations++;
      }
    };
    running = true;
    // Production host loops retain 60 Hz simulation / 20 Hz publication. Clients
    // send ordinary neutral stance controls; the explicit fixture owns trajectories.
    simulationTimer = window.setInterval(() => {
      tick++;
      for (let i = 0; i < 4; i++) {
        const player = snapshots[i]?.players.find(player => player.id === ids[i]);
        if (player?.surface && player.arenaKey) sessions[i].sendSurfaceInput({ moveX: 0, moveY: 0, sprint: false, jump: false, crouch: player.surface.crouched, yawDelta: 0, pitchDelta: 0, lean: Math.sign(player.surface.lean), interact: false }, player.arenaKey, player.lifeId);
      }
    }, 1000 / 60);
    let sequence = 0, nextFire = startAt + 2000, finishedAt = Infinity;
    const timeoutAt = startAt + 5000 + required * 2 * 650;
    while (Date.now() < timeoutAt) {
      assertRunning(); const now = Date.now(), snapshot = snapshots[1], shooter = snapshot?.players.find(player => player.id === ids[1]);
      const accepted = [...attempts.values()].filter(attempt => attempt.accepted).length;
      const sampleComplete = sampleMode === "attempts" ? attempts.size >= required : accepted >= required;
      if (sampleComplete && finishedAt === Infinity) finishedAt = now + 3000;
      if (now >= finishedAt || sequence >= required * 2 && now >= nextFire + 3000) break;
      if (now >= nextFire && !sampleComplete && sequence < required * 2 && snapshot && shooter?.surface && shooter.arenaKey) {
        const displayed = presentSurfacePlayers(histories[1], snapshot.players, new Map(snapshot.arenas.map(arena => [arena.key, arena])), ids[1], shooter.arenaKey, estimates[1] + Math.max(0, now - receivedAt[1]), snapshot.hostTime);
        const target = displayed.samples.find(sample => sample.player.id === ids[2]);
        if (target) {
          const pose = surfaceViewPose(shooter.surface), state = target.frame.state, up = unit(new THREE.Vector3(...state.position));
          const forward = unit(new THREE.Vector3(...state.forward).projectOnPlane(up)), right = unit(new THREE.Vector3().crossVectors(forward, up));
          const point = new THREE.Vector3(...state.position).addScaledVector(up, state.crouched ? 0.7 : 1.2).addScaledVector(right, state.lean)
            .addScaledVector(new THREE.Vector3(...state.velocity), config.distance / SURFACE_BLASTER.boltSpeed).addScaledVector(right, Math.sin((sequence + 1) * 2.399963) * 0.3);
          const aim = point.sub(new THREE.Vector3(...pose.muzzle)).normalize().toArray() as [number, number, number], representedAt = Math.floor(displayed.representedAt);
          sequence++; attempts.set(sequence, { sequence, at: now, representedAt, oracle: latencyOracle(config, state, representedAt, pose.muzzle, aim, sequence, shooter.surface, walls, ids[1]), hits: new Set(),
            viewExhausted: displayed.exhausted, snapshotAgeMs: now - snapshot.hostTime, estimatedOffsetMs: estimates[1] - receivedAt[1] });
          sessions[1].fireSurface(sequence, representedAt, shooter.arenaKey, shooter.lifeId, aim); nextFire = now + 600;
        }
      }
      if (tick % 20 === 0) progress(`${config.scenario} ${config.distance}u ${config.stance}: ${attempts.size} attempts; ${accepted}${sampleMode === "accepted" ? `/${required}` : ""} accepted; ${sampleMode === "attempts" ? `${required}-attempt stability sample; ` : ""}${Math.round((now - startAt) / 1000)}s; ${rejected["view-time"] ?? 0} view-time rejections; snapshot age ${snapshot ? now - snapshot.hostTime : "unknown"}ms`);
      await sleep(16);
    }
    const rows = [...attempts.values()], count = rows.length, accepted = rows.filter(row => row.accepted).length;
    const oracleHits = rows.filter(row => row.oracle).length, actualHits = rows.filter(row => row.hits.size).length;
    const mismatches = rows.filter(row => row.oracle !== !!row.hits.size), agreement = count ? 1 - mismatches.length / count : 0, deficit = count ? (oracleHits - actualHits) / count : 1;
    const latencies = rows.map(row => row.dispositionAt === undefined ? Infinity : row.dispositionAt - row.at).sort((a, b) => a - b);
    const percentile = (p: number) => latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)] ?? Infinity;
    const within600 = latencies.filter(value => value <= 600).length / Math.max(1, count), within1000 = latencies.filter(value => value <= 1000).length / Math.max(1, count);
    const duplicateHits = rows.reduce((sum, row) => sum + Math.max(0, row.hits.size - 1), 0);
    const transport = [];
    for (const session of sessions) for (const peer of fixture(session).peers.values()) {
      const report = await peer.pc.getStats(), selected = [...report.values()].find((item: any) => item.type === "transport" && item.selectedCandidatePairId) as any;
      const pair = selected && report.get(selected.selectedCandidatePairId), remote = pair && report.get(pair.remoteCandidateId);
      transport.push({ state: peer.pc.connectionState, proxy: remote?.address === "127.0.0.1", rttMs: Math.round((pair?.currentRoundTripTime ?? 0) * 1000) });
    }
    const eligible = required >= 500, sampleSatisfied = sampleMode === "attempts" ? count >= required : accepted >= required;
    const passed = sampleSatisfied && invalidSnapshots === 0 && modeDivergence === 0 && duplicateHits === 0 && blockerViolations === 0 && maxRewindMs <= 150
      && transport.length === 12 && transport.every(connection => connection.state === "connected" && connection.proxy)
      && (config.rttMs > 100 || agreement >= 0.9 && deficit <= 0.05) && (config.rttMs !== 200 || within600 >= 0.95 && within1000 >= 0.99);
    return { scope: "Four real room clients in one browser context. Native WebRTC with loopback UDP impairment. Scripted poses and per-tick HP resets isolate hit registration; no WebGL, death/round lifecycle, cross-device clock, or rendered ghost assertions.", config, sampleMode, eligible, passed, clients: 4, attempts: count, accepted, dispositions: rows.filter(row => row.dispositionAt !== undefined).length,
      oracleHits, actualHits, agreement, hitRateDeficit: deficit, dispositionP95Ms: percentile(0.95), dispositionP99Ms: percentile(0.99), within600Ms: within600, within1000Ms: within1000,
      duplicateHits, blockerViolations, maxRewindMs, invalidSnapshots, modeDivergence, cadence: { ...cadence,
        publicationHz: (cadence.publications - 1) * 1000 / Math.max(1, cadence.lastPublicationAt - cadence.firstPublicationAt),
        simulationHz: (cadence.simulationSteps - 1) * 1000 / Math.max(1, cadence.lastStepAt - cadence.firstStepAt) },
      rejectionReasons: rejected, viewTimeRejections, mismatchSequences: mismatches.slice(0, 12).map(row => row.sequence), spreadSeedPlayerId: ids[1], transport };
  } finally {
    running = false; clearInterval(simulationTimer); for (const session of sessions) session.leave();
  }
}
