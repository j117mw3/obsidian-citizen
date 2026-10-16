import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
const built=await build({entryPoints:["src/surfaceCharge.ts","src/surfaceAudio.ts","src/surfacePilot.ts"],bundle:true,platform:"node",format:"esm",target:"node22",outdir:"bundles",write:false});
const load=n=>import(`data:text/javascript;base64,${Buffer.from(built.outputFiles.find(f=>f.path.endsWith(`${n}.js`)).text).toString("base64")}`);
const {SurfaceChargeEffect}=await load("surfaceCharge"),{SurfaceAudio}=await load("surfaceAudio"),{SurfacePilot}=await load("surfacePilot");

test("charge animation gathers bounded energy, respects laser color and hides when cancelled",()=>{
 const effect=new SurfaceChargeEffect();assert.equal(effect.visible,false);assert.equal(effect.children.length,4);
 effect.setColor("#FF8800");effect.update(100,1000);assert.equal(effect.visible,true);
 const sparks=effect.children[3],before=Array.from(sparks.geometry.getAttribute("position").array),scale=effect.children[0].scale.x;
 assert.equal(sparks.geometry.getAttribute("position").count,12);effect.update(1000,1000);
 assert.notDeepEqual(Array.from(sparks.geometry.getAttribute("position").array),before);assert.ok(effect.children[0].scale.x<scale);
 assert.equal(effect.children[0].material.color.getHexString(),"ff8800");assert.equal(sparks.material.color.getHexString(),"ff8800");
 for(let ms=1000;ms<5000;ms+=17)effect.update(ms,1000);
 assert.equal(effect.children.length,4);assert.ok(Array.from(sparks.geometry.getAttribute("position").array).every(n=>Number.isFinite(n)&&Math.abs(n)<.3));
 effect.update(null,1000);assert.equal(effect.visible,false);effect.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
});

function fakeAudio(){
 const oscillators=[],gains=[];const param=()=>({value:0,events:[],setValueAtTime(...args){this.events.push(["set",...args]);},linearRampToValueAtTime(...args){this.events.push(["linear",...args]);},exponentialRampToValueAtTime(...args){this.events.push(["exp",...args]);},cancelScheduledValues(...args){this.events.push(["cancel",...args]);},setTargetAtTime(...args){this.events.push(["target",...args]);}});
 const node=()=>({connect(){},disconnected:false,disconnect(){this.disconnected=true;}});
 const context={currentTime:10,resume:()=>Promise.resolve(),close:()=>Promise.resolve(),createGain(){const gain={...node(),gain:param()};gains.push(gain);return gain;},createOscillator(){const osc={...node(),frequency:param(),starts:[],stops:[],start(at){this.starts.push(at);},stop(at){this.stops.push(at);}};oscillators.push(osc);return osc;}};
 const audio=new SurfaceAudio();Object.assign(audio,{context,master:{...node(),gain:param()}});return {audio,context,oscillators,gains};
}

test("charge sound rises on the audio clock, stays bounded, and stops on cancel, mute and disposal",()=>{
 const {audio,context,oscillators,gains}=fakeAudio();audio.startCharge(1000);assert.equal(oscillators.length,2);
 assert.deepEqual(oscillators[0].frequency.events,[["set",160,10],["exp",880,11]]);assert.equal(oscillators[0].stops[0],15.1);
 context.currentTime=10.5;audio.stopCharge();assert.equal(audio.charge,null);assert.equal(oscillators[0].stops.at(-1),10.52);assert.ok(gains[0].gain.events.some(e=>e[0]==="cancel"));
 oscillators[0].onended();assert.ok(oscillators.every(o=>o.disconnected));assert.equal(gains[0].disconnected,true);
 audio.startCharge(1000);const old=audio.charge;audio.startCharge(1000);assert.notEqual(audio.charge,old);old.oscillators[0].onended();assert.notEqual(audio.charge,null,"old cleanup must not remove the new voice");
 audio.setOptions(false,.5);assert.equal(audio.charge,null);const count=oscillators.length;audio.startCharge(1000);assert.equal(oscillators.length,count);
 audio.setOptions(true,.5);audio.startCharge(1000);audio.setOptions(true,0);assert.equal(audio.charge,null);
 audio.setOptions(true,.5);audio.startCharge(1000);audio.dispose();assert.equal(audio.charge,null);assert.equal(audio.context,null);
});

test("ready feedback plays once per charge and release/cancel stop all feedback",()=>{
 const pilot=Object.create(SurfacePilot.prototype),sounds=[],updates=[];let starts=0,stops=0,now=10000;const oldNow=Date.now;Date.now=()=>now;
 Object.assign(pilot,{state:{surface:{},health:100,heat:0,ventUntil:0},shotCooldown:0,chargeStartedAt:null,chargeReady:false,heldFire:false,muzzleFlash:{visible:false},audio:{startCharge(){starts++;},stopCharge(){stops++;},play:s=>sounds.push(s)},chargeEffect:{update:(...args)=>updates.push(args)},callbacks:{hostTime:()=>now,charge(){}},updateHud(){},fire:kind=>sounds.push(kind)});
 try{
  pilot.beginCharge();assert.equal(starts,1);pilot.beginCharge();assert.equal(starts,1);
  for(const elapsed of [100,900,1000,1010,1500])pilot.updateChargeFeedback(elapsed);
  assert.deepEqual(sounds,["chargeReady"]);now+=1500;pilot.releaseCharge();assert.equal(stops,1);assert.deepEqual(sounds,["chargeReady","charged"]);assert.equal(updates.at(-1)[0],null);
  pilot.beginCharge();pilot.updateChargeFeedback(1000);assert.equal(sounds.filter(s=>s==="chargeReady").length,2);pilot.cancelCharge();assert.equal(stops,2);assert.equal(pilot.chargeStartedAt,null);
 }finally{Date.now=oldNow;}
});
