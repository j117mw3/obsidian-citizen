import { SurfaceHistory, SURFACE_INTERPOLATION_MS, type SurfaceHistoryFrame } from "./surfaceHistory";
import type { SurfaceArenaView, SurfacePlayerView } from "./surfaceWorld";

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
