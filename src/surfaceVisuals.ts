import { buildTerrainMesh, updateTerrainPresentation } from "./surfaceTerrainMesh";
import { bindSurfaceTerrain, terrainHeight, wallGroundRadius, wallBurial } from "./surfaceTerrain";
import { createSurfacePanelMaterial, createRuinMaterial } from "./surfaceDecor";
import * as THREE from "three";
import { SURFACE, type SurfaceArena, type SurfaceVector, type SurfaceBotDropView } from "./surface";
import type { SurfacePickupView } from "./surfaceWorld";
import { SURFACE_WORLD_SCALE } from "./surfaceView";

const vector = (value: SurfaceVector): THREE.Vector3 => new THREE.Vector3(value[0], value[1], value[2]);

function edgeOverlay(geometry: THREE.BufferGeometry, color: number, opacity: number, renderOrder: number): THREE.LineSegments {
  const edges = new THREE.EdgesGeometry(geometry, 18);
  const lines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  lines.renderOrder = renderOrder;
  return lines;
}

function radialFrame(normal: THREE.Vector3, tangent: THREE.Vector3): THREE.Quaternion {
  const x = tangent.clone().projectOnPlane(normal).normalize();
  const y = normal.clone().normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

function pickupLabel(text: string, color: number): THREE.Sprite {
  const material = new THREE.SpriteMaterial({ color, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material); sprite.scale.set(0.9, 0.4, 1); sprite.renderOrder = 4; sprite.userData.label = text;
  if (typeof document === "undefined") return sprite;
  const canvas = document.createElement("canvas"); canvas.width = 128; canvas.height = 56;
  const context = canvas.getContext("2d");
  if (context) {
    context.fillStyle = "rgba(5,12,20,.88)"; context.strokeStyle = "#d9f4ff"; context.lineWidth = 4;
    context.beginPath(); context.rect(5, 4, 118, 48); context.fill(); context.stroke();
    context.fillStyle = `#${color.toString(16).padStart(6, "0")}`; context.font = "bold 30px sans-serif"; context.textAlign = "center"; context.textBaseline = "middle"; context.fillText(text, 64, 28);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  material.map = texture; material.color.set(0xffffff);
  return sprite;
}

function healthCross(color: number, size: number): THREE.Group {
  const group = new THREE.Group(), material = new THREE.MeshBasicMaterial({ color });
  const vertical = new THREE.Mesh(new THREE.BoxGeometry(size * 0.36, size * 0.18, size), material);
  const horizontal = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.18, size * 0.36), material);
  vertical.position.y = horizontal.position.y = size * 0.13;
  group.add(vertical, horizontal);
  return group;
}

function shieldIcon(color: number, size: number): THREE.Group {
  const shape = new THREE.Shape();
  shape.moveTo(-size * 0.5, size * 0.42); shape.lineTo(size * 0.5, size * 0.42); shape.lineTo(size * 0.43, -size * 0.05);
  shape.lineTo(0, -size * 0.55); shape.lineTo(-size * 0.43, -size * 0.05); shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape); geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
  const group = new THREE.Group(); group.add(mesh); group.add(edgeOverlay(geometry, 0xeaf7ff, 0.9, 3));
  return group;
}

/** Build an opaque planet shell and deterministic surface objects in node-relative units. */
export function createSurfaceArenaVisual(arena: SurfaceArena): THREE.Group {
  const radius = arena.radius ?? SURFACE.radius;
  bindSurfaceTerrain(arena.walls,arena.terrain);
  const root = new THREE.Group();
  root.userData.radius = radius; root.userData.wallCount = arena.walls.length;
  root.name = `surface:${arena.hubId}`;
  root.userData.hubId = arena.hubId;
  root.userData.arenaSeed = arena.seed;
  root.scale.setScalar(SURFACE_WORLD_SCALE);

  const segments = Math.max(64, Math.ceil(Math.PI * Math.sqrt(radius / 0.04)));
  const sphere = arena.terrain ? buildTerrainMesh(arena.terrain) : new THREE.SphereGeometry(radius, segments, Math.ceil(segments / 2));
  const planet = new THREE.Mesh(sphere, createSurfacePanelMaterial(radius,arena.seed,arena.terrain?.profile,arena.terrain?.routeAngle));
  planet.name = "surface-planet";
  planet.renderOrder = 0;
  root.add(planet);
  if(!arena.terrain)root.add(edgeOverlay(new THREE.IcosahedronGeometry(radius * 1.002, 2), 0x6284a8, 0.22, 1));
  // Walk-over mineral scree, below the step allowance; cosmetic ground detail, never false cover.
  const mineralCount = Math.min(2048, Math.max(72, arena.walls.length * 3));
  const minerals = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({color:0x566b70}), mineralCount);
  minerals.name = "surface-mineral-scree";
  let mineralSeed = arena.seed ^ 0x51f3a2d7;
  const random = () => { mineralSeed ^= mineralSeed << 13; mineralSeed ^= mineralSeed >>> 17; mineralSeed ^= mineralSeed << 5; return (mineralSeed >>> 0) / 4294967296; };
  const mineralMatrix = new THREE.Matrix4();
  for(let i=0;i<mineralCount;i++) {
    const y=(random()*2-1)*Math.cos(7/radius),angle=random()*Math.PI*2,r=Math.sqrt(1-y*y),normal=new THREE.Vector3(r*Math.cos(angle),y,r*Math.sin(angle));
    mineralMatrix.compose(normal.clone().multiplyScalar(radius+(arena.terrain?terrainHeight(arena.terrain,normal.toArray() as [number,number,number]):0)-.015),radialFrame(normal,new THREE.Vector3(-normal.z,0,normal.x)),new THREE.Vector3(.25+random()*.6,.055+random()*.06,.25+random()*.6));
    minerals.setMatrixAt(i,mineralMatrix); minerals.setColorAt(i,new THREE.Color().setRGB(.22+random()*.12,.30+random()*.12,.32+random()*.12));
  }
  minerals.computeBoundingSphere(); root.add(minerals);

  if (arena.walls.length) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const cover = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial({ color: 0x263746 }), arena.walls.length);
    cover.name = "surface-wall-instances"; cover.userData.wallCount = arena.walls.length;
    cover.userData.connectionIds = arena.walls.map(wall => wall.connectionId ?? null);
    const columns = Array.from({ length: 4 }, () => new Float32Array(arena.walls.length * 4));
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), size = new THREE.Vector3();
    arena.walls.forEach((wall, index) => {
      const normal = vector(wall.normal).normalize(), tangent = vector(wall.tangent).projectOnPlane(normal).normalize();
      matrix.compose(position.copy(normal).multiplyScalar(wallGroundRadius(wall,radius) + (wall.height-wallBurial(wall)) / 2), radialFrame(normal, tangent), size.set(wall.length, wall.height+wallBurial(wall), SURFACE.wallThickness));
      cover.setMatrixAt(index, matrix);
      for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) columns[col][index * 4 + row] = matrix.elements[col * 4 + row];
    });
    cover.instanceMatrix.needsUpdate = true; cover.computeBoundingSphere(); root.add(cover);
    const edges = new THREE.EdgesGeometry(geometry), outline = new THREE.InstancedBufferGeometry();
    outline.setAttribute("position", edges.getAttribute("position").clone()); edges.dispose(); outline.instanceCount = arena.walls.length;
    columns.forEach((column, index) => outline.setAttribute(`wallColumn${index}`, new THREE.InstancedBufferAttribute(column, 4)));
    const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, uniforms: { tint: { value: new THREE.Color(0x8faec5) }, opacity: { value: 0.62 } },
      vertexShader: `attribute vec4 wallColumn0; attribute vec4 wallColumn1; attribute vec4 wallColumn2; attribute vec4 wallColumn3;
        void main() { mat4 transform = mat4(wallColumn0, wallColumn1, wallColumn2, wallColumn3); gl_Position = projectionMatrix * modelViewMatrix * transform * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 tint; uniform float opacity; void main() { gl_FragColor = vec4(tint, opacity); }` });
    const lines = new THREE.LineSegments(outline, material); lines.name = "surface-wall-outlines"; lines.renderOrder = 2; lines.frustumCulled = false; root.add(lines);
  }

  const beaconGeometry = new THREE.CylinderGeometry(0.12, 0.23, 2.4, 8);
  const beaconCapGeometry = new THREE.OctahedronGeometry(0.34, 0);
  for (const [sign, color, name] of [[1, 0x7fe8ff, "north"], [-1, 0xffbd5c, "south"]] as const) {
    const normal = new THREE.Vector3(0, sign, 0);
    const pole = new THREE.Group();
    pole.position.copy(normal).multiplyScalar(radius + 0.8);
    pole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    pole.name = `surface-${name}-pole`;
    const beacon = new THREE.Mesh(beaconGeometry, new THREE.MeshBasicMaterial({ color }));
    const cap = new THREE.Mesh(beaconCapGeometry, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    cap.position.y = 1.35; // The pole group already rotates local +Y toward either outward normal.
    pole.add(beacon, cap);
    root.add(pole);
  }

  const pickupColors: Record<SurfaceArena["pickups"][number]["kind"], number> = {
    "small-health": 0x70f0a5,
    "large-health": 0x51c7ff,
    armor: 0xe0a1ff,
  };
  for (const pickup of arena.pickups) {
    const normal = vector(pickup.normal).normalize();
    const marker = new THREE.Group();
    marker.position.copy(normal).multiplyScalar(radius + (arena.terrain?terrainHeight(arena.terrain,pickup.normal):0) + 0.48);
    marker.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    marker.name = `surface-pickup:${pickup.id}`;
    const color = pickupColors[pickup.kind];
    const large = pickup.kind === "large-health", size = large ? 0.62 : pickup.kind === "armor" ? 0.55 : 0.48;
    marker.userData.kind = pickup.kind;
    marker.userData.label = pickup.kind === "small-health" ? "+25" : pickup.kind === "large-health" ? "+50" : "ARMOR";
    const icon = pickup.kind === "armor" ? shieldIcon(color, size) : healthCross(color, size);
    marker.add(icon);
    marker.add(pickupLabel(marker.userData.label, color));
    marker.children.at(-1)!.position.y = size * 0.95;
    root.add(marker);
  }

  if(arena.terrain){
    const ruins=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),createRuinMaterial(arena.terrain.profile),Math.min(4096,Math.ceil(4*Math.PI*radius*radius/256)*6+6));
    ruins.name="surface-static-ruins";ruins.count=0;root.add(ruins);
    updateTerrainPresentation(root,arena.terrain);
  }
  return root;
}

export function createSurfaceBotDropVisual(drop: SurfaceBotDropView): THREE.Group {
  const marker = new THREE.Group(); marker.name = `surface-bot-drop:${drop.id}`;
  marker.userData.label = "+30";
  const icon = healthCross(0x78f2a4, 0.55); marker.add(icon);
  const label = pickupLabel("+30", 0x78f2a4); label.position.y = 0.58; marker.add(label);
  const halo = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.045, 6, 20), new THREE.MeshBasicMaterial({ color: 0x78f2a4, transparent: true, opacity: 0.75 }));
  halo.rotation.x = -Math.PI / 2; halo.position.y = 0.03; marker.add(halo);
  marker.userData.surfaceDropId = drop.id;
  return marker;
}

/** Host availability controls the same pickup meshes for existing players and late joiners. */
export function setSurfacePickupVisibility(root: THREE.Group, pickups: readonly SurfacePickupView[]): void {
  for (const pickup of pickups) {
    const marker = root.getObjectByName(`surface-pickup:${pickup.id}`);
    if (marker) marker.visible = pickup.available;
  }
}

/** Fixed world geometry keeps a white core readable even when bloom is disabled. */
/** Update existing instances and outlines together; keep the planet, pickups and GPU geometry alive. */
export function updateSurfaceCoverVisual(root: THREE.Group, arena: SurfaceArena): void {
  const cover=root.getObjectByName("surface-wall-instances") as THREE.InstancedMesh|undefined;
  const lines=root.getObjectByName("surface-wall-outlines") as THREE.LineSegments<THREE.InstancedBufferGeometry>|undefined;
  if(!cover||!lines||cover.count!==arena.walls.length)return;
  let previous=root.userData.coverNormals as Float64Array|undefined;
  if(!previous||previous.length!==arena.walls.length*3){previous=new Float64Array(arena.walls.length*3);previous.fill(NaN);root.userData.coverNormals=previous;}
  const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),size=new THREE.Vector3(),radius=arena.radius??27;
  let changed=false;
  arena.walls.forEach((wall,index)=>{
    if(wall.normal.every((n,k)=>n===previous![index*3+k]))return;
    const normal=vector(wall.normal).normalize(),tangent=vector(wall.tangent).projectOnPlane(normal).normalize();
    matrix.compose(position.copy(normal).multiplyScalar(wallGroundRadius(wall,radius)+(wall.height-wallBurial(wall))/2),radialFrame(normal,tangent),size.set(wall.length,wall.height+wallBurial(wall),SURFACE.wallThickness));
    cover.setMatrixAt(index,matrix);
    for(let col=0;col<4;col++){const attribute=lines.geometry.getAttribute(`wallColumn${col}`);for(let row=0;row<4;row++)attribute.array[index*4+row]=matrix.elements[col*4+row];}
    wall.normal.forEach((n,k)=>previous![index*3+k]=n);changed=true;
  });
  if(changed){cover.instanceMatrix.needsUpdate=true;cover.computeBoundingSphere();for(let col=0;col<4;col++)lines.geometry.getAttribute(`wallColumn${col}`).needsUpdate=true;}
}

export class SurfaceBoltGraphic extends THREE.Group {
  readonly core = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  readonly tint = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8), new THREE.MeshBasicMaterial({ color: 0x8cecff, transparent: true, opacity: 0.65, depthWrite: false }));
  constructor(color: string, private charged = false) {
    super(); this.add(this.tint, this.core); this.frustumCulled = false;
    this.core.frustumCulled = false; this.tint.frustumCulled = false; this.setColor(color);
  }
  setColor(color: string): void { this.tint.material.color.set(color); }
  setSegment(start: THREE.Vector3, end: THREE.Vector3): void {
    const direction = end.clone().sub(start), length = direction.length();
    this.visible = length > 1e-6;
    if (!this.visible) return;
    this.position.copy(start).add(end).multiplyScalar(0.5);
    this.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.multiplyScalar(1 / length));
    this.core.scale.set(0.018 * (this.charged ? 2.3 : 1) * SURFACE_WORLD_SCALE, length, 0.018 * (this.charged ? 2.3 : 1) * SURFACE_WORLD_SCALE);
    this.tint.scale.set(0.04 * (this.charged ? 2.3 : 1) * SURFACE_WORLD_SCALE, length, 0.04 * (this.charged ? 2.3 : 1) * SURFACE_WORLD_SCALE);
  }
  dispose(): void {
    this.removeFromParent(); this.core.geometry.dispose(); this.core.material.dispose(); this.tint.geometry.dispose(); this.tint.material.dispose();
  }
}

export function renderSurfaceViewmodel(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): void {
  const autoClear = renderer.autoClear;
  try { renderer.autoClear = false; renderer.clearDepth(); renderer.render(scene, camera); }
  finally { renderer.autoClear = autoClear; }
}


/** Surface worlds are opaque scenes; graph overlays must obey their existing depth buffer.
 * Scope changes to the world pass, including all bloom passes, and restore map/flight style afterwards.
 * The independent first-person viewmodel pass keeps its deliberate depth reset.
 */
export function renderOccludedSurfaceWorld(scene: THREE.Scene, surfaceActive: boolean, draw: () => void): void {
  if (!surfaceActive) { draw(); return; }
  const changed = new Set<THREE.Material>();
  scene.traverseVisible(object => {
    const material = (object as THREE.Mesh).material;
    if (!material) return;
    for (const item of Array.isArray(material) ? material : [material]) if (!item.depthTest) {
      changed.add(item); item.depthTest = true;
    }
  });
  try { draw(); }
  finally { for (const material of changed) material.depthTest = false; }
}

/** Reject DOM annotations behind the same opaque sphere that hides world geometry. */
export function surfaceSphereOccludes(eye: THREE.Vector3, target: THREE.Vector3, center: readonly number[], radius: number): boolean {
  const dx = target.x-eye.x, dy = target.y-eye.y, dz = target.z-eye.z;
  const a = dx*dx+dy*dy+dz*dz;
  if (a < 1e-12) return false;
  const ox=eye.x-center[0], oy=eye.y-center[1], oz=eye.z-center[2];
  const b=ox*dx+oy*dy+oz*dz, c=ox*ox+oy*oy+oz*oz-radius*radius;
  const discriminant=b*b-a*c;
  if (discriminant<=0) return false;
  const root=Math.sqrt(discriminant), enter=(-b-root)/a, leave=(-b+root)/a;
  return enter<1-1e-6 && leave>1e-6;
}
