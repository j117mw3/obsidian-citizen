import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:`export * as THREE from 'three';export * from './src/surfaceOcclusion';export * from './src/surfaceSpatial';export * from './src/surfaceTerrain';export * from './src/surfaceCollision';export * from './src/surfaceGeometry';export * from './src/surfaceSky';export * from './src/surfaceCover';export * from './src/surface';export * from './src/gpuFrameTimer';export * from './src/performanceCapture';export * from './dev/surface-sky-fixture';export {ConstellationRenderer} from './src/renderer';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const unit=v=>{const l=Math.hypot(...v);return v.map(n=>n/l);};
function bruteBox(start,end,wall,radius){
 const box=m.surfaceWallBox(wall,radius),relative=start.map((v,k)=>v-box.center[k]),delta=end.map((v,k)=>v-start[k]);
 const origin=new m.THREE.Vector3(...box.axes.map(axis=>axis.reduce((sum,v,k)=>sum+v*relative[k],0))),direction=new m.THREE.Vector3(...box.axes.map(axis=>axis.reduce((sum,v,k)=>sum+v*delta[k],0))),length=direction.length();
 const bounds=new m.THREE.Box3(new m.THREE.Vector3(...box.half).negate(),new m.THREE.Vector3(...box.half));
 if(bounds.containsPoint(origin))return true;if(length<1e-9)return false;
 const point=new m.THREE.Ray(origin,direction.divideScalar(length)).intersectBox(bounds,new m.THREE.Vector3());return point!==null&&point.distanceTo(origin)<=length+1e-7;
}
test('bounded label rays agree with brute-force terrain and walls, including generated ruins and motion',()=>{
 const arena=m.generateDirectedSurfaceArena('sky-regression',Array.from({length:6},(_,i)=>'n'+i),new Map(),true),motion=new m.SurfaceCoverMotion(arena),query=m.terrainQuery(arena.terrain),radius=arena.radius;
 const verify=()=>{const ruins=query.staticNear([radius,0,0],radius*4),all=[...arena.walls,...ruins];
  for(let i=0;i<240;i++){const normal=unit([Math.sin(i*1.17),Math.cos(i*.37),Math.sin(i*.71)]),start=normal.map(v=>v*(radius+3.5)),target=unit([Math.cos(i*.47),Math.sin(i*.81),Math.cos(i*.29)]),end=target.map(v=>v*(i%2?radius+8:5000));
   const expected=query.ray(start,end)!==null||all.some(w=>bruteBox(start,end,w,radius));assert.equal(m.isSurfaceSegmentOccluded(start,end,arena.walls,radius),expected,`ray ${i}`);}
  for(const wall of all.slice(0,20)){const box=m.surfaceWallBox(wall,radius),start=box.center.map((v,k)=>v+box.axes[2][k]*3),end=box.center.map((v,k)=>v-box.axes[2][k]*3);assert.equal(m.isSurfaceSegmentOccluded(start,end,arena.walls,radius),true);}
 };
 verify();const targets=new Map(Array.from({length:6},(_,i)=>['n'+i,[Math.cos(i+.5),.3,Math.sin(i+.5)]]));for(let tick=0;tick<60;tick++)motion.step(targets,[],1/60);verify();
});
test('distant sky targets cannot expand terrain sampling or grid traversal after leaving bounds',()=>{
 const arena=m.generateDirectedSurfaceArena('hub',Array.from({length:6},(_,i)=>'n'+i),new Map(),true),start=[0,28.65,0],results=[];
 for(const distance of [1000,10000,100000,1000000]){const stats=m.emptyOcclusionStats();assert.equal(m.isSurfaceSegmentOccluded(start,[distance,28.65+distance,distance],arena.walls,arena.radius,stats),false);results.push(stats);}
 assert.ok(results.every(s=>s.visitedCells<300&&s.terrainSamples<100));assert.equal(new Set(results.map(s=>s.visitedCells)).size,1);assert.ok(Math.max(...results.map(s=>s.terrainSamples))-Math.min(...results.map(s=>s.terrainSamples))<=1);
 assert.equal(m.clipSurfaceSegment([40,40,0],[100,100,0],30),null);
 assert.ok(m.clipSurfaceSegment([-40,30,0],[40,30,0],30),'a sphere tangent is retained conservatively');
 assert.ok(m.clipSurfaceSegment([0,0,0],[100,0,0],30),'inside-camera interval retained');
 assert.equal(m.isSurfaceSegmentOccluded([-40,27.0001,0],[40,27.0001,0],[],27),false,'bare sphere must not expand into a clear grazing ray');
});
test('segment grid handles negative coordinates, zero length and exact boundary crossings without cubic scans',()=>{
 const grid=new m.SurfaceSpatialGrid(8);grid.add('origin',[0,0,0],.1);grid.add('corner',[8,8,8],.1);grid.add('negative',[-8,-8,-8],.1);grid.add('far',[5000,-5000,5000],.1);
 for(const [a,b]of[[[-16,-16,-16],[16,16,16]],[[16,16,16],[-16,-16,-16]],[[-8,-8,-8],[-8,-8,-8]]]){const stats={visitedCells:0},hits=grid.querySegment(a,b,stats);assert.ok(hits.includes('negative'));assert.equal(new Set(hits).size,hits.length);assert.ok(stats.visitedCells<200);}
 assert.ok(grid.querySegment([0,8,8],[16,8,8]).includes('corner'));
 const stats={visitedCells:0};grid.querySegment([-1000,-1000,-1000],[1000,1000,1000],stats);assert.ok(stats.visitedCells<10000);
});
test('sky LOD has hysteresis, preserves occupied detail, and restores every visibility flag',()=>{
 assert.equal(m.nextSkyLod(false,31,false),true);assert.equal(m.nextSkyLod(true,47,false),true);assert.equal(m.nextSkyLod(true,48,false),false);assert.equal(m.nextSkyLod(false,33,false),false);assert.equal(m.nextSkyLod(true,1,true),false);
 const presentation=new m.SurfaceSkyPresentation(),group=new m.THREE.Group();group.userData.radius=1;group.userData.renderRadius=1;
 const detail=new m.THREE.Mesh(),pickup=new m.THREE.Group(),proxy=new m.THREE.Mesh();pickup.visible=false;proxy.name='surface-sky-proxy';proxy.visible=false;group.add(detail,pickup,proxy);
 const camera=new m.THREE.PerspectiveCamera(60,1,.1,1000);camera.position.z=100;camera.lookAt(0,0,0);
 assert.equal(presentation.apply([group],camera,null,600,true,false),1);assert.equal(detail.visible,false);assert.equal(proxy.visible,true);presentation.restore();assert.equal(detail.visible,true);assert.equal(pickup.visible,false);assert.equal(proxy.visible,false);
 presentation.apply([group],camera,group,600,true,true);assert.equal(detail.visible,true);assert.equal(proxy.visible,false);presentation.restore();
 group.position.z=200;assert.equal(presentation.apply([group],camera,null,600,true,false),0);assert.equal(group.visible,false);presentation.restore();assert.equal(group.visible,true);
});
test('automatic LOD needs a stable matched capture with at least 15 percent and 1 ms improvement',()=>{
 const baseline={cpuMs:10,gpuMs:0,pose:[0,27,0],view:[0,0,0,1],key:'same',stable:true};assert.equal(m.skyDetailImproves(baseline,{...baseline,cpuMs:8}),true);
 for(const candidate of [{...baseline,cpuMs:9.5},{...baseline,cpuMs:8,stable:false},{...baseline,cpuMs:8,key:'other'},{...baseline,cpuMs:8,pose:[1,27,0]}])assert.equal(m.skyDetailImproves(baseline,candidate),false);
});
test('8, 24 and 64-group fixtures produce that many real selected planets at 850 nodes',()=>{
 for(const count of [8,24,64]){const fixture=m.makeSkyFixture(850,count,128);assert.equal(fixture.data.nodes.length,850);assert.equal(m.selectMainNodeIds(fixture.data.nodes).size,count);assert.deepEqual([...m.selectMainNodeIds(fixture.data.nodes)].sort(),fixture.hubs.sort());}
});
test('all-label diagnostic bypasses labels, nameplate ray checks and player-indicator ray checks',()=>{
 const renderer=Object.create(m.ConstellationRenderer.prototype);renderer.performanceCapture={scenario:'sky-no-labels'};renderer.labelLayer={hidden:false};renderer.indicatorLayer={hidden:false};let cleared=0;renderer.surfaceNameplates={clear(){cleared++;}};
 renderer.updateLabels();renderer.updateSurfaceNameplates();renderer.updatePlayerIndicators();assert.equal(renderer.labelLayer.hidden,true);assert.equal(renderer.indicatorLayer.hidden,true);assert.equal(cleared,1);
});
test('GPU timer remains asynchronous, bounds outstanding queries, and discards disjoint samples',()=>{
 let ready=false,disjoint=false,deleted=0,created=0;const gl={createQuery(){created++;return{};},getExtension(){return{TIME_ELAPSED_EXT:1,GPU_DISJOINT_EXT:2};},isContextLost(){return false;},beginQuery(){},endQuery(){},getParameter(){return disjoint;},QUERY_RESULT_AVAILABLE:3,QUERY_RESULT:4,getQueryParameter(_q,key){return key===3?ready:2000000;},deleteQuery(){deleted++;}};
 const timer=new m.GpuFrameTimer(gl),frames=[];for(let i=0;i<12;i++){const f={gpuMs:null};timer.begin();timer.end(f);frames.push(f);}assert.equal(created,8);timer.poll();assert.ok(frames.every(f=>f.gpuMs===null));ready=true;timer.poll();assert.equal(frames[0].gpuMs,2);assert.equal(deleted,8);
 const invalid={gpuMs:null};timer.begin();timer.end(invalid);disjoint=true;timer.poll();assert.equal(invalid.gpuMs,null);assert.equal(deleted,9);timer.dispose();
 const unsupported=new m.GpuFrameTimer({getExtension(){return null;}});assert.equal(unsupported.available,false);unsupported.begin();unsupported.poll();unsupported.dispose();
});

test('graph pointer cleanup cannot re-enable orbit controls during surface or flight play',()=>{
 const renderer=Object.create(m.ConstellationRenderer.prototype);renderer.controls={enabled:false};renderer.canvas={releasePointerCapture(){}};
 for(const [surface,flight]of[[true,false],[false,true],[true,true],[false,false]]){
  renderer.surfacePilot={active:surface};renderer.pilot={active:flight};
  renderer.endPress(null);assert.equal(renderer.controls.enabled,!surface&&!flight);
  renderer.endPress({id:1});assert.equal(renderer.controls.enabled,!surface&&!flight);
 }
});
