import * as THREE from "three";
import type { ShipKind } from "./ship";

export interface Cockpit {
  /** Lives in the camera's own space; the pilot copies the camera's position and orientation onto it every frame. */
  group: THREE.Group;
  /** The four cannon tips in the group's space. */
  tips: THREE.Vector3[];
  dispose(): void;
}

type P = [number, number];
interface Palette { edge: number; glow: number; dim: number; warm: number; dark: number; mid: number }

const PALETTES: Record<ShipKind, Palette> = {
  striker: { edge: 0x5ad8ff, glow: 0x59e0ff, dim: 0x2a7f99, warm: 0xff6a4a, dark: 0x111726, mid: 0x1b2335 },
  dart: { edge: 0xc792ff, glow: 0xd6b0ff, dim: 0x6a4a99, warm: 0xff7ad0, dark: 0x14101f, mid: 0x211a33 },
  bulwark: { edge: 0xffb35a, glow: 0xffc97a, dim: 0x99682a, warm: 0xff5a2a, dark: 0x1a1710, mid: 0x2a261a },
};

/**
 * The first-person view from inside the ship, drawn in the camera's own space. Each ship has its own: the Striker has the
 * classic canopy with four wing cannons, the Dart a slim bubble canopy and a low dash with two guns on each wing, and the
 * Bulwark a heavy armoured frame with four cannons in the nose. The view is about 1.04 units tall at one unit from the
 * camera (55 degrees), so these numbers are in that frame.
 */
export function buildCockpit(kind: ShipKind = "striker"): Cockpit {
  const pal = PALETTES[kind];
  const group = new THREE.Group();
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(o: T): T => { owned.push(o); return o; };

  // everything is drawn over the scene and ignores depth, in a fixed order
  const solid = (color: number, opacity = 1) => own(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  const line = (color: number, opacity: number) => own(new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false }));
  const dark = solid(pal.dark, 0.96), mid = solid(pal.mid, 0.96), glow = solid(pal.glow, 0.9), dim = solid(pal.dim, 0.55);
  const edge = line(pal.edge, 0.75), warm = line(pal.warm, 0.8);

  const add = (obj: THREE.Object3D, order: number) => { obj.renderOrder = order; group.add(obj); return obj; };
  const poly = (pts: P[], z: number, mat: THREE.Material, order: number, outline?: THREE.LineBasicMaterial) => {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = own(new THREE.ShapeGeometry(shape));
    const m = add(new THREE.Mesh(geo, mat), order); m.position.z = z;
    if (outline) {
      const g = own(new THREE.BufferGeometry().setFromPoints([...pts, pts[0]].map(([x, y]) => new THREE.Vector3(x, y, 0))));
      const l = add(new THREE.Line(g, outline), order + 1); l.position.z = z;
    }
  };
  const tips: THREE.Vector3[] = [];
  const cannon = (rootX: number, rootY: number, tipX: number, tipY: number, side: number) => {
    const root = new THREE.Vector3(rootX, rootY, -1), tip = new THREE.Vector3(tipX, tipY, -1.7);
    add(new THREE.Line(own(new THREE.BufferGeometry().setFromPoints([root, tip])), warm), 24);
    const barrel = own(new THREE.BufferGeometry().setFromPoints([root.clone().add(new THREE.Vector3(side * 0.012, 0, 0)), tip.clone().add(new THREE.Vector3(side * 0.006, 0, 0))]));
    add(new THREE.Line(barrel, edge), 24);
    const dot = add(new THREE.Mesh(own(new THREE.CircleGeometry(0.018, 10)), glow), 25); dot.position.copy(tip);
    tips.push(tip);
  };
  /** A small instrument screen with two gauge bars. */
  const screen = (x0: number, x1: number, y0: number, y1: number) => {
    poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], -0.99, mid, 22, edge);
    const w = x1 - x0, h = y1 - y0;
    poly([[x0 + w * 0.06, y0 + h * 0.2], [x0 + w * 0.56, y0 + h * 0.2], [x0 + w * 0.56, y0 + h * 0.4], [x0 + w * 0.06, y0 + h * 0.4]], -0.98, glow, 23);
    poly([[x0 + w * 0.06, y0 + h * 0.6], [x0 + w * 0.8, y0 + h * 0.6], [x0 + w * 0.8, y0 + h * 0.78], [x0 + w * 0.06, y0 + h * 0.78]], -0.98, dim, 23);
  };

  if (kind === "dart") {
    // a low, narrow dash that sweeps up at the sides, so the view is mostly open canopy
    poly([[-1.6, -0.7], [1.6, -0.7], [1.6, -0.52], [0.9, -0.46], [0.3, -0.4], [0, -0.36], [-0.3, -0.4], [-0.9, -0.46], [-1.6, -0.52]], -1, dark, 20, edge);
    poly([[-0.09, -0.46], [0.09, -0.46], [0, -0.38]], -0.99, glow, 22, edge); // a single arrow where the nose is
    screen(-0.78, -0.42, -0.58, -0.49); screen(0.42, 0.78, -0.58, -0.49);
    // a thin bubble canopy: two slim rails and a high arch
    for (const s of [-1, 1]) poly([[s * 1.3, -0.5], [s * 1.22, -0.5], [s * 0.8, 0.3], [s * 0.7, 0.55], [s * 0.74, 0.56], [s * 0.88, 0.3]], -1, dark, 20, edge);
    poly([[-0.74, 0.5], [0.74, 0.5], [0.7, 0.56], [-0.7, 0.56]], -1, dark, 20, edge);
    poly([[-0.04, 0.5], [0.04, 0.5], [0.03, 0.2], [-0.03, 0.2]], -1, dark, 20, edge); // a centre spine over the head
    // two guns on each wing, low and wide
    for (const up of [1, -1]) for (const side of [-1, 1]) cannon(side * 1.12, up * 0.12 - 0.02, side * (up > 0 ? 0.78 : 0.46), up * 0.07, side);
  } else if (kind === "bulwark") {
    // a tall, heavy dash with a big central display and armoured side blocks
    poly([[-1.6, -0.7], [1.6, -0.7], [1.6, -0.36], [1.0, -0.3], [0.5, -0.27], [-0.5, -0.27], [-1.0, -0.3], [-1.6, -0.36]], -1, dark, 20, edge);
    poly([[-0.34, -0.45], [0.34, -0.45], [0.34, -0.31], [-0.34, -0.31]], -0.99, mid, 22, edge);
    poly([[-0.3, -0.42], [0.1, -0.42], [0.1, -0.39], [-0.3, -0.39]], -0.98, glow, 23);
    poly([[-0.3, -0.37], [0.22, -0.37], [0.22, -0.34], [-0.3, -0.34]], -0.98, dim, 23);
    for (const s of [-1, 1]) { screen(s * 0.55 - 0.2, s * 0.55 + 0.2, -0.55, -0.4); poly([[s * 1.0, -0.4], [s * 1.5, -0.4], [s * 1.5, -0.2], [s * 1.08, -0.16]], -0.99, mid, 21, edge); }
    // thick armoured pillars and a deep brow
    for (const s of [-1, 1]) poly([[s * 1.45, -0.5], [s * 1.15, -0.5], [s * 0.62, 0.52], [s * 0.86, 0.52]], -1, dark, 20, edge);
    poly([[-0.86, 0.38], [0.86, 0.38], [0.78, 0.58], [-0.78, 0.58]], -1, dark, 20, edge);
    poly([[-0.3, 0.38], [0.3, 0.38], [0.24, 0.3], [-0.24, 0.3]], -0.99, mid, 21, edge);
    // four cannons stacked in the nose, close to the middle
    for (const up of [1, -1]) for (const side of [-1, 1]) cannon(side * 0.58, up * 0.2 - 0.12, side * 0.22, up * 0.08, side);
  } else {
    // striker: dashboard along the bottom, with a notch for the nose
    poly([[-1.6, -0.7], [1.6, -0.7], [1.6, -0.47], [0.62, -0.38], [0.2, -0.33], [-0.2, -0.33], [-0.62, -0.38], [-1.6, -0.47]], -1, dark, 20, edge);
    screen(-0.86, -0.5, -0.5, -0.42); screen(0.5, 0.86, -0.5, -0.42);
    poly([[-0.14, -0.44], [0.14, -0.44], [0.14, -0.38], [-0.14, -0.38]], -0.99, mid, 22, edge);
    poly([[-0.1, -0.425], [0.1, -0.425], [0.1, -0.41], [-0.1, -0.41]], -0.98, glow, 23);
    // canopy frame: two slanted pillars and a top bar
    for (const s of [-1, 1]) poly([[s * 1.2, -0.5], [s * 1.02, -0.5], [s * 0.5, 0.56], [s * 0.62, 0.56]], -1, dark, 20, edge);
    poly([[-0.62, 0.5], [0.62, 0.5], [0.58, 0.58], [-0.58, 0.58]], -1, dark, 20, edge);
    // four cannons run from the corners of the view toward the centre
    for (const up of [1, -1]) for (const side of [-1, 1]) cannon(side * 1.0, up * 0.46, side * 0.62, up * 0.26, side);
  }
  group.visible = false;
  return { group, tips, dispose: () => { owned.forEach(o => o.dispose()); } };
}
