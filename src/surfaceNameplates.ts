import * as THREE from "three";
import type { SurfacePlayerState } from "./surfacePhysics";
import type { SurfaceArenaView } from "./surfaceWorld";
import { surfaceSphereOccludes } from "./surfaceVisuals";
import { traceSurfaceSegment } from "./surfaceCombat";
import { SURFACE_WORLD_SCALE, surfaceViewPose, surfaceToWorld, worldToSurface } from "./surfaceView";

export interface SurfaceNameplateTarget { id: string; name: string; health: number; arenaKey: string; state: SurfacePlayerState }
/** Visibility is evaluated against displayed head poses and immutable physical cover, not a label above cover. */
export function projectSurfaceNameplate(camera: THREE.PerspectiveCamera, target: SurfaceNameplateTarget, arena: SurfaceArenaView, center: [number,number,number]): THREE.Vector3 | null {
  if (target.health<=0 || target.arenaKey!==arena.key) return null;
  const pose=surfaceViewPose(target.state), head=new THREE.Vector3(...surfaceToWorld(pose.eye,center));
  // Reject the far hemisphere before querying the static wall grid across a large planet.
  if (surfaceSphereOccludes(camera.position,head,center,((arena.arena.radius??27)-(arena.arena.terrain?.8:0))*SURFACE_WORLD_SCALE)) return null;
  const projectedHead=head.clone().project(camera);
  if (projectedHead.z < -1 || projectedHead.z > 1 || Math.abs(projectedHead.x)>1 || Math.abs(projectedHead.y)>1) return null;
  const eye=worldToSurface(camera.position.toArray(),center);
  if (traceSurfaceSegment(eye,pose.eye,arena.arena.walls,[],"",arena.arena.radius??27)) return null;
  return head.addScaledVector(new THREE.Vector3(...pose.up),.28*SURFACE_WORLD_SCALE).project(camera);
}

export class SurfaceNameplates {
  private entries=new Map<string,{root:HTMLDivElement;name:HTMLSpanElement;fill:HTMLDivElement;bar:HTMLDivElement}>();
  private layer: HTMLDivElement;
  constructor(container: HTMLElement) {
    this.layer=createDiv(); this.layer.className="cg-surface-nameplates"; container.appendChild(this.layer);
  }
  update(camera: THREE.PerspectiveCamera, width: number, height: number, arena: SurfaceArenaView | null, center: [number,number,number] | null, targets: readonly SurfaceNameplateTarget[]): void {
    camera.updateMatrixWorld(); const visible=new Set<string>();
    if (arena && center && width>0 && height>0) for (const target of targets) {
      const point=projectSurfaceNameplate(camera,target,arena,center); if (!point) continue;
      let entry=this.entries.get(target.id);
      if (!entry) {
        const root=createDiv(),name=createSpan(),bar=createDiv(),fill=createDiv();
        root.className="cg-surface-nameplate"; name.className="cg-surface-nameplate-name"; bar.className="cg-surface-nameplate-bar";fill.className="cg-surface-nameplate-fill";
        bar.setAttribute("role","progressbar");bar.setAttribute("aria-valuemin","0");bar.setAttribute("aria-valuemax","100");bar.appendChild(fill);root.append(name,bar);this.layer.appendChild(root);
        this.entries.set(target.id,entry={root,name,bar,fill});
      }
      const health=Math.max(0,Math.min(100,target.health));entry.name.textContent=target.name.slice(0,24);
      entry.fill.style.width=`${health}%`;entry.bar.setAttribute("aria-valuenow",String(health));entry.bar.setAttribute("aria-label",`${target.name.slice(0,24)} health`);
      entry.root.style.transform=`translate(${(point.x*.5+.5)*width}px,${(-point.y*.5+.5)*height}px) translate(-50%,-100%)`;entry.root.hidden=false;visible.add(target.id);
    }
    for (const [id,entry] of this.entries) if (!visible.has(id)) { entry.root.remove();this.entries.delete(id); }
  }
  clear(): void { for(const entry of this.entries.values())entry.root.remove();this.entries.clear(); }
  dispose(): void { this.clear();this.layer.remove(); }
}
