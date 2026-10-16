import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import * as THREE from "three";
const built=await build({entryPoints:["src/surfaceNameplates.ts","src/surfacePhysics.ts","src/surfaceView.ts","src/surfaceDecor.ts","src/surfacePilot.ts"],bundle:true,platform:"node",format:"esm",target:"node22",outdir:"bundles",write:false});
const load=n=>import(`data:text/javascript;base64,${Buffer.from(built.outputFiles.find(f=>f.path.endsWith(`${n}.js`)).text).toString("base64")}`);
const {projectSurfaceNameplate,SurfaceNameplates}=await load("surfaceNameplates"),{createSurfacePlayerState}=await load("surfacePhysics"),{surfaceViewPose,surfaceToWorld}=await load("surfaceView"),{SurfacePilot}=await load("surfacePilot"),{createSurfacePanelMaterial}=await load("surfaceDecor");
function fixture(center=[0,0,0]) {
 const angle=4/27,state=createSurfacePlayerState([0,Math.cos(angle),-Math.sin(angle)],[1,0,0]);
 const target={id:"other",name:"Other pilot",health:75,arenaKey:"arena",state};
 const arena={key:"arena",center:[-100,-100,-100],arena:{radius:27,walls:[]}};
 const camera=new THREE.PerspectiveCamera(75,1,.02,2000);camera.position.set(...surfaceToWorld([0,28.65,4],center));camera.lookAt(new THREE.Vector3(...surfaceToWorld(surfaceViewPose(state).eye,center)));camera.updateMatrixWorld();
 return {center,target,arena,camera};
}
test("names and health require displayed head line of sight through cover and curved ground",()=>{
 for(const center of [[0,0,0],[100,20,-30]]) {
  const {target,arena,camera}=fixture(center);assert.ok(projectSurfaceNameplate(camera,target,arena,center));
  arena.arena.walls=[{id:"wall",normal:[0,1,0],tangent:[1,0,0],height:2.2,length:3.5}];
  assert.equal(projectSurfaceNameplate(camera,target,arena,center),null,"a label floating above cover must not reveal a hidden head");
  arena.arena.walls[0].height=1.3;assert.ok(projectSurfaceNameplate(camera,target,arena,center),"standing head visible above low cover");
  target.state.crouched=true;assert.equal(projectSurfaceNameplate(camera,target,arena,center),null,"crouching behind low cover hides both name and bar");
  arena.arena.walls=[];target.state=createSurfacePlayerState([0,-1,0],[1,0,0]);camera.lookAt(new THREE.Vector3(...surfaceToWorld(surfaceViewPose(target.state).eye,center)));camera.updateMatrixWorld();
  assert.equal(projectSurfaceNameplate(camera,target,arena,center),null,"planet hides players on the far side");
 }
});
test("nameplate display uses public names safely, updates red HP fraction and removes occluded/dead labels immediately",()=>{
 class Element {
  children=[];style={};attributes={};hidden=false;textContent="";
  appendChild(child){this.children.push(child);child.parent=this;return child} append(...children){children.forEach(c=>this.appendChild(c))}
  setAttribute(key,value){this.attributes[key]=value} remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this)}
 }
 const previous=globalThis.document;globalThis.document={createElement:()=>new Element()};
 try {
  const container=new Element(),plates=new SurfaceNameplates(container),{center,target,arena,camera}=fixture();target.name="<img onerror=alert(1)>";
  plates.update(camera,400,500,arena,center,[target]);const root=container.children[0].children[0];assert.equal(root.children[0].textContent,target.name);assert.equal(root.children[1].children[0].style.width,"75%");assert.equal(root.children[1].attributes["aria-valuenow"],"75");
  target.health=20;plates.update(camera,400,500,arena,center,[target]);assert.equal(root.children[1].children[0].style.width,"20%");
  arena.arena.walls=[{id:"wall",normal:[0,1,0],tangent:[1,0,0],height:2.2,length:3.5}];plates.update(camera,400,500,arena,center,[target]);assert.equal(container.children[0].children.length,0);
  arena.arena.walls=[];target.health=0;plates.update(camera,400,500,arena,center,[target]);assert.equal(container.children[0].children.length,0);
  target.health=100;target.arenaKey="other";plates.update(camera,400,500,arena,center,[target]);assert.equal(container.children[0].children.length,0);
  plates.dispose();assert.equal(container.children.length,0);
 } finally {globalThis.document=previous;}
});
test("training hit feedback confirms damage once and does not accept another player's identity",()=>{
 const pilot=Object.create(SurfacePilot.prototype),sounds=[];Object.assign(pilot,{active:true,playerId:"solo",seenCombatEvents:new Set(),audio:{play:s=>sounds.push(s)},updateHud(){}});
 pilot.confirmTrainingHit("shot-1");assert.ok(pilot.hitMarkerUntil>Date.now()+400);pilot.confirmTrainingHit("shot-1");assert.deepEqual(sounds,["hit"]);
 pilot.playerId="other";pilot.confirmTrainingHit("shot-2");assert.deepEqual(sounds,["hit"]);
});
test("panel/circuit/pole-route paint is deterministic opaque decoration without displacement",()=>{
 const first=createSurfacePanelMaterial(27,123),same=createSurfacePanelMaterial(27,123),large=createSurfacePanelMaterial(100,456);
 assert.deepEqual(first.uniforms,same.uniforms);assert.equal(large.uniforms.arenaRadius.value,100);assert.equal(first.transparent,false);assert.equal(first.depthTest,true);assert.equal(first.depthWrite,true);
 assert.match(first.fragmentShader,/routeColor/);assert.match(first.fragmentShader,/poleDistance/);assert.match(first.vertexShader,/surfacePoint=position/);assert.doesNotMatch(first.vertexShader,/displacement/);
 first.dispose();same.dispose();large.dispose();
});


test("far-hemisphere nameplates reject before querying dense cover",()=>{
 const {target,arena,camera,center}=fixture();
 target.state=createSurfacePlayerState([0,-1,0],[1,0,0]);camera.lookAt(new THREE.Vector3(...surfaceToWorld(surfaceViewPose(target.state).eye,center)));camera.updateMatrixWorld();
 arena.arena.walls=new Proxy([],{get(){throw new Error("far hemisphere must not scan cover");}});
 assert.equal(projectSurfaceNameplate(camera,target,arena,center),null);
});
