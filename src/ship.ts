import * as THREE from "three";
import type { ShipId } from "./pilotProfile";
import { buildShip as buildImportedShip } from "./importedShipModels";

export interface Ship {
  /** The fighter, nose toward -Z like the camera. Add it to the scene; the pilot positions it every frame. */
  group: THREE.Group;
  /** The lights that make the hull readable. They only touch lit materials, so the glowing notes are unaffected. */
  lights: THREE.Light[];
  /** Exhaust flames, one per engine; their length and brightness follow the throttle. */
  flames: THREE.Mesh[];
  /** Cannon tips on the four wings, in the ship's own space. */
  muzzles: THREE.Vector3[];
  /** The glowing wireframe outline drawn over the hull. */
  outline: THREE.LineBasicMaterial;
  dispose(): void;
}

const WING_SPREAD = 0.32; // how far the four wings fan out of the horizontal, in radians
export const SHIP_SCALE = 0.34;
export const MULTIPLAYER_SHIP_SCALE = SHIP_SCALE * 2;
export const SHIP_MUZZLES: readonly [number, number, number][] = [
  [-1.61, -0.51, -0.97], [-1.61, 0.51, -0.97], [1.61, -0.51, -0.97], [1.61, 0.51, -0.97],
];
const DART_MUZZLES: readonly [number, number, number][] = [
  [-0.76, 0, -0.744], [-1.36, 0, -0.184], [0.76, 0, -0.744], [1.36, 0, -0.184],
];
const BULWARK_MUZZLES: readonly [number, number, number][] = [
  [-0.336, 0.136, -1.504], [-0.336, -0.136, -1.504], [0.336, 0.136, -1.504], [0.336, -0.136, -1.504],
];
const IMPORTED_MODEL_SCALE = 0.8;
function normalizeImportedShip(kind: "dart" | "bulwark"): Ship {
  const model = buildImportedShip(kind), group = new THREE.Group(), normalized = new THREE.Group();
  normalized.scale.setScalar(IMPORTED_MODEL_SCALE); normalized.add(model.group); group.add(normalized);
  return { group, lights: model.lights, flames: model.flames, muzzles: model.muzzles.map(muzzle => muzzle.multiplyScalar(IMPORTED_MODEL_SCALE)), outline: model.outline, dispose: () => model.dispose() };
}
export function shipMuzzles(style: ShipId): readonly [number, number, number][] {
  return style === "dart-interceptor" ? DART_MUZZLES : style === "bulwark-gunship" ? BULWARK_MUZZLES : SHIP_MUZZLES;
}

/**
 * A small four-winged starfighter built from primitives, with a glowing wireframe outline over the hull.
 * Nothing is loaded from disk: the plugin ships no model files.
 */
export function buildShip(style: ShipId = "classic"): Ship {
  if (style === "dart-interceptor") return normalizeImportedShip("dart");
  if (style === "bulwark-gunship") return normalizeImportedShip("bulwark");
  const group = new THREE.Group();
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(o: T): T => { owned.push(o); return o; };

  // Transparent so it is drawn after the glowing notes (which ignore depth), never underneath them.
  const lit = (color: number, emissive: number, shininess = 50) =>
    own(new THREE.MeshPhongMaterial({ color, emissive, shininess, flatShading: true, transparent: true }));
  const hull = lit(0xdfe6f3, 0x0c1426);
  const dark = lit(0x3a4258, 0x06080f, 20);
  const glass = lit(0x55b4ff, 0x0b3a72, 140);
  const oxide = lit(0xa23a35, 0x3e1012, 65);
  const copper = lit(0x92736a, 0x251714, 35);
  const red = own(new THREE.MeshBasicMaterial({ color: 0xff4b3a, transparent: true }));
  const outline = own(new THREE.LineBasicMaterial({ color: 0x7fe8ff, transparent: true, opacity: 0.9 }));

  /** Add a solid part and trace its hard edges in the glowing outline. */
  const part = (geo: THREE.BufferGeometry, mat: THREE.Material, place: (m: THREE.Mesh) => void, edges = true): THREE.Mesh => {
    const m = new THREE.Mesh(own(geo), mat);
    m.renderOrder = 6;
    place(m);
    if (edges) {
      const e = new THREE.LineSegments(own(new THREE.EdgesGeometry(geo, 25)), outline);
      e.renderOrder = 8;
      m.add(e);
    }
    group.add(m);
    return m;
  };

  /** A thin, edged plan-view plate. The supplied art is used as silhouette inspiration only. */
  const plate = (points: [number, number][], y: number, mat: THREE.Material = hull) => {
    const shape = new THREE.Shape(points.map(([x, forward]) => new THREE.Vector2(x, forward)));
    return part(new THREE.ShapeGeometry(shape), mat, mesh => { mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; });
  };

  // Classic and Crescent retain their original bodies. The other hulls are purpose-built silhouettes.
  if (style === "classic" || style === "crescent") {
    part(new THREE.ConeGeometry(0.2, 1.7, style === "crescent" ? 9 : 7), hull, m => { m.rotation.x = -Math.PI / 2; m.position.z = style === "classic" ? -0.9 : -0.83; });
    part(new THREE.CylinderGeometry(0.27, 0.3, 1.9, 8), hull, m => { m.rotation.x = Math.PI / 2; m.position.z = 0.5; });
    part(new THREE.SphereGeometry(0.25, 10, 8), glass, m => { m.scale.set(1, 0.75, 1.7); m.position.set(0, 0.24, -0.3); }, false);
  } else if (style === "vector") {
    plate([[0, 1.95], [-0.22, 0.72], [-0.3, -1.35], [0, -1.72], [0.3, -1.35], [0.22, 0.72]], 0, hull);
    part(new THREE.BoxGeometry(0.46, 0.26, 2.25), dark, m => { m.position.set(0, 0.08, 0.12); });
    part(new THREE.BoxGeometry(0.3, 0.12, 0.75), glass, m => { m.position.set(0, 0.24, -0.52); }, false);
    for (const side of [-1, 1]) {
      part(new THREE.BoxGeometry(0.38, 1.1, 1.42), hull, m => { m.position.set(side * 0.67, 0.28, 0.48); });
      part(new THREE.BoxGeometry(0.16, 1.22, 0.98), dark, m => { m.position.set(side * 0.67, 0.28, 0.55); }, false);
      part(new THREE.BoxGeometry(0.55, 0.12, 0.54), hull, m => { m.position.set(side * 0.57, -0.48, -0.18); });
      part(new THREE.BoxGeometry(0.1, 0.78, 0.14), glass, m => { m.position.set(side * 0.67, 0.27, 1.18); }, false);
    }
  } else if (style === "dart") {
    part(new THREE.BoxGeometry(0.5, 0.36, 2.65), hull, m => { m.position.set(0.2, 0.04, 0.05); });
    part(new THREE.ConeGeometry(0.22, 1.5, 5), hull, m => { m.rotation.x = -Math.PI / 2; m.position.set(0.2, 0.03, -1.26); });
    part(new THREE.BoxGeometry(0.28, 0.14, 0.62), glass, m => { m.position.set(0.18, 0.28, -0.52); }, false);
    // One broad port cargo wing and one short starboard loading wing make the freighter intentionally asymmetric.
    plate([[-0.06, 0.45], [-1.92, 0.1], [-1.52, -0.45], [-1.05, -1.42], [-0.26, -0.92]], -0.03, hull);
    plate([[0.38, 0.34], [1.42, 0.08], [1.23, -0.2], [0.48, -0.55]], 0.01, copper);
    part(new THREE.BoxGeometry(0.62, 0.54, 0.82), dark, m => { m.position.set(-0.76, 0.03, 0.15); });
    part(new THREE.BoxGeometry(0.62, 0.47, 0.68), copper, m => { m.position.set(-0.86, 0.06, -0.51); });
    part(new THREE.BoxGeometry(0.35, 0.38, 0.82), dark, m => { m.position.set(1.02, 0.02, 0.1); });
    part(new THREE.BoxGeometry(0.12, 0.08, 0.92), glass, m => { m.position.set(-1.34, 0.1, -0.06); }, false);
  } else if (style === "bulwark") {
    plate([[0, 2.05], [-0.72, 0.72], [-1.92, 0.08], [-1.76, -1.45], [-1.05, -1.8], [1.05, -1.8], [1.76, -1.45], [1.92, 0.08], [0.72, 0.72]], -0.05, hull);
    plate([[0, 1.45], [-0.54, 0.44], [-1.48, -0.02], [-1.38, -1.12], [-0.8, -1.4], [0.8, -1.4], [1.38, -1.12], [1.48, -0.02], [0.54, 0.44]], 0.16, dark);
    plate([[0, 0.85], [-0.42, 0.14], [-0.72, -0.22], [-0.62, -1.05], [0.62, -1.05], [0.72, -0.22], [0.42, 0.14]], 0.29, hull);
    part(new THREE.BoxGeometry(0.8, 0.26, 1.45), dark, m => { m.position.set(0, 0.32, 0.25); });
    part(new THREE.BoxGeometry(0.5, 0.16, 0.48), glass, m => { m.position.set(0, 0.43, -0.58); }, false);
    for (const side of [-1, 1]) {
      part(new THREE.BoxGeometry(0.34, 0.2, 1.3), copper, m => { m.position.set(side * 1.28, 0.04, 0.1); });
      part(new THREE.BoxGeometry(0.54, 0.14, 0.24), glass, m => { m.position.set(side * 1.3, 0.12, -0.75); }, false);
    }
  } else {
    // Revenant: a narrow, elongated red survey hull with separated sensor fins and visible ribbing.
    part(new THREE.CylinderGeometry(0.2, 0.38, 3.9, 8), oxide, m => { m.rotation.x = Math.PI / 2; m.position.z = 0.15; });
    part(new THREE.ConeGeometry(0.2, 1.05, 8), oxide, m => { m.rotation.x = -Math.PI / 2; m.position.z = -1.62; });
    part(new THREE.BoxGeometry(0.27, 0.18, 1.6), dark, m => { m.position.set(0, 0.28, 0.37); });
    part(new THREE.BoxGeometry(0.23, 0.15, 0.68), glass, m => { m.position.set(0, 0.37, -0.5); }, false);
    for (const z of [-1.03, -0.58, -0.12, 0.34, 0.8, 1.2]) {
      const rib = part(new THREE.TorusGeometry(0.3 + (z > 0 ? 0.045 : 0), 0.035, 5, 12), copper, m => { m.rotation.x = Math.PI / 2; m.position.z = z; }, false);
      rib.scale.set(1, 1, 1.45);
    }
    for (const side of [-1, 1]) {
      part(new THREE.BoxGeometry(0.2, 0.48, 1.45), oxide, m => { m.position.set(side * 0.68, 0, 0.72); });
      part(new THREE.BoxGeometry(0.12, 0.68, 0.16), glass, m => { m.position.set(side * 0.68, 0.12, 1.2); }, false);
    }
  }

  const flames: THREE.Mesh[] = [];
  const muzzles: THREE.Vector3[] = [];
  const flameMat = own(new THREE.MeshBasicMaterial({ color: 0x7fd8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  const flameGeo = own(new THREE.ConeGeometry(0.12, 1, 8));
  flameGeo.translate(0, 0.5, 0); // base at the origin, tip one unit along +Y

  // Each silhouette keeps the same four physical weapon mounts and engine spacing.
  for (const side of [-1, 1]) {
    for (const up of [-1, 1]) {
      const tilt = WING_SPREAD * side * up;
      if (style === "classic") {
        part(new THREE.BoxGeometry(1.5, 0.035, 0.95), hull, m => { m.position.set(side * 0.9, up * 0.28, 0.5); m.rotation.z = tilt; });
      } else if (style === "crescent") {
        const arc = part(new THREE.TorusGeometry(0.83, 0.055, 6, 20, Math.PI * 0.8), hull, m => { m.position.set(side * 0.75, up * 0.05, 0.35); m.rotation.z = side < 0 ? Math.PI * 0.8 : Math.PI * 0.2; });
        arc.scale.set(1.1, 0.72, 1);
        part(new THREE.BoxGeometry(0.48, 0.04, 0.58), dark, m => { m.position.set(side * 0.51, up * 0.2, 0.55); });
      }
      part(new THREE.BoxGeometry(0.1, 0.05, 0.4), red, m => { m.position.set(side * 1.45, up * 0.47, 0.5); m.rotation.z = tilt; }, false);
      const tipX = side * 1.61, tipY = up * 0.51;
      part(new THREE.CylinderGeometry(0.03, 0.03, 1.7, 5), dark, m => { m.rotation.x = Math.PI / 2; m.position.set(tipX, tipY, -0.1); }, false);
      muzzles.push(new THREE.Vector3(tipX, tipY, -0.97));
      part(new THREE.CylinderGeometry(0.15, 0.17, 1.0, 8), dark, m => { m.rotation.x = Math.PI / 2; m.position.set(side * 0.5, up * 0.2, 0.6); });
      const f = new THREE.Mesh(flameGeo, flameMat);
      f.rotation.x = Math.PI / 2; // tip pointing away from the nose
      f.position.set(side * 0.5, up * 0.2, 1.1);
      f.renderOrder = 7;
      group.add(f); flames.push(f);
    }
  }

  const ambient = new THREE.AmbientLight(0x8fa4d0, 1.0);
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(2, 4, 3);

  return { group, lights: [ambient, sun], flames, muzzles, outline, dispose: () => { owned.forEach(o => o.dispose()); } };
}
