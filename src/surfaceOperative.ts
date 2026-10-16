import * as THREE from "three";
import type { SurfacePlayerState } from "./surfacePhysics";

/** A fitted, articulated operative. Visual joints never replace authoritative damage capsules. */
export class SurfaceOperative {
  readonly group = new THREE.Group();
  readonly upper = new THREE.Group();
  private hips = new THREE.Group();
  private legs: THREE.Group[] = [];
  private arms: THREE.Group[] = [];
  private accent: THREE.MeshBasicMaterial;
  private chestAccent: THREE.MeshBasicMaterial;
  private phase = 0;
  constructor(color: string, training = false) {
    this.group.name = training ? "training-space-operative" : "space-operative";
    this.accent = new THREE.MeshBasicMaterial({ color });
    this.chestAccent = new THREE.MeshBasicMaterial({ color });
    const suit = new THREE.MeshBasicMaterial({ color: training ? 0x293642 : 0x18232f });
    const armor = new THREE.MeshBasicMaterial({ color: 0x344859 });
    const black = new THREE.MeshBasicMaterial({ color: 0x0b111c });
    const wire = new THREE.LineBasicMaterial({ color: training ? 0xd0b991 : 0x8daebf, transparent: true, opacity: 0.8 });
    const part = (parent: THREE.Object3D, name: string, size: number[], at: number[], material = suit, bevel = false) => {
      const geometry = bevel ? new THREE.CylinderGeometry(0.5, 0.44, 1, 6) : new THREE.BoxGeometry(1, 1, 1);
      const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.scale.set(...size as [number,number,number]); mesh.position.set(...at as [number,number,number]);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 28), wire); mesh.add(edges); parent.add(mesh); return mesh;
    };
    this.group.add(this.hips, this.upper);
    part(this.hips, "pelvis", [.32,.20,.23], [0,.87,0]);
    part(this.upper, "fitted-torso", [.39,.45,.23], [0,.16,0], suit, true);
    part(this.upper, "chest-panel", [.25,.23,.035], [0,.18,-.13], this.chestAccent);
    part(this.upper, "belt", [.38,.075,.27], [0,-.10,0], black);
    for (const side of [-1,1]) {
      part(this.upper, "utility-pouch", [.075,.12,.08], [side*.15,-.12,-.15], armor);
      const leg = new THREE.Group(); leg.position.set(side*.105,.84,0); this.hips.add(leg); this.legs.push(leg);
      part(leg,"thigh",[.135,.33,.15],[0,-.17,0],suit,true);
      part(leg,"knee",[.14,.11,.17],[0,-.36,-.015],armor);
      part(leg,"shin",[.115,.30,.13],[0,-.55,0],suit,true);
      part(leg,"boot",[.15,.13,.24],[0,-.77,-.045],black);
      const arm = new THREE.Group(); arm.position.set(side*.235,.34,0); this.upper.add(arm); this.arms.push(arm);
      part(arm,"shoulder",[.12,.13,.16],[0,0,0],armor);
      part(arm,"upper-arm",[.10,.23,.12],[0,-.16,0],suit,true);
      part(arm,"forearm",[.10,.22,.12],[0,-.32,-.10],armor,true);
      part(arm,"glove",[.105,.12,.13],[0,-.40,-.19],black);
    }
    part(this.upper,"neck-seal",[.14,.10,.14],[0,.43,0],black);
    part(this.upper,"angular-helmet",[.28,.29,.27],[0,.60,0],armor,true);
    part(this.upper,"visor-shadow",[.235,.10,.03],[0,.62,-.145],black);
    part(this.upper,"luminous-visor",[.205,.035,.035],[0,.63,-.162],this.accent);
    part(this.upper,"ear-comms",[.045,.085,.09],[-.15,.62,0],black);
    part(this.upper,"pistol-receiver",[.10,.085,.22],[.235,-.37,-.32],black);
    part(this.upper,"pistol-emitter",[.06,.045,.04],[.235,-.35,-.45],this.accent);
    if (training) {
      part(this.upper,"training-target",[.15,.15,.012],[0,.18,-.155],this.accent);
      part(this.upper,"target-center",[.055,.055,.014],[0,.18,-.165],black);
    }
    this.pose({ crouched: false, lean: 0, pitch: 0, velocity: [0,0,0], grounded: true }, 0);
  }
  setColor(color: string): void { this.accent.color.set(color); this.chestAccent.color.set(color); }
  setAggressive(aggressive: boolean, baseColor: string): void { this.setColor(aggressive ? "#FF4B45" : baseColor); }
  pose(state: Pick<SurfacePlayerState,"crouched"|"lean"|"pitch"|"velocity"|"grounded">, dt: number): void {
    const speed = Math.hypot(...state.velocity);
    this.phase += Math.min(.1, Math.max(0,dt)) * Math.min(speed,8.5) * 2.7;
    const stride = state.grounded ? Math.min(1,speed/4.5) : 0;
    this.hips.scale.y = state.crouched ? .58 : 1;
    this.upper.position.set(state.lean, state.crouched ? .35 : 1.04, 0);
    this.upper.rotation.z = -state.lean * .22;
    this.upper.rotation.x = Math.max(-.16,Math.min(.16,state.pitch*.18));
    this.legs.forEach((leg,i) => { leg.rotation.x = Math.sin(this.phase+i*Math.PI)*.36*stride + (state.crouched ? -.5 : 0); });
    this.arms.forEach((arm,i) => { arm.rotation.x = -.38 + Math.sin(this.phase+i*Math.PI)*.08*stride; });
  }
}
