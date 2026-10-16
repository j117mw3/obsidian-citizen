import type { TerrainDefinition } from "./surfaceTerrain";
import type { SurfacePlayerState } from "./surfacePhysics";
/** Shared constants and deterministic surface-arena construction. */
export const SURFACE = Object.freeze({
  radius: 27,
  worldRadius: 6,
  standingHeight: 1.8,
  standingEyeHeight: 1.65,
  crouchedHeight: 1.1,
  crouchedEyeHeight: 0.95,
  playerRadius: 0.3,
  walkSpeed: 4.5,
  crouchSpeed: 2.25,
  sprintSpeed: 8.5,
  gravity: 18,
  jumpHeight: 1.2,
  airControl: 0.3,
  maximumStep: 0.2,
  poleClearance: 6,
  lowWallHeight: 1.3,
  tallWallHeight: 2.2,
  wallLength: 3.5,
  wallThickness: 0.55,
  wallCollisionSpacing: 4.5,
});

export type SurfaceVector = readonly [number, number, number];
export const SURFACE_PARKING_NORMALS: readonly SurfaceVector[] = [[1, 0, 0], [0, 0, 1], [-1, 0, 0], [0, 0, -1]];
/** Feet-relative bottom and total height of the lower and leaned upper damage capsules. */
export function surfaceBodySegments(crouched: boolean): readonly (readonly [number, number])[] {
  return crouched ? [[0, 0.6], [0.3, 0.8]] : [[0, 0.9], [0.6, 1.2]];
}
export type SurfacePickupKind = "small-health" | "large-health" | "armor";
export interface SurfaceWall {
  id: string;
  connectionId?: string;
  thickness?: number;
  normal: SurfaceVector;
  tangent: SurfaceVector;
  height: number;
  length: number;
}
export interface SurfacePickup {
  id: string;
  kind: SurfacePickupKind;
  normal: SurfaceVector;
  placement: "cover" | "open";
  heal: number;
  armor: number;
  respawnMs: number;
}

export interface SurfaceBotView {
  id: string;
  index: number;
  arenaKey: string;
  lifeId: number;
  state: SurfacePlayerState;
  health: number;
  /** Normally zero; solo training controls may enable a practice armor layer. */
  armor: number;
  aggressive: boolean;
  targetId: string;
  respawnAt: number;
}

export interface SurfaceBotShotView {
  id: string;
  botId: string;
  arenaKey: string;
  sequence: number;
  position: SurfaceVector;
  direction: SurfaceVector;
  travelled: number;
  startedAt: number;
  stoppedAt: number;
}

export interface SurfaceBotDropView {
  id: string;
  arenaKey: string;
  position: SurfaceVector;
  heal: 30;
  available: boolean;
  expiresAt: number;
}
export interface SurfaceArena {
  hubId: string;
  radius?: number;
  seed: number;
  terrain?: TerrainDefinition;
  walls: SurfaceWall[];
  pickups: SurfacePickup[];
}

export interface MainNodeCandidate {
  id: string;
  group: string;
  deg: number;
}

/** Select one highest-degree hub per group; an exact tie uses the local note path. */
export function selectMainNodeIds(nodes: readonly MainNodeCandidate[]): Set<string> {
  const best = new Map<string, MainNodeCandidate>();
  for (const node of nodes) {
    if (typeof node.id !== "string" || typeof node.group !== "string" || !Number.isFinite(node.deg)) continue;
    const current = best.get(node.group);
    if (!current || node.deg > current.deg || (node.deg === current.deg && node.id < current.id)) best.set(node.group, node);
  }
  return new Set([...best.values()].map(node => node.id));
}

export { generateDirectedSurfaceArena as generateSurfaceArena } from "./surfaceGeometry";
