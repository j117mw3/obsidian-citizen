import "./obsidian-shim";
import * as THREE from "three";
import { ConstellationApp } from "../src/app";
import { DEFAULT_SETTINGS } from "../src/settings";
import { createSurfacePlayerState } from "../src/surfacePhysics";
import { SURFACE } from "../src/surface";
import { normalizeSurfaceLaserColor } from "../src/surfaceColor";
import { SurfaceBoltGraphic } from "../src/surfaceVisuals";
import { SURFACE_WORLD_SCALE } from "../src/surfaceView";
import type { GraphData } from "../src/types";

// Browser component preview only. Deliberate ship/camera staging is labelled in
// the page; this does not prove normal docking approach or Obsidian rendering.
const fixture = (value: unknown): any => value;
const host = document.getElementById("app")!, status = document.getElementById("preview-status")!;
const ids = ["Preview/Main.md", ...Array.from({ length: 6 }, (_, index) => `Preview/Cover ${index + 1}.md`)];
const data: GraphData = { groups: [{ key: "Preview", label: "Preview", color: "#8CECFF", count: 7 }],
  nodes: ids.map((id, index) => ({ id, name: index ? `Cover ${index}` : "Main", group: "Preview", deg: index ? 1 : 6 })),
  links: ids.slice(1).map(id => ({ source: ids[0], target: id })) };
const settings = { ...DEFAULT_SETTINGS, motion: "off" as const, autoRotate: false, respectReducedMotion: false, bloom: false, surfaceCrouchMode: "hold" as const };
const app = new ConstellationApp(host, { openNote() {} }, settings); app.setData(data);
const renderer = fixture(app).renderer;
const boltSamples: SurfaceBoltGraphic[] = [];
document.getElementById("enter")!.addEventListener("click", () => {
  if (!renderer.surfacePilot) { status.textContent = "WebGL renderer unavailable; no FPS visual claim."; return; }
  if (renderer.surfacePilot.active) { status.textContent = "Already on the preview surface."; return; }
  const index = renderer.sim.nodes.findIndex((node: any) => node.id === ids[0]), node = renderer.sim.nodes[index];
  if (!node) { status.textContent = "Renderer still initializing."; return; }
  renderer.setPilot(true, { position: [node.x, node.y, node.z + 15], rotation: [0, 0, 0, 1], velocity: [0, 0, 0] });
  renderer.requestSurfaceDock(null, index);
  status.textContent = renderer.surfacePilot.active ? "Solo surface active. Ship approach was staged by this fixture; core docking admission ran normally." : "Docking rejected; inspect the game HUD.";
});
document.getElementById("dummy-view")!.addEventListener("click", () => {
  const dummy = renderer.trainingDummies?.[0], player = renderer.surfaceWorld?.players.get("solo");
  if (!dummy || !player?.surface) { status.textContent = "Enter the preview surface first."; return; }
  const target = new THREE.Vector3(...dummy.state.position), up = target.clone().normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(...dummy.state.forward), up).normalize();
  const position = target.clone().addScaledVector(new THREE.Vector3(...dummy.state.forward), -3).addScaledVector(right, 2).normalize().multiplyScalar(SURFACE.radius);
  const forward = target.clone().sub(position).projectOnPlane(position.clone().normalize()).normalize();
  player.surface = { ...createSurfacePlayerState(position.clone().normalize().toArray() as [number, number, number], forward.toArray() as [number, number, number]), pitch: -0.13 };
  renderer.surfacePilot.clearHeldInputs();
  renderer.surfacePilot.applyAuthoritativeState(renderer.surfaceWorld.getPlayer("solo"), renderer.surfaceWorld.getArena(player.arenaKey));
  status.textContent = "Camera staged near the dummy with an oblique cover view; this is not a walking/traversal test.";
});
document.getElementById("fire-preview")!.addEventListener("click", () => {
  if (!renderer.surfacePilot?.active) return;
  renderer.surfacePilot.fire();
  setTimeout(() => { if (renderer.trainingDummies?.[0]) status.textContent = `Training dummy: ${renderer.trainingDummies?.[0].health} HP, ${renderer.trainingDummies?.[0].armor} armor. This is a component shot, not a multiplayer hit.`; }, 150);
});
document.getElementById("crouch-preview")!.addEventListener("change", event => {
  if (renderer.surfacePilot) renderer.surfacePilot.crouchToggle = (event.target as HTMLInputElement).checked;
});
document.getElementById("lean-preview")!.addEventListener("change", event => {
  if (!renderer.surfacePilot) return;
  if ((event.target as HTMLInputElement).checked) renderer.surfacePilot.keys.add("KeyE"); else renderer.surfacePilot.keys.delete("KeyE");
});
document.getElementById("bloom-preview")!.addEventListener("change", event => {
  settings.bloom = (event.target as HTMLInputElement).checked; app.applySettings({ ...settings });
});
document.getElementById("contrast-preview")!.addEventListener("change", event => {
  settings.highContrast = (event.target as HTMLInputElement).checked; app.applySettings({ ...settings });
});
document.getElementById("bolt-samples")!.addEventListener("click", () => {
  for (const sample of boltSamples.splice(0)) sample.dispose();
  if (!renderer.surfacePilot?.active) { status.textContent = "Enter the preview surface first."; return; }
  const camera: THREE.PerspectiveCamera = renderer.camera;
  for (const [index, distance] of [5, 10, 15].entries()) {
    // Production graphic and scale, paused deliberately for visual inspection.
    // Place broadside above the horizon; this is not a physics or collision test.
    const centre = new THREE.Vector3((index - 1) * 0.42, 0.3, -1).normalize().multiplyScalar(distance * SURFACE_WORLD_SCALE).applyQuaternion(camera.quaternion).add(camera.position);
    const half = new THREE.Vector3(1.1 * SURFACE_WORLD_SCALE, 0, 0).applyQuaternion(camera.quaternion);
    const sample = new SurfaceBoltGraphic(settings.surfaceLaserColor);
    sample.setSegment(centre.clone().sub(half), centre.clone().add(half)); renderer.scene.add(sample); boltSamples.push(sample);
  }
  status.textContent = "PAUSED production bolt samples: left 5u, centre 10u, right 15u; broadside, fixed world width/opacity and 2.2u tails. Not live shots or a collision test.";
});
document.getElementById("hold-fire")!.addEventListener("change", event => { if (renderer.surfacePilot) renderer.surfacePilot.heldFire = (event.target as HTMLInputElement).checked; });
document.getElementById("color-preview")!.addEventListener("change", event => {
  const input = event.target as HTMLInputElement, approved = normalizeSurfaceLaserColor(input.value);
  if (!approved) { status.textContent = "Invalid color; previous approved color retained."; return; }
  input.value = approved; settings.surfaceLaserColor = approved; app.applySettings({ ...settings }); status.textContent = `Preview approved color ${approved}; no network color claim.`;
});
document.getElementById("pane-width")!.addEventListener("change", event => {
  const value = (event.target as HTMLSelectElement).value; host.style.width = value === "full" ? "" : `${value}px`; host.style.right = value === "full" ? "0" : "auto";
});
document.getElementById("cover-report")!.addEventListener("click", () => {
  const player = renderer.surfaceWorld?.getPlayer("solo"), arena = player?.arenaKey ? renderer.surfaceWorld.getArena(player.arenaKey) : null;
  const visual = arena && renderer.localSurfaceGroups.get(arena.hubId)?.group;
  if (!visual) return;
  const walls = visual.children.filter((child: any) => child.name.endsWith("-wall")).map((child: any) => {
    const point: THREE.Vector3 = child.getWorldPosition(new THREE.Vector3()), projected = point.clone().project(renderer.camera);
    return { type: child.name, distanceWorld: Number(point.distanceTo(renderer.camera.position).toFixed(2)), ndc: projected.toArray().map(value => Number(value.toFixed(2))) };
  });
  status.textContent = `Cover diagnostics: ${JSON.stringify({ physicalSeed: arena.arena.seed, visualSeed: visual.userData.arenaSeed, physicalWalls: arena.arena.walls.length, visibleGroup: visual.visible, walls })}`;
});
window.addEventListener("beforeunload", () => { for (const sample of boltSamples) sample.dispose(); app.destroy(); });
