import { groundRadius, wallGroundRadius, wallBurial, terrainForWalls, terrainQuery } from "./surfaceTerrain";
import * as THREE from "three";
import { SURFACE, type SurfaceVector, type SurfaceWall } from "./surface";
import { SurfaceSpatialGrid } from "./surfaceSpatial";

export interface SurfaceBox { center: SurfaceVector; axes: readonly SurfaceVector[]; half: SurfaceVector }
export interface CapsuleBoxContact { normal: [number, number, number]; penetration: number }
const vector = (value: SurfaceVector) => new THREE.Vector3(...value);
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export function surfaceWallBox(wall: SurfaceWall, arenaRadius: number = SURFACE.radius): SurfaceBox {
  const up = vector(wall.normal).normalize(), along = vector(wall.tangent).projectOnPlane(up).normalize();
  const across = new THREE.Vector3().crossVectors(up, along).normalize();
  return { center: up.clone().multiplyScalar(wallGroundRadius(wall, arenaRadius) + (wall.height-wallBurial(wall)) / 2).toArray() as [number, number, number],
    axes: [along.toArray(), up.toArray(), across.toArray()] as [number, number, number][], half: [wall.length / 2, (wall.height+wallBurial(wall)) / 2, (wall.thickness ?? SURFACE.wallThickness) / 2] };
}

/** Exact minimum distance of a capsule axis segment to an oriented box, including both rounded caps. */
export function capsuleBoxContact(a: SurfaceVector, b: SurfaceVector, radius: number, box: SurfaceBox): CapsuleBoxContact | null {
  const axes = box.axes.map(axis => vector(axis).normalize()), start = vector(a).sub(vector(box.center)), end = vector(b).sub(vector(box.center));
  const p = axes.map(axis => start.dot(axis)), q = axes.map(axis => end.dot(axis)), delta = q.map((value, axis) => value - p[axis]);
  const breaks = [0, 1];
  for (let axis = 0; axis < 3; axis++) if (Math.abs(delta[axis]) > 1e-12) for (const sign of [-1, 1]) {
    const time = (sign * box.half[axis] - p[axis]) / delta[axis];
    if (time > 0 && time < 1) breaks.push(time);
  }
  breaks.sort((x, y) => x - y);
  let distanceSq = Infinity, difference = [0, 0, 0];
  const inspect = (time: number) => {
    const point = p.map((value, axis) => value + delta[axis] * time);
    const diff = point.map((value, axis) => value - clamp(value, -box.half[axis], box.half[axis]));
    const squared = diff.reduce((sum, value) => sum + value * value, 0);
    if (squared < distanceSq) { distanceSq = squared; difference = diff; }
  };
  for (let index = 0; index < breaks.length; index++) {
    inspect(breaks[index]);
    if (index + 1 >= breaks.length) continue;
    const low = breaks[index], high = breaks[index + 1], middle = (low + high) / 2;
    let quadratic = 0, linear = 0;
    for (let axis = 0; axis < 3; axis++) {
      const value = p[axis] + delta[axis] * middle;
      if (Math.abs(value) <= box.half[axis]) continue;
      quadratic += delta[axis] ** 2;
      linear += delta[axis] * (p[axis] - Math.sign(value) * box.half[axis]);
    }
    if (quadratic > 1e-12) inspect(clamp(-linear / quadratic, low, high));
  }
  if (distanceSq >= radius * radius - 1e-10) return null;
  if (distanceSq > 1e-12) {
    const distance = Math.sqrt(distanceSq), normal = new THREE.Vector3();
    axes.forEach((axis, index) => normal.addScaledVector(axis, difference[index] / distance));
    return { normal: normal.toArray() as [number, number, number], penetration: radius - distance };
  }
  let penetration = Infinity, normal = new THREE.Vector3();
  for (let axis = 0; axis < 3; axis++) {
    const positive = box.half[axis] - Math.min(p[axis], q[axis]) + radius;
    const negative = Math.max(p[axis], q[axis]) + box.half[axis] + radius;
    if (positive < penetration) { penetration = positive; normal.copy(axes[axis]); }
    if (negative < penetration) { penetration = negative; normal.copy(axes[axis]).negate(); }
  }
  return { normal: normal.toArray() as [number, number, number], penetration };
}

export function surfaceCapsuleWallContact(position: SurfaceVector, height: number, wall: SurfaceWall, orientation?: SurfaceVector, arenaRadius: number = SURFACE.radius): CapsuleBoxContact | null {
  const up = orientation ? vector(orientation).normalize() : vector(position).normalize();
  const a = vector(position).addScaledVector(up, SURFACE.playerRadius), b = vector(position).addScaledVector(up, height - SURFACE.playerRadius);
  return capsuleBoxContact(a.toArray() as [number, number, number], b.toArray() as [number, number, number], SURFACE.playerRadius, surfaceWallBox(wall, arenaRadius));
}

const wallIndices = new WeakMap<readonly SurfaceWall[], { radius: number; length: number; grid: SurfaceSpatialGrid<SurfaceWall>; order: Map<SurfaceWall, number> }>();
/** Keep a live wall array's existing collision index in sync with moved instances. */
export function updateSurfaceWallIndex(walls: readonly SurfaceWall[], oldWall: SurfaceWall, nextWall: SurfaceWall, order: number, radius: number): void {
  const index = wallIndices.get(walls); if (!index) return;
  const previous = surfaceWallBox(oldWall, radius), next = surfaceWallBox(nextWall, radius);
  index.grid.remove(oldWall, previous.center, Math.hypot(...previous.half)); index.order.delete(oldWall);
  index.grid.add(nextWall, next.center, Math.hypot(...next.half)); index.order.set(nextWall, order);
}
export function nearbySurfaceWalls(start: SurfaceVector, end: SurfaceVector, walls: readonly SurfaceWall[], arenaRadius: number = SURFACE.radius, padding = 0): readonly SurfaceWall[] {
  const terrain=terrainForWalls(walls),extras=new Map<string,SurfaceWall>();
  if(terrain){const length=Math.hypot(...start.map((v,k)=>end[k]-v)),steps=Math.max(1,Math.ceil(length/8));
    for(let i=0;i<=steps;i++){const point=start.map((v,k)=>v+(end[k]-v)*i/steps) as [number,number,number];
      if(Math.abs(terrainQuery(terrain).signedDistance(point))>padding+5)continue;
      for(const wall of terrainQuery(terrain).staticNear(point,padding+8))extras.set(wall.id,wall);
    }
  }
  if (walls.length <= 8) return [...walls,...extras.values()];
  let index = wallIndices.get(walls);
  if (!index || index.radius !== arenaRadius || index.length !== walls.length) {
    index = { radius: arenaRadius, length: walls.length, grid: new SurfaceSpatialGrid(8), order: new Map() };
    walls.forEach((wall, i) => { const box = surfaceWallBox(wall, arenaRadius); index!.grid.add(wall, box.center, Math.hypot(...box.half)); index!.order.set(wall, i); });
    wallIndices.set(walls, index);
  }
  return index.grid.query(start.map((v, k) => Math.min(v, end[k]) - padding), start.map((v, k) => Math.max(v, end[k]) + padding))
    .sort((a, b) => index!.order.get(a)! - index!.order.get(b)!).concat([...extras.values()]);
}

/** Low ledges may support grounded feet only within the configured automatic step allowance. */
export function surfaceSupportRadius(position: SurfaceVector, walls: readonly SurfaceWall[], arenaRadius: number = SURFACE.radius): number {
  const up = vector(position).normalize();
  let support: number = groundRadius(position,walls,arenaRadius);
  const feet = up.clone().multiplyScalar(arenaRadius).toArray() as [number, number, number];
  for (const wall of nearbySurfaceWalls(feet, feet, walls, arenaRadius, SURFACE.playerRadius + SURFACE.maximumStep)) {
    if (wall.height > SURFACE.maximumStep || wall.height < 0) continue;
    const normal = vector(wall.normal).normalize(), facing = up.dot(normal);
    if (facing < 0.9) continue;
    const radius = (arenaRadius + wall.height) / facing;
    if (radius - arenaRadius > SURFACE.maximumStep + 1e-6) continue;
    const point = up.clone().multiplyScalar(radius).addScaledVector(normal, -arenaRadius);
    const along = vector(wall.tangent).projectOnPlane(normal).normalize(), across = new THREE.Vector3().crossVectors(normal, along);
    if (Math.abs(point.dot(along)) > wall.length / 2 + SURFACE.playerRadius || Math.abs(point.dot(across)) > SURFACE.wallThickness / 2 + SURFACE.playerRadius) continue;
    support = Math.max(support, radius);
  }
  return support;
}
