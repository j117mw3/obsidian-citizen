import "./obsidian-shim";
import * as THREE from "three";
import { ConstellationApp } from "../src/app";
import { DEFAULT_SETTINGS, type ConstellationSettings } from "../src/settings";
import { createSurfacePlayerState } from "../src/surfacePhysics";
import { SURFACE } from "../src/surface";
import { normalizeSurfaceLaserColor } from "../src/surfaceColor";
import { SurfaceBoltGraphic } from "../src/surfaceVisuals";
import { SURFACE_WORLD_SCALE } from "../src/surfaceView";
import { makeSkyFixture } from "./surface-sky-fixture";
import { surfaceSphereOccludes } from "../src/surfaceVisuals";
import { terrainQuery } from "../src/surfaceTerrain";
import { traceSurfaceWallSegment } from "../src/surfaceCombat";
import { worldToSurface } from "../src/surfaceView";
import { PERFORMANCE_SCENARIOS, type PerformanceScenario } from "../src/performanceCapture";

// Browser component preview only. Deliberate ship/camera staging is labelled in
// the page; this does not prove normal docking approach or Obsidian rendering.
import { fixture, requireFixture } from "./fixture-access";
const host = document.getElementById("app")!, status = document.getElementById("preview-status")!;
let ids:string[]=[];
const settings:ConstellationSettings = { ...DEFAULT_SETTINGS, motion: "calm", autoRotate: true, respectReducedMotion: false, bloom: true, surfaceCrouchMode: "hold" };
const app = new ConstellationApp(host, { openNote() {} }, settings);
const setFixtureGraph=()=>{
  const input=(id:string)=>document.getElementById(id) as HTMLInputElement;
  const graph=makeSkyFixture(Number(input("graph-size").value),Number(input("planet-count").value),Number(input("hub-degree").value));
  ids=graph.ids;app.setData(graph.data);
  status.textContent=`Synthetic workload: ${ids.length} nodes, ${graph.data.links.length} links, ${graph.hubs.length} main planets. No vault data is read.`;
};
setFixtureGraph();
import type { ConstellationRenderer } from "../src/renderer";
const renderer = fixture(fixture(app).renderer as ConstellationRenderer);
const boltSamples: SurfaceBoltGraphic[] = [];
document.getElementById("graph-size")!.addEventListener("change",setFixtureGraph);
document.getElementById("hub-degree")!.addEventListener("change",setFixtureGraph);
document.getElementById("planet-count")!.addEventListener("change",setFixtureGraph);
document.getElementById("graph-motion")!.addEventListener("change",event=>{settings.motion=(event.target as HTMLInputElement).checked?"calm":"off";settings.autoRotate=(event.target as HTMLInputElement).checked;app.applySettings({...settings});});
document.getElementById("enter")!.addEventListener("click", () => {
  if (!renderer.surfacePilot) { status.textContent = "WebGL renderer unavailable; no FPS visual claim."; return; }
  if (fixture(renderer.surfacePilot).active) { status.textContent = "Already on the preview surface."; return; }
  const index = renderer.sim.nodes.findIndex((node) => node.id === ids[0]), node = renderer.sim.nodes[index];
  if (!node) { status.textContent = "Renderer still initializing."; return; }
  const approach=(Number(renderer.localSurfaceGroups.get(node.id)?.group.userData.radius??27))*SURFACE_WORLD_SCALE+8;
  renderer.setPilot(true, { position: [node.x, node.y, node.z + approach], rotation: [0, 0, 0, 1], velocity: [0, 0, 0] });
  renderer.requestSurfaceDock(null, index);
  status.textContent = fixture(renderer.surfacePilot).active ? "Solo surface active. Ship approach was staged by this fixture; core docking admission ran normally." : "Docking rejected; inspect the game HUD.";
});
document.getElementById("dummy-view")!.addEventListener("click", () => {
  const dummy = [...fixture(renderer.surfaceWorld).bots.values()][0], player = fixture(renderer.surfaceWorld).players.get("solo");
  if (!dummy || !player?.surface) { status.textContent = "Enter the preview surface first."; return; }
  const target = new THREE.Vector3(...dummy.patrol.state.position), up = target.clone().normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(...dummy.patrol.state.forward), up).normalize();
  const radius=fixture(renderer.surfaceWorld).getArena(requireFixture(player.arenaKey))?.arena.radius??SURFACE.radius;
  const position = target.clone().addScaledVector(new THREE.Vector3(...dummy.patrol.state.forward), -3).addScaledVector(right, 2).normalize().multiplyScalar(radius);
  const forward = target.clone().sub(position).projectOnPlane(position.clone().normalize()).normalize();
  player.surface = { ...createSurfacePlayerState(position.clone().normalize().toArray(), forward.toArray()), pitch: -0.13 };
  fixture(renderer.surfacePilot).clearHeldInputs();
  fixture(renderer.surfacePilot).applyAuthoritativeState(requireFixture(renderer.surfaceWorld.getPlayer("solo")), requireFixture(renderer.surfaceWorld.getArena(requireFixture(player.arenaKey))));
  status.textContent = "Camera staged near the dummy with an oblique cover view; this is not a walking/traversal test.";
});
document.getElementById("fire-preview")!.addEventListener("click", () => {
  if (!renderer.surfacePilot?.active) return;
  fixture(renderer.surfacePilot).fire();
  window.setTimeout(() => { if ([...fixture(renderer.surfaceWorld).bots.values()][0]) status.textContent = `Training dummy: ${[...fixture(renderer.surfaceWorld).bots.values()][0].health} HP, ${[...fixture(renderer.surfaceWorld).bots.values()][0].armor} armor. This is a component shot, not a multiplayer hit.`; }, 150);
});
document.getElementById("crouch-preview")!.addEventListener("change", event => {
  if (renderer.surfacePilot) (event.target as HTMLInputElement).checked ? fixture(renderer.surfacePilot).keys.add("ControlLeft") : fixture(renderer.surfacePilot).keys.delete("ControlLeft");
});
document.getElementById("lean-preview")!.addEventListener("change", event => {
  if (!renderer.surfacePilot) return;
  if ((event.target as HTMLInputElement).checked) fixture(renderer.surfacePilot).keys.add("KeyE"); else fixture(renderer.surfacePilot).keys.delete("KeyE");
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
document.getElementById("hold-fire")!.addEventListener("change", event => { if (renderer.surfacePilot) fixture(renderer.surfacePilot).heldFire = (event.target as HTMLInputElement).checked; });
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
  const walls = visual.children.filter((child) => child.name.endsWith("-wall")).map((child) => {
    const point: THREE.Vector3 = child.getWorldPosition(new THREE.Vector3()), projected = point.clone().project(renderer.camera);
    return { type: child.name, distanceWorld: Number(point.distanceTo(renderer.camera.position).toFixed(2)), ndc: projected.toArray().map(value => Number(value.toFixed(2))) };
  });
  status.textContent = `Cover diagnostics: ${JSON.stringify({ physicalSeed: arena.arena.seed, visualSeed: Number(visual.userData.arenaSeed), physicalWalls: arena.arena.walls.length, visibleGroup: visual.visible, walls })}`;
});
window.addEventListener("beforeunload", () => { for (const sample of boltSamples) sample.dispose(); app.destroy(); });

function stageSkyView(view:"sky"|"horizon"|"floor"):void {
  const player=fixture(renderer.surfaceWorld).players.get("solo"),arena=player?.arenaKey?renderer.surfaceWorld.getArena(player.arenaKey):null;
  if(!player?.surface||!arena){status.textContent="Enter the surface first.";return;}
  const center=new THREE.Vector3(...arena.center),up=new THREE.Vector3(0,1,0);
  const candidates=[...renderer.localSurfaceGroups.values()].filter(entry=>entry.group.userData.hubId!==arena.hubId).map(entry=>entry.group.position.clone().sub(center).normalize());
  const aim=candidates.sort((a,b)=>b.y-a.y)[0]??new THREE.Vector3(0,1,-1).normalize();
  const tangent=aim.clone().projectOnPlane(up).normalize();if(tangent.lengthSq()<.001)tangent.set(0,0,-1);
  player.surface={...createSurfacePlayerState([0,1,0],tangent.toArray(),arena.arena.radius,arena.arena.terrain),pitch:view==="floor"?-80*Math.PI/180:view==="horizon"?0:Math.min(85*Math.PI/180,Math.max(.15,Math.asin(aim.y)))};
  renderer.surfacePilot.clearHeldInputs();renderer.surfacePilot.applyAuthoritativeState(requireFixture(renderer.surfaceWorld.getPlayer("solo")),arena);
  status.textContent=`Staged ${view} view from the same north-pole position.`;
}
for(const view of ["sky","horizon","floor"] as const)document.getElementById(`view-${view}`)!.addEventListener("click",()=>stageSkyView(view));
const scenarioSelect=document.getElementById("profile-scenario") as HTMLSelectElement;
for(const scenario of PERFORMANCE_SCENARIOS){const option=createEl("option");option.value=scenario;option.textContent=scenario;scenarioSelect.appendChild(option);}
scenarioSelect.value="sky";
document.getElementById("capture-profile")!.addEventListener("click",()=>app.startPerformanceCapture(scenarioSelect.value as PerformanceScenario,null));
// Dev-only automation API: synthetic graph state only, never included in the plugin bundle.
const boundedOcclusion=renderer.isSurfacePointOccluded.bind(renderer);
declare global {interface Window {citizenSkyFixture?:{configure:(groups:number)=>void;enter:()=>void;view:(view:"sky"|"horizon"|"floor")=>void;capture:(scenario:PerformanceScenario)=>Promise<object>;ready:()=>boolean;active:()=>boolean;motion:(on:boolean)=>void;legacyOcclusion:(on:boolean)=>void;lod:(enabled:boolean)=>void;diagnostics:()=>object}}}
window.citizenSkyFixture={
  configure(groups){(document.getElementById("planet-count") as HTMLInputElement).value=String(groups);setFixtureGraph();},
  enter(){document.getElementById("enter")!.click();const player=fixture(renderer.surfaceWorld).players.get("solo");if(player)player.protectedUntil=Date.now()+3600000;},view:stageSkyView,
  ready:()=>renderer.sim.nodes.length===850&&renderer.localSurfaceGroups.size>0,
  active:()=>renderer.surfacePilot.active,
  diagnostics:()=>({active:renderer.surfacePilot.active,hidden:document.hidden,visible:renderer.visible,contextLost:renderer.contextLost,frameNo:renderer.frameNo,orbitEnabled:renderer.controls.enabled,charging:fixture(renderer.surfacePilot).chargeStartedAt!==null,fireSequence:fixture(renderer.surfacePilot).fireSequence}),
  motion(on){settings.motion=on?"calm":"off";settings.autoRotate=on;(document.getElementById("graph-motion") as HTMLInputElement).checked=on;app.applySettings({...settings});if(!on)renderer.sim.settle(300);},
  lod(enabled){renderer.distantLodEnabled=enabled;},
  legacyOcclusion(on){renderer.isSurfacePointOccluded=on?(point:THREE.Vector3)=>{
    for(const arena of renderer.surfaceWorld.listArenas()){
      const center=renderer.localSurfaceGroups.get(arena.hubId)?.group.position.toArray()??arena.center,radius=arena.arena.radius??27;
      if(arena.arena.terrain){if(!surfaceSphereOccludes(renderer.camera.position,point,center,(radius+3.1)*SURFACE_WORLD_SCALE))continue;
        const a=worldToSurface(renderer.camera.position.toArray(),center),b=worldToSurface(point.toArray(),center);
        if(terrainQuery(arena.arena.terrain).ray(a,b)!==null||traceSurfaceWallSegment(a,b,arena.arena.walls,radius))return true;
      }else if(surfaceSphereOccludes(renderer.camera.position,point,center,radius*SURFACE_WORLD_SCALE))return true;
    }return false;
  }:boundedOcclusion;},
  capture:(scenario)=>new Promise((resolve,reject)=>{if(!renderer.startPerformanceCapture(scenario,null,resolve))reject(new Error("Capture unavailable"));}),
};
