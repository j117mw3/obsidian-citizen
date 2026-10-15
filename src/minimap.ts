import type { SimNode } from "./types";

/** A pilot as the map sees them: where they are (scene units) and which way they face. */
export interface MapPilot { x: number; y: number; z: number; fx: number; fz: number; color: string; name: string; self?: boolean }

/** A group that is collapsed into one point, as the map sees it. */
export interface MapCluster { x: number; z: number; r: number; color: string; name: string }

export interface MapHost {
  nodes(): SimNode[];
  solid(i: number): boolean;
  groupColor(gi: number): string;
  bounds(): { cx: number; cy: number; cz: number; radius: number };
  selectedIndex(): number;
  /** Both ends of every link, as two parallel lists. */
  linkEnds(): { a: SimNode[]; b: SimNode[] };
  /** Groups that are collapsed right now. */
  collapsed(): MapCluster[];
}

export type MapMode = "off" | "small" | "large";

const SMALL = 190;
const MAX_LINKS = 2500;   // above this the map draws a sample of the links
const BASE_EVERY = 0.5;   // seconds between redraws of the notes and links
const PILOTS_EVERY = 0.06; // and of the pilots

/**
 * A flat, top-down map in the style of Obsidian's own graph view: grey links, coloured dots for notes, the selected note
 * ringed, and each pilot drawn as an arrow showing where they are and which way they face. The notes are drawn from the
 * real positions in the scene, looking straight down, so a pilot's arrow is always exactly where their ship is. A thin
 * gauge down the right-hand side shows height.
 */
export class Minimap {
  private root: HTMLDivElement;
  private base: HTMLCanvasElement;
  private over: HTMLCanvasElement;
  private caption: HTMLDivElement;
  private mode: MapMode = "small";
  private size = SMALL;
  private baseAge = 1e9; private pilotAge = 1e9;
  private dirty = true;
  private view = { cx: 0, cz: 0, cy: 0, r: 100 };

  constructor(parent: HTMLElement, private host: MapHost) {
    this.root = parent.createDiv({ cls: "cg-minimap", attr: { "aria-hidden": "true" } });
    this.base = createEl("canvas", { cls: "cg-minimap-base" });
    this.over = createEl("canvas", { cls: "cg-minimap-over" });
    this.root.append(this.base, this.over);
    this.caption = this.root.createDiv({ cls: "cg-minimap-caption", text: "Map" });
    this.root.hidden = true;
  }

  setMode(mode: MapMode, containerHeight = 700): void {
    this.mode = mode;
    this.root.hidden = mode === "off";
    this.size = mode === "large" ? Math.round(Math.max(SMALL, Math.min(430, containerHeight * 0.55))) : SMALL;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const c of [this.base, this.over]) {
      c.width = Math.round(this.size * dpr); c.height = Math.round(this.size * dpr);
      c.style.width = this.size + "px"; c.style.height = this.size + "px";
    }
    this.caption.textContent = mode === "large" ? "Map (M: hide)" : "Map (M: larger)";
    this.dirty = true;
  }

  get currentMode(): MapMode { return this.mode; }

  /** Call every frame with the pilots to draw; the map redraws itself at its own, slower pace. */
  update(dt: number, pilots: MapPilot[]): void {
    if (this.mode === "off") return;
    this.baseAge += dt; this.pilotAge += dt;
    if (this.dirty || this.baseAge > BASE_EVERY) { this.drawBase(); this.baseAge = 0; this.dirty = false; this.pilotAge = 1e9; }
    if (this.pilotAge > PILOTS_EVERY) { this.drawPilots(pilots); this.pilotAge = 0; }
  }

  destroy(): void { this.root.remove(); }

  // ----------------------------------------------------------------- drawing

  private toMap(x: number, z: number): [number, number] {
    const half = this.size / 2, s = (half - 12) / this.view.r;
    return [half + (x - this.view.cx) * s, half + (z - this.view.cz) * s];
  }

  private drawBase(): void {
    const ctx = this.base.getContext("2d"); if (!ctx) return;
    const dpr = this.base.width / this.size, n = this.host.nodes();
    const b = this.host.bounds();
    this.view = { cx: b.cx, cz: b.cz, cy: b.cy, r: Math.max(40, b.radius * 1.15) };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.fillStyle = "rgba(9, 12, 20, 0.78)"; ctx.fillRect(0, 0, this.size, this.size);

    // links: one faint path (a sample of them in a big vault)
    const { a, b: e } = this.host.linkEnds();
    ctx.strokeStyle = "rgba(150, 160, 195, 0.16)"; ctx.lineWidth = 0.6; ctx.beginPath();
    const step = Math.max(1, Math.ceil(a.length / MAX_LINKS));
    for (let l = 0; l < a.length; l += step) {
      const [x1, y1] = this.toMap(a[l].x, a[l].z), [x2, y2] = this.toMap(e[l].x, e[l].z);
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    }
    ctx.stroke();

    // notes, as dots coloured by group
    const big = n.length > 1800;
    for (let i = 0; i < n.length; i++) {
      if (!this.host.solid(i)) continue;
      const p = n[i], [x, y] = this.toMap(p.x, p.z);
      ctx.fillStyle = this.host.groupColor(p.gi); ctx.globalAlpha = 0.8;
      if (big) ctx.fillRect(x - 0.8, y - 0.8, 1.6, 1.6);
      else { ctx.beginPath(); ctx.arc(x, y, Math.min(3.2, 1.1 + Math.sqrt(p.deg) * 0.28), 0, 6.2832); ctx.fill(); }
    }
    ctx.globalAlpha = 1;

    // groups that are collapsed into one point
    for (const c of this.host.collapsed()) {
      const [x, y] = this.toMap(c.x, c.z), r = Math.max(4, Math.min(14, 3 + c.r * 0.35 * ((this.size / 2 - 12) / this.view.r)));
      ctx.fillStyle = c.color; ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(x, y, r * 1.8, 0, 6.2832); ctx.fill();
      ctx.globalAlpha = 0.95; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); ctx.globalAlpha = 1;
    }

    // the selected note
    const sel = this.host.selectedIndex();
    if (sel >= 0 && n[sel]) {
      const [x, y] = this.toMap(n[sel].x, n[sel].z);
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.2832); ctx.stroke();
    }

    // frame
    ctx.strokeStyle = "rgba(255, 255, 255, 0.14)"; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, this.size - 1, this.size - 1);
  }

  private drawPilots(pilots: MapPilot[]): void {
    const ctx = this.over.getContext("2d"); if (!ctx) return;
    const dpr = this.over.width / this.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.size, this.size);

    // height gauge down the right-hand edge
    const gx = this.size - 7, g0 = 14, g1 = this.size - 14, rY = this.view.r;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(gx, g0); ctx.lineTo(gx, g1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(gx - 3, (g0 + g1) / 2); ctx.lineTo(gx + 3, (g0 + g1) / 2); ctx.stroke();

    for (const p of pilots) {
      let [x, y] = this.toMap(p.x, p.z);
      // a pilot far outside the map is pinned to its edge
      const m = 10; let pinned = false;
      if (x < m || x > this.size - m || y < m || y > this.size - m) { x = Math.min(this.size - m, Math.max(m, x)); y = Math.min(this.size - m, Math.max(m, y)); pinned = true; }
      const len = Math.hypot(p.fx, p.fz) || 1, dx = p.fx / len, dy = p.fz / len, s = p.self ? 7 : 6;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.atan2(dy, dx) + Math.PI / 2);
      ctx.fillStyle = p.color; ctx.strokeStyle = "rgba(0, 0, 0, 0.7)"; ctx.lineWidth = 1.5; ctx.globalAlpha = pinned ? 0.6 : 1;
      ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.7, s * 0.8); ctx.lineTo(0, s * 0.35); ctx.lineTo(-s * 0.7, s * 0.8); ctx.closePath(); ctx.stroke(); ctx.fill();
      ctx.restore(); ctx.globalAlpha = 1;
      if (!p.self) { ctx.font = "600 10px system-ui, sans-serif"; ctx.fillStyle = p.color; ctx.textAlign = "center"; ctx.fillText(p.name, Math.min(this.size - 24, Math.max(24, x)), Math.max(10, y - 9)); }
      // height marker on the gauge
      const t = 1 - Math.min(1, Math.max(0, (p.y - this.view.cy + rY) / (2 * rY)));
      ctx.fillStyle = p.color; ctx.fillRect(gx - 3, g0 + t * (g1 - g0) - 1.5, 6, 3);
    }
  }
}
