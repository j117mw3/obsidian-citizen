import type { PerformanceFrame } from "./performanceCapture";
interface TimerExtension { TIME_ELAPSED_EXT:number; GPU_DISJOINT_EXT:number }
/** Nonblocking WebGL2 timing; bounded queue and disjoint results never become zero-time samples. */
export class GpuFrameTimer {
  private readonly extension:TimerExtension|null;
  private active:WebGLQuery|null=null;
  private pending:Array<{query:WebGLQuery;frame:PerformanceFrame}>=[];
  private gl:WebGL2RenderingContext;
  constructor(context:WebGLRenderingContext|WebGL2RenderingContext){this.gl=context as WebGL2RenderingContext;this.extension=typeof this.gl.createQuery==="function"?this.gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExtension|null:null;}
  get available():boolean{return this.extension!==null;}
  begin():void{if(!this.extension||this.active||this.pending.length>=8||this.gl.isContextLost())return;this.active=this.gl.createQuery();if(this.active)this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT,this.active);}
  end(frame:PerformanceFrame):void{if(!this.active||!this.extension)return;this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);this.pending.push({query:this.active,frame});this.active=null;}
  poll():void{
    if(!this.extension||!this.pending.length)return;
    if(this.gl.isContextLost()||this.gl.getParameter(this.extension.GPU_DISJOINT_EXT)){this.clear();return;}
    this.pending=this.pending.filter(({query,frame})=>{if(!this.gl.getQueryParameter(query,this.gl.QUERY_RESULT_AVAILABLE))return true;const ns=this.gl.getQueryParameter(query,this.gl.QUERY_RESULT) as number;if(Number.isFinite(ns)&&ns>=0)frame.gpuMs=ns/1e6;this.gl.deleteQuery(query);return false;});
  }
  private clear():void{for(const {query} of this.pending)this.gl.deleteQuery(query);this.pending=[];}
  dispose():void{if(this.active&&this.extension){this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);this.gl.deleteQuery(this.active);this.active=null;}this.clear();}
}
