import {build} from 'esbuild';
import {writeFile,readFile} from 'node:fs/promises';
import {cpus,totalmem} from 'node:os';
import * as baseline from '../dist/terrain-baseline-0.6.8.mjs';
const result=await build({stdin:{contents:`export * as surface from './src/surface';export * as surfacePhysics from './src/surfacePhysics';export * as surfaceGeometry from './src/surfaceGeometry';export * as surfaceVisuals from './src/surfaceVisuals';export * as surfaceCombat from './src/surfaceCombat';export * as terrainMesh from './src/surfaceTerrainMesh';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const candidate=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
const measure=(action,count=1)=>{const times=[];let value;for(let i=0;i<count;i++){const start=performance.now();value=action();times.push(performance.now()-start);}times.sort((a,b)=>a-b);return {value,medianMs:times[Math.floor(times.length/2)],maxMs:times.at(-1)}};
const neutral={moveX:0,moveY:0,sprint:false,jump:false,crouch:false,yawDelta:0,pitchDelta:0,lean:0};
const candidateVersion=JSON.parse(await readFile("manifest.json","utf8")).version;
const reports=[];
for(const [version,api] of [['0.6.8',baseline],[candidateVersion,candidate]])for(const degree of [0,6,1000,19999]){
 const ids=Array.from({length:degree},(_,i)=>`n-00000000-0000-4000-8000-${String(i).padStart(12,'0')}`);
 global.gc?.();const memoryBefore=process.memoryUsage().heapUsed;
 const generation=measure(()=>api.surfaceGeometry.generateDirectedSurfaceArena('hub',ids,new Map(),version===candidateVersion));const arena=generation.value;
 const construction=measure(()=>api.surfaceVisuals.createSurfaceArenaVisual(arena));const root=construction.value;
 let draws=0,triangles=0,geometryBytes=0;const seen=new Set();root.traverse(o=>{if(o.isMesh||o.isLineSegments)draws++;if(o.geometry&&!seen.has(o.geometry)){seen.add(o.geometry);const g=o.geometry;geometryBytes+=Object.values(g.attributes).reduce((sum,a)=>sum+a.array.byteLength,0)+(g.index?.array.byteLength??0);if(o.isMesh)triangles+=(g.index?.count??g.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);}});
 const physics=measure(()=>{let states=Array.from({length:4},()=>api.surfacePhysics.createSurfacePlayerState([0,1,0],[1,0,0],arena.radius,arena.terrain));for(let frame=0;frame<180;frame++)states=states.map((s,i)=>api.surfacePhysics.stepSurfacePlayer(s,{...neutral,moveY:frame<120?1:0,jump:frame===90},1/60,arena.walls));return states;},3);
 const frameCost=physics.medianMs/180;
 const local=version===candidateVersion?measure(()=>api.terrainMesh.buildTerrainMesh(arena.terrain,[arena.radius+1.65,0,0])):null;
 reports.push({version,degree,radius:arena.radius,generationMs:generation.medianMs,visualConstructionMs:construction.medianMs,localMeshPreparationMs:local?.medianMs??null,localVertices:local?.value.getAttribute('position').count??null,fourPlayerPhysicsFrameMs:frameCost,estimatedDrawCalls:draws,estimatedTriangles:triangles,geometryBytes,heapDeltaBytes:process.memoryUsage().heapUsed-memoryBefore});
 local?.value.dispose();root.traverse(o=>{o.geometry?.dispose();if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();});
 console.log(version,degree,'generation',generation.medianMs.toFixed(1),'physics/frame',frameCost.toFixed(3),'localMesh',local?.medianMs.toFixed(1));
}
await writeFile(`docs/terrain-benchmark-${candidateVersion}.json`,JSON.stringify({at:new Date().toISOString(),cpu:cpus()[0].model,memoryBytes:totalmem(),node:process.version,scope:'Same-process headless CPU/heap/geometry benchmarks. Estimated scene draw calls; no GPU rendering, native Obsidian FPS, or visual observation. Heap deltas include transient allocations and JIT.',reports},null,2)+'\n');
