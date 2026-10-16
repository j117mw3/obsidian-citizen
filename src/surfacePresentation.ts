import { SurfaceHistory, SURFACE_INTERPOLATION_MS, type SurfaceHistoryFrame } from "./surfaceHistory";
import type { SurfaceArenaView, SurfacePlayerView } from "./surfaceWorld";
import type { SurfaceArena } from "./surface";
import { terrainHeight } from "./surfaceTerrain";
import type { SurfacePlayerState } from "./surfacePhysics";

/** Interpolate bot poses along the terrain instead of flattening them to the planet's base radius. */
export function interpolateSurfaceBotState(from: SurfacePlayerState, to: SurfacePlayerState, amount: number, arena: SurfaceArena): SurfacePlayerState {
  const t = Math.max(0, Math.min(1, amount));
  const lerp = (a: readonly number[], b: readonly number[]) => a.map((value, index) => value + (b[index] - value) * t);
  const fromNormal = normalize(from.position), toNormal = normalize(to.position);
  const normal = normalize(lerp(fromNormal, toNormal));
  const radius = arena.radius ?? 27;
  const groundRadius = (n: readonly number[]) => radius + (arena.terrain ? terrainHeight(arena.terrain, n as [number, number, number]) : 0);
  const fromOffset = Math.hypot(...from.position) - groundRadius(fromNormal);
  const toOffset = Math.hypot(...to.position) - groundRadius(toNormal);
  const position = normal.map(value => value * (groundRadius(normal) + fromOffset + (toOffset - fromOffset) * t)) as [number, number, number];
  const forward = lerp(from.forward, to.forward), projection = forward.reduce((sum, value, index) => sum + value * normal[index], 0);
  const tangent = normalize(forward.map((value, index) => value - normal[index] * projection));
  return { ...to, position, forward: tangent, velocity: lerp(from.velocity, to.velocity) as [number, number, number] };
}

function normalize(values: readonly number[]): [number, number, number] {
  const length = Math.hypot(...values) || 1;
  return values.map(value => value / length) as [number, number, number];
}

/** Shared selection of displayed poses and their actual represented firing time. */
export function presentSurfacePlayers<T extends SurfacePlayerView>(history: SurfaceHistory, players: Iterable<T>, arenas: ReadonlyMap<string, SurfaceArenaView>, localId: string, localArenaKey: string | null, estimatedHostNow: number, snapshotTime: number): {
  samples: Array<{ player: T; arena: SurfaceArenaView; frame: SurfaceHistoryFrame }>;
  representedAt: number;
  exhausted: boolean;
} {
  const samples: Array<{ player: T; arena: SurfaceArenaView; frame: SurfaceHistoryFrame }> = [];
  const displayAt = estimatedHostNow - SURFACE_INTERPOLATION_MS;
  let representedAt: number | null = null, exhausted = false;
  for (const player of players) {
    if (player.id === localId || player.mode !== "surface" || !player.surface || !player.arenaKey) continue;
    const arena = arenas.get(player.arenaKey); if (!arena) continue;
    const presentation = history.present(player.id, displayAt, player.arenaKey, player.lifeId, arena.revision);
    if (!presentation) continue;
    if (player.health > 0 && player.arenaKey === localArenaKey) {
      representedAt = representedAt === null ? presentation.frame.at : Math.min(representedAt, presentation.frame.at);
      exhausted ||= presentation.exhausted;
    }
    samples.push({ player, arena, frame: presentation.frame });
  }
  return { samples, representedAt: representedAt ?? snapshotTime, exhausted };
}
