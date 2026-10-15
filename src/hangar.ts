import * as THREE from "three";
import type { ConstellationSettings } from "./settings";
import { buildShip, type Ship } from "./ship";
import type { AfterburnerSoundId, EngineSoundId, LaserSoundId, ShipId } from "./pilotProfile";

type ChoicePatch = Partial<Pick<ConstellationSettings, "pilotShip" | "pilotEngineSound" | "pilotAfterburnerSound" | "pilotLaserSound" | "pilotNearbyAudio">>;
const SHIPS: [ShipId, string][] = [["classic", "Classic fighter"], ["vector", "Vector interceptor"], ["dart", "Dart scout"], ["bulwark", "Bulwark gunship"], ["crescent", "Crescent spacecraft"]];
const ENGINES: [EngineSoundId, string][] = [["classic", "Classic rumble"], ["ion", "Ion pulse"]];
const BOOSTS: [AfterburnerSoundId, string][] = [["classic", "Classic whoosh"], ["plasma", "Plasma surge"]];
const LASERS: [LaserSoundId, string][] = [["classic", "Classic blaster"], ["pulse", "Pulse bolt"]];

export class PilotHangar {
  readonly panel: HTMLElement;
  private canvas: HTMLCanvasElement;
  private gl: THREE.WebGLRenderer | null = null;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  private ship: Ship | null = null;
  private frame = 0;
  private destroyed = false;
  private resume: HTMLButtonElement;
  private close: HTMLButtonElement;
  private observer: ResizeObserver;

  constructor(parent: HTMLElement, initial: ConstellationSettings, private onChange: (patch: ChoicePatch) => void, private onPreview: (kind: "engine" | "afterburner" | "laser") => void, private onResume: () => void) {
    this.panel = document.createElement("aside"); this.panel.className = "cg-hangar"; this.panel.hidden = true;
    this.panel.setAttribute("aria-label", "Spacecraft hangar"); this.panel.setAttribute("role", "dialog"); this.panel.setAttribute("aria-modal", "false");
    const heading = document.createElement("h2"); heading.textContent = "Spacecraft Hangar"; this.panel.appendChild(heading);
    const previewWrap = document.createElement("div"); previewWrap.className = "cg-hangar-preview";
    this.canvas = document.createElement("canvas"); this.canvas.setAttribute("aria-label", "Rotating spacecraft preview"); previewWrap.appendChild(this.canvas); this.panel.appendChild(previewWrap);
    this.scene.background = new THREE.Color(0x080b13);
    this.camera.position.set(0, 1.7, 8); this.camera.lookAt(0, 0, 0);
    this.scene.add(new THREE.AmbientLight(0xb8c8ee, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(2, 4, 5); this.scene.add(key);
    try { this.gl = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false }); this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); }
    catch { previewWrap.textContent = "Preview is unavailable; the ship choices still work."; }
    this.setShip(initial.pilotShip);
    const controls = document.createElement("div"); controls.className = "cg-hangar-controls";
    this.select(controls, "Spacecraft", SHIPS, initial.pilotShip, value => { this.setShip(value); this.onChange({ pilotShip: value }); });
    this.soundSelect(controls, "Engine", ENGINES, initial.pilotEngineSound, "engine", value => this.onChange({ pilotEngineSound: value }));
    this.soundSelect(controls, "Afterburner", BOOSTS, initial.pilotAfterburnerSound, "afterburner", value => this.onChange({ pilotAfterburnerSound: value }));
    this.soundSelect(controls, "Laser", LASERS, initial.pilotLaserSound, "laser", value => this.onChange({ pilotLaserSound: value }));
    const nearbyLabel = document.createElement("label"); nearbyLabel.className = "cg-hangar-nearby";
    const nearby = document.createElement("input"); nearby.type = "checkbox"; nearby.checked = initial.pilotNearbyAudio;
    nearby.addEventListener("change", () => this.onChange({ pilotNearbyAudio: nearby.checked }));
    nearbyLabel.append(nearby, document.createTextNode("Nearby ship audio")); controls.appendChild(nearbyLabel);
    this.panel.appendChild(controls);
    const actions = document.createElement("div"); actions.className = "cg-hangar-actions";
    this.close = document.createElement("button"); this.close.type = "button"; this.close.className = "cg-btn"; this.close.textContent = "Close"; this.close.addEventListener("click", () => this.hide());
    this.resume = document.createElement("button"); this.resume.type = "button"; this.resume.className = "cg-btn cg-primary"; this.resume.hidden = true; this.resume.textContent = "Resume flight"; this.resume.addEventListener("click", () => { this.hide(); this.onResume(); });
    actions.append(this.close, this.resume); this.panel.appendChild(actions); parent.appendChild(this.panel);
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(previewWrap);
  }

  private select<T extends string>(parent: HTMLElement, labelText: string, options: [T, string][], value: T, onValue: (value: T) => void): HTMLSelectElement {
    const label = document.createElement("label"); label.className = "cg-hangar-row";
    const text = document.createElement("span"); text.textContent = labelText;
    const select = document.createElement("select"); select.setAttribute("aria-label", labelText);
    for (const [id, name] of options) { const option = document.createElement("option"); option.value = id; option.textContent = name; select.appendChild(option); }
    select.value = value; select.addEventListener("change", () => onValue(select.value as T));
    label.append(text, select); parent.appendChild(label); return select;
  }

  private soundSelect<T extends string>(parent: HTMLElement, name: string, options: [T, string][], value: T, kind: "engine" | "afterburner" | "laser", onValue: (value: T) => void): void {
    const row = document.createElement("div"); row.className = "cg-hangar-sound-row";
    this.select(row, name, options, value, onValue);
    const preview = document.createElement("button"); preview.type = "button"; preview.className = "cg-btn cg-hangar-preview-btn"; preview.textContent = "Preview"; preview.setAttribute("aria-label", `Preview ${name.toLowerCase()} sound`); preview.addEventListener("click", () => this.onPreview(kind));
    row.appendChild(preview); parent.appendChild(row);
  }

  private setShip(id: ShipId): void {
    if (this.ship) { this.scene.remove(this.ship.group); this.ship.dispose(); }
    this.ship = buildShip(id); this.ship.group.scale.setScalar(1.35); this.ship.group.position.set(0, 0, 0); this.scene.add(this.ship.group);
    this.resize();
  }

  setFlightActive(active: boolean): void { this.resume.hidden = !active; this.close.hidden = active; }
  show(): void { if (this.destroyed) return; this.panel.hidden = false; this.resize(); this.frame = requestAnimationFrame(this.draw); }
  hide(): void { this.panel.hidden = true; cancelAnimationFrame(this.frame); }
  private resize(): void {
    if (!this.gl || this.panel.hidden) return;
    const width = Math.max(1, this.canvas.clientWidth), height = Math.max(1, this.canvas.clientHeight);
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); this.gl.setSize(width, height, false);
  }
  private draw = (): void => {
    if (this.destroyed || this.panel.hidden || !this.gl) return;
    if (this.ship) this.ship.group.rotation.y += 0.006;
    this.gl.render(this.scene, this.camera); this.frame = requestAnimationFrame(this.draw);
  };
  destroy(): void {
    this.destroyed = true; cancelAnimationFrame(this.frame); this.observer.disconnect();
    if (this.ship) { this.scene.remove(this.ship.group); this.ship.dispose(); this.ship = null; }
    this.gl?.dispose(); this.gl = null; this.panel.remove();
  }
}
