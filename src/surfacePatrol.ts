import { terrainHeight } from "./surfaceTerrain";
import * as THREE from "three";
import { createSurfacePlayerState, stepSurfacePlayer, surfacePoseClear, type SurfacePlayerState } from "./surfacePhysics";
import type { SurfaceArena, SurfaceVector } from "./surface";
export interface SurfacePatrol { index:number; state:SurfacePlayerState; home:SurfaceVector; goal:SurfaceVector; leash:number; random:number; wait:number; stuck:number; repath:number; returningHome:boolean }
const tuple=(v:THREE.Vector3)=>v.toArray() as [number,number,number];
const distance=(a:THREE.Vector3,b:THREE.Vector3,r:number)=>Math.acos(Math.max(-1,Math.min(1,a.dot(b))))*r;
function random(p:SurfacePatrol):number{p.random=(Math.imul(p.random,1664525)+1013904223)>>>0;return p.random/4294967296;}
function valid(normal:THREE.Vector3,p:SurfacePatrol,arena:SurfaceArena):boolean{
 const r=arena.radius??27;
 return distance(normal,new THREE.Vector3(...p.home),r)<=p.leash && Math.acos(Math.abs(normal.y))*r>4 && surfacePoseClear(tuple(normal.clone().multiplyScalar(r+(arena.terrain?terrainHeight(arena.terrain,tuple(normal)):0))),1.8,arena.walls,undefined,r);
}
function destination(p:SurfacePatrol,arena:SurfaceArena):SurfaceVector{
 const r=arena.radius??27,home=new THREE.Vector3(...p.home),axis=new THREE.Vector3(0,Math.abs(home.y)>.9?0:1,Math.abs(home.y)>.9?1:0).projectOnPlane(home).normalize();
 for(let i=0;i<256;i++){
  const arc=p.index<2?4.5+random(p)*Math.max(.5,p.leash-4.5):random(p)*p.leash;
  const offset=axis.clone().applyAxisAngle(home,random(p)*Math.PI*2);
  const n=home.clone().multiplyScalar(Math.cos(arc/r)).addScaledVector(offset,Math.sin(arc/r)).normalize();
  if(valid(n,p,arena))return tuple(n);
 }
 return tuple(new THREE.Vector3(...p.state.position).normalize());
}
export function createSurfacePatrol(arena:SurfaceArena,index:number):SurfacePatrol{
 const r=arena.radius??27,home=([[0,1,0],[0,-1,0],[1,0,0],[-1,0,0]] as const)[index];
 const patrol:SurfacePatrol={index,state:createSurfacePlayerState(home,[0,0,1],r,arena.terrain),home,goal:home,leash:index<2?Math.min(12,r*.45):r*1.15,random:(arena.seed^Math.imul(index+1,2654435761))>>>0,wait:0,stuck:0,repath:0,returningHome:false};
 const spawn=destination(patrol,arena);patrol.state=createSurfacePlayerState(spawn,[0,0,1],r,arena.terrain);patrol.goal=destination(patrol,arena);return patrol;
}
/** Local passive walking with predictive wall checks, steering and bounded stuck recovery. */
export function stepSurfacePatrol(p:SurfacePatrol,arena:SurfaceArena,dt:number,speed=.48):SurfacePlayerState{
 const r=arena.radius??27,up=new THREE.Vector3(...p.state.position).normalize();
 const neutral={moveX:0,moveY:0,sprint:false,jump:false,crouch:false,yawDelta:0,pitchDelta:0,lean:0};
 if(p.wait>0){p.wait=Math.max(0,p.wait-dt);p.state=stepSurfacePlayer(p.state,neutral,dt,arena.walls);return p.state;}
 p.repath-=dt;
 const arrived=distance(up,new THREE.Vector3(...p.goal),r)<1;
 if(p.returningHome&&arrived){p.returningHome=false;p.wait=.4+random(p)*1.2;p.goal=destination(p,arena);p.repath=5+random(p)*5;p.stuck=0;}
 else if(p.returningHome&&p.stuck>.65){p.returningHome=false;p.goal=destination(p,arena);p.repath=5+random(p)*5;p.wait=.3+random(p)*.5;p.stuck=0;}
 else if(!p.returningHome&&(arrived || p.repath<=0 || p.stuck>.65)){if(arrived)p.wait=.4+random(p)*1.2;p.goal=destination(p,arena);p.repath=5+random(p)*5;if(p.stuck>.65)p.wait=.3+random(p)*.5;p.stuck=0;}
 const toward=new THREE.Vector3(...p.goal).projectOnPlane(up).normalize(),forward=new THREE.Vector3(...p.state.forward).projectOnPlane(up).normalize();
 let chosen:THREE.Vector3|null=null,best=-Infinity;
 for(const turn of [0,.4,-.4,.85,-.85,1.3,-1.3,Math.PI]){
  const heading=toward.clone().applyAxisAngle(up,turn);if(heading.lengthSq()<.01)continue;
  let clear=true;
  for(const ahead of [.5,1.1,1.8]){const normal=up.clone().multiplyScalar(Math.cos(ahead/r)).addScaledVector(heading,Math.sin(ahead/r)).normalize();if(!valid(normal,p,arena)){clear=false;break;}}
  const score=heading.dot(toward)*2+heading.dot(forward)*.35;
  if(clear&&score>best){chosen=heading;best=score;}
 }
 if(!chosen){p.stuck+=dt;p.goal=destination(p,arena);p.state=stepSurfacePlayer(p.state,neutral,dt,arena.walls);return p.state;}
 const right=new THREE.Vector3().crossVectors(forward,up).normalize();
 const yaw=-Math.atan2(chosen.dot(right),chosen.dot(forward));
 const before=new THREE.Vector3(...p.state.position);
 p.state=stepSurfacePlayer(p.state,{...neutral,moveY:forward.dot(chosen)>.7?Math.max(0,Math.min(.48,speed)):0,yawDelta:Math.max(-2.5*dt,Math.min(2.5*dt,yaw))},dt,arena.walls);
 const moved=before.distanceTo(new THREE.Vector3(...p.state.position));p.stuck=forward.dot(chosen)>.7 && moved<dt*.25?p.stuck+dt:Math.max(0,p.stuck-dt*.5);
 return p.state;
}
