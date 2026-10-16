import * as THREE from "three";
import type { SurfaceArena, SurfaceVector } from "./surface";
import type { SurfacePlayerState } from "./surfacePhysics";
import { terrainQuery } from "./surfaceTerrain";
import { sampleTerrainMeshSurface } from "./surfaceTerrainMesh";
import { SURFACE_WORLD_SCALE, surfaceToWorld, worldToSurface } from "./surfaceView";
import type { SurfaceOperative } from "./surfaceOperative";

const CONTACT_CLEARANCE = 0.012;
const bootCache = new WeakMap<SurfaceOperative, THREE.Mesh[]>();

function operativeBoots(operative: SurfaceOperative): THREE.Mesh[] {
  const cached = bootCache.get(operative);
  if (cached) return cached;
  const boots: THREE.Mesh[] = [];
  operative.group.traverse(object => {
    if (object.name === "boot" && (object as THREE.Mesh).isMesh) boots.push(object as THREE.Mesh);
  });
  bootCache.set(operative, boots);
  return boots;
}

/** Place the rendered operative on the visible ground, accounting for slope and its animated boots. */
export function poseSurfaceOperativeOnTerrain(
  root: THREE.Group,
  operative: SurfaceOperative,
  state: SurfacePlayerState,
  arena: SurfaceArena,
  center: SurfaceVector,
  dt: number,
  visibleTerrain?: THREE.BufferGeometry,
): SurfacePlayerState {
  operative.pose(state, dt);
  root.scale.setScalar(SURFACE_WORLD_SCALE);

  const radialUp = new THREE.Vector3(...state.position).normalize();
  const meshContact = visibleTerrain ? sampleTerrainMeshSurface(visibleTerrain, state.position) : null;
  const surfaceUp = meshContact ? new THREE.Vector3(...meshContact.normal)
    : arena.terrain ? new THREE.Vector3(...terrainQuery(arena.terrain).normal(state.position)) : radialUp.clone();
  const forward = new THREE.Vector3(...state.forward).projectOnPlane(surfaceUp).normalize();
  if (forward.lengthSq() < 1e-8) forward.set(0, 0, -1).projectOnPlane(surfaceUp).normalize();
  const right = new THREE.Vector3().crossVectors(forward, surfaceUp).normalize();
  root.position.set(...surfaceToWorld(state.position, center));
  root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, surfaceUp, forward.clone().negate()));

  if (!state.grounded) return state;
  root.updateMatrixWorld(true);
  const boots = operativeBoots(operative);
  const query = arena.terrain ? terrainQuery(arena.terrain) : null;
  const groundGap = (worldPoint: THREE.Vector3): number => {
    const point = worldToSurface(worldPoint.toArray(), center);
    const meshSample = visibleTerrain ? sampleTerrainMeshSurface(visibleTerrain, point) : null;
    if (meshSample) return Math.hypot(...point) - meshSample.radius;
    return query ? query.signedDistance(point) : Math.hypot(...point) - (arena.radius ?? 27);
  };
  const soleGaps = (): number[] => {
    const gaps: number[] = [];
    for (const boot of boots) {
      const geometry = boot.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const box = geometry.boundingBox;
      if (!box) continue;
      for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) {
        const point = new THREE.Vector3(x, box.min.y, z).applyMatrix4(boot.matrixWorld);
        gaps.push(groundGap(point));
      }
    }
    return gaps;
  };

  // One boot may be lifted by the walk cycle. Keep the lowest planted sole just clear of the mesh.
  for (let pass = 0; pass < 2; pass++) {
    const gaps = soleGaps();
    if (!gaps.length) break;
    const correction = CONTACT_CLEARANCE - Math.min(...gaps);
    if (Math.abs(correction) < 1e-5) break;
    root.position.addScaledVector(surfaceUp, correction * SURFACE_WORLD_SCALE);
    root.updateMatrixWorld(true);
  }

  return { ...state, position: worldToSurface(root.position.toArray(), center) };
}
