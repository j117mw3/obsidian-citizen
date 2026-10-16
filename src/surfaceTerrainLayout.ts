import type { SurfaceArena, SurfaceVector } from './surface';
import { createTerrainDefinition, terrainQuery, type TerrainDefinition } from './surfaceTerrain';
export interface TerrainLayoutValidation { valid:boolean; errors:string[]; samples:number; poleRouteCosts:[number,number]; pickupImbalance:number }
const dot=(a:SurfaceVector,b:SurfaceVector)=>a.reduce((sum,v,k)=>sum+v*b[k],0);
const unit=(v:SurfaceVector):[number,number,number]=>{const r=Math.hypot(...v);return v.map(x=>x/r) as [number,number,number]};
/** Four separate meridian approaches, joined by an equatorial resource route. */
export function validateTerrainLayout(definition:TerrainDefinition,arena?:SurfaceArena):TerrainLayoutValidation {
 const query=terrainQuery(definition),radius=definition.radius,errors:string[]=[],segments=Math.max(32,Math.ceil(Math.PI*radius/3));
 let samples=0;const costs:[number,number]=[0,0],approaches:Array<[number,number]>=[];
 for(let lane=0;lane<4;lane++){
  const angle=definition.routeAngle+Math.PI/2*lane;
  let previous:SurfaceVector|undefined;const laneCosts:[number,number]=[0,0];
  for(let i=0;i<=segments;i++){
   const theta=i*Math.PI/segments,n:SurfaceVector=[Math.sin(theta)*Math.cos(angle),Math.cos(theta),Math.sin(theta)*Math.sin(angle)],height=query.height(n),normal=query.normal(n);
   samples++;if(Math.acos(Math.min(1,dot(normal,n)))>25*Math.PI/180+1e-6)errors.push('Route slope exceeds 25 degrees');
   const p=n.map(x=>x*(radius+height)) as [number,number,number];
   if(previous){const distance=Math.hypot(...p.map((x,k)=>x-previous![k]));costs[i<=segments/2?0:1]+=distance/4;laneCosts[i<=segments/2?0:1]+=distance;}
   previous=p;
  }
  approaches.push(laneCosts);
 }
 // Pole access follows separate meridians and the same equatorial route, so relief is the only asymmetry.
 let imbalance=Math.abs(costs[0]-costs[1])/Math.max(.001,Math.min(...costs));
 // The coarse graph contains both poles, four independent meridian branches, and an equatorial ring.
 // Fine edge samples above measure relief rather than assuming flat great-circle travel cost.
 for(let pickup=0;pickup<6;pickup++){
   const bearing=definition.routeAngle+(pickup+.5)*Math.PI/3+.17;
   const shortest=([0,1] as const).map(pole=>Math.min(...approaches.map((cost,lane)=>{
     const delta=Math.acos(Math.cos(bearing-definition.routeAngle-lane*Math.PI/2));return cost[pole]+delta*radius;
   })));
   imbalance=Math.max(imbalance,Math.abs(shortest[0]-shortest[1])/Math.min(...shortest));
 }
 if(imbalance>.1)errors.push('Pole pickup access differs by more than 10%');
 if(arena){
  for(const wall of arena.walls){
   if(query.routeDistance(wall.normal)<wall.length/2+1.6||Math.abs(Math.asin(wall.normal[1]))*radius<wall.length/2+1.6)errors.push('Moving cover intersects a protected route');
  }
  for(const pickup of arena.pickups){const n=unit(pickup.normal);if(Math.abs(n[1])>1e-5)errors.push('Resource is outside the balanced equatorial route');}
 }
 return {valid:errors.length===0,errors:[...new Set(errors)],samples,poleRouteCosts:costs,pickupImbalance:imbalance};
}
export function prepareTerrainDefinition(seed:number,radius:number):TerrainDefinition {
 for(let attempt=0;attempt<32;attempt++){const definition=createTerrainDefinition(seed,radius,attempt);if(validateTerrainLayout(definition).valid)return definition;}
 // Deterministic repair smooths the relief to the safest supported profile before final rejection.
 const repaired=createTerrainDefinition(seed,radius,32);
 if(validateTerrainLayout(repaired).valid)return repaired;
 throw new Error('Planet preparation failed: no accessible terrain layout after 32 candidates and repair');
}
