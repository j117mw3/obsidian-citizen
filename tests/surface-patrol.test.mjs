import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
const built=await build({entryPoints:["src/surfacePatrol.ts","src/surface.ts","src/surfacePhysics.ts","src/surfaceSteam.ts","src/surfacePilot.ts"],bundle:true,platform:"node",format:"esm",target:"node22",outdir:"bundles",write:false});
const load=n=>import(`data:text/javascript;base64,${Buffer.from(built.outputFiles.find(f=>f.path.endsWith(`${n}.js`)).text).toString("base64")}`);
const {createSurfacePatrol,stepSurfacePatrol}=await load("surfacePatrol"),{generateSurfaceArena}=await load("surface"),physics=await load("surfacePhysics"),{SurfaceVentSteam}=await load("surfaceSteam"),{SurfacePilot}=await load("surfacePilot");
const dot=(a,b)=>a.reduce((s,n,i)=>s+n*b[i],0);
const arc=(a,b,r)=>Math.acos(Math.max(-1,Math.min(1,dot(a,b)/(Math.hypot(...a)*Math.hypot(...b)))))*r;

test("four deterministic passive patrols stay on the sphere, out of exit zones and in their assigned regions",()=>{
 for(const degree of [0,6,17]) {
  const arena=generateSurfaceArena(`patrol-${degree}`,Array.from({length:degree},(_,i)=>`file-${i}`));
  for(let index=0;index<4;index++){
   const p=createSurfacePatrol(arena,index),copy=createSurfacePatrol(arena,index),initial=[...p.state.position];assert.deepEqual(p,copy);
   let travel=0;
   for(let tick=0;tick<1200;tick++){
    const before=[...p.state.position];stepSurfacePatrol(p,arena,1/60);stepSurfacePatrol(copy,arena,1/60);
    travel+=Math.hypot(...p.state.position.map((n,i)=>n-before[i]));
    assert.ok(Math.abs(Math.hypot(...p.state.position)-arena.radius)<1e-5);
    assert.ok(arc(p.state.position,p.home,arena.radius)<=p.leash+.2);
    assert.ok(Math.acos(Math.abs(p.state.position[1])/arena.radius)*arena.radius>3.7);
    assert.ok(physics.surfacePoseClear(p.state.position,1.8,arena.walls,undefined,arena.radius));
   }
   assert.deepEqual(p,copy);assert.ok(travel>3,`patrol ${degree}/${index} must actually walk: ${travel}`);assert.ok(arc(initial,p.state.position,arena.radius)>.1);
  }
 }
});

test("patrol steering turns around a wall rather than walking against it continuously",()=>{
 const arena=generateSurfaceArena("avoid-wall",[]);
 arena.walls=[{id:"barrier",normal:[1,0,0],tangent:[0,1,0],height:2.2,length:3.5}];
 const p=createSurfacePatrol(arena,2),z=4;
 p.state=physics.createSurfacePlayerState([Math.sqrt(27*27-z*z)/27,0,z/27],[0,0,-1]);
 p.home=[1,0,0];p.leash=18;p.goal=[Math.sqrt(27*27-z*z)/27,0,-z/27];p.repath=100;
 // This fixture relaxes the patrol region to test a direct approach to one obstacle.
 let contactTicks=0,travel=0;
 for(let tick=0;tick<1800;tick++){
  const before=[...p.state.position];stepSurfacePatrol(p,arena,1/60);
  const moved=Math.hypot(...p.state.position.map((n,i)=>n-before[i]));travel+=moved;if(moved<.001)contactTicks++;
  assert.ok(physics.surfacePoseClear(p.state.position,1.8,arena.walls));
 }
 assert.ok(travel>8,`must route away from barrier: ${travel}`);assert.ok(contactTicks<900,`must not spend the entire run stuck: ${contactTicks}`);
});

test("vent lock suppresses shot callbacks and firing effects until authoritative cooling permits firing",()=>{
 const pilot=Object.create(SurfacePilot.prototype);let now=10000,requests=0;const sounds=[];
 const state={id:"solo",mode:"surface",arenaKey:"arena",lifeId:1,surface:physics.createSurfacePlayerState(),health:100,armor:0,kills:0,heat:98,ventUntil:0};
 Object.assign(pilot,{state,arena:{key:"arena",center:[0,0,0]},shotCooldown:0,fireSequence:0,muzzleFlash:{visible:false},audio:{play:s=>sounds.push(s)},callbacks:{hostTime:()=>now,fire(){requests++;return {...state,heat:100,ventUntil:now+2000}}},updateHud(){}});
 pilot.fire();assert.equal(requests,1);assert.equal(pilot.state.ventUntil,12000);
 pilot.shotCooldown=0;pilot.recoil=.2;pilot.muzzleFlash.visible=false;
 for(let i=0;i<90;i++){now=10001+i*20;pilot.fire();}
 assert.equal(requests,1);assert.equal(sounds.filter(s=>s==="blaster").length,1);assert.equal(pilot.recoil,.2);assert.equal(pilot.muzzleFlash.visible,false);
 now=12001;pilot.fire();assert.equal(requests,1,"stale full heat must await authoritative cooling");
 pilot.state={...state,heat:0,ventUntil:0};pilot.fire();assert.equal(requests,2);
});

test("steam is bounded weapon-local presentation, visible only during the host-timed vent",()=>{
 const steam=new SurfaceVentSteam();assert.equal(steam.visible,false);
 steam.update(10000,12000);assert.equal(steam.visible,true);assert.equal(steam.geometry.getAttribute("position").count,12);
 const before=Array.from(steam.geometry.getAttribute("position").array);steam.update(10100,12000);assert.notDeepEqual(Array.from(steam.geometry.getAttribute("position").array),before);
 assert.ok(Array.from(steam.geometry.getAttribute("fade").array).every(n=>n>=0&&n<=1));
 steam.update(12000,12000);assert.equal(steam.visible,false);steam.update(13000,0);assert.equal(steam.visible,false);steam.geometry.dispose();steam.material.dispose();
});


test("dense cover patrol steps retain clear capsules without a full-arena movement scan",()=>{
 const arena=generateSurfaceArena("dense-patrol",Array.from({length:1000},(_,i)=>`file-${i}`));
 for(let index=0;index<4;index++){
  const p=createSurfacePatrol(arena,index);
  for(let tick=0;tick<120;tick++){stepSurfacePatrol(p,arena,1/60);assert.ok(physics.surfacePoseClear(p.state.position,1.8,arena.walls,undefined,arena.radius));}
 }
});

test("charged controls release only a full charge and cancel safely when held inputs clear",()=>{
 const pilot=Object.create(SurfacePilot.prototype);let now=10000;const previousNow=Date.now;Date.now=()=>now;
 const events=[];Object.assign(pilot,{state:{surface:physics.createSurfacePlayerState(),health:100,heat:0,ventUntil:0},keys:new Set(),mouseX:0,mouseY:0,accumulator:0,shotCooldown:0,chargeStartedAt:null,heldFire:true,muzzleFlash:{visible:false},callbacks:{hostTime:()=>now,charge:active=>events.push(active)},updateHud(){},fire:kind=>events.push(kind)});
 try{
  pilot.beginCharge();assert.equal(pilot.heldFire,false);now+=500;pilot.releaseCharge();assert.deepEqual(events,[true,false]);
  pilot.beginCharge();now+=1000;pilot.releaseCharge();assert.deepEqual(events,[true,false,true,"charged",false]);
  pilot.beginCharge();pilot.keys.add("ControlLeft");pilot.clearHeldInputs();assert.equal(pilot.chargeStartedAt,null);assert.equal(pilot.keys.size,0);assert.equal(events.at(-1),false);
  pilot.beginCharge();now+=5001;pilot.releaseCharge();assert.notEqual(events.at(-1),"charged");
  pilot.state.ventUntil=now+2000;const count=events.length;pilot.beginCharge();assert.equal(events.length,count);
 }finally{Date.now=previousNow;}
});
