import * as THREE from "three";
/** Surface-only paint: full opaque depth, no displacement, collision or additional draw calls. */
export function createSurfacePanelMaterial(radius: number, seed: number, terrainProfile?: number, routeAngle=0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ side:THREE.FrontSide,depthTest:true,depthWrite:true,transparent:false,
    uniforms:{arenaRadius:{value:radius},layoutSeed:{value:(seed>>>0)%4096},terrainProfile:{value:terrainProfile??-1},routeAngle:{value:routeAngle}},
    vertexShader:`varying vec3 surfacePoint;
      void main(){surfacePoint=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader:`uniform float arenaRadius; uniform float layoutSeed; uniform float terrainProfile; uniform float routeAngle; varying vec3 surfacePoint;
      float hash21(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7))+layoutSeed)*43758.5453);}
      void main(){
        vec3 n=normalize(surfacePoint);
        float longitude=atan(n.z,n.x), latitude=asin(clamp(n.y,-1.0,1.0));
        vec2 p=vec2(longitude,latitude)*arenaRadius;
        vec2 cell=floor(p/3.5), local=fract(p/3.5);
        vec2 edge=min(local,1.0-local);
        float aa=max(.004,max(fwidth(p.x),fwidth(p.y))/3.5);
        float seam=1.0-smoothstep(.012,.012+aa,min(edge.x,edge.y));
        float panel=hash21(cell);
        vec3 color=mix(vec3(.038,.064,.092),vec3(.066,.099,.128),panel);
        color=mix(color,vec3(.012,.025,.04),seam*.85);
        float traceX=1.0-smoothstep(.012,.012+aa,abs(local.x-.23));
        float traceY=1.0-smoothstep(.012,.012+aa,abs(local.y-.31));
        float trace=max(traceX*step(.31,local.y)*step(local.y,.72),traceY*step(.23,local.x)*step(local.x,.64));
        color+=vec3(.025,.075,.10)*trace*step(.48,panel);
        float routeDistance=abs(sin(longitude*4.0))*arenaRadius*max(.06,cos(latitude))/4.0;
        float routeAA=max(.015,fwidth(routeDistance));
        float route=1.0-smoothstep(.035,.035+routeAA,routeDistance);
        route*=step(.26,fract((latitude*arenaRadius)/1.4));
        float poleDistance=acos(clamp(abs(n.y),0.0,1.0))*arenaRadius;
        float ring=1.0-smoothstep(.04,.04+max(.02,fwidth(poleDistance)),abs(poleDistance-3.1));
        vec3 routeColor=n.y>=0.0 ? vec3(.12,.57,.68) : vec3(.66,.36,.10);
        color+=routeColor*(route*.42+ring*.65);
        // Broad technical sector stamps break up the smaller panel grid without adding obstacles.
        vec2 sector=fract(p/14.0)-.5;
        float sectorRadius=length(sector);
        float sectorAA=max(.002,max(fwidth(sector.x),fwidth(sector.y)));
        float sectorRing=1.0-smoothstep(.008,.008+sectorAA,abs(sectorRadius-.29));
        float sectorMark=step(.63,hash21(floor(p/14.0)+41.0));
        float slash=step(.5,fract((sector.x+sector.y)*16.0));
        float trim=(1.0-smoothstep(.018,.018+sectorAA,abs(sector.y+.37)))*step(abs(sector.x),.28);
        color+=mix(vec3(.07,.16,.19),vec3(.22,.15,.06),step(.8,panel))*(sectorRing*.45+trim*slash*.4)*sectorMark;
        if(terrainProfile>=0.0){
          vec3 rock=terrainProfile<.5?vec3(.12,.17,.20):terrainProfile<1.5?vec3(.29,.21,.12):vec3(.36,.35,.39);
          vec3 tech=terrainProfile<.5?vec3(.07,.45,.54):terrainProfile<1.5?vec3(.54,.30,.06):vec3(.38,.19,.53);
          float elevation=length(surfacePoint)-arenaRadius;
          float strata=.5+.5*sin(elevation*14.0+sin(p.x*.17)*.8);
          float grain=hash21(floor(p*2.0));
          color=rock*(.70+.12*strata+.06*grain)+tech*trace*.09;
          float routeGap=min(abs(sin(longitude-routeAngle)),abs(cos(longitude-routeAngle)))*arenaRadius*cos(latitude);
          float path=1.0-smoothstep(.025,.08+fwidth(routeGap),abs(routeGap-1.55));
          color+=routeColor*(path*.36+ring*.65);
          // Buried circuitry follows stone seams; restrained contrast keeps silhouettes readable.
          color+=tech*trace*seam*.12;
          vec3 slopeNormal=normalize(cross(dFdx(surfacePoint),dFdy(surfacePoint)));
          float light=.70+.30*abs(dot(slopeNormal,normalize(vec3(.4,.8,.25))));
          color*=light;
        }
        gl_FragColor=vec4(color,1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
}
/** Stone faces and restrained edge circuits share one instanced material. */
export function createRuinMaterial(profile:number):THREE.ShaderMaterial {
 const stone=[new THREE.Color(0x34434a),new THREE.Color(0x756044),new THREE.Color(0x878791)][profile];
 const accent=[new THREE.Color(0x389ca8),new THREE.Color(0xb17d39),new THREE.Color(0x8962b4)][profile];
 return new THREE.ShaderMaterial({uniforms:{stone:{value:stone},accent:{value:accent}},
 vertexShader:`varying vec3 localPoint; varying vec3 faceNormal; void main(){localPoint=position;faceNormal=normal;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.0);}`,
 fragmentShader:`uniform vec3 stone;uniform vec3 accent;varying vec3 localPoint;varying vec3 faceNormal;
 void main(){vec3 p=abs(localPoint);float edge=max(min(p.x,p.y),max(min(p.y,p.z),min(p.x,p.z)));
 float trim=smoothstep(.46,.49,edge);float strata=.5+.5*sin(localPoint.y*55.0+sin(localPoint.x*9.0)*.8);
 float light=.70+.30*abs(dot(normalize(faceNormal),normalize(vec3(.4,.8,.25))));
 vec3 color=stone*(.82+strata*.12)*light+accent*trim*.35;
 gl_FragColor=vec4(color,1.0);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
 }`});
}
