import test from "node:test";
import assert from "node:assert/strict";
import {build} from "esbuild";
import * as THREE from "three";
const names=["surface","surfaceCover","surfaceCoverWire","surfaceGeometry","surfacePhysics","surfaceCollision","surfaceCombat","surfaceWorld","surfaceAuthority","surfaceVisuals","surfaceSnapshotWire","surfaceGeometryWire","renderer"];
const built=await build({stdin:{contents:names.map(n=>`export * as ${n} from "./src/${n}";`).join("\n"),resolveDir:process.cwd()},bundle:true,platform:"node",format:"esm",target:"node22",write:false});
const modules=await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`);
const load=async name=>modules[name];
const {SurfaceCoverMotion}=await load("surfaceCover"),{generateDirectedSurfaceArena,pairedSurfaceBearing}=await load("surfaceGeometry"),physics=await load("surfacePhysics"),collision=await load("surfaceCollision"),combat=await load("surfaceCombat"),visuals=await load("surfaceVisuals"),wire=await load("surfaceCoverWire"),{SurfaceAuthority,validSurfaceNetworkSnapshot}=await load("surfaceAuthority"),{SurfaceSnapshotWire}=await load("surfaceSnapshotWire"),geometryWire=await load("surfaceGeometryWire"),{ConstellationRenderer}=await load("renderer");
const distance=(a,b)=>Math.hypot(...a.map((n,i)=>n-b[i]));
const rotate=(n,angle)=>[n[0]*Math.cos(angle)-n[2]*Math.sin(angle),n[1],n[0]*Math.sin(angle)+n[2]*Math.cos(angle)];
const dispose=root=>root.traverse(o=>{o.geometry?.dispose();for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])m.dispose();});

test("two associated walls per file track its bearing slowly on the sphere without regenerating pickups",()=>{
 const arena=generateDirectedSurfaceArena("hub",["a"],new Map([["a",[1,0,0]]])),saved=structuredClone(arena);arena.pickups=[];
 const motion=new SurfaceCoverMotion(arena),initial=motion.walls.map(w=>[...w.normal]),direction=rotate([1,0,0],.35),map=new Map([["a",direction]]);
 assert.equal(motion.walls.length,2);assert.ok(motion.walls.every(w=>w.connectionId==="a"));
 for(let tick=0;tick<600;tick++){
  const before=motion.walls.map(w=>[...w.normal]);motion.step(map,[],1/60);
  for(let i=0;i<2;i++){assert.ok(Math.abs(Math.hypot(...motion.walls[i].normal)-1)<1e-10);assert.ok(distance(before[i],motion.walls[i].normal)*27<=.8/60+1e-7);}
  assert.ok(distance(motion.walls[0].normal,motion.walls[1].normal)*27>4.49);
 }
 for(let i=0;i<2;i++){assert.ok(distance(initial[i],motion.walls[i].normal)*27>3);assert.ok(distance(motion.walls[i].normal,pairedSurfaceBearing(direction,i,27))<distance(initial[i],pairedSurfaceBearing(direction,i,27)));}
 assert.deepEqual(arena.walls,saved.walls,"baseline geometry remains immutable");
});

test("moving cover stops before a player, leaves exits clear and avoids fixed pickups",()=>{
 const base=generateDirectedSurfaceArena("hub",["a"],new Map([["a",[1,0,0]]]));base.walls=[base.walls[0]];base.pickups=[];
 const motion=new SurfaceCoverMotion(base),player=physics.createSurfacePlayerState(rotate(base.walls[0].normal,.14)),directions=new Map([["a",rotate([1,0,0],.6)]]);
 assert.equal(collision.surfaceCapsuleWallContact(player.position,1.8,motion.walls[0]),null);
 for(let tick=0;tick<1200;tick++){motion.step(directions,[player],1/60);assert.equal(collision.surfaceCapsuleWallContact(player.position,1.8,motion.walls[0]),null);}
 assert.ok(distance(base.walls[0].normal,motion.walls[0].normal)*27<3,"wall waits instead of pushing the player");
 const polar=new SurfaceCoverMotion(base);
 for(let tick=0;tick<3000;tick++)polar.step(new Map([["a",[0,1,0]]]),[],1/60);
 assert.ok(Math.acos(Math.abs(polar.walls[0].normal[1]))*27>=6);
 const pickupNormal=rotate(base.walls[0].normal,.2);base.pickups=[{normal:pickupNormal}];const aroundPickup=new SurfaceCoverMotion(base);
 for(let tick=0;tick<1500;tick++)aroundPickup.step(directions,[],1/60);
 assert.ok(distance(aroundPickup.walls[0].normal,pickupNormal)*27>=2.74);
});

test("moving collision indices, solid instances and wire outlines use the same wall pose",()=>{
 const arena=generateDirectedSurfaceArena("hub",Array.from({length:10},(_,i)=>`n-${i}`)),motion=new SurfaceCoverMotion(arena),root=visuals.createSurfaceArenaVisual(arena),wall=motion.walls[0];
 const oldStart=wall.normal.map(n=>n*31);collision.nearbySurfaceWalls(oldStart,oldStart,motion.walls,27,3);
 motion.setWall(0,[0,.4,Math.sqrt(.84)]);const moved=motion.walls[0],start=moved.normal.map(n=>n*31),end=moved.normal.map(n=>n*26);
 assert.ok(collision.nearbySurfaceWalls(start,end,motion.walls,27).includes(moved));assert.equal(combat.traceSurfaceSegment(start,end,motion.walls,[]).kind,"wall");
 visuals.updateSurfaceCoverVisual(root,{...arena,walls:motion.walls});const cover=root.getObjectByName("surface-wall-instances"),lines=root.getObjectByName("surface-wall-outlines"),matrix=new THREE.Matrix4();cover.getMatrixAt(0,matrix);
 const center=new THREE.Vector3().setFromMatrixPosition(matrix);assert.ok(center.distanceTo(new THREE.Vector3(...moved.normal).multiplyScalar(27+moved.height/2))<1e-4);
 for(let col=0;col<4;col++)for(let row=0;row<4;row++)assert.equal(lines.geometry.getAttribute(`wallColumn${col}`).array[row],matrix.elements[col*4+row]);
 const geometry=cover.geometry;visuals.updateSurfaceCoverVisual(root,{...arena,walls:motion.walls});assert.equal(cover.geometry,geometry);assert.equal(cover.count,20);dispose(root);
});

const OWNER="11111111-1111-4111-8111-111111111111",PILOT="22222222-2222-4222-8222-222222222222",HUB="n-33333333-3333-4333-8333-333333333333",NOTE="n-44444444-4444-4444-8444-444444444444",KEY=`${OWNER}/${HUB}`;
function worldFixture(){const authority=new SurfaceAuthority(),topology={revision:1,nodes:[{id:HUB,group:0,degree:1,dockable:true},{id:NOTE,group:0,degree:1,dockable:false}],links:[[HUB,NOTE],[NOTE,HUB]]};authority.setOwnerMap(OWNER,topology,new Float32Array([0,0,0,10,0,0]));authority.addPlayer(PILOT,{position:[0,0,38*6/27],rotation:[0,0,0,1],velocity:[0,0,0]});assert.equal(authority.dock(PILOT,OWNER,HUB,4000),true);return {authority,topology};}

test("host motion preserves center stability, timers and immutable geometry tokens while publishing bounded anonymous poses",()=>{
 const {authority,topology}=worldFixture(),world=authority.world;
 world.arenas.get(KEY).pickups[0]={available:false,respawnAt:22000};authority.step(1/60,8000);
 const original=authority.snapshot(1,1,8000),baseline=structuredClone(original.arenas[0].arena),player=world.getPlayer(PILOT).surface,host=new SurfaceSnapshotWire(),guest=new SurfaceSnapshotWire();
 const first=host.encode(original);assert.ok(guest.decode(first,1).snapshot);host.acknowledge([first.arenas[0].geometryId]);
 authority.setOwnerMap(OWNER,topology,new Float32Array([100,20,-30,100+10*Math.cos(.4),20,-30+10*Math.sin(.4)]));
 for(let tick=0;tick<120;tick++)authority.step(1/60,8017+tick*17);
 const current=authority.snapshot(1,2,10040);assert.equal(validSurfaceNetworkSnapshot(current,1),true);assert.deepEqual(current.arenas[0].arena,baseline);assert.deepEqual(world.getPlayer(PILOT).surface,player);
 assert.deepEqual(current.arenas[0].center,[100,20,-30]);assert.equal(world.getPickups(KEY,10040)[0].respawnAt,22000);
 const packet=host.encode(current);assert.equal(packet.arenas[0].geometryId,first.arenas[0].geometryId);assert.equal(typeof packet.arenas[0].arena,"number");assert.ok(JSON.stringify(packet).length<128000);
 const decoded=guest.decode(packet,1).snapshot;assert.ok(decoded);const rows=wire.decodeCoverPoses(decoded.cover[0].poses,2);assert.equal(rows.length,2);
 for(const [i,n] of rows)assert.ok(distance(n,world.getArena(KEY).arena.walls[i].normal)<1e-6);
 assert.ok(distance(world.getArena(KEY).arena.walls[0].normal,baseline.walls[0].normal)>.02);
 const cp=geometryWire.parseSurfaceTransfer(geometryWire.stringifySurfaceTransfer(authority.checkpoint(10040),32*1024*1024),32*1024*1024),restored=new SurfaceAuthority();assert.equal(restored.restoreCheckpoint(cp,11000,960),true);
 for(let i=0;i<2;i++){const restoredWall=restored.world.getArena(KEY).arena.walls[i],wall=world.getArena(KEY).arena.walls[i];assert.ok(distance(restoredWall.normal,wall.normal)<1e-6);assert.ok(distance(restoredWall.tangent,wall.tangent)<1e-6);assert.equal(restoredWall.connectionId,wall.connectionId);assert.equal(restoredWall.height,wall.height);}assert.equal(restored.world.getPickups(KEY,11000)[0].respawnAt,22000);
 const renderer=Object.create(ConstellationRenderer.prototype),replica=renderer.applyRoomCover(decoded.arenas[0],decoded.cover);assert.equal(replica.arena.walls.length,2);
 for(const [i,n] of rows)assert.ok(distance(replica.arena.walls[i].normal,n)<1e-6);
 for(const bad of ["!",btoa("short"),"x".repeat(50000)])assert.equal(wire.decodeCoverPoses(bad,2),null);
 const bad=structuredClone(current);bad.cover[0].poses=btoa("bad");assert.equal(validSurfaceNetworkSnapshot(bad,1),false);
 const view=new DataView(new Uint8Array(14).buffer);view.setUint16(0,10,true);assert.equal(wire.decodeCoverPoses(btoa(String.fromCharCode(...new Uint8Array(view.buffer))),2),null);
});

test("mineral ground detail is deterministic, instanced and below the step allowance",()=>{
 const arena=generateDirectedSurfaceArena("minerals",["a"]),a=visuals.createSurfaceArenaVisual(arena),b=visuals.createSurfaceArenaVisual(arena),aa=a.getObjectByName("surface-mineral-scree"),bb=b.getObjectByName("surface-mineral-scree");
 assert.ok(aa.count>=72);assert.deepEqual(Array.from(aa.instanceMatrix.array),Array.from(bb.instanceMatrix.array));assert.ok(a.children.length<20);
 const matrix=new THREE.Matrix4(),position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();for(let i=0;i<aa.count;i++){aa.getMatrixAt(i,matrix);matrix.decompose(position,rotation,scale);assert.ok(scale.y<=.116);assert.ok(Math.acos(Math.abs(position.y)/position.length())*27>=6.9);}
 dispose(a);dispose(b);
});

test("delayed 200 ms RTT pose delivery remains bounded and converges without rebuilding geometry",()=>{
 const arena=generateDirectedSurfaceArena("delayed",["a"],new Map([["a",[1,0,0]]]));arena.pickups=[];
 const host=new SurfaceCoverMotion(arena),client=new SurfaceCoverMotion(arena),directions=new Map([["a",rotate([1,0,0],.3)]]),queue=[];let maxError=0;
 const view=walls=>({key:"arena",arena:{...arena,walls}}),player={arenaKey:"arena",health:100,surface:physics.createSurfacePlayerState()};
 for(let tick=0;tick<900;tick++){
  const now=tick/60;host.step(directions,[],1/60);
  if(tick%3===0)queue.push({at:now+.1+(tick%2?.016:0),packets:wire.encodeCoverPoses([view(host.walls)],[player])});
  while(queue.length&&queue[0].at<=now){const packet=queue.shift().packets[0];client.networkTargets.clear();for(const [index,normal]of wire.decodeCoverPoses(packet.poses,2))client.networkTargets.set(index,normal);}
  client.step(new Map(),[],1/60,true);
  for(let i=0;i<2;i++)maxError=Math.max(maxError,distance(client.walls[i].normal,host.walls[i].normal)*27);
 }
 assert.ok(maxError<.25,`200 ms RTT plus jitter: maximum wall disagreement ${maxError}`);for(let i=0;i<2;i++)assert.ok(distance(client.walls[i].normal,host.walls[i].normal)*27<.01);
});

test("geometry transfer definitions deduplicate repeated arenas and reject dangling or duplicate references",()=>{
 const arena=generateDirectedSurfaceArena("shared",["a"]),record={arenas:Array(28).fill(arena)},encoded=geometryWire.stringifySurfaceTransfer(record,4*1024*1024);
 assert.ok(encoded.includes("surfaceGeometryRef"));assert.deepEqual(geometryWire.parseSurfaceTransfer(encoded,4*1024*1024),record);
 assert.throws(()=>geometryWire.parseSurfaceTransfer('{"surfaceGeometryRef":1}',1024),/reference/);
 assert.throws(()=>geometryWire.parseSurfaceTransfer('{"surfaceGeometryId":0,"definition":{}}',1024),/definition/);
 const definition=JSON.parse(geometryWire.stringifySurfaceTransfer(arena,4*1024*1024));assert.throws(()=>geometryWire.parseSurfaceTransfer(JSON.stringify([definition,definition]),4*1024*1024),/definition/);
});

test("moving cover respects a leaned upper hitbox even when the upright body is clear",async()=>{
 const {surfaceBodySegments}=await load("surface");
 for(const crouched of [false,true]){
  const base=generateDirectedSurfaceArena("leaned",["a"],new Map([["a",[1,0,0]]]));base.walls=[base.walls[0]];base.pickups=[];
  const motion=new SurfaceCoverMotion(base),n=rotate(base.walls[0].normal,.14);n[1]=.65/27;const len=Math.hypot(...n),normal=n.map(v=>v/len),player=physics.createSurfacePlayerState(normal);
  Object.assign(player,{crouched,lean:.35});const up=player.position.map(v=>v/27),f=player.forward,right=new THREE.Vector3(...f).cross(new THREE.Vector3(...up)).normalize().toArray(),[bottom,height]=surfaceBodySegments(crouched)[1],upper=player.position.map((v,k)=>v+up[k]*bottom+right[k]*player.lean);
  assert.equal(collision.surfaceCapsuleWallContact(upper,height,motion.walls[0],up),null);
  for(let tick=0;tick<1200;tick++){
   motion.step(new Map([["a",rotate([1,0,0],.6)]]),[player],1/60);
   assert.equal(collision.surfaceCapsuleWallContact(player.position,crouched?1.1:1.8,motion.walls[0]),null,"upright body alone would allow this wall to pass");
   assert.equal(collision.surfaceCapsuleWallContact(upper,height,motion.walls[0],up),null,"leaned upper body must remain clear");
  }
  assert.ok(distance(base.walls[0].normal,motion.walls[0].normal)*27<3);
 }
});

test("maximum-degree moved geometry retains bounded precision and transfer size",()=>{
 const ids=Array.from({length:19999},(_,i)=>`n-00000000-0000-4000-8000-${String(i).padStart(12,"0")}`),arena=generateDirectedSurfaceArena(HUB,ids);
 const moved={...arena,walls:arena.walls.map(w=>{const normal=rotate(w.normal,.0137),tangent=new THREE.Vector3(-normal[2],0,normal[0]).normalize().toArray();return {...w,normal,tangent};})};
 const encoded=geometryWire.stringifySurfaceTransfer(moved,4*1024*1024),restored=geometryWire.parseSurfaceTransfer(encoded,4*1024*1024);
 assert.ok(Buffer.byteLength(encoded)<=4*1024*1024);assert.equal(restored.walls.length,39998);
 for(let i=0;i<moved.walls.length;i++)assert.ok(distance(restored.walls[i].normal,moved.walls[i].normal)*moved.radius<.001);
});

test("production solo world and displayed frame move linked terrain walls without rebuilding the arena",async()=>{
 const {SurfaceWorld}=await load("surfaceWorld"),world=new SurfaceWorld({terrain:true}),ids=Array.from({length:6},(_,i)=>`file${i}`),topology={revision:1,nodes:[{id:"hub",dockable:true,group:0,degree:6},...ids.map(id=>({id,dockable:false,group:0,degree:1}))],links:ids.map(id=>["hub",id])};
 const nodes=topology.nodes.map((node,i)=>({id:node.id,x:i?Math.cos(i)*10:0,y:i?2:0,z:i?Math.sin(i)*10:0}));
 const positions=()=>new Float32Array(nodes.flatMap(n=>[n.x,n.y,n.z]));world.setOwnerMap("solo",topology,positions());world.addPlayer("solo",{position:[0,0,38],rotation:[0,0,0,1],velocity:[0,0,0]});assert.ok(world.dock("solo","solo/hub",4000));
 const initial=world.getArena("solo/hub"),root=visuals.createSurfaceArenaVisual(initial.arena),mesh=root.getObjectByName("surface-wall-instances"),before=initial.arena.walls.map(w=>[...w.normal]),renderer=Object.create(ConstellationRenderer.prototype);
 Object.assign(renderer,{multiplayer:false,surfaceWorld:world,idIndex:new Map([["hub",0]]),sim:{nodes},worldNodes:nodes,localSurfaceGroups:new Map([["hub",{group:root,index:0}]]),surfaceDisplayCenters:new Map(),surfacePilot:{surfacePosition:world.getPlayer("solo").surface.position},updateParkedSurfaceShip(){}});
 for(let tick=0;tick<600;tick++){
  const turn=Math.min(.5,tick/600);nodes[0].x=Math.sin(tick/60)*3;
  for(let i=1;i<nodes.length;i++){nodes[i].x=nodes[0].x+Math.cos(i+turn)*10;nodes[i].z=Math.sin(i+turn)*10;}
  if(tick%6===0)world.setOwnerMap("solo",topology,positions());world.moveCover(1/60);renderer.resolveSurfaceDisplayFrames();
 }
 const final=world.getArena("solo/hub");assert.equal(final.revision,initial.revision);assert.equal(root.getObjectByName("surface-wall-instances"),mesh);
 const moved=final.arena.walls.map((w,i)=>distance(w.normal,before[i])*27);assert.ok(moved.filter(d=>d>.3).length>=6,JSON.stringify(moved));
 const matrix=new THREE.Matrix4();final.arena.walls.forEach((wall,i)=>{mesh.getMatrixAt(i,matrix);const p=new THREE.Vector3().setFromMatrixPosition(matrix),box=collision.surfaceWallBox(wall,27);assert.ok(p.distanceTo(new THREE.Vector3(...box.center))<.00001);});dispose(root);
});
