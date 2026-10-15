import * as THREE from "three";

const COUNT = 240;     // specks of dust around the ship
const RADIUS = 80;     // how far from the ship they live, in scene units
const MIN_SPEED = 1;   // below this the dust just hangs there

/**
 * Space dust that makes speed visible. Specks of dust hang in the world around the ship; as the ship moves they slide
 * past, drawn as short lines that stretch the faster it goes (and glow hotter under afterburner). A speck that falls
 * behind or drifts too far is moved to a new place ahead, so the ship always flies through fresh dust.
 */
export class SpeedFx {
  private pos = new Float32Array(COUNT * 3);
  private lines: THREE.LineSegments;
  private linePos = new Float32Array(COUNT * 6);
  private lineCol = new Float32Array(COUNT * 6);
  private fresh = true;
  private tmp = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {
    const g = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(this.linePos, 3); pa.setUsage(THREE.DynamicDrawUsage); g.setAttribute("position", pa);
    const ca = new THREE.BufferAttribute(this.lineCol, 3); ca.setUsage(THREE.DynamicDrawUsage); g.setAttribute("color", ca);
    this.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 1;
    this.lines.visible = false;
    scene.add(this.lines);
  }

  show(on: boolean): void { this.lines.visible = on; if (on) this.fresh = true; }

  /** `speed01` is 0..1 of the top speed; `boost` is true while the afterburner burns. */
  update(shipPos: THREE.Vector3, vel: THREE.Vector3, speed01: number, boost: boolean): void {
    if (!this.lines.visible) return;
    const speed = vel.length(), moving = speed > MIN_SPEED;
    if (moving) this.dir.copy(vel).divideScalar(speed); else this.dir.set(0, 0, -1);

    for (let i = 0; i < COUNT; i++) {
      const o = i * 3;
      let dx = this.pos[o] - shipPos.x, dy = this.pos[o + 1] - shipPos.y, dz = this.pos[o + 2] - shipPos.z;
      const d2 = dx * dx + dy * dy + dz * dz, behind = dx * this.dir.x + dy * this.dir.y + dz * this.dir.z < -RADIUS * 0.4;
      if (this.fresh || d2 > RADIUS * RADIUS || (moving && behind)) {
        // a new speck: anywhere around the ship at first, and ahead of it once the ship is moving
        const u = Math.random() * 2 - 1, a = Math.random() * 6.2832, s = Math.sqrt(1 - u * u), r = RADIUS * (this.fresh ? Math.cbrt(Math.random()) : 0.55 + Math.random() * 0.45);
        this.tmp.set(Math.cos(a) * s, u, Math.sin(a) * s);
        if (moving && !this.fresh) { this.tmp.multiplyScalar(0.7).addScaledVector(this.dir, 0.9).normalize(); }
        dx = this.tmp.x * r; dy = this.tmp.y * r; dz = this.tmp.z * r;
        this.pos[o] = shipPos.x + dx; this.pos[o + 1] = shipPos.y + dy; this.pos[o + 2] = shipPos.z + dz;
      }
      // a line from the speck back along the way the ship is going: longer the faster, brighter near the ship
      const len = moving ? Math.min(18, 0.35 + speed * 0.045) : 0.25;
      const near = 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy + dz * dz) / RADIUS);
      const a = (0.1 + 0.55 * Math.min(1, speed01 * 1.6)) * near * near * (boost ? 1.4 : 1);
      const k = i * 6;
      this.linePos[k] = this.pos[o]; this.linePos[k + 1] = this.pos[o + 1]; this.linePos[k + 2] = this.pos[o + 2];
      this.linePos[k + 3] = this.pos[o] - this.dir.x * len; this.linePos[k + 4] = this.pos[o + 1] - this.dir.y * len; this.linePos[k + 5] = this.pos[o + 2] - this.dir.z * len;
      const r = boost ? 0.45 : 0.7, g = boost ? 0.85 : 0.85, b = 1;
      this.lineCol[k] = r * a; this.lineCol[k + 1] = g * a; this.lineCol[k + 2] = b * a;
      this.lineCol[k + 3] = r * a * 0.15; this.lineCol[k + 4] = g * a * 0.15; this.lineCol[k + 5] = b * a * 0.15; // the tail fades
    }
    this.fresh = false;
    const geo = this.lines.geometry;
    (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.lines);
    this.lines.geometry.dispose(); (this.lines.material as THREE.Material).dispose();
  }
}
