import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:`import * as THREE from 'three';export {THREE};export * as terrain from './src/surfaceTerrain';export * as physics from './src/surfacePhysics';export * as combat from './src/surfaceCombat';export * as layout from './src/surfaceTerrainLayout';export * as geometry from './src/surfaceGeometry';export * as mesh from './src/surfaceTerrainMesh';export * as world from './src/surfaceWorld';export * as wire from './src/surfaceGeometryWire';export * as cover from './src/surfaceCover';export * as coverWire from './src/surfaceCoverWire';export * as collision from './src/surfaceCollision';export * as authority from './src/surfaceAuthority';export * as snapshotWire from './src/surfaceSnapshotWire';export * as visuals from './src/surfaceVisuals';export * as patrol from './src/surfacePatrol';export * as presentation from './src/surfacePresentation';export * as operative from './src/surfaceOperative';export * as botPresentation from './src/surfaceBotPresentation';export * as view from './src/surfaceView';export * as nameplates from './src/surfaceNameplates';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {THREE,terrain:t,physics:p,layout,geometry,mesh,world,wire,cover,coverWire,combat,collision,authority,snapshotWire,visuals,patrol,presentation,operative,botPresentation,view,nameplates}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const idle={moveX:0,moveY:0,sprint:false,jump:false,crouch:false,yawDelta:0,pitchDelta:0,lean:0};
const normalize=v=>{const r=Math.hypot(...v);return v.map(x=>x/r)};
test('version 2 terrain remains valid while version 3 generates deterministic hills and crater bowls',()=>{
 const legacy=t.createLegacyTerrainDefinition(42,27),first=t.createTerrainDefinition(42,27),again=t.createTerrainDefinition(42,27);
 assert.equal(legacy.version,2);assert.ok(t.validTerrainDefinition(legacy,27));assert.equal(t.terrainHeight(legacy,[0,1,0]),0);
 assert.equal(first.version,3);assert.ok(t.validTerrainDefinition(first,27));assert.equal(first.hash,again.hash);assert.deepEqual(first.chunkHashes,again.chunkHashes);
 let low=Infinity,high=-Infinity;for(let i=0;i<4096;i++){const y=1-2*(i+.5)/4096,a=i*2.399963229728653,n=[Math.sqrt(1-y*y)*Math.cos(a),y,Math.sqrt(1-y*y)*Math.sin(a)],h=t.terrainHeight(first,n);low=Math.min(low,h);high=Math.max(high,h);}
 assert.ok(low>=-1.5&&high<=3);assert.ok(high-low>=2.5,`terrain relief was only ${high-low}`);
});
test('terrain format hashes reject altered content and accept reordered fields',()=>{
 const d=t.createTerrainDefinition(42,27);assert.ok(t.validTerrainDefinition(d,27));assert.ok(t.validTerrainDefinition(Object.fromEntries(Object.entries(d).reverse()),27));
 for(const field of ['seed','radius','relief','routeAngle','profile'])assert.equal(t.validTerrainDefinition({...d,[field]:d[field]+1}),false);
 assert.equal(t.validTerrainDefinition({...d,notePath:'private'}),false);
 assert.equal(t.validTerrainDefinition({...d,chunkHashes:d.chunkHashes.map(()=> '00000000')}),false);
});
test('1000 seeds retain flat poles, bounded elevation and walkable normals at all supported radii',()=>{
 for(let seed=0;seed<1000;seed++){
  const radius=27*Math.sqrt(Math.max(1,[0,1,2,6,16,17,1000,19999][seed%8]/16));const d=t.createTerrainDefinition(seed,radius),q=t.terrainQuery(d);
  for(const pole of [[0,1,0],[0,-1,0]])assert.equal(q.height(pole),0);
  for(let i=0;i<32;i++){
   const y=1-2*(i+.5)/32,a=i*2.399963229728653,n=[Math.sqrt(1-y*y)*Math.cos(a),y,Math.sqrt(1-y*y)*Math.sin(a)];
   const h=q.height(n),normal=q.normal(n),dot=normal.reduce((s,x,k)=>s+x*n[k],0);
   assert.ok(h>=-1.5&&h<=3);assert.ok(Math.acos(Math.min(1,dot))<=25*Math.PI/180,`seed ${seed} slope`);
  }
 }
});
test('terrain rays and sweeps agree with radial ground, including shallow craters',()=>{
 for(let seed=0;seed<30;seed++){
  const d=t.createTerrainDefinition(seed,27),q=t.terrainQuery(d),n=normalize([1,.2,.5]),r=27+q.height(n),start=n.map(x=>x*(r+3)),end=n.map(x=>x*(r-2));
  const hit=q.ray(start,end);assert.ok(Math.abs(hit-.6)<.00005);const sweep=q.sweepGround(start,end);assert.ok(sweep.hit);assert.ok(Math.abs(Math.hypot(...sweep.position)-r)<1e-9);
 }
});
test('combat planet intersections use the same raised hills and crater bowls as terrain collision',()=>{
 const def=t.createTerrainDefinition(7319,27),walls=[];t.bindSurfaceTerrain(walls,def);let peak=null,bowl=null;
 for(let i=0;i<4096;i++){const y=1-2*(i+.5)/4096,a=i*2.399963229728653,n=[Math.sqrt(1-y*y)*Math.cos(a),y,Math.sqrt(1-y*y)*Math.sin(a)],height=t.terrainHeight(def,n);
  if(!peak||height>peak.height)peak={normal:n,height};if(!bowl||height<bowl.height)bowl={normal:n,height};}
 for(const sample of [peak,bowl]){const start=sample.normal.map(value=>value*(def.radius+8)),end=sample.normal.map(value=>value*(def.radius-4)),hit=combat.traceSurfaceSegment(start,end,walls,[]);
  assert.equal(hit?.kind,'planet');assert.ok(Math.abs(Math.hypot(...hit.position)-def.radius-sample.height)<.01);}
 assert.ok(peak.height-bowl.height>=2.5,'raised ridges and crater lows must have physical separation');
});
test('terrain generation yields during assembly, reuses cached patches and returns a sampleable mesh',()=>{
 const def=t.createTerrainDefinition(7319,27),observer=[28,0,0],preparation=mesh.prepareTerrainMesh(def,observer);let yields=0,next;
 do{next=preparation.next();if(!next.done)yields++;}while(!next.done);
 assert.ok(yields>8,`mesh preparation yielded only ${yields} times`);assert.ok(mesh.sampleTerrainMeshSurface(next.value,[1,0,0]));next.value.dispose();
 const repeated=mesh.buildTerrainMesh(def,observer);assert.ok(repeated.userData.terrainPatchCacheHits>0);assert.ok(mesh.sampleTerrainMeshSurface(repeated,[1,0,0]));repeated.dispose();
});
test('terrain grounded and jumping movement stays stable at 30,60,144 FPS and delayed display centers',()=>{
 const d=t.createTerrainDefinition(77,27),walls=[];t.bindSurfaceTerrain(walls,d);const q=t.terrainQuery(d);
 for(const fps of [30,60,144]){
  let state=p.createSurfacePlayerState(normalize([1,.15,.3]),[0,0,-1],27,d);
  for(let i=0;i<fps*8;i++){
   const move=i>fps&&i<fps*6;state=p.stepSurfacePlayer(state,{...idle,moveY:move?1:0,jump:i===fps*3,crouch:i>fps*4&&i<fps*5},1/fps,walls);
   assert.ok(p.validSurfacePlayerState(state));assert.ok(q.signedDistance(state.position)>-1e-7);
   if(state.grounded)assert.ok(Math.abs(q.signedDistance(state.position))<1e-7);
   const center=[Math.sin(i/fps)*10, i/fps,0],eye=state.position.map((x,k)=>x+normalize(state.position)[k]*1.65+center[k]);
   assert.ok(Math.abs(Math.hypot(...eye.map((x,k)=>x-center[k]))-Math.hypot(...state.position)-1.65)<1e-10);
  }
 }
});

test('terrain production geometry retains paired walls at maximum degree and transport hashes',()=>{
 for(const count of [0,1,2,6,16,17,1000,19999]){
  const arena=geometry.generateDirectedSurfaceArena('hub',Array.from({length:count},(_,i)=>`n-00000000-0000-4000-8000-${String(i).padStart(12,'0')}`),new Map(),true);
  assert.equal(arena.walls.length,count*2);assert.ok(layout.validateTerrainLayout(arena.terrain,arena).valid);
  const encoded=wire.stringifySurfaceTransfer(arena,4*1024*1024),decoded=wire.parseSurfaceTransfer(encoded,4*1024*1024);
  assert.equal(decoded.terrain.hash,arena.terrain.hash);assert.ok(t.terrainForWalls(decoded.walls));
  assert.equal(decoded.walls.length,count*2);
 }
});
test('unlinked terrain has static physical ruins and protected routes',()=>{
 for(let seed=0;seed<1000;seed++){
  const def=layout.prepareTerrainDefinition(seed,27);assert.ok(layout.validateTerrainLayout(def).valid);
  const q=t.terrainQuery(def),ruins=q.staticNear([27,0,0],100);assert.ok(ruins.length>0);
  for(const ruin of ruins){assert.ok(q.routeDistance(ruin.normal)>=Math.hypot(ruin.length,ruin.thickness)/2+1.6);assert.ok(Math.acos(Math.abs(ruin.normal[1]))*27>=6+Math.hypot(ruin.length,ruin.thickness)/2+1.6);}
 }
});
test('static ruins block movement and shots without leaking into moving pose rows',()=>{
 const arena=geometry.generateDirectedSurfaceArena('hub',[],new Map(),true),q=t.terrainQuery(arena.terrain),wall=q.staticNear([27,0,0],100)[0],box=collision.surfaceWallBox(wall,27);
 const side=box.axes[2],start=box.center.map((x,k)=>x+side[k]*3),end=box.center.map((x,k)=>x-side[k]*3);
 assert.equal(combat.traceSurfaceSegment(start,end,arena.walls,[]).kind,'wall');
 assert.equal(p.surfacePoseClear(box.center,1.8,arena.walls),false);
 const packet=coverWire.encodeCoverPoses([{key:'owner/hub',arena}],[{arenaKey:'owner/hub',health:100,surface:{position:box.center}}]);assert.equal(packet.length,0);
});
test('terrain snapshots preserve occupied terrain, timers, and migration',()=>{
 const w=new world.SurfaceWorld({terrain:true}),topology={revision:1,nodes:[{id:'hub',dockable:true,group:0,degree:6},...Array.from({length:6},(_,i)=>({id:'n'+i,dockable:false,group:0,degree:1}))],links:Array.from({length:6},(_,i)=>['hub','n'+i])};
 const positions=new Float32Array([0,0,0,...Array.from({length:6},(_,i)=>[10*Math.cos(i),0,10*Math.sin(i)]).flat()]);
 w.setOwnerMap('owner',topology,positions);w.addPlayer('pilot',{position:[0,0,38],rotation:[0,0,0,1],velocity:[0,0,0]});assert.ok(w.dock('pilot','owner/hub',4000));
 const first=w.getArena('owner/hub');assert.equal(first.arena.walls.length,12);assert.equal(w.getPlayer('pilot').surface.terrainHash,first.arena.terrain.hash);
 w.setOwnerMap('owner',topology,positions.map((x,i)=>x+[9,15,-4][i%3]));w.moveCover(.016);
 assert.equal(w.getArena('owner/hub').arena.terrain.hash,first.arena.terrain.hash);
 const checkpoint=wire.parseSurfaceTransfer(wire.stringifySurfaceTransfer(w.checkpoint(5000),32*1024*1024),32*1024*1024),restored=new world.SurfaceWorld({terrain:true});
 assert.ok(restored.restoreCheckpoint(checkpoint,6000,1000));assert.equal(restored.getArena('owner/hub').arena.terrain.hash,first.arena.terrain.hash);
});
test('near terrain mesh agrees with collision within .02, with bounded LOD complexity',()=>{
 for(const radius of [27,27*Math.sqrt(19999/16)]){
  const def=t.createTerrainDefinition(42,radius),observer=[radius+1.65,0,0],geo=mesh.buildTerrainMesh(def,observer),points=geo.getAttribute('position'),indices=geo.index.array,q=t.terrainQuery(def);let checked=0;
  for(let i=0;i<indices.length;i+=3){const vertices=[0,1,2].map(k=>{const at=indices[i+k];return [points.getX(at),points.getY(at),points.getZ(at)]});
   const c=[0,1,2].map(k=>(vertices[0][k]+vertices[1][k]+vertices[2][k])/3);
   if(Math.hypot(...c.map((x,k)=>x-observer[k]))>20)continue;
   // Skirts are below the top surface, never a walkable top triangle.
   if(vertices.some(v=>q.signedDistance(v)<-.01))continue;
   assert.ok(Math.abs(q.signedDistance(c))<=.02,`radius ${radius} error ${q.signedDistance(c)}`);checked++;
  }
  assert.ok(checked>0);assert.ok(points.count<1000000);geo.dispose();
 }
});

test('1000 procedural encounter layouts retain paired walls, accessible routes and balanced resources',()=>{
 for(let seed=0;seed<1000;seed++){
  const count=[0,1,2,6,16,17][seed%6],ids=Array.from({length:count},(_,i)=>'file-'+i),directions=new Map(ids.map(id=>[id,seed%2?[0,1,0]:[1,0,0]]));
  const arena=geometry.generateDirectedSurfaceArena('seed-'+seed,ids,directions,true),validation=layout.validateTerrainLayout(arena.terrain,arena);
  assert.ok(validation.valid,JSON.stringify(validation.errors));assert.ok(validation.pickupImbalance<=.1);assert.equal(arena.walls.length,count*2);
  for(const pickup of arena.pickups){const r=arena.radius+t.terrainHeight(arena.terrain,pickup.normal),feet=pickup.normal.map(v=>v*r);assert.ok(p.surfacePoseClear(feet,1.8,arena.walls,undefined,arena.radius));}
 }
});
test('terrain reliable chunks and delayed snapshots prepare matching collision before late join, then migrate',()=>{
 const owner='11111111-1111-4111-8111-111111111111',pilot='22222222-2222-4222-8222-222222222222',hub='n-33333333-3333-4333-8333-333333333333',key=owner+'/'+hub;
 const host=new authority.SurfaceAuthority({terrain:true});host.setOwnerMap(owner,{revision:1,nodes:[{id:hub,dockable:true,group:0,degree:0}],links:[]},new Float32Array([0,0,0]));
 host.addPlayer(pilot,{position:[0,0,8.45],rotation:[0,0,0,1],velocity:[0,0,0]});assert.ok(host.dock(pilot,owner,hub,4000));
 const sender=new snapshotWire.SurfaceSnapshotWire(),receiver=new snapshotWire.SurfaceSnapshotWire(),pending=[],delays=[];let accepted=0;
 for(let tick=0;tick<180;tick++){
  const now=5000+tick*1000/60;host.step(1/60,Math.round(now));
  if(tick%3===0){const frame=sender.encode(host.snapshot(1,tick+1,Math.round(now)),true);pending.push({at:now+100+(tick%5)*5,frame});
   const chunk=sender.nextChunk(now);if(chunk){assert.ok(Buffer.byteLength(JSON.stringify(chunk))<16384);delays.push({at:now+100+(tick%3)*7,chunk});}}
  while(delays.length&&delays[0].at<=now){const token=receiver.receiveChunk(delays.shift().chunk);if(token)sender.acknowledge([token]);}
  while(pending.length&&pending[0].at<=now){const result=receiver.decode(pending.shift().frame,1);if(!result.snapshot)continue;accepted++;sender.acknowledge(result.acknowledge);
   const arena=result.snapshot.arenas[0].arena,state=result.snapshot.players[0].surface;assert.equal(state.terrainHash,arena.terrain.hash);assert.ok(t.terrainForWalls(arena.walls));assert.ok(Math.abs(t.terrainQuery(arena.terrain).signedDistance(state.position))<1e-7);
  }
 }
 assert.ok(accepted>40);const snap=host.snapshot(1,200,8000),inline=new snapshotWire.SurfaceSnapshotWire(),full=inline.decode(new snapshotWire.SurfaceSnapshotWire().encode(snap),1);assert.ok(full.snapshot);const refs=inline.decode({...snap,arenas:full.snapshot.arenas.map((a,i)=>({...a,geometryId:i+1,arena:i+1}))},1);assert.ok(refs.snapshot);assert.ok(t.terrainForWalls(refs.snapshot.arenas[0].arena.walls));
 const bad=structuredClone(snap);bad.players[0].surface.terrainHash='00000000';assert.equal(authority.validSurfaceNetworkSnapshot(bad,1),false);
 const checkpoint=host.checkpoint(8000),migrated=new authority.SurfaceAuthority({terrain:true});assert.ok(migrated.restoreCheckpoint(checkpoint,8100,100));assert.equal(migrated.world.getArena(key).arena.terrain.hash,host.world.getArena(key).arena.terrain.hash);
});
test('terrain slopes, both poles, pause, crouch, lean, and jumping preserve grounded radial orientation',()=>{
 const arena=geometry.generateDirectedSurfaceArena('walk-terrain',[],new Map(),true),q=t.terrainQuery(arena.terrain);
 for(const start of [[0,1,0],[0,-1,0],normalize([1,1,1])])for(const fps of [30,60,144]){
  let state=p.createSurfacePlayerState(start,[1,0,0],arena.radius,arena.terrain);
  for(let frame=0;frame<fps*12;frame++){
   const input={...idle,moveY:frame<fps*9?1:0,sprint:frame>fps*2&&frame<fps*4,crouch:frame>fps*6&&frame<fps*8,lean:frame>fps*7?.5:0,jump:frame===fps*4};
   state=p.stepSurfacePlayer(state,input,1/fps,arena.walls);assert.ok(q.signedDistance(state.position)>-1e-6);assert.ok(p.validSurfacePlayerState(state));
   if(frame===fps*5){const paused=p.stepSurfacePlayer(state,input,0,arena.walls);assert.deepEqual(paused,state);}
  }
 }
});

test('irregular frames and delayed moving centers cannot change idle terrain altitude or heading',()=>{
 const w=new world.SurfaceWorld({terrain:true}),map={revision:1,nodes:[{id:'hub',dockable:true,group:0,degree:0}],links:[]};w.setOwnerMap('owner',map,new Float32Array([0,0,0]));w.addPlayer('pilot',{position:[0,0,38],rotation:[0,0,0,1],velocity:[0,0,0]});assert.ok(w.dock('pilot','owner/hub',4000));
 const original=w.getPlayer('pilot').surface,arena=w.getArena('owner/hub').arena;let elapsed=0;
 for(let frame=0;frame<1200;frame++){
  const dt=[1/30,1/144,.017,.05][frame%4];elapsed+=dt;
  if(frame%7===0)w.setOwnerMap('owner',map,new Float32Array([Math.sin(elapsed)*50,elapsed*2,Math.cos(elapsed)*20]));
  w.updatePlayer('pilot',idle,dt,Math.round(5000+elapsed*1000));const state=w.getPlayer('pilot').surface;assert.deepEqual(state.position,original.position);assert.deepEqual(state.forward,original.forward);assert.deepEqual(state.velocity,original.velocity);assert.equal(state.grounded,true);
 }
 assert.equal(w.getArena('owner/hub').arena.terrain.hash,arena.terrain.hash);w.ownerLeft('owner');assert.equal(w.getPlayer('pilot').mode,'ship');
});
test('moving terrain walls remain grounded and never seal protected approaches or intersect static ruins',()=>{
 const arena=geometry.generateDirectedSurfaceArena('terrain-motion',Array.from({length:6},(_,i)=>'file'+i),new Map(),true),motion=new cover.SurfaceCoverMotion(arena),q=t.terrainQuery(arena.terrain);
 const directions=new Map(arena.walls.map(w=>[w.connectionId,[0,1,0]]));
 for(let tick=0;tick<600;tick++)motion.step(directions,[],1/60);
 for(const wall of motion.walls){assert.ok(q.routeDistance(wall.normal)>=wall.length/2+1.6);assert.ok(Math.abs(Math.asin(wall.normal[1]))*27>=wall.length/2+1.6);
  const box=collision.surfaceWallBox(wall,27);assert.ok(Math.abs(Math.hypot(...box.center)-(27+q.height(wall.normal)+(wall.height-.35)/2))<1e-8);
  for(const ruin of q.staticNear(wall.normal.map(v=>v*27),6)){const d=Math.hypot(...ruin.normal.map((v,k)=>(v-wall.normal[k])*27));assert.ok(d>=wall.length/2+ruin.length/2+1-.01);}
 }
});
test('training patrols use terrain grounding and clear capsule paths around permanent ruins',()=>{
 const arena=geometry.generateDirectedSurfaceArena('terrain-training',[],new Map(),true),q=t.terrainQuery(arena.terrain);
 for(let index=0;index<4;index++){
  const actor=patrol.createSurfacePatrol(arena,index),initial=[...actor.state.position];let traveled=0;
  for(let frame=0;frame<1200;frame++){const before=actor.state.position;const state=patrol.stepSurfacePatrol(actor,arena,1/60);traveled+=Math.hypot(...state.position.map((v,k)=>v-before[k]));assert.ok(Math.abs(q.signedDistance(state.position))<1e-5);assert.ok(p.surfacePoseClear(state.position,1.8,arena.walls));}
  assert.ok(traveled>5,'patrol must find an open approach instead of staying blocked');
 }
});
test('East Patrol display interpolation follows terrain elevation from the pole toward the equator',()=>{
 const arena=geometry.generateDirectedSurfaceArena('east-patrol-grounding',[],new Map(),true),q=t.terrainQuery(arena.terrain),r=arena.radius;
 let fromNormal,toNormal;
 for(let longitude=0;longitude<Math.PI*2&&!fromNormal;longitude+=.01){
  const atLatitude=latitude=>[Math.cos(latitude)*Math.cos(longitude),Math.sin(latitude),Math.cos(latitude)*Math.sin(longitude)];
  const from=atLatitude(.62),to=atLatitude(.12);
  if(Math.abs(q.height(to)-q.height(from))>.15){fromNormal=from;toNormal=to;}
 }
 assert.ok(fromNormal&&toNormal,'fixture must contain a visible equatorward elevation change');
 const from=p.createSurfacePlayerState(fromNormal,[0,0,-1],r,arena.terrain),to=p.createSurfacePlayerState(toNormal,[0,0,-1],r,arena.terrain);
 for(const amount of [0,.1,.25,.5,.75,.9,1]){
  const displayed=presentation.interpolateSurfaceBotState(from,to,amount,arena);
  assert.ok(Math.abs(q.signedDistance(displayed.position))<1e-6,`interpolated bot sank at ${amount}`);
 }
});

test('rendered patrol boot soles contact the terrain mesh across heights and camera LODs',()=>{
 const definition=t.createTerrainDefinition(908,27),radius=definition.radius,center=[19,-7,31],scale=view.SURFACE_WORLD_SCALE;
 const cameraOffsets=[0,.16,.3];
 const candidates=[];for(const latitude of [-.65,-.3,-.12,0,.12,.3,.65])for(let longitude=0;longitude<Math.PI*2;longitude+=.15){const normal=[Math.cos(latitude)*Math.cos(longitude),Math.sin(latitude),Math.cos(latitude)*Math.sin(longitude)];candidates.push({normal,latitude,height:t.terrainHeight(definition,normal)});}
 const lowest=candidates.reduce((a,b)=>a.height<b.height?a:b),highest=candidates.reduce((a,b)=>a.height>b.height?a:b);
 const botNormals=[lowest.normal,highest.normal,candidates.find(candidate=>Math.abs(candidate.latitude-.12)<1e-6).normal,candidates.find(candidate=>Math.abs(candidate.latitude+.3)<1e-6).normal];
 const heights=botNormals.map(normal=>t.terrainHeight(definition,normal));assert.ok(Math.max(...heights)-Math.min(...heights)>.4,'fixture spans distinct terrain elevations');
 for(const normal of botNormals){
  const radial=new THREE.Vector3(...normal),tangent=new THREE.Vector3(-normal[2],0,normal[0]).projectOnPlane(radial).normalize();
  for(const offset of cameraOffsets){
   const observer=radial.clone().applyAxisAngle(tangent,offset).multiplyScalar(radius+1.65).toArray();
   const scene=new THREE.Scene(),planetRoot=new THREE.Group();planetRoot.position.set(...center);planetRoot.scale.setScalar(scale);
   const planet=new THREE.Mesh(mesh.buildTerrainMesh(definition,observer),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));planetRoot.add(planet);scene.add(planetRoot);
   scene.updateMatrixWorld(true);
   for(const axis of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
    const sample=mesh.sampleTerrainMeshSurface(planet.geometry,axis),origin=new THREE.Vector3(...center).addScaledVector(new THREE.Vector3(...axis),(radius+5)*scale),hit=new THREE.Raycaster(origin,new THREE.Vector3(...axis).negate(),0,3).intersectObject(planet,true)[0];
    assert.ok(sample&&hit,'mesh sampling covers all six cube-sphere faces');
    const hitLocal=view.worldToSurface(hit.point.toArray(),center);assert.ok(Math.abs(sample.radius-Math.hypot(...hitLocal))<1e-4,'mesh sample matches the rendered triangle');
   }
   const forward=new THREE.Vector3(-normal[2],0,normal[0]).projectOnPlane(new THREE.Vector3(...normal)).normalize().toArray();
   const start=p.createSurfacePlayerState(normal,forward,radius,definition),nextNormal=new THREE.Vector3(...normal).multiplyScalar(Math.cos(.06)).addScaledVector(new THREE.Vector3(...forward),Math.sin(.06)).normalize().toArray();
   const next=p.createSurfacePlayerState(nextNormal,forward,radius,definition),state=presentation.interpolateSurfaceBotState(start,next,.5,{radius,terrain:definition});state.velocity=forward.map(v=>v*4.5);
   const root=new THREE.Group(),model=new operative.SurfaceOperative('#ffffff');root.add(model.group);scene.add(root);
   for(let frame=0;frame<4;frame++){
    const displayed=botPresentation.poseSurfaceOperativeOnTerrain(root,model,state,{radius,terrain:definition},center,.11,planet.geometry);
    scene.updateMatrixWorld(true);
    const contactGaps=[],analyticGaps=[];
    const boots=[];model.group.traverse(object=>{if(object instanceof THREE.Mesh&&object.name==='boot')boots.push(object);});
    for(const boot of boots){boot.geometry.computeBoundingBox();const box=boot.geometry.boundingBox;
     for(const x of [box.min.x,box.max.x])for(const z of [box.min.z,box.max.z]){
      const foot=new THREE.Vector3(x,box.min.y,z).applyMatrix4(boot.matrixWorld),radial=view.worldToSurface(foot.toArray(),center),up=new THREE.Vector3(...radial).normalize();
      analyticGaps.push(t.terrainQuery(definition).signedDistance(radial));
      const clearance=2,origin=foot.clone().addScaledVector(up,clearance),ray=new THREE.Raycaster(origin,up.clone().negate(),0,5),hit=ray.intersectObject(planet,true)[0];
      if(hit)contactGaps.push((hit.distance-clearance)/scale);
     }
    }
    assert.ok(contactGaps.length>0,`boot soles must intersect the visible terrain mesh; observer=${observer}; bot=${normal}; root=${root.position.toArray()}`);
    assert.ok(Math.min(...contactGaps.map(Math.abs))<.04&&Math.min(...contactGaps)>-.08,`rendered sole contact gaps ${contactGaps.join(',')} analytic=${analyticGaps.join(',')}`);
    const displayedRoot=view.worldToSurface(root.position.toArray(),center);assert.deepEqual(displayed.position,displayedRoot,'the nameplate uses the corrected rendered root pose');
    const labelWorld=model.upper.localToWorld(new THREE.Vector3(0,.9,0)),labelPoint=view.worldToSurface(labelWorld.toArray(),center),camera=new THREE.PerspectiveCamera(55,1,.02,2000);
    camera.position.set(...view.surfaceToWorld(observer,center));camera.lookAt(labelWorld);camera.updateMatrixWorld();
    const projected=nameplates.projectSurfaceNameplate(camera,{id:'patrol',name:'West patrol',health:100,arenaKey:'test',state:displayed,labelPoint},{key:'test',center,arena:{radius,terrain:definition,walls:[]}},center);
    assert.ok(projected);assert.ok(projected.distanceTo(labelWorld.clone().project(camera))<1e-8,'the label anchor matches the rendered helmet pose');
   }
   root.traverse(object=>{if(object instanceof THREE.Mesh){object.geometry.dispose();if(Array.isArray(object.material))object.material.forEach(material=>material.dispose());else object.material.dispose();}});
   root.removeFromParent();planet.geometry.dispose();planet.material.dispose();
  }
 }
});

test('small-planet terrain has visible relief instead of only passing an upper elevation bound',()=>{
 let globalMaximumSlope=0;
 for(let seed=0;seed<1000;seed++){
  const d=t.createTerrainDefinition(seed,27),q=t.terrainQuery(d);let low=Infinity,high=-Infinity;
  for(let i=0;i<512;i++){const y=1-2*(i+.5)/512,a=i*2.399963,n=[Math.sqrt(1-y*y)*Math.cos(a),y,Math.sqrt(1-y*y)*Math.sin(a)],h=q.height(n),normal=q.normal(n);low=Math.min(low,h);high=Math.max(high,h);const slope=Math.acos(Math.min(1,normal.reduce((sum,v,k)=>sum+v*n[k],0)))*180/Math.PI;assert.ok(slope<=25);globalMaximumSlope=Math.max(globalMaximumSlope,slope);}
  assert.ok(high-low>=1.6,`seed ${seed} is too flat: ${high-low}`);
 }
 assert.ok(globalMaximumSlope>15,'landforms should have readable shoulders');
 assert.equal(t.validTerrainDefinition({...t.createTerrainDefinition(1,27),version:1}),false);
});
test('linked walls make measurable progress around ruin blockers and unreachable route-centre bearings',()=>{
 const ids=Array.from({length:6},(_,i)=>'file'+i),directions=new Map(ids.map((id,i)=>[id,[Math.cos(i),.2,Math.sin(i)]])),arena=geometry.generateDirectedSurfaceArena('Surface Smoke/Surface Smoke Hub.md',ids,directions,true),motion=new cover.SurfaceCoverMotion(arena),before=motion.walls.map(w=>[...w.normal]);
 const target=new Map(ids.map((id,i)=>[id,[Math.cos(i+.5),.2,Math.sin(i+.5)]]));
 for(let tick=0;tick<600;tick++)motion.step(target,[],1/60);
 const moved=motion.walls.map((w,i)=>Math.hypot(...w.normal.map((v,k)=>(v-before[i][k])*27)));
 assert.ok(moved.every(distance=>distance>.25),JSON.stringify(moved));assert.ok(moved.filter(distance=>distance>1).length>=10);
 assert.equal(motion.walls.length,12);
});
