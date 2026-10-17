import type { SurfaceVector, SurfaceWall } from "./surface";
export interface TerrainDefinition {
  version: 2 | 3; seed: number; radius: number; profile: 0 | 1 | 2; attempt: number;
  relief: number; routeAngle: number; hash: string; chunkHashes: string[];
}
export type TerrainVector=SurfaceVector;
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const unit=(v:SurfaceVector):[number,number,number]=>{const r=Math.hypot(...v)||1;return [v[0]/r,v[1]/r,v[2]/r];};
const smooth=(v:number)=>{v=clamp(v,0,1);return v*v*v*(v*(v*6-15)+10);};
export function terrainHash(text:string):string {let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619)>>>0;return h.toString(16).padStart(8,"0");}
interface TerrainCrater {normal:SurfaceVector;outer:number;core:number}
const craterCenters=new WeakMap<TerrainDefinition,readonly TerrainCrater[]>();
function centers(def:TerrainDefinition):readonly TerrainCrater[]{let cached=craterCenters.get(def);if(cached)return cached;let random=def.seed||1;const next=()=>{random^=random<<13;random^=random>>>17;random^=random<<5;return(random>>>0)/4294967296;};const angle=next()*Math.PI*2;cached=Array.from({length:5},(_,i)=>{const y=(i-2)*.29+(next()-.5)*.15,a=angle+i*2.399963229728653,r=Math.sqrt(1-y*y),outer=13+(parseInt(terrainHash(`${def.seed}/${i}`),16)%8);return{normal:[r*Math.cos(a),y,r*Math.sin(a)] as SurfaceVector,outer,core:outer*.43};});craterCenters.set(def,cached);return cached;}
export function terrainHeight(def:TerrainDefinition,n:SurfaceVector):number {
  const [x,y,z]=unit(n),r=def.radius,p=(def.seed%10007)*.013;
  const pole=Math.acos(clamp(Math.abs(y),0,1))*r;
  if(pole<=6)return 0;
  if(def.version===3){
    const raw=.95+1.05*Math.sin(x*r*.075+p)+.62*Math.sin(z*r*.059+p*1.3)+.4*Math.cos(y*r*.065+p*.7);
    let crater=0;const craterLocations=centers(def);
    for(const craterLocation of craterLocations){const center=craterLocation.normal,chord=Math.hypot(x-center[0],y-center[1],z-center[2])*r;if(chord>=craterLocation.outer)continue;const bowl=smooth((chord-craterLocation.core)/(craterLocation.outer-craterLocation.core));crater=Math.max(crater,1-bowl);}
    return clamp((raw-crater*.78)*def.relief,-1.5,3)*smooth((pole-6)/34);
  }
  // Shorter landforms produce visible hill shoulders and bowls within a normal firefight distance.
  const raw=.25+.70*Math.sin(x*r*.16+p)+.40*Math.sin(z*r*.14+p*1.3)+.25*Math.cos(y*r*.16+p*.7);
  return clamp(raw*def.relief,-.8,1.6)*smooth((pole-6)/8);
}
export function cubeTerrainNormal(face:number,u:number,v:number):[number,number,number] {
  return unit(([[1,v,-u],[-1,v,u],[u,1,-v],[u,-1,v],[u,v,1],[-u,v,-1]] as [number,number,number][])[face]);
}
function hashes(def:TerrainDefinition):string[] {
  return Array.from({length:6},(_,face)=>terrainHash(JSON.stringify([def.version,def.version===2?"alien-ruins-1":"rolling-craters-1",def.seed,def.radius,def.relief,def.routeAngle,face,
    ...Array.from({length:25},(_,i)=>Math.round(terrainHeight(def,cubeTerrainNormal(face,(i%5)/2-1,Math.floor(i/5)/2-1))*1e6))])));
}
export function createTerrainDefinition(seed:number,radius:number,attempt=0):TerrainDefinition {
  const def:TerrainDefinition={version:3,seed:seed>>>0,radius,profile:(seed>>>0)%3 as 0|1|2,attempt,relief:Math.pow(.94,attempt),routeAngle:((seed>>>0)%6283)/1000,hash:"",chunkHashes:[]};
  def.chunkHashes=hashes(def);def.hash=terrainHash(JSON.stringify([def.version,def.seed,def.radius,def.profile,def.attempt,def.relief,def.routeAngle,def.chunkHashes]));return def;
}
export function createLegacyTerrainDefinition(seed:number,radius:number,attempt=0):TerrainDefinition {
  const def:TerrainDefinition={version:2,seed:seed>>>0,radius,profile:(seed>>>0)%3 as 0|1|2,attempt,relief:Math.pow(.94,attempt),routeAngle:((seed>>>0)%6283)/1000,hash:"",chunkHashes:[]};
  def.chunkHashes=hashes(def);def.hash=terrainHash(JSON.stringify([def.version,def.seed,def.radius,def.profile,def.attempt,def.relief,def.routeAngle,def.chunkHashes]));return def;
}
const checked=new WeakSet<object>();
export function validTerrainDefinition(value:unknown,radius?:number):value is TerrainDefinition {
  if(!value||typeof value!=="object")return false;const d=value as TerrainDefinition;
  if(checked.has(d))return radius===undefined||radius===d.radius;
  if(Object.keys(d).sort().join(",")!=="attempt,chunkHashes,hash,profile,radius,relief,routeAngle,seed,version"||(d.version!==2&&d.version!==3)||!Number.isSafeInteger(d.seed)||d.seed<0||d.seed>4294967295||!Number.isFinite(d.radius)||d.radius<27||d.radius>1000||radius!==undefined&&d.radius!==radius
    ||!Number.isInteger(d.attempt)||d.attempt<0||d.attempt>32||!Array.isArray(d.chunkHashes)||d.chunkHashes.length!==6)return false;
  const expected=d.version===2?createLegacyTerrainDefinition(d.seed,d.radius,d.attempt):createTerrainDefinition(d.seed,d.radius,d.attempt);
  if(d.profile!==expected.profile||d.relief!==expected.relief||d.routeAngle!==expected.routeAngle||d.hash!==expected.hash||d.chunkHashes.some((hash,index)=>hash!==expected.chunkHashes[index]))return false;
  if(Object.isFrozen(d))checked.add(d);return true;
}
const definitions=new WeakMap<readonly SurfaceWall[],TerrainDefinition>();
const wallDefinitions=new WeakMap<SurfaceWall,TerrainDefinition>();
const queries=new WeakMap<TerrainDefinition,SurfaceTerrainQuery>();
export function bindSurfaceTerrain(walls:readonly SurfaceWall[],def?:TerrainDefinition):void {
  if(!def)return;definitions.set(walls,def);for(const wall of walls)wallDefinitions.set(wall,def);
}
export function bindTerrainWall(wall:SurfaceWall,def?:TerrainDefinition):void {if(def)wallDefinitions.set(wall,def);}
export function terrainForWalls(walls:readonly SurfaceWall[]):TerrainDefinition|undefined{return definitions.get(walls);}
export function wallBurial(wall:SurfaceWall):number{return wallDefinitions.has(wall)?.35:0;}
export function wallGroundRadius(wall:SurfaceWall,radius:number):number {const def=wallDefinitions.get(wall);return radius+(def?terrainHeight(def,wall.normal):0);}
export function groundRadius(n:SurfaceVector,walls:readonly SurfaceWall[],radius:number):number {const def=definitions.get(walls);return radius+(def?terrainHeight(def,n):0);}
export function terrainQuery(def:TerrainDefinition):SurfaceTerrainQuery {let query=queries.get(def);if(!query){query=new SurfaceTerrainQuery(def);queries.set(def,query);}return query;}
export class SurfaceTerrainQuery {
  constructor(readonly definition:TerrainDefinition){}
  height(normal:SurfaceVector):number{return terrainHeight(this.definition,normal);}
  normal(position:SurfaceVector):[number,number,number] {
    const n=unit(position),axis:SurfaceVector=Math.abs(n[1])<.9?[0,1,0]:[1,0,0];
    const a=unit([n[1]*axis[2]-n[2]*axis[1],n[2]*axis[0]-n[0]*axis[2],n[0]*axis[1]-n[1]*axis[0]]),b=unit([n[1]*a[2]-n[2]*a[1],n[2]*a[0]-n[0]*a[2],n[0]*a[1]-n[1]*a[0]]),delta=.02;
    const derivative=(t:SurfaceVector)=>(this.height(n.map((v,k)=>v+t[k]*delta/this.definition.radius) as [number,number,number])-this.height(n.map((v,k)=>v-t[k]*delta/this.definition.radius) as [number,number,number]))/(2*delta);
    const da=derivative(a),db=derivative(b);return unit(n.map((v,k)=>v-a[k]*da-b[k]*db) as [number,number,number]);
  }
  signedDistance(point:SurfaceVector):number{return Math.hypot(...point)-this.definition.radius-this.height(point);}
  sweepGround(start:SurfaceVector,end:SurfaceVector):{position:[number,number,number];hit:boolean} {
    const contact=this.ray(start,end);
    if(contact!==null){const point=start.map((v,k)=>v+(end[k]-v)*contact) as [number,number,number];const r=this.definition.radius+this.height(point);return {position:unit(point).map(v=>v*r) as [number,number,number],hit:true};}
    return {position:[...end],hit:false};
  }
  ray(start:SurfaceVector,end:SurfaceVector,stats?:{terrainSamples:number}):number|null {
    const delta=end.map((v,k)=>v-start[k]),length=Math.hypot(...delta);if(length<1e-10)return null;
    // Height gradients are bounded below tan(25 degrees); conservative sphere tracing cannot skip a ridge.
    let distance=0;
    for(let iteration=0;iteration<4096&&distance<=length;iteration++){
      if(stats)stats.terrainSamples++;
      const t=distance/length,p=start.map((v,k)=>v+delta[k]*t) as [number,number,number],gap=this.signedDistance(p);
      if(gap<=.00005)return t;
      distance+=Math.max(.00002,gap/1.5);
    }
    return null;
  }
  routeDistance(n:SurfaceVector):number {const p=unit(n),angle=this.definition.routeAngle;return Math.min(Math.abs(p[0]*Math.cos(angle)+p[2]*Math.sin(angle)),Math.abs(-p[0]*Math.sin(angle)+p[2]*Math.cos(angle)))*this.definition.radius;}
  private readonly cells=new Map<string,readonly SurfaceWall[]>();
  private cell(row:number,column:number):readonly SurfaceWall[]{
    const r=this.definition.radius,rows=Math.ceil(Math.PI*r/16),columns=Math.ceil(2*Math.PI*r/16);
    column=(column%columns+columns)%columns;const key=`${row}/${column}`,cached=this.cells.get(key);if(cached)return cached;
    const hash=parseInt(terrainHash(`${this.definition.seed}/${key}`),16),latitude=(row+.5+(hash%101/100-.5)*.25)*Math.PI/rows-Math.PI/2;
    const longitude=(column+.5+((hash>>>8)%101/100-.5)*.25)*2*Math.PI/columns;
    const n:SurfaceVector=[Math.cos(latitude)*Math.cos(longitude),Math.sin(latitude),Math.cos(latitude)*Math.sin(longitude)];
    const tangent=unit([-n[2],0,n[0]]),result:SurfaceWall[]=[];
    // Two perpendicular meridian routes plus the equatorial crossing are never sealed by ruins.
    if(Math.acos(Math.abs(n[1]))*r>11&&this.routeDistance(n)>5.5&&Math.abs(latitude)*r>5.5){
      const kind=hash%3,across=unit([n[1]*tangent[2]-n[2]*tangent[1],n[2]*tangent[0]-n[0]*tangent[2],n[0]*tangent[1]-n[1]*tangent[0]]);
      // Broken spire, fractured ring, or an excavated courtyard: geometry is assembled per cell.
      const shapes=kind===0?[
        {x:0,z:0,angle:0,length:1.1,height:2.2,thickness:1.1},
        {x:-2,z:1,angle:.3,length:3.2,height:1.3,thickness:.8}]
       :kind===1?[0,1,3,4].map(i=>{const angle=i*Math.PI/3+.2;return {x:Math.cos(angle)*3,z:Math.sin(angle)*3,angle:angle+Math.PI/2,length:2.1,height:i%2?1.3:2.2,thickness:.7};})
       :[{x:-3,z:-2,angle:0,length:2.8,height:1.3,thickness:.8},{x:3,z:2,angle:0,length:2.8,height:1.3,thickness:.8},
         {x:-3,z:1.7,angle:Math.PI/2,length:2.5,height:2.2,thickness:.8},{x:3,z:-1.7,angle:Math.PI/2,length:2.5,height:2.2,thickness:.8}];
      for(let i=0;i<shapes.length;i++){
        const shape=shapes[i],normal=unit(n.map((v,k)=>v+(tangent[k]*shape.x+across[k]*shape.z)/r) as [number,number,number]);
        const margin=Math.hypot(shape.length,shape.thickness)/2+1.6;
        if(this.routeDistance(normal)<margin||Math.abs(Math.asin(normal[1]))*r<margin||Math.acos(Math.abs(normal[1]))*r<6+margin)continue;
        const heading=tangent.map((v,k)=>v*Math.cos(shape.angle)+across[k]*Math.sin(shape.angle)) as [number,number,number],projection=heading.reduce((sum,v,k)=>sum+v*normal[k],0);
        const along=unit(heading.map((v,k)=>v-normal[k]*projection) as [number,number,number]);
        const wall:SurfaceWall={id:`ruin-${kind}-${key}-${i}`,normal,tangent:along,height:shape.height,length:shape.length,thickness:shape.thickness};
        bindTerrainWall(wall,this.definition);result.push(wall);
      }
    }
    // Bounded cache: cells are immutable and can be regenerated without touching gameplay state.
    if(this.cells.size>=2048)this.cells.delete(this.cells.keys().next().value!);
    this.cells.set(key,result);return result;
  }
  staticNear(position:SurfaceVector,range:number):readonly SurfaceWall[]{
    const r=this.definition.radius,n=unit(position),rows=Math.ceil(Math.PI*r/16),columns=Math.ceil(2*Math.PI*r/16);
    const latitude=Math.asin(clamp(n[1],-1,1)),longitude=Math.atan2(n[2],n[0]),arc=Math.min(Math.PI,(range+5)/r);
    const low=Math.max(0,Math.floor((latitude-arc+Math.PI/2)*rows/Math.PI)),high=Math.min(rows-1,Math.floor((latitude+arc+Math.PI/2)*rows/Math.PI));
    const result:SurfaceWall[]=[];
    for(let row=low;row<=high;row++){
      const lat=(row+.5)*Math.PI/rows-Math.PI/2,span=Math.min(Math.PI,arc/Math.max(.01,Math.cos(lat))),center=Math.floor(longitude*columns/(2*Math.PI)),width=Math.min(columns,Math.ceil(span*columns/(2*Math.PI))+2),seen=new Set<number>();
      for(let c=center-width;c<=center+width;c++){const column=(c%columns+columns)%columns;if(seen.has(column))continue;seen.add(column);
        for(const wall of this.cell(row,column)){const dot=n.reduce((sum,v,k)=>sum+v*wall.normal[k],0);if(Math.acos(clamp(dot,-1,1))*r<=range+5)result.push(wall);}
      }
    }
    // Three resources sit beside permanent cover; the other three retain exposed approaches.
    for(const index of [0,1,4]){
      const angle=this.definition.routeAngle+(index+.5)*Math.PI/3+.17,latitude=(index%2?-1:1)*4/r;
      const normal:SurfaceVector=[Math.cos(latitude)*Math.cos(angle),Math.sin(latitude),Math.cos(latitude)*Math.sin(angle)];
      if(Math.acos(clamp(n.reduce((sum,v,k)=>sum+v*normal[k],0),-1,1))*r>range+5||this.routeDistance(normal)<3)continue;
      const wall:SurfaceWall={id:`ruin-resource-${index}`,normal,tangent:[-Math.sin(angle),0,Math.cos(angle)],height:1.3,length:2.5,thickness:.8};bindTerrainWall(wall,this.definition);result.push(wall);
    }
    return result;
  }
}
