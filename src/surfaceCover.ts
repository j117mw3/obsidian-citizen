import { bindSurfaceTerrain, bindTerrainWall, terrainQuery } from "./surfaceTerrain";
import { SURFACE, surfaceBodySegments, type SurfaceArena, type SurfaceVector, type SurfaceWall } from "./surface";
import { pairedSurfaceBearing } from "./surfaceGeometry";
import { SurfaceSpatialGrid } from "./surfaceSpatial";
import { surfaceCapsuleWallContact, updateSurfaceWallIndex } from "./surfaceCollision";
import type { SurfacePlayerState } from "./surfacePhysics";

const point = (n: SurfaceVector, r: number): [number, number, number] => n.map(v => v*r) as [number, number, number];
const distance = (a: SurfaceVector,b: SurfaceVector) => Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]);
const unit = (n: SurfaceVector): [number,number,number] => {const r=Math.hypot(...n)||1;return n.map(v=>v/r) as [number,number,number];};
function touchesPlayer(wall: SurfaceWall, player: SurfacePlayerState, radius: number): boolean {
  if(surfaceCapsuleWallContact(player.position,player.crouched?SURFACE.crouchedHeight:SURFACE.standingHeight,wall,undefined,radius))return true;
  if(!player.lean)return false;
  const up=unit(player.position),f=player.forward,right=unit([f[1]*up[2]-f[2]*up[1],f[2]*up[0]-f[0]*up[2],f[0]*up[1]-f[1]*up[0]]);
  const [bottom,height]=surfaceBodySegments(player.crouched)[1],feet=player.position.map((n,k)=>n+up[k]*bottom+right[k]*player.lean) as [number,number,number];
  return !!surfaceCapsuleWallContact(feet,height,wall,up,radius);
}
export const SURFACE_COVER_SPEED = .8;
export class SurfaceCoverMotion {
  readonly walls: SurfaceWall[];
  readonly networkTargets = new Map<number, SurfaceVector>();
  private readonly headings=new Map<number,SurfaceVector>();
  private readonly grid = new SurfaceSpatialGrid<number>(SURFACE.wallCollisionSpacing);
  constructor(readonly base: SurfaceArena) {
    this.walls=base.walls.map(w=>({...w,normal:[...w.normal],tangent:[...w.tangent]}));
    bindSurfaceTerrain(this.walls,base.terrain);
    this.walls.forEach((w,i)=>this.grid.add(i,point(w.normal,base.radius??27)));
  }
  setWall(index:number,normal:SurfaceVector):void {
    if(!normal.every(Number.isFinite)||Math.hypot(...normal)<1e-8)return;
    const old=this.walls[index],radius=this.base.radius??27,n=unit(normal);
    if(!old||distance(old.normal,n)<1e-9)return;
    const tangent=unit([-n[2],0,n[0]]),next={...old,normal:n,tangent};
    bindTerrainWall(next,this.base.terrain);
    this.grid.remove(index,point(old.normal,radius));this.grid.add(index,point(n,radius));
    this.walls[index]=next;updateSurfaceWallIndex(this.walls,old,next,index,radius);
  }
  step(directions:ReadonlyMap<string,SurfaceVector>,players:readonly SurfacePlayerState[],dt:number,network=false):void {
    if(!(dt>0)||dt>.1)return;
    const radius=this.base.radius??27,maxStep=SURFACE_COVER_SPEED*dt;
    for(let i=0;i<this.walls.length;i++) {
      const wall=this.walls[i],direction=wall.connectionId?directions.get(wall.connectionId):undefined;
      const authoritative=network?this.networkTargets.get(i):undefined;
      if(!authoritative&&(!direction||!direction.every(Number.isFinite)||Math.hypot(...direction)<1e-8))continue;
      const desired=authoritative??pairedSurfaceBearing(direction!,i%2,radius),from=unit(wall.normal);
      let to=unit(desired);
      if(this.base.terrain&&!authoritative){
        // Project an unreachable bearing onto this wall's side of the protected routes.
        // Chasing the forbidden centreline previously stopped most nearly coplanar file walls.
        const a=this.base.terrain.routeAngle,c=Math.cos(a),s=Math.sin(a),minimum=(SURFACE.wallLength/2+1.9)/radius;
        const coordinates=(n:SurfaceVector)=>[n[0]*c+n[2]*s,n[1],-n[0]*s+n[2]*c];
        const original=coordinates(from),target=coordinates(to).map((v,k)=>Math.sign(original[k]||1)*Math.max(minimum,v*Math.sign(original[k]||1)));
        to=unit([target[0]*c-target[2]*s,target[1],target[0]*s+target[2]*c]);
        const maximumY=Math.cos((SURFACE.poleClearance+.4)/radius);
        if(Math.abs(to[1])>maximumY){const horizontal=Math.sqrt(1-maximumY*maximumY)/Math.hypot(to[0],to[2]);to=[to[0]*horizontal,Math.sign(to[1])*maximumY,to[2]*horizontal];}
      }
      const angle=Math.acos(Math.max(-1,Math.min(1,from[0]*to[0]+from[1]*to[1]+from[2]*to[2])));
      if(angle*radius<.002)continue;
      let tangent=to.map((v,k)=>v-from[k]*Math.cos(angle)) as [number,number,number];
      if(Math.hypot(...tangent)<1e-7)tangent=[-from[2],0,from[0]];
      if(Math.hypot(...tangent)<1e-7)tangent=[1,0,0];tangent=unit(tangent);
      const turn=Math.min(angle,(authoritative?maxStep*2:maxStep)/radius);
      const advance=(heading:SurfaceVector)=>unit(from.map((v,k)=>v*Math.cos(turn)+heading[k]*Math.sin(turn)) as [number,number,number]);
      let normal=advance(tangent),p=point(normal,radius);
      if(!authoritative) {
        const candidateAt=(n:SurfaceVector)=>{const candidate={...wall,normal:n,tangent:unit([-n[2],0,n[0]])};bindTerrainWall(candidate,this.base.terrain);return candidate;};
        const bodiesClear=(n:SurfaceVector)=>{const location=point(n,radius);return !players.some(player=>distance(location,player.position)<4&&touchesPlayer(candidateAt(n),player,radius));};
        const objectsClear=(n:SurfaceVector)=>{const location=point(n,radius);return !this.grid.near(location,SURFACE.wallCollisionSpacing+.05).some(j=>j!==i&&distance(location,point(this.walls[j].normal,radius))<SURFACE.wallCollisionSpacing+.001)
          && !this.base.pickups.some(pickup=>distance(location,point(pickup.normal,radius))<SURFACE.wallLength/2+1);};
        const terrainClear=(n:SurfaceVector)=>{
          if(Math.acos(Math.min(1,Math.abs(n[1])))*radius<SURFACE.poleClearance+.05)return false;
          if(!this.base.terrain)return true;const query=terrainQuery(this.base.terrain);
          if(query.routeDistance(n)<SURFACE.wallLength/2+1.7||Math.abs(Math.asin(n[1]))*radius<SURFACE.wallLength/2+1.7)return false;
          // Use the same great-circle distance as initial placement, avoiding false overlap at rest.
          return !query.staticNear(point(n,radius),6).some(ruin=>Math.acos(Math.max(-1,Math.min(1,n.reduce((sum,v,k)=>sum+v*ruin.normal[k],0))))*radius<SURFACE.wallLength/2+ruin.length/2+1-.001);
        };
        // Players and other moving walls retain priority; steering never squeezes past a player.
        if(!bodiesClear(normal)||!objectsClear(normal))continue;
        if(!terrainClear(normal)){
          if(!this.base.terrain)continue;
          const side=unit([from[1]*tangent[2]-from[2]*tangent[1],from[2]*tangent[0]-from[0]*tangent[2],from[0]*tangent[1]-from[1]*tangent[0]]);
          const previous=this.headings.get(i);let best:SurfaceVector|undefined,bestScore=-Infinity;
          for(const angle of [.45,-.45,.9,-.9,1.35,-1.35,1.7,-1.7]){
            const heading=unit(tangent.map((v,k)=>v*Math.cos(angle)+side[k]*Math.sin(angle)) as [number,number,number]),next=advance(heading);
            if(!terrainClear(next)||!objectsClear(next)||!bodiesClear(next))continue;
            const score=Math.cos(angle)+(previous?heading.reduce((sum,v,k)=>sum+v*previous[k],0)*.4:angle*(i%2?1:-1)*.001);
            if(score>bestScore){bestScore=score;best=heading;}
          }
          if(!best)continue;normal=advance(best);this.headings.set(i,best);
        }else this.headings.set(i,tangent);
      }
      this.setWall(i,normal);
    }
  }
}
