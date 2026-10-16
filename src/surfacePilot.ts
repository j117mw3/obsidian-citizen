import { SurfaceChargeEffect } from "./surfaceCharge";
import { SURFACE_CHARGE, type SurfaceShotKind } from "./surfaceCombat";
import { SurfaceVentSteam } from "./surfaceSteam";
import { surfacePoleGuides } from "./surfaceNavigation";
import * as THREE from "three";
import { SURFACE } from "./surface";
import type { SurfaceArenaView, SurfacePlayerView, SurfaceShipState } from "./surfaceWorld";
import type { SurfaceInput } from "./surfacePhysics";
import type { ConstellationSettings } from "./settings";
import { normalizeSurfaceLaserColor } from "./surfaceColor";
import type { SurfaceDamageCue, SurfaceHitConfirmation } from "./surfaceAuthority";
import { SurfaceAudio } from "./surfaceAudio";
import { SURFACE_MUZZLE_OFFSET, SURFACE_WORLD_SCALE, surfaceBlasterDirection, surfaceToWorld, surfaceViewPose } from "./surfaceView";
import { renderSurfaceViewmodel } from "./surfaceVisuals";

const WORLD_SCALE = SURFACE_WORLD_SCALE;
const STEP = 1 / 60;
const LOOK_SCALE = 0.0022;

export interface SurfacePilotCallbacks {
  step(input: SurfaceInput & { interact: boolean }, dt: number, now: number): SurfacePlayerView | null;
  fire(origin: [number, number, number], direction: [number, number, number], sequence: number, viewTime: number, kind?: SurfaceShotKind): SurfacePlayerView | null;
  charge?(active: boolean): void;
  hostViewTime?(): number;
  hostTime?(): number;
  arenaCenter?(arena: SurfaceArenaView): [number, number, number];
  trainingReset?(maximum: 100 | 150): void;
  nearbyThreats?(): Array<{ bearing: number; distance: number }>;
  connectionRtt?(): number;
  connectionDegraded?(): boolean;
  prepareSpaceAudio?(): void;
  ended(ship: SurfaceShipState, center: [number, number, number]): void;
}

/** First-person surface input, camera, and compact arena HUD. */
export class SurfacePilot {
  active = false;
  private playerId = "";
  private arena: SurfaceArenaView | null = null;
  private state: SurfacePlayerView | null = null;
  private spawnRelocated = false;
  private keys = new Set<string>();
  private pointerLocked = false;
  private mouseX = 0;
  private mouseY = 0;
  private accumulator = 0;
  private shotCooldown = 0;
  private heldFire = false;
  private recoil = 0;
  private headBobTime = 0;
  private stepSoundTimer = 0;
  private muzzleFlashUntil = 0;
  private chargeStartedAt: number | null = null;
  private chargeReady = false;
  private readonly chargeEffect = new SurfaceChargeEffect();
  private fireSequence = 0;
  private readonly hud: HTMLDivElement;
  private readonly healthText: HTMLSpanElement;
  private readonly armorText: HTMLSpanElement;
  private readonly healthFill: HTMLDivElement;
  private readonly armorFill: HTMLDivElement;
  private readonly heatText: HTMLSpanElement;
  private readonly heatFill: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly hitMarker: HTMLDivElement;
  private readonly damageIndicator: HTMLDivElement;
  private readonly stanceStatus: HTMLDivElement;
  private readonly poleCompass: HTMLDivElement;
  private readonly poleEdges: HTMLDivElement[];
  private readonly poleCards: HTMLDivElement[];
  private readonly enemyCue: HTMLDivElement;
  private readonly enemySectors: HTMLSpanElement[];
  private readonly connectionStatus: HTMLDivElement;
  private readonly trainingPanel: HTMLDivElement;
  private readonly trainingSelect: HTMLSelectElement;
  private readonly trainingButton: HTMLButtonElement;
  private readonly ventSteam = new SurfaceVentSteam();
  private readonly viewModel = new THREE.Group();
  private readonly viewScene = new THREE.Scene();
  private readonly emitterMaterial = new THREE.MeshBasicMaterial({ color: 0x8cecff });
  private readonly muzzleFlash = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
  private readonly up = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly look = new THREE.Vector3();
  private readonly cameraUp = new THREE.Vector3();
  private readonly back = new THREE.Vector3();
  private readonly center = new THREE.Vector3();
  private readonly point = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly roll = new THREE.Quaternion();
  private readonly cueForward = new THREE.Vector3();
  private readonly cueRight = new THREE.Vector3();
  private readonly cueUp = new THREE.Vector3();
  private readonly cueDirection = new THREE.Vector3();
  private hitMarkerUntil = 0;
  private damageUntil = 0;
  private lastEnemyCueAt = 0;
  private readonly seenCombatEvents = new Set<string>();
  private accumulatorInput: SurfaceInput & { interact: boolean } = { moveX: 0, moveY: 0, sprint: false, jump: false, crouch: false, yawDelta: 0, pitchDelta: 0, lean: 0, interact: false };

  constructor(private container: HTMLElement, private canvas: HTMLCanvasElement, private camera: THREE.PerspectiveCamera, _scene: THREE.Scene,
    private callbacks: SurfacePilotCallbacks, private settings: ConstellationSettings, private audio: SurfaceAudio) {
    this.hud = container.createDiv({ cls: "cg-surface-hud", attr: { "aria-hidden": "true" } });
    this.hud.hidden = true;
    this.crosshair = this.hud.createDiv({ cls: "cg-surface-crosshair" });
    this.hitMarker = this.hud.createDiv({ cls: "cg-surface-hit-marker" }); this.hitMarker.textContent = ""; this.hitMarker.hidden = true;
    this.damageIndicator = this.hud.createDiv({ cls: "cg-surface-damage-direction" }); this.damageIndicator.textContent = "▲"; this.damageIndicator.hidden = true;
    this.stanceStatus = this.hud.createDiv({ cls: "cg-surface-stance" });
    this.poleCompass = this.hud.createDiv({ cls: "cg-surface-pole-compass" });
    this.poleCompass.setAttribute("aria-label", "Pole navigation");
    this.poleCards = ["north", "south"].map(name => this.poleCompass.createDiv({ cls: `cg-pole-card cg-pole-${name}` }));
    this.poleEdges = ["north", "south"].map(name => this.hud.createDiv({ cls: `cg-pole-edge cg-pole-${name}` }));
    this.enemyCue = this.hud.createDiv({ cls: "cg-surface-enemy-cue" });
    this.enemySectors = Array.from({ length: 8 }, (_, index) => {
      const sector = this.enemyCue.createSpan({ cls: "cg-surface-enemy-sector" }); sector.textContent = "·"; sector.setAttribute("aria-hidden", "true"); sector.dataset.sector = String(index); return sector;
    });
    this.connectionStatus = this.hud.createDiv({ cls: "cg-surface-connection" });
    const status = this.hud.createDiv({ cls: "cg-surface-status" });
    const health = status.createDiv({ cls: "cg-surface-resource" });
    this.healthText = health.createSpan({ cls: "cg-surface-resource-label" });
    const healthTrack = health.createDiv({ cls: "cg-surface-track cg-surface-health" });
    this.healthFill = healthTrack.createDiv({ cls: "cg-surface-fill" });
    const armor = status.createDiv({ cls: "cg-surface-resource" });
    this.armorText = armor.createSpan({ cls: "cg-surface-resource-label" });
    const armorTrack = armor.createDiv({ cls: "cg-surface-track cg-surface-armor" });
    this.armorFill = armorTrack.createDiv({ cls: "cg-surface-fill" });
    const heat = status.createDiv({ cls: "cg-surface-resource" });
    this.heatText = heat.createSpan({ cls: "cg-surface-resource-label" });
    const heatTrack = heat.createDiv({ cls: "cg-surface-track cg-surface-heat" });
    this.heatFill = heatTrack.createDiv({ cls: "cg-surface-fill" });
    this.prompt = this.hud.createDiv({ cls: "cg-surface-prompt" });
    this.trainingPanel = this.hud.createDiv({ cls: "cg-surface-training" });
    const trainingTitle = this.trainingPanel.createDiv({ cls: "cg-surface-training-title" });
    trainingTitle.textContent = "Training patrols";
    trainingTitle.setAttribute("aria-hidden", "true");
    this.trainingSelect = this.trainingPanel.createEl("select", { attr: { "aria-label": "All training dummies health" } });
    this.trainingSelect.createEl("option", { text: "100 HP" }).value = "100";
    this.trainingSelect.createEl("option", { text: "100 HP + 50 armor" }).value = "150";
    this.trainingButton = this.trainingPanel.createEl("button", { text: "Reset all dummies", attr: { type: "button" } });
    this.trainingButton.addEventListener("click", this.onTrainingReset);
    this.trainingSelect.addEventListener("change", this.onTrainingReset);

    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.09, 0.19), new THREE.MeshBasicMaterial({ color: 0x384456 }));
    const gunX = SURFACE_MUZZLE_OFFSET[0];
    glove.scale.set(1.25, 0.82, 1.55); glove.position.set(gunX - 0.07, -0.33, -0.52);
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.18, 10), new THREE.MeshBasicMaterial({ color: 0x202a36 }));
    wrist.rotation.x = Math.PI / 2; wrist.position.set(gunX - 0.09, -0.39, -0.42);
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.095, 0.27), new THREE.MeshBasicMaterial({ color: 0x222d3a }));
    receiver.position.set(gunX, -0.25, -0.65);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.035, 0.24, 10), new THREE.MeshBasicMaterial({ color: 0x9db4c8 }));
    barrel.rotation.x = Math.PI / 2; barrel.position.set(gunX, SURFACE_MUZZLE_OFFSET[1], SURFACE_MUZZLE_OFFSET[2] + 0.125);
    const emitter = new THREE.Mesh(new THREE.TorusGeometry(0.041, 0.008, 5, 12), this.emitterMaterial);
    emitter.position.set(...SURFACE_MUZZLE_OFFSET);
    this.muzzleFlash.position.set(...SURFACE_MUZZLE_OFFSET); this.muzzleFlash.position.z -= 0.04; this.muzzleFlash.visible = false;
    const knuckles = new THREE.Mesh(new THREE.BoxGeometry(.13,.035,.075), new THREE.MeshBasicMaterial({ color: 0x6b8598 }));
    knuckles.position.set(gunX-.065,-.285,-.55);
    const slide = new THREE.Mesh(new THREE.BoxGeometry(.10,.025,.22), new THREE.MeshBasicMaterial({color:0x566f83})); slide.position.set(gunX,-.195,-.65);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(.025,.025,.04),this.emitterMaterial); sight.position.set(gunX,-.17,-.73);
    this.viewModel.add(glove, wrist, receiver, barrel, emitter, knuckles, slide, sight, this.muzzleFlash, this.ventSteam, this.chargeEffect);
    for (const mesh of [glove, wrist, receiver, barrel]) {
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: 0xb6cfe1, transparent: true, opacity: 0.8 }));
      outline.position.copy(mesh.position); outline.quaternion.copy(mesh.quaternion); outline.scale.copy(mesh.scale); this.viewModel.add(outline);
    }
    this.viewModel.scale.setScalar(WORLD_SCALE);
    this.viewModel.visible = false;
    this.viewScene.add(this.viewModel);

    for (const key of ["keydown", "keyup"] as const) this.container.addEventListener(key, key === "keydown" ? this.onKeyDown : this.onKeyUp, true);
    this.container.addEventListener("blur", this.onBlur);
    this.canvas.addEventListener("contextmenu", this.onContextMenu);
    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointerleave", this.onPointerLeave);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    window.addEventListener("blur", this.onBlur);
  }

  enter(playerId: string, state: SurfacePlayerView, arena: SurfaceArenaView): void {
    if (state.mode !== "surface" || !state.surface) return;
    this.playerId = playerId;
    this.state = state;
    this.rememberSpawnPosition(state);
    this.arena = arena;
    this.active = true;
    this.keys.clear(); this.mouseX = this.mouseY = 0; this.accumulator = 0; this.shotCooldown = 0; this.heldFire = false;
    this.cancelCharge(); this.headBobTime = 0; this.hitMarkerUntil = 0; this.damageUntil = 0; this.stepSoundTimer = 0;
    this.audio.setOptions(this.settings.pilotSound, this.settings.pilotVolume);
    this.hud.hidden = false; this.viewModel.visible = true;
    this.trainingPanel.hidden = playerId !== "solo";
    this.container.classList.add("cg-surfacing");
    this.container.closest(".cg-root")?.classList.add("cg-surfacing");
    this.canvas.classList.add("cg-surface-canvas");
    this.camera.near = 0.02; this.camera.fov = this.settings.surfaceFov; this.camera.updateProjectionMatrix();
    this.canvas.requestPointerLock?.();
    this.updateView(0);
    this.updateHud();
  }

  applySettings(settings: ConstellationSettings): void {
    this.settings = settings;
    this.audio.setOptions(settings.pilotSound, settings.pilotVolume);
    this.setLaserColor(settings.surfaceLaserColor);
    if (this.active) { this.camera.fov = settings.surfaceFov; this.camera.updateProjectionMatrix(); this.updateView(0); }
  }

  setLaserColor(value: unknown): void {
    const color = normalizeSurfaceLaserColor(value) ?? "#8CECFF";
    this.chargeEffect.setColor(color);
    this.emitterMaterial.color.set(color);
    (this.muzzleFlash.material as THREE.MeshBasicMaterial).color.set(color);
  }

  /** Only call after actual character damage; never for a wall/planet impact or predicted shot. */
  confirmTrainingHit(eventId: string): void {
    if (!this.active || this.playerId !== "solo" || this.seenCombatEvents.has(`hit:${eventId}`)) return;
    this.rememberCombatEvent(`hit:${eventId}`);
    this.hitMarkerUntil = Date.now()+450; this.audio.play("hit"); this.updateHud();
  }

  applyCombatEvents(damageCues: readonly SurfaceDamageCue[], hits: readonly SurfaceHitConfirmation[], playerId: string, hostTime: number): void {
    if (!this.active || playerId !== this.playerId) return;
    for (const hit of hits) {
      if (hit.ownerId !== playerId || this.seenCombatEvents.has(`hit:${hit.id}`)) continue;
      this.rememberCombatEvent(`hit:${hit.id}`);
      const remaining = 450 - Math.max(0, hostTime - hit.at);
      if (remaining <= 0) continue;
      this.hitMarkerUntil = Date.now() + remaining; this.audio.play("hit");
    }
    for (const cue of damageCues) {
      if (cue.targetId !== playerId || this.seenCombatEvents.has(`damage:${cue.id}`)) continue;
      this.rememberCombatEvent(`damage:${cue.id}`);
      if (hostTime - cue.at >= 1000) continue;
      this.showDamageCue(cue, hostTime);
    }
    this.updateHud();
  }

  updateArena(arena: SurfaceArenaView): void {
    if (this.arena?.key === arena.key) this.arena = arena;
  }

  applyAuthoritativeState(state: SurfacePlayerView, arena: SurfaceArenaView): void {
    if (!this.active || state.id !== this.playerId || state.mode !== "surface" || !state.surface || arena.key !== state.arenaKey) return;
    if (this.state?.lifeId !== state.lifeId) this.clearHeldInputs();
    this.playStateChangeSounds(this.state, state, this.currentHostTime());
    this.state = state; this.arena = arena; this.updateHud(); this.updateView(0);
  }

  clearHeldInputs(): void {
    this.keys.clear(); this.heldFire = false; this.mouseX = this.mouseY = 0; this.cancelCharge(); this.accumulator = 0;
  }

  renderViewmodel(renderer: THREE.WebGLRenderer): void {
    if (this.active) renderSurfaceViewmodel(renderer, this.viewScene, this.camera);
  }

  completeExit(ship: SurfaceShipState, center: [number, number, number]): void { this.finish(ship, center); }

  update(dt: number, now: number): void {
    if (!this.active || !this.arena || !this.state?.surface) return;
    const step = Math.min(0.1, Math.max(0, dt));
    this.accumulator = Math.min(0.2, this.accumulator + step);
    this.shotCooldown = Math.max(0, this.shotCooldown - step);
    this.recoil = Math.max(0, this.recoil - step * 5);
    this.headBobTime += step;
    this.stepSoundTimer = Math.max(0, this.stepSoundTimer - step);
    const venting = this.state.ventUntil > this.currentHostTime();
    this.muzzleFlash.visible = !venting && Date.now() < this.muzzleFlashUntil;
    this.ventSteam.update(this.currentHostTime(),this.state.health>0 ? this.state.ventUntil : 0);
    const count = Math.floor(this.accumulator / STEP);
    if (count > 0) {
      const input = this.currentInput();
      input.yawDelta = -this.mouseX * LOOK_SCALE;
      input.pitchDelta = -this.mouseY * LOOK_SCALE;
      this.mouseX = this.mouseY = 0;
      for (let i = 0; i < count; i++) {
        const previous = this.state;
        const view = this.callbacks.step(input, STEP, now);
        if (!view || view.mode !== "surface" || !view.surface) {
          if (view) this.finish(view.ship, this.arena.center);
          return;
        }
        this.playStateChangeSounds(previous, view, this.currentHostTime());
        this.state = view;
        if (view.surface.grounded && Math.hypot(...view.surface.velocity) > 1 && this.stepSoundTimer <= 0) {
          this.audio.play("footstep", this.camera.position.toArray() as [number, number, number]); this.stepSoundTimer = view.surface.crouched ? 0.52 : 0.4;
        }
        input.yawDelta = 0; input.pitchDelta = 0;
        this.accumulator -= STEP;
      }
      this.updateHud();
    }
    if (this.chargeStartedAt != null) {
      if (this.state.health <= 0 || venting || Date.now() - this.chargeStartedAt >= SURFACE_CHARGE.maximumHoldMs) this.cancelCharge();
      else {
        const elapsed = Date.now() - this.chargeStartedAt;
        const progress = Math.min(1, elapsed / SURFACE_CHARGE.chargeMs);
        this.updateChargeFeedback(elapsed);
        this.muzzleFlash.visible = true; this.muzzleFlash.scale.setScalar(.25 + progress * .75);
        this.updateHud();
      }
    } else { this.muzzleFlash.scale.setScalar(1); this.chargeEffect.update(null, SURFACE_CHARGE.chargeMs); }
    if (this.heldFire && this.shotCooldown <= 0 && this.state.health > 0) this.fire();
    this.updateView(step);
  }

  dispose(): void {
    this.finish(null, null);
    this.container.removeEventListener("keydown", this.onKeyDown, true);
    this.container.removeEventListener("keyup", this.onKeyUp, true);
    this.container.removeEventListener("blur", this.onBlur);
    this.canvas.removeEventListener("contextmenu", this.onContextMenu);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointerleave", this.onPointerLeave);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    window.removeEventListener("blur", this.onBlur);
    this.trainingButton.removeEventListener("click", this.onTrainingReset);
    this.trainingSelect.removeEventListener("change", this.onTrainingReset);
    this.viewScene.remove(this.viewModel);
    this.viewModel.traverse(object => {
      const item = object as THREE.Mesh;
      item.geometry?.dispose();
      const material = item.material;
      if (material) for (const value of Array.isArray(material) ? material : [material]) value.dispose();
    });
    this.hud.remove();
  }

  private finish(ship: SurfaceShipState | null, center: [number, number, number] | null): void {
    this.cancelCharge();
    const wasActive = this.active;
    this.active = false;
    this.ventSteam.visible = false;
    this.state = null; this.arena = null; this.playerId = ""; this.keys.clear(); this.heldFire = false;
    this.hud.hidden = true; this.viewModel.visible = false;
    this.container.classList.remove("cg-surfacing"); this.canvas.classList.remove("cg-surface-canvas");
    this.container.closest(".cg-root")?.classList.remove("cg-surfacing");
    if (this.pointerLocked && document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.camera.near = 1; this.camera.fov = 55; this.camera.updateProjectionMatrix();
    if (wasActive && ship && center) this.callbacks.ended(ship, center);
  }

  get surfacePosition(): [number,number,number] | null { return this.state?.surface ? [...this.state.surface.position] : null; }

  private currentInput(): SurfaceInput & { interact: boolean } {
    const key = (name: "surfaceForwardKey" | "surfaceBackKey" | "surfaceLeftKey" | "surfaceRightKey" | "surfaceSprintKey" | "surfaceJumpKey" | "surfaceCrouchKey" | "surfaceLeanLeftKey" | "surfaceLeanRightKey" | "surfaceInteractKey") => this.settings[name];
    return {
      moveX: Number(this.keys.has(key("surfaceRightKey"))) - Number(this.keys.has(key("surfaceLeftKey"))),
      moveY: Number(this.keys.has(key("surfaceForwardKey"))) - Number(this.keys.has(key("surfaceBackKey"))),
      sprint: this.keys.has(key("surfaceSprintKey")), jump: this.keys.has(key("surfaceJumpKey")),
      crouch: this.keys.has(key("surfaceCrouchKey")),
      yawDelta: 0, pitchDelta: 0,
      lean: Number(this.keys.has(key("surfaceLeanRightKey"))) - Number(this.keys.has(key("surfaceLeanLeftKey"))),
      interact: this.keys.has(key("surfaceInteractKey")),
    };
  }

  private updateView(_dt: number): void {
    const surface = this.state?.surface, arena = this.arena;
    if (!surface || !arena) return;
    const view = surfaceViewPose(surface);
    const center = this.callbacks.arenaCenter?.(arena) ?? arena.center;
    this.center.set(...center);
    this.up.set(...view.up); this.right.set(...view.right); this.look.set(...view.look); this.cameraUp.set(...view.cameraUp);
    this.camera.quaternion.set(...view.rotation);
    const speed = Math.hypot(...surface.velocity), bob = this.settings.surfaceHeadBob && surface.grounded
      ? Math.sin(this.headBobTime * 11) * 0.012 * Math.min(1, speed / SURFACE.walkSpeed) : 0;
    this.point.set(...surfaceToWorld(view.eye, center)).addScaledVector(this.up, bob * WORLD_SCALE);
    this.camera.position.copy(this.point);
    this.audio.updateListener(this.camera.position.toArray() as [number, number, number], this.look.toArray() as [number, number, number], this.cameraUp.toArray() as [number, number, number]);
    this.viewModel.position.set(...surfaceToWorld(view.eye, center));
    this.viewModel.quaternion.copy(this.camera.quaternion);
    this.viewModel.translateY(-this.recoil * 0.035 * WORLD_SCALE);
    if (this.chargeStartedAt != null) {
      const elapsed = Math.max(0, Date.now() - this.chargeStartedAt), progress = Math.min(1, elapsed / SURFACE_CHARGE.chargeMs);
      // Brace and lift the weapon with restrained vibration; never move the camera or physical muzzle.
      this.viewModel.translateY((.025 * progress + Math.sin(elapsed * .065) * .002 * progress) * WORLD_SCALE);
      this.viewModel.translateZ(.035 * progress * WORLD_SCALE);
    }
  }

  private currentHostTime(): number { return this.callbacks.hostTime?.() ?? Date.now(); }

  private updateHud(): void {
    const state = this.state;
    if (!state?.surface) return;
    const health = Math.max(0, Math.min(100, state.health));
    const armor = Math.max(0, Math.min(50, state.armor));
    this.healthText.textContent = `HP ${Math.ceil(health)}`;
    this.armorText.textContent = `ARM ${Math.ceil(armor)}`;
    this.healthFill.style.width = `${health}%`;
    this.armorFill.style.width = `${armor * 2}%`;
    const hostNow = this.currentHostTime();
    if (this.chargeStartedAt != null) {
      const progress = Math.min(100, Math.floor((Date.now() - this.chargeStartedAt) / SURFACE_CHARGE.chargeMs * 100));
      this.heatText.textContent = progress >= 100 ? "CHARGED · release RMB" : `CHARGING ${progress}%`;
    } else this.heatText.textContent = state.ventUntil > hostNow ? `VENT ${((state.ventUntil - hostNow) / 1000).toFixed(1)}s` : `HEAT ${Math.ceil(state.heat)}%`;
    this.heatFill.style.width = `${Math.max(0, Math.min(100, state.heat))}%`;
    this.stanceStatus.textContent = state.surface.crouched ? "CROUCHED" : state.surface.grounded ? "STANDING" : "AIRBORNE";
    this.updatePoleCompass(state.surface);
    this.updateEnemyCue();
    const rtt = this.callbacks.connectionRtt?.() ?? 0;
    const updatesDelayed = this.callbacks.connectionDegraded?.() ?? false;
    this.connectionStatus.textContent = rtt > 100 ? `DEGRADED · ${Math.round(rtt)} ms` : updatesDelayed ? "DEGRADED · updates delayed" : "";
    this.connectionStatus.hidden = rtt <= 100 && !updatesDelayed;
    this.hitMarker.hidden = Date.now() > this.hitMarkerUntil;
    this.damageIndicator.hidden = Date.now() > this.damageUntil;
    this.damageIndicator.style.opacity = String(Math.max(0, Math.min(1, (this.damageUntil - Date.now()) / 1000)));
    const respawn = state.health <= 0 ? `Respawn in ${Math.max(0, Math.ceil((state.respawnAt - hostNow) / 1000))}s` : "";
    const interact = this.displayKey(this.settings.surfaceInteractKey);
    const crouch = this.displayKey(this.settings.surfaceCrouchKey);
    const leanLeft = this.displayKey(this.settings.surfaceLeanLeftKey), leanRight = this.displayKey(this.settings.surfaceLeanRightKey);
    const protection = state.protectedUntil > hostNow ? `Protected ${Math.ceil((state.protectedUntil - hostNow) / 1000)}s · ` : "";
    const relocation = protection && this.spawnRelocated ? "Spawn relocated · " : "";
    this.prompt.textContent = state.health <= 0 ? respawn : state.exitProgress > 0 ? `Returning to ship · ${Math.round(state.exitProgress * 100)}%`
      : `${relocation}${protection}${this.pointerLocked ? `Hold ${crouch} crouch · ${leanLeft}/${leanRight} lean · ` : "Click to look · "}${interact} leave at a pole · RMB hold 1s, release: charged shot`;
  }

  private displayKey(code: string): string {
    if (code === "ControlLeft") return "Left Ctrl";
    if (code === "ControlRight") return "Right Ctrl";
    if (code === "Space") return "Space";
    if (code.startsWith("Key") || code.startsWith("Digit")) return code.slice(code.startsWith("Key") ? 3 : 5);
    if (code.startsWith("Shift")) return "Shift";
    if (code.startsWith("Arrow")) return code.slice(5);
    return code;
  }

  private updatePoleCompass(surface: NonNullable<SurfacePlayerView["surface"]>): void {
    const guides = surfacePoleGuides(surface);
    if (!this.poleCards) { this.poleCompass.textContent = guides.map(g=>`${g.name} ${Math.round(g.distance)}u`).join(" · "); return; }
    const fov = this.camera.fov * Math.PI / 180, horizontal = 2*Math.atan(Math.tan(fov/2)*this.camera.aspect);
    guides.forEach((guide,i) => {
      const arrow = guide.ambiguous ? "◆" : this.bearingArrow(guide.bearing);
      this.poleCards[i].textContent = guide.atExit ? `At ${guide.name} exit · Hold ${this.displayKey(this.settings.surfaceInteractKey)} ${Math.round((this.state?.exitProgress ?? 0)*100)}%` : `${arrow} ${guide.name} · ${Math.round(guide.distance)}u`;
      this.poleCards[i].style.setProperty("--pole-position", `${50+Math.max(-1,Math.min(1,guide.bearing/Math.PI))*44}%`);
      const edge = this.poleEdges[i];
      edge.hidden = guide.atExit;
      edge.textContent = `${arrow} ${guide.name} · ${Math.round(guide.distance)}u`;
      const offscreen = Math.abs(guide.bearing)>horizontal/2;
      const horizontalPosition = offscreen ? (guide.bearing<0 ? 4 : 96) : 50+guide.bearing/(horizontal/2)*40;
      edge.style.left = `clamp(72px, ${horizontalPosition}%, calc(100% - 72px))`;
      edge.style.top = guide.behind ? "65%" : "34%";
      edge.dataset.direction = guide.behind ? "behind" : "ahead";
    });
  }

  private updateEnemyCue(): void {
    const now = Date.now();
    if (now - this.lastEnemyCueAt < 1500) return;
    this.lastEnemyCueAt = now;
    const threats = this.callbacks.nearbyThreats?.() ?? [];
    for (const sector of this.enemySectors) sector.classList.remove("is-active");
    for (const threat of threats) {
      const slot = ((Math.round(threat.bearing / (Math.PI / 4)) % 8) + 8) % 8;
      this.enemySectors[slot]?.classList.add("is-active");
    }
    const nearest = threats.reduce((distance, threat) => Math.min(distance, threat.distance), Infinity);
    this.enemyCue.setAttribute("aria-label", Number.isFinite(nearest) ? nearest < 10 ? "Opponent near" : "Opponent nearby" : "No opponents nearby");
    this.enemyCue.dataset.label = Number.isFinite(nearest) ? nearest < 10 ? "NEAR" : "NEARBY" : "";
  }

  private bearingArrow(bearing: number): string {
    const arrows = ["↑", "↗", "→", "↘", "↓", "↙", "←", "↖"];
    const index = ((Math.round(bearing / (Math.PI / 4)) % 8) + 8) % 8;
    return arrows[index];
  }

  private showDamageCue(cue: SurfaceDamageCue, hostTime: number): void {
    const surface = this.state?.surface;
    if (!surface) return;
    this.cueUp.set(...surface.position).normalize();
    this.cueForward.set(...surface.forward).projectOnPlane(this.cueUp).normalize();
    this.cueRight.crossVectors(this.cueForward, this.cueUp).normalize();
    this.cueDirection.set(...cue.direction).normalize();
    const horizontal = Math.hypot(this.cueDirection.dot(this.cueForward), this.cueDirection.dot(this.cueRight));
    const vertical = this.cueDirection.dot(this.cueUp);
    this.damageIndicator.textContent = horizontal < 0.35 ? vertical >= 0 ? "▲" : "▼" : "▲";
    const bearing = Math.atan2(this.cueDirection.dot(this.cueRight), this.cueDirection.dot(this.cueForward));
    this.damageIndicator.style.transform = `translate(-50%, -50%) rotate(${bearing * 180 / Math.PI}deg)`;
    const age = Math.max(0, hostTime - cue.at);
    this.audio.play("damage");
    this.damageUntil = Date.now() + Math.max(0, 1000 - Math.min(1000, age));
  }

  private rememberCombatEvent(id: string): void {
    this.seenCombatEvents.add(id);
    if (this.seenCombatEvents.size > 128) this.seenCombatEvents.delete(this.seenCombatEvents.values().next().value!);
  }

  private fire(kind: SurfaceShotKind = "normal"): void {
    if (kind === "normal" && this.chargeStartedAt != null) return;
    if (!this.state?.surface || !this.arena || this.state.health <= 0 || this.shotCooldown > 0 || this.state.ventUntil > this.currentHostTime() || this.state.heat >= 100) return;
    this.shotCooldown = 0.2; this.recoil = kind === "charged" ? 1.7 : 1;
    this.muzzleFlashUntil = Date.now() + (kind === "charged" ? 140 : 65); this.muzzleFlash.visible = true; this.audio.play("blaster");
    if (!this.arena) return;
    const pose = surfaceViewPose(this.state.surface);
    const origin = new THREE.Vector3(...surfaceToWorld(pose.muzzle, this.callbacks.arenaCenter?.(this.arena) ?? this.arena.center));
    const direction = new THREE.Vector3(...surfaceBlasterDirection(this.state.surface));
    const previous = this.state;
    const view = this.callbacks.fire(origin.toArray() as [number, number, number], direction.toArray() as [number, number, number], ++this.fireSequence, this.callbacks.hostViewTime?.() ?? Date.now(), kind);
    if (view) { this.playStateChangeSounds(previous, view, this.currentHostTime()); this.state = view; this.updateHud(); }
  }

  private rememberSpawnPosition(state: SurfacePlayerView): void {
    const position = state.surface?.position;
    this.spawnRelocated = !!position && (state.surface?.radius ?? SURFACE.radius) * Math.acos(Math.max(-1, Math.min(1, Math.abs(position[1]) / Math.hypot(...position)))) > 6 + 1e-5;
  }

  private playStateChangeSounds(before: SurfacePlayerView | null, after: SurfacePlayerView, now: number): void {
    if (!before || before.lifeId !== after.lifeId || before.arenaKey !== after.arenaKey) this.rememberSpawnPosition(after);
    if (!before?.surface || after.mode !== "surface" || !after.surface || before.lifeId !== after.lifeId || before.arenaKey !== after.arenaKey) return;
    if (before.surface.grounded && !after.surface.grounded) this.audio.play("jump");
    if (!before.surface.grounded && after.surface.grounded) this.audio.play("land");
    if (after.ventUntil > now && before.ventUntil <= now) this.audio.play("vent");
    if ((after.health > before.health || after.armor > before.armor) && after.kills === before.kills) this.audio.play("pickup");
  }

  private onKeyDown = (event: KeyboardEvent): void => this.handleKeyDown(event);
  private handleKeyDown(event: KeyboardEvent): void {
    if (!this.active || event.metaKey || event.altKey) return;
    if (!this.pointerLocked && event.ctrlKey && event.code !== this.settings.surfaceCrouchKey) return;
    if (this.pointerLocked && event.ctrlKey && !this.surfaceBindings().includes(event.code)) {
      event.preventDefault(); event.stopImmediatePropagation(); return;
    }
    if (!this.surfaceBindings().includes(event.code)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.keys.add(event.code);

  }

  private onKeyUp = (event: KeyboardEvent): void => this.handleKeyUp(event);
  private handleKeyUp(event: KeyboardEvent): void {
    if (!this.active) return;
    this.keys.delete(event.code);
    if (this.surfaceBindings().includes(event.code)) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }

  private surfaceBindings(): string[] {
    return [this.settings.surfaceForwardKey, this.settings.surfaceBackKey, this.settings.surfaceLeftKey, this.settings.surfaceRightKey,
      this.settings.surfaceJumpKey, this.settings.surfaceSprintKey, this.settings.surfaceCrouchKey, this.settings.surfaceLeanLeftKey,
      this.settings.surfaceLeanRightKey, this.settings.surfaceInteractKey];
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.active || (event.button !== 0 && event.button !== 2)) return;
    this.container.focus({ preventScroll: true });
    this.callbacks.prepareSpaceAudio?.();
    if (!this.pointerLocked) { this.canvas.requestPointerLock?.(); return; }
    if (event.button === 2) this.beginCharge();
    else { this.heldFire = true; this.fire(); }
    event.preventDefault();
  };
  private beginCharge(): void {
    if (this.chargeStartedAt != null || !this.state?.surface || this.state.health <= 0 || this.state.ventUntil > this.currentHostTime() || this.state.heat >= 100 || this.shotCooldown > 0) return;
    this.heldFire = false; this.chargeReady = false; this.chargeStartedAt = Date.now();
    this.audio?.startCharge?.(SURFACE_CHARGE.chargeMs); this.chargeEffect?.update(0, SURFACE_CHARGE.chargeMs);
    this.callbacks.charge?.(true); this.updateHud();
  }
  private updateChargeFeedback(elapsed: number): void {
    if (elapsed >= SURFACE_CHARGE.chargeMs && !this.chargeReady) { this.chargeReady = true; this.audio.play("chargeReady"); }
    this.chargeEffect.update(elapsed, SURFACE_CHARGE.chargeMs);
  }
  private stopChargeFeedback(): void {
    this.audio?.stopCharge?.(); this.chargeEffect?.update(null, SURFACE_CHARGE.chargeMs); this.chargeReady = false;
  }
  private cancelCharge(): void {
    if (this.chargeStartedAt == null) return;
    this.stopChargeFeedback();
    this.chargeStartedAt = null; this.callbacks.charge?.(false);
    this.muzzleFlash.visible = false;
  }
  private releaseCharge(): void {
    if (this.chargeStartedAt == null) return;
    const duration = Date.now() - this.chargeStartedAt;
    if (duration < SURFACE_CHARGE.chargeMs || duration >= SURFACE_CHARGE.maximumHoldMs) { this.cancelCharge(); return; }
    this.stopChargeFeedback();
    this.chargeStartedAt = null;
    this.fire("charged");
    // Ordered after release: a rejected shot must also relinquish its charge lock.
    this.callbacks.charge?.(false);
  }
  private onContextMenu = (event: MouseEvent): void => { if (this.active) event.preventDefault(); };
  private onPointerUp = (event: PointerEvent): void => {
    if (event.button === 2) this.releaseCharge();
    if (event.button === 0) this.heldFire = false;
  };
  private onPointerLeave = (): void => { this.heldFire = false; this.cancelCharge(); };
  private onMouseMove = (event: MouseEvent): void => {
    if (this.active && this.pointerLocked && document.pointerLockElement === this.canvas) {
      this.mouseX += Math.max(-150, Math.min(150, event.movementX)) * this.settings.surfaceSensitivity;
      this.mouseY += Math.max(-150, Math.min(150, event.movementY)) * this.settings.surfaceSensitivity * (this.settings.surfaceInvertY ? -1 : 1);
    }
  };
  private onPointerLockChange = (): void => {
    this.pointerLocked = document.pointerLockElement === this.canvas;
    if (!this.pointerLocked) { this.clearHeldInputs(); }
    this.updateHud();
  };
  private onBlur = (): void => { this.clearHeldInputs(); };
  private onTrainingReset = (): void => { this.callbacks.trainingReset?.(this.trainingSelect.value === "150" ? 150 : 100); };
}
