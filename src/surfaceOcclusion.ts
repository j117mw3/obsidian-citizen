import type { SurfaceVector, SurfaceWall } from "./surface";
import { terrainForWalls, terrainQuery } from "./surfaceTerrain";
import { traceSurfaceWallSegment } from "./surfaceCombat";

export interface OcclusionStats { visitedCells:number; terrainSamples:number; queries:number; queryMs:number }
export const emptyOcclusionStats = ():OcclusionStats => ({visitedCells:0,terrainSamples:0,queries:0,queryMs:0});
/** Segment/sphere interval, including cameras inside the enclosing sphere. */
export function clipSurfaceSegment(start:SurfaceVector,end:SurfaceVector,radius:number):[SurfaceVector,SurfaceVector]|null {
  const delta=end.map((value,k)=>value-start[k]),a=delta.reduce((sum,v)=>sum+v*v,0);
  const c=start.reduce((sum,v)=>sum+v*v,0)-radius*radius;
  if(a<1e-20)return c<=0?[[...start],[...end]]:null;
  const b=start.reduce((sum,v,k)=>sum+v*delta[k],0),d=b*b-a*c;
  if(d<0)return null;
  const root=Math.sqrt(Math.max(0,d)),low=Math.max(0,(-b-root)/a),high=Math.min(1,(-b+root)/a);
  if(low>high)return null;
  return [start.map((v,k)=>v+delta[k]*low) as [number,number,number],start.map((v,k)=>v+delta[k]*high) as [number,number,number]];
}
// Wall motion changes bearings, not dimensions. Cache conservative radii by immutable geometry identity.
const bounds=new WeakMap<readonly SurfaceWall[],{length:number;radius:number;outer:number}>();
export function surfaceOcclusionRadius(walls:readonly SurfaceWall[],radius:number):number {
  const cached=bounds.get(walls);if(cached&&cached.length===walls.length&&cached.radius===radius)return cached.outer;
  let extension=4; // Includes generated static ruins (2.2 high with <=3.2-wide footprints).
  for(const wall of walls)extension=Math.max(extension,wall.height+Math.hypot(wall.length/2,(wall.thickness??.55)/2));
  const outer=radius+(terrainForWalls(walls)?3:0)+extension+.01;
  bounds.set(walls,{length:walls.length,radius,outer});return outer;
}
/** Presentation only: distant targets never expand terrain probes or wall-grid work. */
export function isSurfaceSegmentOccluded(start:SurfaceVector,end:SurfaceVector,walls:readonly SurfaceWall[],radius:number,stats?:OcclusionStats):boolean {
  const began=stats?performance.now():0,work=stats??emptyOcclusionStats();if(stats)stats.queries++;
  try {
    const segment=clipSurfaceSegment(start,end,surfaceOcclusionRadius(walls,radius));if(!segment)return false;
    const terrain=terrainForWalls(walls),ground=clipSurfaceSegment(segment[0],segment[1],radius+(terrain?3.001:0));
    if(ground&&(terrain?terrainQuery(terrain).ray(...ground,work)!==null:true))return true;
    return traceSurfaceWallSegment(...segment,walls,radius,work);
  } finally {if(stats)stats.queryMs+=performance.now()-began;}
}
