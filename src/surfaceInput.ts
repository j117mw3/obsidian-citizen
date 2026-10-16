import { stepSurfacePlayer, type SurfaceInput } from "./surfacePhysics";
import type { SurfaceWall } from "./surface";
import type { SurfacePlayerView } from "./surfaceWorld";

export type SurfaceControls = SurfaceInput & { interact: boolean };
export interface SurfaceInputFrame { sequence: number; arenaKey: string; lifeId: number; input: SurfaceControls }
export const SURFACE_INPUT_RESEND = 12;
export const SURFACE_INPUT_LIMIT = 120;
export const neutralSurfaceInput = (): SurfaceControls => ({ moveX: 0, moveY: 0, sprint: false, jump: false, crouch: false, yawDelta: 0, pitchDelta: 0, lean: 0, interact: false });
export const copySurfaceControls = (input: SurfaceControls): SurfaceControls => ({ moveX: input.moveX, moveY: input.moveY, sprint: input.sprint,
  jump: input.jump, crouch: input.crouch, yawDelta: input.yawDelta, pitchDelta: input.pitchDelta, lean: input.lean, interact: input.interact });

export function validSurfaceControls(value: unknown): value is SurfaceControls {
  if (!value || typeof value !== "object") return false;
  const input = value as SurfaceControls;
  return [input.moveX, input.moveY, input.yawDelta, input.pitchDelta, input.lean].every(Number.isFinite)
    && Math.abs(input.moveX) <= 1 && Math.abs(input.moveY) <= 1 && Math.abs(input.yawDelta) <= Math.PI && Math.abs(input.pitchDelta) <= Math.PI
    && Math.abs(input.lean) <= 1 && [input.sprint, input.jump, input.crouch, input.interact].every(value => typeof value === "boolean");
}

export function validSurfaceInputFrame(value: unknown): value is SurfaceInputFrame {
  if (!value || typeof value !== "object") return false;
  const frame = value as SurfaceInputFrame;
  return Number.isSafeInteger(frame.sequence) && frame.sequence > 0 && typeof frame.arenaKey === "string" && frame.arenaKey.length > 0 && frame.arenaKey.length <= 128
    && Number.isSafeInteger(frame.lifeId) && frame.lifeId > 0 && validSurfaceControls(frame.input);
}

const cloneFrame = (frame: SurfaceInputFrame): SurfaceInputFrame => ({ sequence: frame.sequence, arenaKey: frame.arenaKey, lifeId: frame.lifeId, input: copySurfaceControls(frame.input) });
const identity = (arenaKey: string | null, lifeId: number): string => `${arenaKey ?? "ship"}:${lifeId}`;

/** Host input queue: one fixed tick at a time, with bounded overlapping resends and no repeated mouse deltas. */
export class SurfaceInputBuffer {
  private pending = new Map<number, SurfaceInputFrame>();
  private scope = "";
  private acknowledged: number;
  private highest: number;
  private held = neutralSurfaceInput();
  private receivedAt = -Infinity;

  constructor(sequence = 0) { this.acknowledged = sequence; this.highest = sequence; }
  get acknowledgedSequence(): number { return this.acknowledged; }
  get highestSequence(): number { return this.highest; }
  get queuedCount(): number { return this.pending.size; }

  reset(arenaKey: string | null, lifeId: number): void {
    this.scope = identity(arenaKey, lifeId); this.pending.clear(); this.acknowledged = this.highest;
    this.held = neutralSurfaceInput(); this.receivedAt = -Infinity;
  }

  accept(value: unknown, arenaKey: string, lifeId: number, now: number): boolean {
    if (!Array.isArray(value) || value.length < 1 || value.length > SURFACE_INPUT_RESEND || !Number.isFinite(now)
      || !value.every(frame => validSurfaceInputFrame(frame) && frame.arenaKey === arenaKey && frame.lifeId === lifeId)) return false;
    if (this.scope !== identity(arenaKey, lifeId)) this.reset(arenaKey, lifeId);
    const frames = (value as SurfaceInputFrame[]).slice().sort((a, b) => a.sequence - b.sequence);
    if (this.highest === 0 && this.acknowledged === 0) this.acknowledged = frames[0].sequence - 1;
    let accepted = false;
    for (const frame of frames) {
      if (frame.sequence <= this.acknowledged || this.pending.has(frame.sequence) || this.pending.size >= SURFACE_INPUT_LIMIT) continue;
      this.pending.set(frame.sequence, cloneFrame(frame)); this.highest = Math.max(this.highest, frame.sequence); accepted = true;
    }
    if (accepted) this.receivedAt = now;
    return accepted;
  }

  advance(arenaKey: string, lifeId: number, now: number): SurfaceControls {
    if (this.scope !== identity(arenaKey, lifeId)) this.reset(arenaKey, lifeId);
    if (now - this.receivedAt > 250) {
      this.pending.clear(); this.acknowledged = this.highest; this.held = neutralSurfaceInput();
    }
    let next = this.pending.get(this.acknowledged + 1);
    if (!next && this.pending.size) {
      const earliest = Math.min(...this.pending.keys());
      if (earliest - this.acknowledged > SURFACE_INPUT_RESEND) {
        this.acknowledged = earliest - 1; this.held = neutralSurfaceInput(); next = this.pending.get(earliest);
      }
    }
    const input = next ? { ...next.input } : { ...this.held, yawDelta: 0, pitchDelta: 0 };
    if (next) { this.pending.delete(next.sequence); this.acknowledged = next.sequence; }
    this.held = { ...input, yawDelta: 0, pitchDelta: 0 };
    return input;
  }
}

/** Client movement replay never predicts health, pickups, heat, damage, or exit completion. */
export class SurfacePrediction {
  private scope = "";
  private pending: SurfaceInputFrame[] = [];
  get pendingCount(): number { return this.pending.length; }
  reset(): void { this.scope = ""; this.pending.length = 0; }

  record(frame: SurfaceInputFrame, epoch: number): void {
    const scope = `${epoch}:${identity(frame.arenaKey, frame.lifeId)}`;
    if (this.scope !== scope) { this.scope = scope; this.pending.length = 0; }
    if (!validSurfaceInputFrame(frame) || this.pending.some(item => item.sequence === frame.sequence)) return;
    this.pending.push(cloneFrame(frame)); this.pending.sort((a, b) => a.sequence - b.sequence);
    if (this.pending.length > SURFACE_INPUT_LIMIT) this.pending.splice(0, this.pending.length - SURFACE_INPUT_LIMIT);
  }

  reconcile<T extends SurfacePlayerView & { inputSequence: number }>(view: T, epoch: number, walls: readonly SurfaceWall[]): T {
    const scope = `${epoch}:${identity(view.arenaKey, view.lifeId)}`;
    if (scope !== this.scope || view.mode !== "surface" || !view.surface || view.health <= 0) {
      this.scope = scope; this.pending.length = 0; return view;
    }
    this.pending = this.pending.filter(frame => frame.sequence > view.inputSequence && frame.arenaKey === view.arenaKey && frame.lifeId === view.lifeId);
    let state = view.surface;
    for (const frame of this.pending) state = stepSurfacePlayer(state, frame.input, 1 / 60, walls);
    return { ...view, surface: state };
  }
}
