import * as THREE from "three";

const COUNT = 240;
const RADIUS = 80;
const MIN_SPEED = 1;

/** World-space dust streaks communicate velocity and brighten under afterburner. */
export class SpeedFx {
  private pos = new Float32Array(COUNT * 3);
  private lines: THREE.LineSegments;
  private linePos = new Float32Array(COUNT * 6);
  private lineCol = new Float32Array(COUNT * 6);
  private fresh = true;
  private tmp = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(this.linePos, 3); position.setUsage(THREE.DynamicDrawUsage); geometry.setAttribute("position", position);
    const color = new THREE.BufferAttribute(this.lineCol, 3); color.setUsage(THREE.DynamicDrawUsage); geometry.setAttribute("color", color);
    this.lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 1;
    this.lines.visible = false;
    scene.add(this.lines);
  }

  show(on: boolean): void { this.lines.visible = on; if (on) this.fresh = true; }

  update(shipPos: THREE.Vector3, velocity: THREE.Vector3, speed01: number, boost: boolean): void {
    if (!this.lines.visible) return;
    const speed = velocity.length(), moving = speed > MIN_SPEED;
    if (moving) this.dir.copy(velocity).divideScalar(speed); else this.dir.set(0, 0, -1);

    for (let i = 0; i < COUNT; i++) {
      const offset = i * 3;
      let dx = this.pos[offset] - shipPos.x, dy = this.pos[offset + 1] - shipPos.y, dz = this.pos[offset + 2] - shipPos.z;
      const d2 = dx * dx + dy * dy + dz * dz, behind = dx * this.dir.x + dy * this.dir.y + dz * this.dir.z < -RADIUS * 0.4;
      if (this.fresh || d2 > RADIUS * RADIUS || (moving && behind)) {
        const u = Math.random() * 2 - 1, angle = Math.random() * Math.PI * 2, ring = Math.sqrt(1 - u * u);
        const radius = RADIUS * (this.fresh ? Math.cbrt(Math.random()) : 0.55 + Math.random() * 0.45);
        this.tmp.set(Math.cos(angle) * ring, u, Math.sin(angle) * ring);
        if (moving && !this.fresh) this.tmp.multiplyScalar(0.7).addScaledVector(this.dir, 0.9).normalize();
        dx = this.tmp.x * radius; dy = this.tmp.y * radius; dz = this.tmp.z * radius;
        this.pos[offset] = shipPos.x + dx; this.pos[offset + 1] = shipPos.y + dy; this.pos[offset + 2] = shipPos.z + dz;
      }
      const length = moving ? Math.min(18, 0.35 + speed * 0.045) : 0.25;
      const near = 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy + dz * dz) / RADIUS);
      const alpha = (0.1 + 0.55 * Math.min(1, speed01 * 1.6)) * near * near * (boost ? 1.4 : 1);
      const lineOffset = i * 6;
      this.linePos[lineOffset] = this.pos[offset]; this.linePos[lineOffset + 1] = this.pos[offset + 1]; this.linePos[lineOffset + 2] = this.pos[offset + 2];
      this.linePos[lineOffset + 3] = this.pos[offset] - this.dir.x * length;
      this.linePos[lineOffset + 4] = this.pos[offset + 1] - this.dir.y * length;
      this.linePos[lineOffset + 5] = this.pos[offset + 2] - this.dir.z * length;
      const red = boost ? 0.45 : 0.7, green = 0.85, blue = 1;
      this.lineCol[lineOffset] = red * alpha; this.lineCol[lineOffset + 1] = green * alpha; this.lineCol[lineOffset + 2] = blue * alpha;
      this.lineCol[lineOffset + 3] = red * alpha * 0.15; this.lineCol[lineOffset + 4] = green * alpha * 0.15; this.lineCol[lineOffset + 5] = blue * alpha * 0.15;
    }
    this.fresh = false;
    const geometry = this.lines.geometry;
    (geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.scene.remove(this.lines);
    this.lines.geometry.dispose(); (this.lines.material as THREE.Material).dispose();
  }
}
