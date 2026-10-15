import * as THREE from "three";

export interface Cockpit {
  /** Lives in the camera's own space; the pilot copies the camera's position and orientation onto it every frame. */
  group: THREE.Group;
  /** The four cannon tips in the group's space, in the order upper-left, upper-right, lower-left, lower-right. */
  tips: THREE.Vector3[];
  dispose(): void;
}

/** The view is about 1.04 units tall at one unit from the camera (55 degrees), so these numbers are in that frame. */
export function buildCockpit(): Cockpit {
  const group = new THREE.Group();
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(o: T): T => { owned.push(o); return o; };

  // everything is drawn over the scene and ignores depth, in a fixed order
  const solid = (color: number, opacity = 1) => own(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  const line = (color: number, opacity: number) => own(new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false }));
  const dark = solid(0x111726, 0.96), mid = solid(0x1b2335, 0.96), glow = solid(0x59e0ff, 0.9), dim = solid(0x2a7f99, 0.55);
  const edge = line(0x5ad8ff, 0.75), warm = line(0xff6a4a, 0.8);

  const add = (obj: THREE.Object3D, order: number) => { obj.renderOrder = order; group.add(obj); return obj; };
  const poly = (pts: [number, number][], z: number, mat: THREE.Material, order: number, outline?: THREE.LineBasicMaterial) => {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = own(new THREE.ShapeGeometry(shape));
    const m = add(new THREE.Mesh(geo, mat), order); m.position.z = z;
    if (outline) {
      const g = own(new THREE.BufferGeometry().setFromPoints([...pts, pts[0]].map(([x, y]) => new THREE.Vector3(x, y, 0))));
      const l = add(new THREE.Line(g, outline), order + 1); l.position.z = z;
    }
  };

  // dashboard along the bottom, with a notch for the nose
  poly([[-1.6, -0.7], [1.6, -0.7], [1.6, -0.47], [0.62, -0.38], [0.2, -0.33], [-0.2, -0.33], [-0.62, -0.38], [-1.6, -0.47]], -1, dark, 20, edge);
  // instrument screens
  for (const s of [-1, 1]) {
    poly([[s * 0.5, -0.5], [s * 0.86, -0.5], [s * 0.86, -0.42], [s * 0.5, -0.42]], -0.99, mid, 22, edge);
    poly([[s * 0.52, -0.485], [s * 0.52 + s * 0.2, -0.485], [s * 0.52 + s * 0.2, -0.465], [s * 0.52, -0.465]], -0.98, glow, 23);
    poly([[s * 0.52, -0.455], [s * 0.52 + s * 0.28, -0.455], [s * 0.52 + s * 0.28, -0.44], [s * 0.52, -0.44]], -0.98, dim, 23);
  }
  poly([[-0.14, -0.44], [0.14, -0.44], [0.14, -0.38], [-0.14, -0.38]], -0.99, mid, 22, edge);
  poly([[-0.1, -0.425], [0.1, -0.425], [0.1, -0.41], [-0.1, -0.41]], -0.98, glow, 23);

  // canopy frame: two slanted pillars and a top bar
  for (const s of [-1, 1]) {
    poly([[s * 1.2, -0.5], [s * 1.02, -0.5], [s * 0.5, 0.56], [s * 0.62, 0.56]], -1, dark, 20, edge);
  }
  poly([[-0.62, 0.5], [0.62, 0.5], [0.58, 0.58], [-0.58, 0.58]], -1, dark, 20, edge);

  // four cannons run from the corners of the view toward the centre; the tips glow warm
  const tips: THREE.Vector3[] = [];
  for (const up of [1, -1]) {
    for (const side of [-1, 1]) {
      const root = new THREE.Vector3(side * 1.0, up * 0.46, -1), tip = new THREE.Vector3(side * 0.62, up * 0.26, -1.7);
      const g = own(new THREE.BufferGeometry().setFromPoints([root, tip]));
      add(new THREE.Line(g, warm), 24);
      const barrel = own(new THREE.BufferGeometry().setFromPoints([root.clone().add(new THREE.Vector3(side * 0.012, 0, 0)), tip.clone().add(new THREE.Vector3(side * 0.006, 0, 0))]));
      add(new THREE.Line(barrel, edge), 24);
      const dot = add(new THREE.Mesh(own(new THREE.CircleGeometry(0.018, 10)), glow), 25); dot.position.copy(tip);
      tips.push(tip);
    }
  }
  group.visible = false;
  return { group, tips, dispose: () => { owned.forEach(o => o.dispose()); } };
}
