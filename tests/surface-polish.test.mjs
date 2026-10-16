import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import * as THREE from "three";
import { readFileSync, existsSync } from "node:fs";
const built=await build({entryPoints:["src/data.ts","src/settings.ts","src/sim.ts","src/renderer.ts","src/surfacePilot.ts","src/surfaceNavigation.ts","src/surfaceOperative.ts","src/surfaceWorld.ts","src/surfaceCombat.ts","src/surfaceTerrain.ts"],bundle:true,platform:"node",format:"esm",target:"node22",outdir:"bundles",write:false,plugins:[{name:"obsidian-fixture",setup(b){b.onResolve({filter:/^obsidian$/},()=>({path:"obsidian",namespace:"fixture"})); b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:"export class TFile {} export function getAllTags(){return []} export class App {}",loader:"js"}));}}]});
const load=n=>import(`data:text/javascript;base64,${Buffer.from(built.outputFiles.find(f=>f.path.endsWith(`${n}.js`)).text).toString("base64")}`);
const {SurfaceOperative}=await load("surfaceOperative"), {surfacePoleGuides}=await load("surfaceNavigation"), {SurfacePilot}=await load("surfacePilot"), {DEFAULT_SETTINGS}=await load("settings");
test("operative has deliberate suit details, bounded scene complexity and stable pose geometry",()=>{
 const model=new SurfaceOperative("#44CCFF",true); const names=[]; model.group.traverse(n=>names.push(n.name));
 for(const name of ["angular-helmet","luminous-visor","utility-pouch","pistol-receiver","training-target","knee","glove"]) assert.ok(names.includes(name));
 assert.ok(names.length<130); const ids=[]; model.group.traverse(n=>{if(n.geometry)ids.push(n.geometry.uuid)});
 for(const crouched of [false,true]) for(const lean of [-.35,0,.35]) {
 model.pose({crouched,lean,pitch:.3,velocity:[4.5,0,0],grounded:true},1/60); model.group.updateMatrixWorld(true);
 const bounds=new THREE.Box3().setFromObject(model.group); assert.ok(bounds.max.y< (crouched?1.13:1.85)); assert.ok(bounds.min.y>-.12);
 }
 model.setColor("#FFAA55"); assert.equal(model.group.getObjectByName("luminous-visor").material.color.getHexString(),"ffaa55");
 const after=[];model.group.traverse(n=>{if(n.geometry)after.push(n.geometry.uuid)});assert.deepEqual(after,ids);
});
test("pole guides retain tangent bearings, radius-aware distances and stable exact-pole exits",()=>{
 const state={position:[27,0,0],forward:[0,1,0],radius:27}; const guides=surfacePoleGuides(state);
 assert.equal(guides[0].bearing,0);assert.ok(Math.abs(guides[1].bearing)===Math.PI);
 assert.ok(Math.abs(guides[0].distance-27*Math.PI/2)<1e-8);
 for(const sign of [-1,1]) { const result=surfacePoleGuides({...state,position:[0,sign*27,0],forward:[1,0,0]}); assert.equal(result.find(g=>g.atExit).name,sign===1?"North":"South");assert.ok(result.every(g=>Number.isFinite(g.bearing))); }
 assert.equal(surfacePoleGuides({...state,radius:54})[0].distance,guides[0].distance*2);
});
test("Left Control crouches while captured movement works and Ctrl shortcuts are suppressed",()=>{
 const pilot=Object.create(SurfacePilot.prototype);Object.assign(pilot,{active:true,pointerLocked:true,settings:{...DEFAULT_SETTINGS},keys:new Set(),crouchToggle:false});
 let stopped=0;const event=(code,ctrlKey=true,repeat=false)=>({code,ctrlKey,repeat,preventDefault(){stopped++},stopImmediatePropagation(){}});
 pilot.handleKeyDown(event("ControlLeft"));pilot.handleKeyDown(event("KeyW"));assert.ok(pilot.keys.has("ControlLeft"));assert.ok(pilot.keys.has("KeyW"));
 pilot.handleKeyDown(event("KeyL"));assert.equal(stopped,3);assert.equal(pilot.keys.has("KeyL"),false);
 pilot.handleKeyUp(event("ControlLeft"));assert.equal(pilot.keys.has("ControlLeft"),false);
 pilot.settings.surfaceCrouchMode="toggle";pilot.handleKeyDown(event("ControlLeft"));pilot.handleKeyDown(event("ControlLeft",true,true));assert.equal(pilot.currentInput().crouch,true);pilot.handleKeyUp(event("ControlLeft"));assert.equal(pilot.currentInput().crouch,false,"legacy toggle settings cannot latch crouch");
});
test("real Smoke Hub files flow through graph, simulation, docking, physical cover and renderer instances",async t=>{
 const {buildGraphData}=await load("data"),{Simulation}=await load("sim"),{ConstellationRenderer}=await load("renderer"),{SurfaceWorld}=await load("surfaceWorld"),{traceSurfaceSegment}=await load("surfaceCombat");
 const base="T:/AI/ObsidianCitizenVault/Testing/Surface Smoke/";const hub="Surface Smoke/Surface Smoke Hub.md";
 const localFixture=existsSync(base+"Surface Smoke Hub.md");
 const fixtureText=localFixture ? readFileSync(base+"Surface Smoke Hub.md","utf8") : "[[Cover A]] [[Cover B]] [[Cover C]] [[Cover D]] [[Cover E]] [[Cover F]]";
 t.diagnostic(localFixture ? "Read actual Testing-vault Smoke fixture" : "Portable equivalent of six-file Smoke fixture");
 const text=fixtureText, names=[...text.matchAll(/\[\[([^\]]+)\]\]/g)].map(m=>m[1]);assert.equal(names.length,6);
 const paths=[hub,...names.map(n=>`Surface Smoke/${n}.md`)];const files=paths.map(path=>({path,basename:path.split("/").at(-1).slice(0,-3),stat:{ctime:1}}));
 const resolved={[hub]:Object.fromEntries(paths.slice(1).map(p=>[p,1]))}; for(const [i,path] of paths.slice(1).entries()){ if(localFixture) assert.ok(readFileSync(base+names[i]+".md","utf8").includes("[[Surface Smoke Hub]]"));resolved[path]={[hub]:1}; }
 const app={vault:{getMarkdownFiles:()=>files},metadataCache:{resolvedLinks:resolved,unresolvedLinks:{},getFileCache:()=>null}};
 const data=buildGraphData(app,{...DEFAULT_SETTINGS,groupBy:"folder",showOrphans:true}); assert.equal(data.links.length,6);
 const sim=new Simulation();sim.setData(data);const world=new SurfaceWorld({terrain:true}),renderer=Object.create(ConstellationRenderer.prototype);
 Object.assign(renderer,{multiplayer:false,sim,surfaceWorld:world,localSurfaceGroups:new Map(),scene:new THREE.Scene(),idIndex:new Map(sim.nodes.map((n,i)=>[n.id,i])),surfaceTopologyRevision:1});
 renderer.rebuildLocalSurfaceVisuals();const node=sim.nodes.find(n=>n.id===hub);world.setOwnerMap("solo",renderer.soloSurfaceTopology(),renderer.soloSurfacePositions());
 world.addPlayer("solo",{position:[node.x,node.y,node.z+38],rotation:[0,0,0,1],velocity:[0,0,0]}); assert.equal(world.dock("solo",`solo/${hub}`,4000),true);
 const arena=world.getArena(`solo/${hub}`);renderer.synchronizeSurfaceArenaVisual(arena,world.getPickups(arena.key,4000));const root=renderer.localSurfaceGroups.get(hub).group, mesh=root.getObjectByName("surface-wall-instances");
 assert.equal(arena.arena.walls.length,12);assert.equal(mesh.count,12);assert.equal(new Set(mesh.userData.connectionIds).size,6);for(const id of new Set(mesh.userData.connectionIds))assert.equal(mesh.userData.connectionIds.filter(value=>value===id).length,2);assert.equal(root.userData.geometryRevision,arena.revision);
 const {terrainHeight}=await load("surfaceTerrain");const matrix=new THREE.Matrix4();arena.arena.walls.forEach((w,i)=>{mesh.getMatrixAt(i,matrix);const p=new THREE.Vector3().setFromMatrixPosition(matrix);assert.ok(Math.abs(p.length()-(27+terrainHeight(arena.arena.terrain,w.normal)+(w.height-.35)/2))<1e-4); const start=w.normal.map(n=>n*31),end=w.normal.map(n=>n*26);assert.equal(traceSurfaceSegment(start,end,arena.arena.walls,[]).kind,"wall");});
 root.visible=false;Object.assign(renderer,{worldNodes:sim.nodes,surfaceDisplayCenters:new Map(),surfacePilot:{surfacePosition:world.getPlayer("solo").surface.position},updateParkedSurfaceShip(){}});renderer.resolveSurfaceDisplayFrames();assert.equal(root.visible,true,"occupied arena survives graph fading");
 renderer.synchronizeSurfaceArenaVisual({...arena,revision:arena.revision+1},world.getPickups(arena.key,4000));const refreshed=renderer.localSurfaceGroups.get(hub).group;assert.notEqual(refreshed,root,"revision changes refresh even when seed is unchanged");renderer.disposeSurfaceGroup(refreshed);
});


test("pole HUD exposes both destinations, exit progress, offscreen directions and bounded marker positions",()=>{
 const pilot=Object.create(SurfacePilot.prototype);
 const element=()=>({textContent:"",style:{setProperty(){}},dataset:{},hidden:false});
 Object.assign(pilot,{settings:{...DEFAULT_SETTINGS},poleCards:[element(),element()],poleEdges:[element(),element()],camera:{fov:75,aspect:280/700},state:{exitProgress:.5}});
 pilot.updatePoleCompass({position:[27,0,0],forward:[0,1,0]});
 assert.match(pilot.poleCards[0].textContent,/North/);assert.match(pilot.poleCards[1].textContent,/South/);
 assert.equal(pilot.poleEdges[1].dataset.direction,"behind");assert.match(pilot.poleEdges[1].style.left,/clamp/);
 pilot.updatePoleCompass({position:[0,27,0],forward:[1,0,0]});assert.match(pilot.poleCards[0].textContent,/At North exit.*50%/);assert.equal(pilot.poleEdges[0].hidden,true);
});

test("graph exclusions remain intact after removing diagnostics",async()=>{
 const {buildGraphData}=await load("data");
 const paths=["A/Hub.md","A/Leaf.md","Hidden/Secret.md"],files=paths.map(path=>({path,basename:path,stat:{ctime:1}}));
 const data=buildGraphData({vault:{getMarkdownFiles:()=>files},metadataCache:{resolvedLinks:{[paths[0]]:{[paths[1]]:1,[paths[2]]:1},[paths[2]]:{[paths[0]]:1}},unresolvedLinks:{[paths[0]]:{"Missing note":1}}}},{...DEFAULT_SETTINGS,excludeFolders:"Hidden",groupBy:"none"});
 assert.equal(data.links.length,1);assert.equal(data.nodes.some(n=>n.id===paths[2]),false);assert.equal("localLinkDiagnostics" in data,false);
});
