export const PERFORMANCE_SCENARIOS = ["standing","looking","walking","combat","sky","horizon","floor","sky-no-labels","sky-no-graph","sky-no-distant-details","sky-no-bloom","sky-bloom"] as const;
export type PerformanceScenario = typeof PERFORMANCE_SCENARIOS[number];
export function performanceOverrides(scenario?:PerformanceScenario) {
  return {noLabels:scenario==="sky-no-labels",noGraph:scenario==="sky-no-graph",noDistantDetails:scenario==="sky-no-distant-details",bloom:scenario==="sky-bloom"?"on":scenario==="sky-no-bloom"?"off":"settings"} as const;
}
export interface PerformanceFrame {
  rafMs:number;workMs:number;worldMs:number;graphMs:number;surfaceMs:number;terrainMs:number;labelsMs:number;renderMs:number;calls:number;triangles:number;
  labelQueryMs?:number;terrainSamples?:number;visitedCells?:number;occlusionQueries?:number;visiblePlanets?:number;worldCalls?:number;worldTriangles?:number;points?:number;lines?:number;geometryCount?:number;gpuMs?:number|null;
}
export interface PerformanceMetadata {
  pluginVersion:string;installedBundleSha256:string|null;graphNodes:number;graphLinks:number;planetRadius:number|null;terrainVertices:number;sceneGeometries:number;sceneVertices:number;
  viewport:{width:number;height:number;pixelRatio:number};motion:string;bloom:boolean;effectiveBloom?:boolean;fov?:number;glow?:number;gpuTimerAvailable?:boolean;lodEnabled?:boolean;cameraPosition?:number[];cameraQuaternion?:number[];
}
export const percentile=(values:number[],q:number):number=>{if(!values.length)return 0;const sorted=[...values].sort((a,b)=>a-b);return Math.round(sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(q*sorted.length)-1))]*100)/100;};
export class PerformanceCapture {
  readonly startedAt=new Date().toISOString();
  readonly frames:PerformanceFrame[]=[];
  private readonly startedAtMs=performance.now();
  constructor(readonly scenario:PerformanceScenario,readonly metadata:PerformanceMetadata,readonly durationMs=20000){}
  record(frame:PerformanceFrame):void{const elapsed=performance.now()-this.startedAtMs;if(elapsed>=5000&&elapsed<this.durationMs)this.frames.push(frame);}
  p95(key:keyof PerformanceFrame):number{return percentile(this.frames.flatMap(frame=>typeof frame[key]==="number"?[frame[key]]:[]),.95);}
  private summary(key:keyof PerformanceFrame){const values=this.frames.flatMap(frame=>typeof frame[key]==="number"?[frame[key]]:[]);return{samples:values.length,median:percentile(values,.5),p95:percentile(values,.95),p99:percentile(values,.99),max:percentile(values,1)};}
  report():object{return{
    format:2,scenario:this.scenario,overrides:performanceOverrides(this.scenario),startedAt:this.startedAt,durationMs:this.durationMs,warmupMs:5000,sampledFrames:this.frames.length,metadata:this.metadata,
    frameMs:{rafDelta:this.summary("rafMs"),mainThreadWork:this.summary("workMs")},
    subsystems:Object.fromEntries((["worldMs","graphMs","surfaceMs","terrainMs","labelsMs","labelQueryMs","renderMs"] as const).map(key=>[key,this.summary(key)])),
    occlusion:Object.fromEntries((["occlusionQueries","terrainSamples","visitedCells"] as const).map(key=>[key,this.summary(key)])),
    render:Object.fromEntries((["calls","triangles","worldCalls","worldTriangles","points","lines","geometryCount","visiblePlanets","gpuMs"] as const).map(key=>[key,this.summary(key)])),
    limits:{data:"Local aggregate timings, numeric camera pose and graph/surface counts only. No note names, paths, links, or contents.",timing:"terrainMs is included in surfaceMs; labelQueryMs can include indicator work. renderMs is CPU submission time. GPU samples are asynchronous and omitted when unsupported, pending or disjoint."},
  };}
}
