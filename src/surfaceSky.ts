import * as THREE from "three";
import type { SurfaceArena } from "./surface";
import { terrainHeight } from "./surfaceTerrain";

/** Prepared with the arena, so crossing an LOD threshold allocates no geometry. */
export function createSurfaceSkyProxy(arena:SurfaceArena):THREE.Mesh {
  const radius=arena.radius??27,geometry=new THREE.IcosahedronGeometry(radius,2),positions=geometry.getAttribute("position");
  const n=new THREE.Vector3();for(let i=0;i<positions.count;i++){n.fromBufferAttribute(positions,i).normalize();n.multiplyScalar(radius+(arena.terrain?terrainHeight(arena.terrain,n.toArray()):0));positions.setXYZ(i,n.x,n.y,n.z);}
  const color=[0x1f2b33,0x4a361f,0x5c5963][arena.terrain?.profile??0];
  const material=new THREE.ShaderMaterial({uniforms:{tint:{value:new THREE.Color(color)}},vertexShader:"varying vec3 radial;void main(){radial=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}",fragmentShader:"uniform vec3 tint;varying vec3 radial;void main(){float light=.58+.42*max(0.0,dot(normalize(radial),normalize(vec3(.4,.8,.25))));gl_FragColor=vec4(tint*light,1.0);}"});
  const proxy=new THREE.Mesh(geometry,material);proxy.name="surface-sky-proxy";proxy.visible=false;geometry.computeBoundingSphere();return proxy;
}
export function nextSkyLod(previous:boolean,diameter:number,occupied:boolean):boolean{return !occupied&&(previous?diameter<48:diameter<32);}
export interface SkyCaptureEvidence {cpuMs:number;gpuMs:number;pose:number[];view:number[];key:string;stable:boolean}
export function skyDetailImproves(baseline:SkyCaptureEvidence,candidate:SkyCaptureEvidence):boolean {
  if(!baseline.stable||!candidate.stable||baseline.key!==candidate.key||Math.hypot(...baseline.pose.map((v,k)=>v-candidate.pose[k]))>.1||Math.abs(baseline.view.reduce((sum,v,k)=>sum+v*candidate.view[k],0))<.9998)return false;
  const improved=(a:number,b:number)=>a>=1&&a-b>=1&&b<=a*.85;
  return improved(baseline.cpuMs,candidate.cpuMs)||(baseline.gpuMs>0&&candidate.gpuMs>0&&improved(baseline.gpuMs,candidate.gpuMs));
}
/** Changes visibility only for the draw, and restores every original flag, including pickups. */
export class SurfaceSkyPresentation {
  private readonly low=new WeakMap<THREE.Group,boolean>();
  private readonly saved=new Map<THREE.Object3D,boolean>();
  private readonly frustum=new THREE.Frustum();
  private readonly matrix=new THREE.Matrix4();
  private readonly sphere=new THREE.Sphere();
  private hide(object:THREE.Object3D):void{if(!this.saved.has(object))this.saved.set(object,object.visible);object.visible=false;}
  apply(groups:Iterable<THREE.Group>,camera:THREE.PerspectiveCamera,occupied:THREE.Object3D|null,height:number,enabled:boolean,forceDetailsOff:boolean):number {
    camera.updateMatrixWorld();this.frustum.setFromProjectionMatrix(this.matrix.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse));let visible=0;
    for(const group of groups){if(!group.visible)continue;group.updateWorldMatrix(true,false);
      this.sphere.center.setFromMatrixPosition(group.matrixWorld);const scale=group.getWorldScale(new THREE.Vector3()).x;
      this.sphere.radius=Number(group.userData.renderRadius??Number(group.userData.radius)+8)*scale;
      const active=group===occupied;if(!active&&!this.frustum.intersectsSphere(this.sphere)){this.hide(group);continue;}visible++;
      const distance=camera.position.distanceTo(this.sphere.center),radius=Number(group.userData.radius)*scale;
      const diameter=distance>radius?height*radius/(Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*Math.sqrt(distance*distance-radius*radius)):Infinity;
      const low=nextSkyLod(this.low.get(group)??false,diameter,active);this.low.set(group,low);
      if(!active&&(forceDetailsOff||enabled&&low)){const proxy=group.getObjectByName("surface-sky-proxy");if(!proxy)continue;this.saved.set(proxy,proxy.visible);proxy.visible=true;for(const child of group.children)if(child!==proxy)this.hide(child);}
    }
    return visible;
  }
  restore():void{for(const [object,visible]of this.saved)object.visible=visible;this.saved.clear();}
}
