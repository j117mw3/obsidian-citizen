/** Maximum gap from a main node's surface at which docking is allowed, in world units. */
export const PILOT_DOCK_RANGE_WORLD_UNITS = 14;

export type SurfaceDockReason = "preparation" | "not-ready" | "target" | "connection" | "timeout" | "interrupted";

export function isSurfaceDockReason(value: unknown): value is SurfaceDockReason {
  return value === "preparation" || value === "not-ready" || value === "target" || value === "connection" || value === "timeout" || value === "interrupted";
}

export function surfaceDockFailureMessage(reason?: SurfaceDockReason): string {
  switch (reason) {
    case "preparation": return "Planet preparation failed: no accessible combat layout. Try a different main node.";
    case "not-ready": return "Dock unavailable · wait for the room and combat round to be ready, then release F and retry.";
    case "target": return "Dock target changed · aim at a current main sphere, then release F and retry.";
    case "connection": return "Dock request could not reach the host · wait for the connection, then release F and retry.";
    case "timeout": return "Docking timed out · no surface entry within 5s. Release F and retry.";
    case "interrupted": return "Docking interrupted by a room or host change. Release F and retry.";
    default: return `Dock rejected · wait 3s after damage, stay within ${PILOT_DOCK_RANGE_WORLD_UNITS}u and below speed 10; the arena may be full. Release F to retry.`;
  }
}
