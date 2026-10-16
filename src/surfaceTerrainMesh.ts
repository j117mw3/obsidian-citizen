import * as THREE from 'three';
import {cubeTerrainNormal,terrainHeight,terrainQuery,type TerrainDefinition} from './surfaceTerrain';
import type {SurfaceVector} from './surface';
/** Local quadtree patches share one draw. Skirts close LOD boundaries without a sphere filling craters. */
export function* prepareTerrainMesh(def:TerrainDefinition,observer?:SurfaceVector):Generator<void,THREE.BufferGeometry> {
 const positions:number[]=[],indices:number[]=[],grid=16,r=def.radius,patches=Array.from({length:6},()=>new Map<string,{base:number;level:number;column:number;row:number}>());
 const eye=observer?new THREE.Vector3(...observer):undefined,horizon=Math.sqrt(2*r*5)*1.6+16;
 const append=(n:SurfaceVector,depth=0)=>{const h=terrainHeight(def,n);positions.push(...n.map(v=>v*(r+h-depth)));};
 const patch=function*(face:number,u:number,v:number,size:number,level:number):Generator<void,void>{
  const center=cubeTerrainNormal(face,u+size/2,v+size/2),distance=eye?eye.distanceTo(new THREE.Vector3(...center).multiplyScalar(r)):Infinity;
  const span=r*size*1.5,near=distance<span+horizon,nearest=Math.max(0,distance-span*.6),targetEdge=.95+Math.max(0,nearest-25)*.05;
  if(eye&&near&&r*size/grid>targetEdge&&level<10){for(let y=0;y<2;y++)for(let x=0;x<2;x++)yield* patch(face,u+x*size/2,v+y*size/2,size/2,level+1);return;}
  const base=positions.length/3,column=Math.round((u+1)/size),row=Math.round((v+1)/size);patches[face].set(`${level}/${column}/${row}`,{base,level,column,row});
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
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeBoundingSphere();geometry.userData.terrainHash=def.hash;geometry.userData.terrainGrid=grid;geometry.userData.terrainPatchLookup=patches;return geometry;
}
export function buildTerrainMesh(def:TerrainDefinition,observer?:SurfaceVector):THREE.BufferGeometry {
 const preparation=prepareTerrainMesh(def,observer);let step=preparation.next();while(!step.done)step=preparation.next();return step.value;
}

/** Sample the exact radial surface and face normal represented by the currently displayed terrain mesh. */
export function sampleTerrainMeshSurface(geometry:THREE.BufferGeometry,direction:SurfaceVector):{radius:number;point:[number,number,number];normal:[number,number,number]}|null {
 const lookups=geometry.userData.terrainPatchLookup as Array<Map<string,{base:number;level:number;column:number;row:number}>>|undefined,grid=geometry.userData.terrainGrid as number|undefined;
 const positions=geometry.getAttribute('position'),indices=geometry.index;
 if(!lookups||!grid||!positions||!indices)return null;
 const length=Math.hypot(...direction)||1,[x,y,z]=direction.map(value=>value/length) as [number,number,number],ax=Math.abs(x),ay=Math.abs(y),az=Math.abs(z);
 let face:number,u:number,v:number;
 if(ax>=ay&&ax>=az){if(x>=0){face=0;u=-z/x;v=y/x;}else{face=1;u=z/-x;v=y/-x;}}
 else if(ay>=az){if(y>=0){face=2;u=x/y;v=-z/y;}else{face=3;u=x/-y;v=z/-y;}}
 else if(z>=0){face=4;u=x/z;v=y/z;}
 else{face=5;u=x/z;v=-y/z;}
 u=Math.max(-1,Math.min(1,u));v=Math.max(-1,Math.min(1,v));
 let patch:{base:number;level:number;column:number;row:number}|undefined,divisions=1;
 for(let level=0;level<=10;level++){
  const column=Math.min(divisions-1,Math.max(0,Math.floor((u+1)*divisions/2))),row=Math.min(divisions-1,Math.max(0,Math.floor((v+1)*divisions/2))),candidate=lookups[face].get(`${level}/${column}/${row}`);
  if(candidate)patch=candidate;divisions*=2;
 }
 if(!patch)return null;
 const size=2/(2**patch.level),localX=(u+1)/size*grid-patch.column*grid,localY=(v+1)/size*grid-patch.row*grid;
 const cellX=Math.max(0,Math.min(grid-1,Math.floor(localX))),cellY=Math.max(0,Math.min(grid-1,Math.floor(localY)));
 const fx=Math.max(0,Math.min(1,localX-cellX)),fy=Math.max(0,Math.min(1,localY-cellY));
 const a=patch.base+cellY*(grid+1)+cellX,b=a+1,c=a+grid+1,d=c+1;
 const ids=fx+fy<=1?[a,b,c]:[b,d,c],p0=new THREE.Vector3().fromBufferAttribute(positions,ids[0]),p1=new THREE.Vector3().fromBufferAttribute(positions,ids[1]),p2=new THREE.Vector3().fromBufferAttribute(positions,ids[2]);
 const normal=new THREE.Vector3().subVectors(p1,p0).cross(new THREE.Vector3().subVectors(p2,p0)).normalize(),ray=new THREE.Vector3(x,y,z);
 if(normal.dot(ray)<0)normal.negate();const denominator=normal.dot(ray),radius=normal.dot(p0)/denominator;
 if(!Number.isFinite(radius)||radius<=0)return null;
 return {radius,point:ray.multiplyScalar(radius).toArray(),normal:normal.toArray()};
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
