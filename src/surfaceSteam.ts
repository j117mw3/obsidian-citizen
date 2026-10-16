import * as THREE from "three";
/** Fixed-size cosmetic puffs in weapon-local space; no projectile or shared state. */
export class SurfaceVentSteam extends THREE.Points {
  private positions=new Float32Array(36);
  private fades=new Float32Array(12);
  constructor(){
    const geometry=new THREE.BufferGeometry();geometry.setAttribute("position",new THREE.BufferAttribute(new Float32Array(36),3));geometry.setAttribute("fade",new THREE.BufferAttribute(new Float32Array(12),1));
    super(geometry,new THREE.ShaderMaterial({transparent:true,depthWrite:false,uniforms:{},
      vertexShader:`attribute float fade; varying float steamFade; void main(){steamFade=fade;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);gl_PointSize=12.0+20.0*(1.0-fade);}`,
      fragmentShader:`varying float steamFade; void main(){float d=length(gl_PointCoord-vec2(.5))*2.0;float alpha=exp(-d*d*4.0)*steamFade*.28;if(d>1.0)discard;gl_FragColor=vec4(.77,.87,.92,alpha);}` }));
    this.name="blaster-vent-steam";this.frustumCulled=false;this.visible=false;
  }
  update(hostNow:number,ventUntil:number):void {
    this.visible=ventUntil>hostNow;
    if(!this.visible)return;
    for(let i=0;i<12;i++){
      const age=((hostNow/1000+i*.061)% .8)/.8,side=i%2?1:-1;
      this.positions[i*3]=.12+side*(.035+age*.07)+Math.sin(i*2.1+age*5)*.018;
      this.positions[i*3+1]=-.21+age*.32;
      this.positions[i*3+2]=-.66+Math.sin(i*1.7)*.03+age*.06;
      this.fades[i]=(1-age)*(1-age)*Math.min(1,age*8)*Math.min(1,(ventUntil-hostNow)/120);
    }
    (this.geometry.getAttribute("position") as THREE.BufferAttribute).array.set(this.positions);
    (this.geometry.getAttribute("fade") as THREE.BufferAttribute).array.set(this.fades);
    this.geometry.getAttribute("position").needsUpdate=true;this.geometry.getAttribute("fade").needsUpdate=true;
  }
}
