import * as THREE from "three";
import { SURFACE_MUZZLE_OFFSET } from "./surfaceView";

/** Fixed-budget weapon-local energy coils and inward-moving sparks; cosmetic only. */
export class SurfaceChargeEffect extends THREE.Group {
  private readonly rings: THREE.Mesh[] = [];
  private readonly positions = new Float32Array(36);
  private readonly sparks: THREE.Points;
  private readonly material = new THREE.MeshBasicMaterial({color: 0x8cecff, transparent: true, opacity: 0, depthWrite: false});
  constructor() {
    super(); this.name = "blaster-charge-energy"; this.visible = false;
    this.position.set(...SURFACE_MUZZLE_OFFSET);
    for (let i = 0; i < 3; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.055, .0035, 5, 24), this.material);
      this.rings.push(ring); this.add(ring);
    }
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.sparks = new THREE.Points(geometry, new THREE.PointsMaterial({color: 0x8cecff, size: .012, transparent: true, opacity: .8, depthWrite: false}));
    this.sparks.frustumCulled = false; this.add(this.sparks);
  }
  setColor(color: string): void { this.material.color.set(color); (this.sparks.material as THREE.PointsMaterial).color.set(color); }
  update(elapsedMs: number | null, chargeMs: number): void {
    this.visible = elapsedMs !== null;
    if (elapsedMs === null) return;
    const time = Math.max(0, elapsedMs) / 1000, progress = Math.min(1, Math.max(0, elapsedMs) / chargeMs), ready = progress >= 1;
    this.material.opacity = .25 + progress * .6;
    for (let i = 0; i < 3; i++) {
      const ring = this.rings[i]; ring.position.z = .025 + i * .045;
      ring.rotation.set(Math.sin(time * 5 + i) * .22, Math.cos(time * 4 + i) * .22, time * (i % 2 ? -4 : 4));
      ring.scale.setScalar(1.7 - progress * .65 + Math.sin(time * (ready ? 16 : 7) + i) * .08);
    }
    for (let i = 0; i < 12; i++) {
      const phase = (time * (1.2 + progress) + i / 12) % 1, radius = .025 + (1 - phase) * .11;
      const angle = i * 2.399 + time * 4;
      this.positions.set([Math.cos(angle) * radius, Math.sin(angle) * radius, .02 + (1 - phase) * .18], i * 3);
    }
    this.sparks.geometry.getAttribute("position").needsUpdate = true;
  }
}
