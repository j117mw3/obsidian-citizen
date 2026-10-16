import * as THREE from 'three';
import {cubeTerrainNormal,terrainHeight,terrainQuery,type TerrainDefinition} from './surfaceTerrain';
import type {SurfaceVector} from './surface';
/** Local quadtree patches share one draw. Skirts close LOD boundaries without a sphere filling craters. */
export function* prepareTerrainMesh(def:TerrainDefinition,observer?:SurfaceVector):Generator<void,THREE.BufferGeometry> {
 const positions:number[]=[],indices:number[]=[],grid=16,r=def.radius;
 const eye=observer?new THREE.Vector3(...observer):undefined,horizon=Math.sqrt(2*r*5)*1.6+16;
 const append=(n:SurfaceVector,depth=0)=>{const h=terrainHeight(def,n);positions.push(...n.map(v=>v*(r+h-depth)));};
 const patch=function*(face:number,u:number,v:number,size:number,level:number):Generator<void,void>{
  const center=cubeTerrainNormal(face,u+size/2,v+size/2),distance=eye?eye.distanceTo(new THREE.Vector3(...center).multiplyScalar(r)):Infinity;
  const span=r*size*1.5,near=distance<span+horizon,nearest=Math.max(0,distance-span*.6),targetEdge=.95+Math.max(0,nearest-25)*.05;
  if(eye&&near&&r*size/grid>targetEdge&&level<10){for(let y=0;y<2;y++)for(let x=0;x<2;x++)yield* patch(face,u+x*size/2,v+y*size/2,size/2,level+1);return;}
  const base=positions.length/3;
  for(let y=0;y<=grid;y++)for(let x=0;x<=grid;x++)append(cubeTerrainNormal(face,u+x*size/grid,v+y*size/grid));
  for(let y=0;y<grid;y++)for(let x=0;x<grid;x++){const a=base+y*(grid+1)+x,b=a+1,c=a+grid+1,d=c+1;indices.push(a,b,c,b,d,c);}
  const edge:number[]=[];for(let x=0;x<=grid;x++)edge.push(x);for(let y=1;y<=grid;y++)edge.push(y*(grid+1)+grid);for(let x=grid-1;x>=0;x--)edge.push(grid*(grid+1)+x);for(let y=grid-1;y>0;y--)edge.push(y*(grid+1));
  const skirt=positions.length/3,depth=Math.max(.04,r*(size/grid)**2);
  for(const index of edge){const y=Math.floor(index/(grid+1)),x=index%(grid+1);append(cubeTerrainNormal(face,u+x*size/grid,v+y*size/grid),depth);}
  for(let i=0;i<edge.length;i++){const j=(i+1)%edge.length;indices.push(base+edge[i],skirt+i,base+edge[j],base+edge[j],skirt+i,skirt+j);}
  yield;
 };
 for(let face=0;face<6;face++)yield* patch(face,-1,-1,2,0);
 // Cube-face UV mappings and perimeter skirts use outward winding.
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeBoundingSphere();geometry.userData.terrainHash=def.hash;return geometry;
}
export function buildTerrainMesh(def:TerrainDefinition,observer?:SurfaceVector):THREE.BufferGeometry {
 const preparation=prepareTerrainMesh(def,observer);let step=preparation.next();while(!step.done)step=preparation.next();return step.value;
}
/** Rebuild only after crossing a local LOD region; ground motion is applied by the existing parent transform. */
export function updateTerrainPresentation(root:THREE.Group,definition:TerrainDefinition,observer?:SurfaceVector):void {
 const previous=root.userData.terrainObserver as SurfaceVector|undefined;
 if(root.userData.terrainPrepared&&(!observer&&!previous||observer&&previous&&Math.hypot(...observer.map((v,k)=>v-previous[k]))<12))return;
 const planet=root.getObjectByName('surface-planet') as THREE.Mesh;if(!planet)return;
 let next:THREE.BufferGeometry;
 if(observer&&previous){
   let preparation=root.userData.terrainPreparation as {iterator:Generator<void,THREE.BufferGeometry>;observer:SurfaceVector}|undefined;
   if(!preparation){preparation={iterator:prepareTerrainMesh(definition,observer),observer:[...observer]};root.userData.terrainPreparation=preparation;}
   const deadline=performance.now()+2;let step=preparation.iterator.next();
   while(!step.done&&performance.now()<deadline)step=preparation.iterator.next();
   if(!step.done)return;
   next=step.value;observer=preparation.observer;delete root.userData.terrainPreparation;
 }else next=buildTerrainMesh(definition,observer);
 planet.geometry.dispose();planet.geometry=next;
 root.userData.terrainObserver=observer?[...observer]:undefined;root.userData.terrainPrepared=true;
 const ruins=root.getObjectByName('surface-static-ruins') as THREE.InstancedMesh|undefined;if(!ruins)return;
 const point=observer??[definition.radius,0,0],range=observer?Math.sqrt(2*definition.radius*5)*1.6+16:definition.radius*4;
 const walls=terrainQuery(definition).staticNear(point,Math.min(range,160)),matrix=new THREE.Matrix4();
 // On-foot visibility is bounded by the local horizon; never allocate per-ruin scene trees.
 ruins.count=Math.min(walls.length,ruins.instanceMatrix.count);
 for(let i=0;i<ruins.count;i++){const wall=walls[i],normal=new THREE.Vector3(...wall.normal),x=new THREE.Vector3(...wall.tangent),z=new THREE.Vector3().crossVectors(x,normal).normalize();
  matrix.compose(normal.clone().multiplyScalar(definition.radius+terrainHeight(definition,wall.normal)+(wall.height-.35)/2),new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x,normal,z)),new THREE.Vector3(wall.length,wall.height+.35,wall.thickness??.8));ruins.setMatrixAt(i,matrix);
 }
 ruins.instanceMatrix.needsUpdate=true;ruins.computeBoundingSphere();root.userData.staticRuinCount=walls.length;
}
