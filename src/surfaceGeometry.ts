import { validateTerrainLayout } from "./surfaceTerrainLayout";
import { bindSurfaceTerrain, createTerrainDefinition, terrainQuery } from "./surfaceTerrain";
import { SURFACE, type SurfaceArena, type SurfaceVector, type SurfaceWall, type SurfacePickup } from "./surface";
import { SurfacePointSlots, SurfaceSpatialGrid } from "./surfaceSpatial";

export interface DirectedSurfaceArena extends SurfaceArena { radius: number; walls: Array<SurfaceWall & { connectionId: string }> }
export const surfaceRadiusForConnections = (count: number): number => 27 * Math.sqrt(Math.max(1, count / 16));
const length = (v: SurfaceVector) => Math.hypot(...v);
const unit = (v: SurfaceVector): [number, number, number] => { const d = length(v); return v.map(n => n / d) as [number, number, number]; };
const scaled = (v: SurfaceVector, scale: number): [number, number, number] => v.map(n => n * scale) as [number, number, number];
const dot = (a: SurfaceVector, b: SurfaceVector) => a.reduce((sum, n, k) => sum + n * b[k], 0);
const distance = (a: SurfaceVector, b: SurfaceVector, radius: number) => radius * Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (length(a) * length(b)))));
const quantize = (v: SurfaceVector): [number, number, number] => v.map(n => (Math.round(n * 1e6) / 1e6) || 0) as [number, number, number];
const poleClear = (n: SurfaceVector, radius: number) => Math.acos(Math.abs(n[1]) / length(n)) * radius >= SURFACE.poleClearance + 0.01;
function randomStream(seed: number): () => number { let state = seed || 1; return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; }; }
function randomNormal(random: () => number): [number, number, number] { const y = random() * 2 - 1, a = random() * Math.PI * 2, r = Math.sqrt(1 - y * y); return [r * Math.cos(a), y, r * Math.sin(a)]; }

/** Two separated surface bearings per linked file; both stay associated with its anonymous ID. */
export function pairedSurfaceBearing(direction: SurfaceVector, side: number, radius: number): SurfaceVector {
  const n = unit(direction), axis: SurfaceVector = Math.abs(n[1]) < .95 ? [0, 1, 0] : [1, 0, 0];
  const tangent = unit([n[1]*axis[2]-n[2]*axis[1], n[2]*axis[0]-n[0]*axis[2], n[0]*axis[1]-n[1]*axis[0]]);
  const angle = (side ? 1 : -1) * 2.6 / radius;
  return unit(n.map((v, k) => v * Math.cos(angle) + tangent[k] * Math.sin(angle)) as [number, number, number]);
}
/** Stable anonymous ordering; radius and pickups stay fixed during an occupied visit. */
function generateDirectedSurfaceArenaCandidate(hubId: string, connectedIds: readonly string[], directions: ReadonlyMap<string, SurfaceVector>, terrainEnabled:boolean, attempt=0): DirectedSurfaceArena {
  if (!hubId.length || hubId.length > 128 || connectedIds.length > 100000 || connectedIds.some(id => !id.length || id.length > 128)) throw new Error("Invalid surface connections");
  const connections = [...new Set(connectedIds.filter(id => id !== hubId))].sort();
  const bearings = connections.map(id => {
    const direction = directions.get(id);
    return direction && direction.length === 3 && direction.every(Number.isFinite) && length(direction) > 1e-8 ? quantize(unit(direction)) : null;
  });
  let seed = 0x811c9dc5;
  const identity = JSON.stringify([hubId, connections.map((id, i) => [id, bearings[i]])]);
  for (let i = 0; i < identity.length; i++) seed = Math.imul(seed ^ identity.charCodeAt(i), 0x01000193) >>> 0;
  seed ||= 1;
  const radius = surfaceRadiusForConnections(connections.length), random = randomStream(seed), grid = new SurfaceSpatialGrid<SurfaceVector>(SURFACE.wallCollisionSpacing);
  const terrain=terrainEnabled?createTerrainDefinition(seed,radius,attempt):undefined,query=terrain?terrainQuery(terrain):undefined;
  let slots: SurfacePointSlots | null = null;
  const safe = (normal: SurfaceVector): boolean => poleClear(normal, radius)
    && (!query || query.routeDistance(normal)>SURFACE.wallLength/2+1.7 && Math.abs(Math.asin(normal[1]))*radius>SURFACE.wallLength/2+1.7
      && !query.staticNear(scaled(normal,radius),6).some(w=>distance(w.normal,normal,radius)<SURFACE.wallLength/2+w.length/2+1)) && grid.near(scaled(normal, radius), SURFACE.wallCollisionSpacing + 0.01)
    .every(other => distance(normal, other, radius) >= SURFACE.wallCollisionSpacing + 0.01);
  const choose = (desired: SurfaceVector): SurfaceVector => {
    if (safe(desired)) return desired;
    if (!slots) {
      const points: SurfaceVector[] = [], count = Math.max(512, connections.length * 8);
      for (let i = 0; i < count; i++) { const y = 1 - 2 * (i + 0.5) / count, a = i * 2.399963229728653, r = Math.sqrt(1 - y * y); const n: SurfaceVector = [r * Math.cos(a), y, r * Math.sin(a)]; if (poleClear(n, radius)) points.push(n); }
      slots = new SurfacePointSlots(points);
    }
    for (let candidate = slots.takeNearest(desired); candidate; candidate = slots.takeNearest(desired)) if (safe(candidate)) return candidate;
    throw new Error("No accessible wall position");
  };
  const walls = connections.flatMap((connectionId, connectionIndex) => {
    const bearing = bearings[connectionIndex] ? unit(bearings[connectionIndex]!) : randomNormal(random);
    return [0, 1].map(side => {
    const index = connectionIndex * 2 + side;
    const normal = quantize(choose(pairedSurfaceBearing(bearing, side, radius)));
    grid.add(normal, scaled(normal, radius));
    const tangent = unit([-normal[2], 0, normal[0]]);
    return { id: `wall-${index}`, connectionId, normal, tangent: quantize(tangent), height: index % 4 === 3 ? SURFACE.tallWallHeight : SURFACE.lowWallHeight, length: SURFACE.wallLength };
    });
  });
  const pickups: SurfacePickup[] = [], pickupRandom = randomStream(seed ^ 0x9e3779b9);
  const specs: Array<Pick<SurfacePickup, "kind" | "placement" | "heal" | "armor" | "respawnMs">> = [
    { kind: "small-health", placement: "cover", heal: 25, armor: 0, respawnMs: 15000 }, { kind: "small-health", placement: "cover", heal: 25, armor: 0, respawnMs: 15000 },
    { kind: "large-health", placement: "open", heal: 50, armor: 0, respawnMs: 30000 }, { kind: "large-health", placement: "open", heal: 50, armor: 0, respawnMs: 30000 },
    { kind: "armor", placement: "cover", heal: 0, armor: 25, respawnMs: 30000 }, { kind: "armor", placement: "open", heal: 0, armor: 25, respawnMs: 30000 },
  ];
  for (const spec of specs) {
    const placement = walls.length ? spec.placement : "open";
    let normal: SurfaceVector | null = null;
    for (let attempt = 0; attempt < 20000; attempt++) {
      const candidate = randomNormal(pickupRandom);
      if (!poleClear(candidate, radius) || pickups.some(p => distance(p.normal, candidate, radius) < 2.5)) continue;
      const nearby = grid.near(scaled(candidate, radius), 10);
      const nearest = Math.min(...nearby.map(w => Math.max(0, distance(w, candidate, radius) - SURFACE.wallLength / 2)));
      if (placement === "cover" ? nearest < 0.8 || nearest > 4 : nearest < 7.5) continue;
      normal = quantize(candidate); break;
    }
    if (!normal) throw new Error("No accessible pickup position");
    pickups.push({ ...spec, placement, id: `pickup-${pickups.length}`, normal });
  }
  if(terrain){
    // Equatorial resources have comparable access from either pole; IDs/timers remain unchanged.
    pickups.forEach((pickup,index)=>{const angle=terrain.routeAngle+(index+.5)*Math.PI/3+.17;pickup.normal=quantize([Math.cos(angle),0,Math.sin(angle)]);});
    bindSurfaceTerrain(walls,terrain);
  }
  const arena={ hubId, seed, radius, walls, pickups, ...(terrain?{terrain}: {}) };
  if(terrain&&!validateTerrainLayout(terrain,arena).valid)throw new Error("Planet preparation failed: protected routes are obstructed");
  return arena;
}

/** Validate whole candidates, including cover placement, before exposing a prepared arena. */
export function generateDirectedSurfaceArena(hubId:string,connectedIds:readonly string[],directions:ReadonlyMap<string,SurfaceVector>=new Map(),terrainEnabled=false):DirectedSurfaceArena {
  if(!terrainEnabled)return generateDirectedSurfaceArenaCandidate(hubId,connectedIds,directions,false);
  for(let attempt=0;attempt<=32;attempt++){
    try{return generateDirectedSurfaceArenaCandidate(hubId,connectedIds,directions,true,attempt);}
    catch(error){if(error instanceof Error&&error.message==="Invalid surface connections")throw error;}
  }
  throw new Error("Planet preparation failed: no accessible combat layout after 32 candidates and deterministic repair");
}

/** Per-node world collision spheres, honoring frozen occupied geometry when supplied. */
export function surfaceWorldRadii(topology: { nodes: Array<{ id: string; dockable: boolean }>; links: Array<[string, string]> }, frozen: ReadonlyMap<string, number> = new Map()): Float32Array {
  const adjacent = new Map<string, Set<string>>();
  for (const [a, b] of topology.links) if (a !== b) {
    if (!adjacent.has(a)) adjacent.set(a, new Set());
    if (!adjacent.has(b)) adjacent.set(b, new Set());
    adjacent.get(a)!.add(b); adjacent.get(b)!.add(a);
  }
  return Float32Array.from(topology.nodes, node => node.dockable ? (frozen.get(node.id) ?? surfaceRadiusForConnections(adjacent.get(node.id)?.size ?? 0)) * 6 / 27 : 6);
}
