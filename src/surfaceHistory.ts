import type { SurfacePlayerState } from "./surfacePhysics";
import { SURFACE } from "./surface";

export const SURFACE_HISTORY_MS = 250;
export const MAX_SURFACE_REWIND_MS = 150;
export const MAX_SURFACE_CLOCK_OFFSET_MS = 2000;
export const SURFACE_INTERPOLATION_MS = 75;
export const SURFACE_EXTRAPOLATION_MS = 50;
const MAX_SAMPLE_GAP_MS = 50;

export interface SurfaceHistoryFrame {
  playerId: string;
  arenaKey: string;
  arenaRevision?: number;
  lifeId: number;
  at: number;
  state: SurfacePlayerState;
  protected: boolean;
}

function validFrame(frame: SurfaceHistoryFrame): boolean {
  return !!frame.playerId && !!frame.arenaKey && Number.isSafeInteger(frame.lifeId) && frame.lifeId > 0
    && Number.isFinite(frame.at) && frame.state.position.every(Number.isFinite) && frame.state.forward.every(Number.isFinite)
    && frame.state.velocity.every(Number.isFinite) && Number.isFinite(frame.state.pitch) && Number.isFinite(frame.state.lean);
}

function cloneFrame(frame: SurfaceHistoryFrame): SurfaceHistoryFrame {
  return { ...frame, state: { ...frame.state, position: [...frame.state.position], velocity: [...frame.state.velocity], forward: [...frame.state.forward] } };
}

/** Bounded authoritative poses for target-hitbox rewind; resources are intentionally absent. */
export class SurfaceHistory {
  private readonly frames = new Map<string, SurfaceHistoryFrame[]>();

  record(frame: SurfaceHistoryFrame): boolean {
    if (!validFrame(frame)) return false;
    const ring = this.frames.get(frame.playerId) ?? [];
    const previous = ring[ring.length - 1];
    if (previous && frame.at < previous.at) return false;
    if (previous && frame.at === previous.at) ring[ring.length - 1] = cloneFrame(frame);
    else ring.push(cloneFrame(frame));
    const cutoff = frame.at - SURFACE_HISTORY_MS;
    while (ring.length > 1 && ring[1].at < cutoff) ring.shift();
    while (ring.length > 18) ring.shift();
    this.frames.set(frame.playerId, ring);
    return true;
  }

  sample(playerId: string, at: number, arenaKey: string, lifeId: number, arenaRevision?: number, maxGapMs = MAX_SAMPLE_GAP_MS): SurfaceHistoryFrame | null {
    const ring = this.frames.get(playerId);
    if (!ring?.length || !Number.isFinite(at) || !arenaKey || !Number.isSafeInteger(lifeId)) return null;
    let afterIndex = ring.findIndex(frame => frame.at >= at);
    if (afterIndex < 0) afterIndex = ring.length;
    const before = ring[Math.max(0, afterIndex - 1)];
    const after = ring[Math.min(ring.length - 1, afterIndex)];
    if (!before || !after || at < before.at - 1e-6 || at > after.at + 1e-6) return null;
    if (before.arenaKey !== arenaKey || after.arenaKey !== arenaKey || before.lifeId !== lifeId || after.lifeId !== lifeId
      || before.arenaRevision !== after.arenaRevision || (arenaRevision !== undefined && before.arenaRevision !== arenaRevision)
      || before.protected !== after.protected || after.at - before.at > maxGapMs) return null;
    if (before === after || Math.abs(after.at - before.at) < 1e-6) return cloneFrame(before);
    const t = Math.max(0, Math.min(1, (at - before.at) / (after.at - before.at)));
    const lerp = (a: number, b: number) => a + (b - a) * t;
    const position = before.state.position.map((value, i) => lerp(value, after.state.position[i])) as [number, number, number];
    const radius = Math.hypot(...position);
    if (!(radius > 1e-6)) return null;
    const altitudeRadius = lerp(Math.hypot(...before.state.position), Math.hypot(...after.state.position));
    const scale = altitudeRadius / radius;
    const forward = before.state.forward.map((value, i) => lerp(value, after.state.forward[i])) as [number, number, number];
    const normal = position.map(value => value / radius) as [number, number, number];
    const tangent = forward.map((value, i) => value - normal[i] * (forward[0] * normal[0] + forward[1] * normal[1] + forward[2] * normal[2])) as [number, number, number];
    const forwardLength = Math.hypot(...tangent) || 1;
    return {
      ...cloneFrame(before), at,
      state: {
        ...before.state,
        position: position.map(value => value * scale) as [number, number, number],
        velocity: before.state.velocity.map((value, i) => lerp(value, after.state.velocity[i])) as [number, number, number],
        forward: tangent.map(value => value / forwardLength) as [number, number, number],
        pitch: lerp(before.state.pitch, after.state.pitch), lean: lerp(before.state.lean, after.state.lean),
        crouched: t < 0.5 ? before.state.crouched : after.state.crouched,
        grounded: t < 0.5 ? before.state.grounded : after.state.grounded,
        jumpHeld: t < 0.5 ? before.state.jumpHeld : after.state.jumpHeld,
      },
    };
  }

  /** Return the pose actually displayed, including its bounded represented time when updates stall. */
  present(playerId: string, at: number, arenaKey: string, lifeId: number, arenaRevision?: number): { frame: SurfaceHistoryFrame; exhausted: boolean } | null {
    const sampled = this.sample(playerId, at, arenaKey, lifeId, arenaRevision, 125);
    if (sampled) return { frame: sampled, exhausted: false };
    const frames = this.frames.get(playerId)?.filter(frame => frame.arenaKey === arenaKey && frame.lifeId === lifeId
      && (arenaRevision === undefined || frame.arenaRevision === arenaRevision));
    if (!frames?.length || !Number.isFinite(at)) return null;
    const first = frames[0], latest = frames[frames.length - 1];
    if (at < first.at) return { frame: cloneFrame(first), exhausted: false };
    if (at < latest.at) {
      const previous = frames.slice().reverse().find(frame => frame.at <= at);
      return previous ? { frame: cloneFrame(previous), exhausted: true } : null;
    }
    const milliseconds = Math.min(SURFACE_EXTRAPOLATION_MS, at - latest.at), dt = milliseconds / 1000;
    const frame = cloneFrame(latest), state = frame.state, radius = Math.hypot(...state.position);
    const up = state.position.map(value => value / radius);
    const candidate = state.position.map((value, axis) => value + state.velocity[axis] * dt - (state.grounded ? 0 : up[axis] * SURFACE.gravity * dt * dt / 2));
    const candidateRadius = Math.hypot(...candidate);
    if (candidateRadius > 1e-8) {
      const normal = candidate.map(value => value / candidateRadius);
      state.position = normal.map(value => value * (state.grounded ? radius : Math.max(SURFACE.radius, candidateRadius))) as [number, number, number];
      const projection = state.forward.reduce((sum, value, axis) => sum + value * normal[axis], 0);
      const tangent = state.forward.map((value, axis) => value - normal[axis] * projection), length = Math.hypot(...tangent) || 1;
      state.forward = tangent.map(value => value / length) as [number, number, number];
    }
    frame.at = latest.at + milliseconds;
    return { frame, exhausted: at - latest.at > SURFACE_EXTRAPOLATION_MS };
  }

  latest(playerId: string): SurfaceHistoryFrame | null {
    const ring = this.frames.get(playerId);
    return ring?.length ? cloneFrame(ring[ring.length - 1]) : null;
  }

  earliest(playerId: string): SurfaceHistoryFrame | null {
    const ring = this.frames.get(playerId);
    return ring?.length ? cloneFrame(ring[0]) : null;
  }

  clear(): void { this.frames.clear(); }
  clearPlayer(playerId: string): void { this.frames.delete(playerId); }
}

/** Host-owned transport timing; none of these samples are accepted from a gameplay payload. */
export class SurfaceConnectionTiming {
  private rtt: number | null = null;
  private sampledAt = -Infinity;
  observe(roundTripMs: number, now: number): boolean {
    if (!Number.isFinite(roundTripMs) || roundTripMs < 0 || roundTripMs > 2000 || !Number.isFinite(now) || now < this.sampledAt) return false;
    this.rtt = this.rtt === null ? roundTripMs : this.rtt * 0.8 + roundTripMs * 0.2; this.sampledAt = now;
    return true;
  }
  measuredRtt(now: number): number | null { return now >= this.sampledAt && now - this.sampledAt <= 5000 ? this.rtt : null; }
}

/** Issued history and host-measured timing constrain the represented view; compensation has its own hard cap. */
export function validateSurfaceViewTime(viewTime: unknown, now: number, issuedTimes: readonly number[], measuredRttMs: number | null = null): { accepted: boolean; rewindMs: number } {
  if (!Number.isSafeInteger(viewTime) || !Number.isFinite(now)) return { accepted: false, rewindMs: 0 };
  const representedAt = viewTime as number;
  const ordered = issuedTimes.filter(time => Number.isSafeInteger(time) && time <= now).slice().sort((a, b) => a - b);
  const bracketed = ordered.includes(representedAt) || ordered.some((time, index) => index > 0
    && ordered[index - 1] <= representedAt && representedAt <= time && time - ordered[index - 1] <= 100);
  if (representedAt > now || now - representedAt > SURFACE_HISTORY_MS || !bracketed) return { accepted: false, rewindMs: 0 };
  const age = now - representedAt;
  if (measuredRttMs === null) return { accepted: age === 0, rewindMs: 0 };
  if (!Number.isFinite(measuredRttMs) || measuredRttMs < 0 || measuredRttMs > 2000) return { accepted: false, rewindMs: 0 };
  const expectedAge = SURFACE_INTERPOLATION_MS + measuredRttMs / 2;
  if (age < Math.max(0, expectedAge - 100) || age > expectedAge + 50) return { accepted: false, rewindMs: 0 };
  return { accepted: true, rewindMs: Math.min(MAX_SURFACE_REWIND_MS, age) };
}

/** NTP-style host clock estimate used by surface interpolation and shot timestamps. */
export class SurfaceHostClock {
  private offsetMs: number | null = null;
  private rttMs = 100;

  observePing(clientSentAt: number, hostReceivedAt: number, hostSentAt: number, clientReceivedAt: number): boolean {
    if (![clientSentAt, hostReceivedAt, hostSentAt, clientReceivedAt].every(Number.isFinite)
      || clientReceivedAt < clientSentAt || hostSentAt < hostReceivedAt) return false;
    const rtt = (clientReceivedAt - clientSentAt) - (hostSentAt - hostReceivedAt);
    if (rtt < 0 || rtt > 2000) return false;
    const offset = ((hostReceivedAt - clientSentAt) + (hostSentAt - clientReceivedAt)) / 2;
    if (Math.abs(offset) > MAX_SURFACE_CLOCK_OFFSET_MS) return false;
    this.offsetMs = this.offsetMs === null ? offset : this.offsetMs + (offset - this.offsetMs) * 0.2;
    this.rttMs = this.rttMs * 0.8 + rtt * 0.2;
    return true;
  }

  observeSnapshot(hostTime: number, localReceivedAt: number): void {
    if (!Number.isFinite(hostTime) || !Number.isFinite(localReceivedAt)) return;
    const offset = hostTime + this.rttMs / 2 - localReceivedAt;
    if (this.offsetMs === null) this.offsetMs = offset;
  }

  estimateHostTime(localNow: number): number { return localNow + (this.offsetMs ?? 0); }
  get roundTripMs(): number { return this.rttMs; }
  reset(): void { this.offsetMs = null; this.rttMs = 100; }
}
