import * as THREE from "three";
import type { ShipId } from "./pilotProfile";

export interface Cockpit {
  /** Lives in the camera's own space; the pilot copies the camera's position and orientation onto it every frame. */
  group: THREE.Group;
  /** The four cannon tips in the group's space, in the order upper-left, upper-right, lower-left, lower-right. */
  tips: THREE.Vector3[];
  updateDashboard(reading: CockpitReading): void;
  readonly dashboardText: string;
  dispose(): void;
}

export interface CockpitReading {
  health: number; shields: number; boost: number; speed: number; boostLocked: boolean; regenDelay: number; emptyHold: number;
  weapon: 0 | 1; heat: number; overheated: boolean; ammunition: number;
  weaponReady: boolean; weaponCooldown: number; kills: number; leader: number; protectedFor: number; respawnIn: number;
  phase: string;
}

const COCKPIT_SCREEN_CENTER_X = 0.45;
export function cockpitScreenLayout(aspect: number): { horizontalScale: number; centerX: number } {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1.78;
  return { horizontalScale: safeAspect / 1.78, centerX: COCKPIT_SCREEN_CENTER_X };
}

/** The view is about 1.04 units tall at one unit from the camera (55 degrees), so these numbers are in that frame. */
export function buildCockpit(ship: ShipId = "classic"): Cockpit {
  const group = new THREE.Group();
  const owned: { dispose(): void }[] = [];
  const own = <T extends { dispose(): void }>(o: T): T => { owned.push(o); return o; };

  // everything is drawn over the scene and ignores depth, in a fixed order
  const solid = (color: number, opacity = 1) => own(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
  const line = (color: number, opacity: number) => own(new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false }));
  const dark = solid(0x111726, 0.96), mid = solid(0x1b2335, 0.96), glow = solid(0x59e0ff, 0.9), dim = solid(0x2a7f99, 0.55);
  const edge = line(0x5ad8ff, 0.75), warm = line(0xff6a4a, 0.8);
  const screens: { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D; texture: THREE.CanvasTexture }[] = [];

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

  const importedDart = ship === "dart-interceptor", importedBulwark = ship === "bulwark-gunship";
  const screenWidth = importedDart ? 0.68 : importedBulwark ? 0.62 : 0.76;
  // These two imported silhouettes use their upstream canopy and dash frames while keeping the live instrument canvases.
  if (importedDart) {
    poly([[-1.6, -0.7], [1.6, -0.7], [1.6, -0.52], [0.9, -0.46], [0.3, -0.4], [0, -0.36], [-0.3, -0.4], [-0.9, -0.46], [-1.6, -0.52]], -1, dark, 20, edge);
    poly([[-0.09, -0.46], [0.09, -0.46], [0, -0.38]], -0.99, glow, 22, edge);
    for (const s of [-1, 1]) poly([[s * 1.3, -0.5], [s * 1.22, -0.5], [s * 0.8, 0.3], [s * 0.7, 0.55], [s * 0.74, 0.56], [s * 0.88, 0.3]], -1, dark, 20, edge);
    poly([[-0.74, 0.5], [0.74, 0.5], [0.7, 0.56], [-0.7, 0.56]], -1, dark, 20, edge);
    poly([[-0.04, 0.5], [0.04, 0.5], [0.03, 0.2], [-0.03, 0.2]], -1, dark, 20, edge);
  } else if (importedBulwark) {
    poly([[-1.6, -0.7], [1.6, -0.7], [1.6, -0.36], [1.0, -0.3], [0.5, -0.27], [-0.5, -0.27], [-1.0, -0.3], [-1.6, -0.36]], -1, dark, 20, edge);
    poly([[-0.34, -0.45], [0.34, -0.45], [0.34, -0.31], [-0.34, -0.31]], -0.99, mid, 22, edge);
    poly([[-0.3, -0.42], [0.1, -0.42], [0.1, -0.39], [-0.3, -0.39]], -0.98, glow, 23);
    poly([[-0.3, -0.37], [0.22, -0.37], [0.22, -0.34], [-0.3, -0.34]], -0.98, dim, 23);
    for (const s of [-1, 1]) poly([[s * 1.45, -0.5], [s * 1.15, -0.5], [s * 0.62, 0.52], [s * 0.86, 0.52]], -1, dark, 20, edge);
    poly([[-0.86, 0.38], [0.86, 0.38], [0.78, 0.58], [-0.78, 0.58]], -1, dark, 20, edge);
    poly([[-0.3, 0.38], [0.3, 0.38], [0.24, 0.3], [-0.24, 0.3]], -0.99, mid, 21, edge);
  } else {
    // dashboard along the bottom, with a notch for the nose
    poly([[-1.6, -0.7], [1.6, -0.7], [1.6, -0.47], [0.62, -0.38], [0.2, -0.33], [-0.2, -0.33], [-0.62, -0.38], [-1.6, -0.47]], -1, dark, 20, edge);
  }
  // Instrument panels use canvas-backed textures so the readings are live in the 3D cockpit.
  for (const x of [-COCKPIT_SCREEN_CENTER_X, COCKPIT_SCREEN_CENTER_X]) {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 200;
    const context = canvas.getContext("2d"); if (!context) continue;
    const texture = own(new THREE.CanvasTexture(canvas)); texture.colorSpace = THREE.SRGBColorSpace;
    const material = own(new THREE.MeshBasicMaterial({ map: texture, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    const screen = add(new THREE.Mesh(own(new THREE.PlaneGeometry(screenWidth, 0.235)), material), 23);
    screen.position.set(x, -0.525, -0.975);
    screens.push({ canvas, context, texture });
  }

  // Classic-family canopy frame; imported variants drew their own vehicle-specific frame above.
  if (!importedDart && !importedBulwark) {
    for (const s of [-1, 1]) poly([[s * 1.2, -0.5], [s * 1.02, -0.5], [s * 0.5, 0.56], [s * 0.62, 0.56]], -1, dark, 20, edge);
    poly([[-0.62, 0.5], [0.62, 0.5], [0.58, 0.58], [-0.58, 0.58]], -1, dark, 20, edge);
  }

  // The camera tips follow each model's physical muzzle order, so predicted and accepted shots use the same cannon.
  const tips: THREE.Vector3[] = [];
  const cannonLayout: [number, number, number, number, number][] = importedDart
    ? [[-1.12, 0.10, -0.78, 0.07, -1], [-1.30, -0.10, -1.08, -0.07, -1], [1.12, 0.10, 0.78, 0.07, 1], [1.30, -0.10, 1.08, -0.07, 1]]
      .map(([rx, ry, tx, ty, side]) => [rx, ry, tx, ty, side] as [number, number, number, number, number])
    : importedBulwark
      ? [[-0.58, 0.08, -0.22, 0.06, -1], [-0.58, -0.08, -0.22, -0.06, -1], [0.58, 0.08, 0.22, 0.06, 1], [0.58, -0.08, 0.22, -0.06, 1]]
      : [-1, 1].flatMap(side => [-1, 1].map(up => [side * 1.0, up * 0.46, side * 0.62, up * 0.26, side] as [number, number, number, number, number]));
  for (const [rootX, rootY, tipX, tipY, side] of cannonLayout) {
      const root = new THREE.Vector3(rootX, rootY, -1), tip = new THREE.Vector3(tipX, tipY, -1.7);
      const g = own(new THREE.BufferGeometry().setFromPoints([root, tip]));
      add(new THREE.Line(g, warm), 24);
      const barrel = own(new THREE.BufferGeometry().setFromPoints([root.clone().add(new THREE.Vector3(side * 0.012, 0, 0)), tip.clone().add(new THREE.Vector3(side * 0.006, 0, 0))]));
      add(new THREE.Line(barrel, edge), 24);
      const dot = add(new THREE.Mesh(own(new THREE.CircleGeometry(0.018, 10)), glow), 25); dot.position.copy(tip);
      tips.push(tip);
  }
  group.visible = false;
  let dashboardText = "";
  const updateDashboard = (reading: CockpitReading) => {
    const health = Math.max(0, Math.min(100, Math.round(reading.health))), boost = Math.max(0, Math.min(100, Math.round(reading.boost * 100)));
    const boostStatus = reading.boostLocked ? (reading.emptyHold > 0 ? `LOCKED ${reading.emptyHold.toFixed(1)}s` : `LOCKED · ${reading.regenDelay > 0 ? `${reading.regenDelay.toFixed(1)}s TO RECHARGE` : "WAITING FOR 30%"}`)
      : reading.boost >= 1 ? "FULL" : reading.regenDelay > 0 ? `RECHARGE IN ${reading.regenDelay.toFixed(1)}s` : "RECHARGING";
    const status = reading.respawnIn > 0 ? `RESPAWN ${Math.ceil(reading.respawnIn / 1000)}s` : reading.protectedFor > 0 ? `PROTECTED ${Math.ceil(reading.protectedFor / 1000)}s` : reading.phase;
    const weaponName = reading.weapon === 1 ? "Cannon" : "Blaster", rate = reading.weapon === 1 ? "2" : "6.25";
    const weaponStatus = reading.weapon === 1 ? `Cannon ${reading.ammunition} rounds, ${reading.weaponReady ? "ready" : `cooling down for ${reading.weaponCooldown.toFixed(2)} seconds`}`
      : `Blaster ${reading.weaponReady ? "ready" : reading.overheated ? "overheated" : `cooling down for ${reading.weaponCooldown.toFixed(2)} seconds`}, ${rate} shots per second, heat ${Math.round(reading.heat * 100)} percent`;
    dashboardText = `Hull ${health} percent. Shields ${Math.round(reading.shields)} of 40. Boost ${boost} percent, ${boostStatus}. Speed ${Math.round(reading.speed)}. ${weaponStatus}. ${status}. ${reading.kills} kills out of five. Leader has ${reading.leader}.`;
    screens.forEach(({ context, canvas, texture }, index) => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#08111bdc"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = index ? "#ff9d67" : "#56dafa"; context.lineWidth = 3; context.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
      context.font = "bold 27px system-ui"; context.fillStyle = index ? "#ffc1a4" : "#a9f0ff";
      context.fillText(index ? "WEAPONS  /  SCORE" : "FLIGHT  /  SYSTEMS", 19, 34);
      context.font = "bold 30px system-ui"; context.fillStyle = "#f4fbff";
      context.fillText(index ? `${weaponName.toUpperCase()}  ·  ${reading.weapon === 1 ? `${reading.ammunition} AMMO` : `${rate} SHOTS/SEC`}` : `HULL ${health}%   SHIELD ${Math.round(reading.shields)}/40`, 20, 76, 594);
      context.font = "22px system-ui"; context.fillStyle = "#b6c8d5";
      context.fillText(index ? (reading.weapon === 1 ? (reading.weaponReady ? "READY" : `COOLING ${reading.weaponCooldown.toFixed(2)}s`) : (reading.overheated ? `OVERHEATED  ·  ${Math.round(reading.heat * 100)}% HEAT` : `READY ${Math.round(reading.heat * 100)}% HEAT`)) : `SPEED ${Math.round(reading.speed)} u/s   BOOST ${boostStatus}`, 20, 111, 594);
      context.font = "19px system-ui"; context.fillStyle = "#9db0c1";
      context.fillText(index ? status : `STATUS ${status}`, 20, 139, 594);
      const bx = 20, by = 154, bw = 594;
      context.fillStyle = "#263747"; context.fillRect(bx, by, bw, 13);
      const value = index
        ? (reading.weapon === 1 ? (reading.weaponReady ? 1 : Math.max(0, Math.min(1, 1 - reading.weaponCooldown / 0.5))) : (reading.overheated ? 1 - reading.heat : (reading.weaponReady ? 1 : Math.max(0, Math.min(1, 1 - reading.weaponCooldown / 0.16)))))
        : health / 100;
      context.fillStyle = index ? (reading.weaponReady ? "#65e6ff" : "#f4ac62") : "#fb6573"; context.fillRect(bx, by, Math.max(2, bw * value), 13);
      if (!index) { context.fillStyle = "#263747"; context.fillRect(bx, by + 20, bw, 7); context.fillStyle = "#67ceff"; context.fillRect(bx, by + 20, bw * boost / 100, 7); }
      texture.needsUpdate = true;
    });
  };
  return { group, tips, updateDashboard, get dashboardText() { return dashboardText; }, dispose: () => { owned.forEach(o => o.dispose()); } };
}
