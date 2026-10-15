import * as THREE from "three";
import type { AnonymousTopology, HitMsg, Pose, ShotMsg } from "./multiplayer";
import type { MapPilot } from "./minimap";
import { buildShip, type Ship } from "./ship";

/**
 * Where each pilot's constellation sits in the shared space. The first three form a triangle 1,500 units on a side, which is
 * about fifteen seconds at cruise speed and four on afterburner: close enough that you can see the next constellation glowing
 * from yours, far enough that two ordinary vaults never touch. The fourth sits across the gap from the first.
 */
export const WORLD_ORIGINS: [number, number, number][] = [[0, 0, 0], [1500, 0, 0], [-750, 0, 1299], [-750, 0, -1299]];
/** The colour of each pilot's ship, by place in the room. Your own ship is always cyan. */
export const SLOT_COLORS = ["#ffb347", "#c792ff", "#7dff9a", "#ff7a9a"];

const CORE = 0.34;           // as in the renderer: the solid part of a note sprite
const SHIP_SCALE = 0.34;
const BOLT_SPEED = 1500;
const BOLT_LENGTH = 22;
const BOLT_RANGE = 1100;
const MAX_BOLTS = 48;
const MAX_BURSTS = 6;
const POSE_STALE_MS = 2500;  // a pilot we have not heard from for this long is hidden

interface RemoteMap { points: THREE.Points; lines: THREE.LineSegments; ends: Int32Array; pos: Float32Array; ready: boolean }
interface RemoteShip { ship: Ship; label: HTMLDivElement; name: string; slot: number; color: string; pose: Pose | null; at: number; target: THREE.Vector3; shown: boolean; dead: boolean }
interface RemoteBolt { owner: string; id: string; o: THREE.Vector3; d: THREE.Vector3; travelled: number; head: THREE.Vector3; prev: THREE.Vector3 }
interface Burst { line: THREE.LineSegments; age: number; size: number; live: boolean }

export interface RemoteHooks {
  /** Does this segment of a bolt's flight hit your own ship? (It also applies the damage.) */
  hitTest(a: THREE.Vector3, b: THREE.Vector3): boolean;
  /** You were hit by a bolt from this pilot. */
  struck(shooterId: string, shotId: string, at: [number, number, number]): void;
}

/**
 * Everything of the other pilots that is drawn in your scene: their constellations (as glowing points and faint links, in
 * their own corner of the shared space), their ships, the bolts they fire, and the bursts where things are hit. All of it
 * comes from a few validated numbers; none of it can reach a note, a file or anything outside this drawing.
 */
export class RemoteWorld {
  private maps = new Map<string, RemoteMap>();
  private ships = new Map<string, RemoteShip>();
  private bolts: RemoteBolt[] = [];
  private boltLines: THREE.LineSegments;
  private boltPos = new Float32Array(MAX_BOLTS * 6);
  private boltCol = new Float32Array(MAX_BOLTS * 6);
  private bursts: Burst[] = [];
  private burstGeo: THREE.BufferGeometry;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private q = new THREE.Quaternion();

  constructor(
    private scene: THREE.Scene,
    private labelLayer: HTMLElement,
    private camera: THREE.PerspectiveCamera,
    private pointMaterial: () => THREE.ShaderMaterial,
    private hooks: RemoteHooks,
  ) {
    const g = new THREE.BufferGeometry();
    const pa = new THREE.BufferAttribute(this.boltPos, 3); pa.setUsage(THREE.DynamicDrawUsage); g.setAttribute("position", pa);
    const ca = new THREE.BufferAttribute(this.boltCol, 3); ca.setUsage(THREE.DynamicDrawUsage); g.setAttribute("color", ca);
    g.setDrawRange(0, 0);
    this.boltLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    this.boltLines.frustumCulled = false; this.boltLines.renderOrder = 5;
    scene.add(this.boltLines);
    this.burstGeo = new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1, 0));
  }

  get any(): boolean { return this.maps.size > 0 || this.ships.size > 0 || this.bolts.length > 0; }

  // ----------------------------------------------------------------- what arrives

  setTopology(id: string, topology: AnonymousTopology, name: string, slot: number): void {
    this.removeMap(id);
    const n = topology.nodes.length, ids = new Map<string, number>();
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), size = new Float32Array(n), alpha = new Float32Array(n).fill(0.9), emph = new Float32Array(n);
    topology.nodes.forEach((node, i) => {
      ids.set(node.id, i);
      const c = new THREE.Color(topology.groups[node.group]?.color ?? "#8b93a7");
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
      size[i] = (Math.min(5.5, 0.9 + Math.sqrt(node.degree) * 0.5) * 2) / CORE;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1)); geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1)); geo.setAttribute("aEmph", new THREE.BufferAttribute(emph, 1));
    const points = new THREE.Points(geo, this.pointMaterial());
    points.frustumCulled = false; points.renderOrder = 2; points.visible = false;
    const ends = new Int32Array(topology.links.length * 2);
    topology.links.forEach((l, k) => { ends[k * 2] = ids.get(l[0]) ?? 0; ends[k * 2 + 1] = ids.get(l[1]) ?? 0; });
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ends.length * 3), 3));
    const lc = new Float32Array(ends.length * 3);
    for (let k = 0; k < ends.length; k++) { lc[k * 3] = col[ends[k] * 3] * 0.2; lc[k * 3 + 1] = col[ends[k] * 3 + 1] * 0.2; lc[k * 3 + 2] = col[ends[k] * 3 + 2] * 0.2; }
    lg.setAttribute("color", new THREE.BufferAttribute(lc, 3));
    const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
    lines.frustumCulled = false; lines.renderOrder = 1; lines.visible = false;
    this.scene.add(points, lines);
    this.maps.set(id, { points, lines, ends, pos, ready: false });
    this.ensureShip(id, name, slot);
  }

  setPositions(id: string, positions: Float32Array): void {
    const m = this.maps.get(id); if (!m || positions.length !== m.pos.length) return;
    m.pos.set(positions);
    const pa = m.points.geometry.getAttribute("position") as THREE.BufferAttribute; pa.needsUpdate = true;
    const la = m.lines.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let k = 0; k < m.ends.length; k++) { const s = m.ends[k] * 3; la.array[k * 3] = m.pos[s]; la.array[k * 3 + 1] = m.pos[s + 1]; la.array[k * 3 + 2] = m.pos[s + 2]; }
    la.needsUpdate = true;
    m.ready = true; m.points.visible = true; m.lines.visible = true;
  }

  private ensureShip(id: string, name: string, slot: number): RemoteShip {
    let s = this.ships.get(id);
    if (s) { s.name = name; s.slot = slot; return s; }
    const ship = buildShip(), color = SLOT_COLORS[Math.max(0, Math.min(3, slot))];
    ship.group.scale.setScalar(SHIP_SCALE); ship.group.visible = false;
    ship.outline.color.set(color);
    this.scene.add(ship.group); ship.lights.forEach(l => { l.visible = true; this.scene.add(l); });
    const label = this.labelLayer.createDiv({ cls: "cg-label cg-label-pilot" });
    label.style.color = color; label.toggleClass("cg-hidden", true);
    s = { ship, label, name, slot, color, pose: null, at: 0, target: new THREE.Vector3(), shown: false, dead: false };
    this.ships.set(id, s);
    return s;
  }

  setPose(id: string, pose: Pose): void {
    const s = this.ships.get(id); if (!s) return;
    const wasDead = s.dead;
    s.pose = pose; s.at = performance.now(); s.dead = pose.hp <= 0;
    if (s.dead && !wasDead && s.shown) this.burst(pose.p[0], pose.p[1], pose.p[2], 14, s.color);
    if (!s.shown && pose.ac && !s.dead) { s.ship.group.position.set(...pose.p); s.ship.group.quaternion.set(...pose.q).normalize(); }
  }

  addShot(id: string, shot: ShotMsg): void {
    if (this.bolts.length >= MAX_BOLTS) this.bolts.shift();
    const o = new THREE.Vector3(...shot.o), d = new THREE.Vector3(...shot.d).normalize();
    this.bolts.push({ owner: id, id: shot.id, o, d, travelled: 0, head: o.clone(), prev: o.clone() });
  }

  showHit(hit: HitMsg): void { this.burst(hit.at[0], hit.at[1], hit.at[2], 6, "#ffb27a"); }

  remove(id: string): void {
    this.removeMap(id);
    const s = this.ships.get(id);
    if (s) { this.scene.remove(s.ship.group); s.ship.lights.forEach(l => this.scene.remove(l)); s.ship.dispose(); s.label.remove(); this.ships.delete(id); }
    this.bolts = this.bolts.filter(b => b.owner !== id);
  }

  private removeMap(id: string): void {
    const m = this.maps.get(id); if (!m) return;
    this.scene.remove(m.points, m.lines);
    m.points.geometry.dispose(); (m.points.material as THREE.Material).dispose(); m.lines.geometry.dispose(); (m.lines.material as THREE.Material).dispose();
    this.maps.delete(id);
  }

  clear(): void { for (const id of [...new Set([...this.maps.keys(), ...this.ships.keys()])]) this.remove(id); this.bolts = []; for (const b of this.bursts) b.live = false; this.bursts.forEach(b => { b.line.visible = false; }); }

  // ----------------------------------------------------------------- per frame

  update(dt: number, width: number, height: number): void {
    const now = performance.now();
    // ships: ease toward where the pilot is now (their last pose, carried forward by their speed)
    const cam = this.camera.position;
    for (const s of this.ships.values()) {
      const p = s.pose, alive = !!p && p.ac && !s.dead && now - s.at < POSE_STALE_MS;
      s.ship.group.visible = alive; s.label.toggleClass("cg-hidden", !alive);
      s.shown = alive;
      if (!alive || !p) continue;
      const age = Math.min(0.25, (now - s.at) / 1000);
      s.target.set(p.p[0] + p.v[0] * age, p.p[1] + p.v[1] * age, p.p[2] + p.v[2] * age);
      const k = 1 - Math.exp(-dt * 14), g = s.ship.group;
      g.position.lerp(s.target, k);
      g.quaternion.slerp(this.q.set(...p.q).normalize(), k);
      g.updateMatrixWorld(true);
      const speed = Math.hypot(p.v[0], p.v[1], p.v[2]);
      const len = 0.35 + Math.min(1, speed / 350) * 2 + (p.bo ? 1.2 : 0);
      for (const f of s.ship.flames) f.scale.set(1, len, 1);
      s.ship.outline.opacity = p.pr ? 0.35 + 0.35 * Math.sin(now * 0.02) : 0.9; // a ship that has just respawned shimmers
      // the name above the ship
      this.tmp.copy(g.position).project(this.camera);
      const infront = (g.position.x - cam.x) * this.dirX() + (g.position.y - cam.y) * this.dirY() + (g.position.z - cam.z) * this.dirZ() > 1;
      if (this.tmp.z > 1 || !infront || Math.abs(this.tmp.x) > 1.1 || Math.abs(this.tmp.y) > 1.1) { s.label.toggleClass("cg-hidden", true); continue; }
      const dist = cam.distanceTo(g.position), hp = Math.round(p.hp);
      const text = `${s.name}${hp < 100 ? ` · ${hp}` : ""}`;
      if (s.label.textContent !== text) s.label.textContent = text;
      s.label.style.opacity = String(Math.max(0.35, Math.min(1, 1.2 - dist / 2500)));
      s.label.style.transform = `translate(${Math.round((this.tmp.x * 0.5 + 0.5) * width)}px, ${Math.round((-this.tmp.y * 0.5 + 0.5) * height - 22)}px) translate(-50%, -100%)`;
    }
    this.stepBolts(dt);
    this.stepBursts(dt);
  }

  private dirX(): number { this.tmp2.set(0, 0, -1).applyQuaternion(this.camera.quaternion); return this.tmp2.x; }
  private dirY(): number { return this.tmp2.y; }
  private dirZ(): number { return this.tmp2.z; }

  private stepBolts(dt: number): void {
    let out = 0;
    for (let k = this.bolts.length - 1; k >= 0; k--) {
      const b = this.bolts[k];
      b.prev.copy(b.head); b.travelled += BOLT_SPEED * dt;
      b.head.copy(b.o).addScaledVector(b.d, b.travelled);
      if (b.travelled > BOLT_RANGE) { this.bolts.splice(k, 1); continue; }
      if (this.hooks.hitTest(b.prev, b.head)) { // it hit you
        this.hooks.struck(b.owner, b.id, [b.head.x, b.head.y, b.head.z]);
        this.burst(b.head.x, b.head.y, b.head.z, 5, "#ff8a6a");
        this.bolts.splice(k, 1); continue;
      }
      if (out >= MAX_BOLTS) continue;
      const tail = Math.max(0, b.travelled - BOLT_LENGTH), o = out * 6, color = this.ships.get(b.owner)?.color ?? "#ffb347";
      const c = new THREE.Color(color);
      this.boltPos[o] = b.o.x + b.d.x * tail; this.boltPos[o + 1] = b.o.y + b.d.y * tail; this.boltPos[o + 2] = b.o.z + b.d.z * tail;
      this.boltPos[o + 3] = b.head.x; this.boltPos[o + 4] = b.head.y; this.boltPos[o + 5] = b.head.z;
      this.boltCol[o] = c.r * 0.2; this.boltCol[o + 1] = c.g * 0.2; this.boltCol[o + 2] = c.b * 0.2;
      this.boltCol[o + 3] = c.r; this.boltCol[o + 4] = c.g; this.boltCol[o + 5] = c.b;
      out++;
    }
    const geo = this.boltLines.geometry;
    geo.setDrawRange(0, out * 2);
    (geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }

  private burst(x: number, y: number, z: number, size: number, color: string): void {
    let b = this.bursts.find(v => !v.live);
    if (!b && this.bursts.length < MAX_BURSTS) {
      const line = new THREE.LineSegments(this.burstGeo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }));
      line.renderOrder = 4; line.frustumCulled = false; this.scene.add(line);
      b = { line, age: 0, size, live: false }; this.bursts.push(b);
    }
    if (!b) b = this.bursts[0];
    (b.line.material as THREE.LineBasicMaterial).color.set(color);
    b.age = 0; b.size = size; b.live = true; b.line.visible = true; b.line.position.set(x, y, z);
  }

  private stepBursts(dt: number): void {
    for (const b of this.bursts) {
      if (!b.live) continue;
      b.age += dt; const t = b.age / 0.45;
      if (t >= 1) { b.live = false; b.line.visible = false; continue; }
      b.line.scale.setScalar(b.size * (0.6 + 5 * (1 - Math.pow(1 - t, 3))));
      (b.line.material as THREE.LineBasicMaterial).opacity = 0.9 * (1 - t);
    }
  }

  /** The other pilots, as the map draws them. */
  pilots(): MapPilot[] {
    const out: MapPilot[] = [];
    for (const s of this.ships.values()) {
      if (!s.shown || !s.pose) continue;
      const f = this.tmp2.set(0, 0, -1).applyQuaternion(this.q.set(...s.pose.q).normalize());
      out.push({ x: s.pose.p[0], y: s.pose.p[1], z: s.pose.p[2], fx: f.x, fz: f.z, color: s.color, name: s.name });
    }
    return out;
  }

  dispose(): void {
    this.clear();
    this.scene.remove(this.boltLines); this.boltLines.geometry.dispose(); (this.boltLines.material as THREE.Material).dispose();
    for (const b of this.bursts) { this.scene.remove(b.line); (b.line.material as THREE.Material).dispose(); }
    this.burstGeo.dispose();
  }
}
