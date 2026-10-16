import { isRecord } from "./validation";
import { isUnknownArray } from "./validation";
import type { SurfaceVector } from "./surface";
import type { SurfaceArenaView, SurfacePlayerView } from "./surfaceWorld";
import { nearbySurfaceWalls } from "./surfaceCollision";
export interface SurfaceCoverPacket { arenaKey: string; poses: string }
const MAX_ROWS=2048, STRIDE=14;
export function decodeCoverPoses(text:unknown,wallCount:number):Array<[number,SurfaceVector]>|null {
  if(typeof text!=="string"||text.length>Math.ceil(MAX_ROWS*STRIDE/3)*4||text.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(text))return null;
  try {
    const raw=atob(text);if(raw.length%STRIDE||raw.length>MAX_ROWS*STRIDE)return null;
    const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)),view=new DataView(bytes.buffer),rows:Array<[number,SurfaceVector]>=[],seen=new Set<number>();
    for(let at=0;at<bytes.length;at+=STRIDE){const index=view.getUint16(at,true),n:SurfaceVector=[view.getFloat32(at+2,true),view.getFloat32(at+6,true),view.getFloat32(at+10,true)];
      if(index>=wallCount||seen.has(index)||!n.every(Number.isFinite)||Math.abs(Math.hypot(...n)-1)>.001)return null;
      seen.add(index);rows.push([index,n]);}
    return rows;
  }catch{return null;}
}
/** Only collision-relevant cover needs exact host poses; distant presentation uses anonymous graph prediction. */
export function encodeCoverPoses(arenas:readonly SurfaceArenaView[],players:readonly SurfacePlayerView[]):SurfaceCoverPacket[] {
  const candidates:Array<{arenaKey:string;index:number;normal:SurfaceVector;distance:number}>=[];
  for(const arena of arenas){const occupants=players.filter(p=>p.arenaKey===arena.key&&p.surface&&p.health>0),found=new Map<number,{normal:SurfaceVector;distance:number}>(),radius=arena.arena.radius??27;
    for(const player of occupants){const position=player.surface!.position;
      for(const wall of nearbySurfaceWalls(position,position,arena.arena.walls,radius,43)){
        if(!/^wall-\d+$/.test(wall.id))continue;
        const distance=Math.hypot(...wall.normal.map((v,k)=>v*radius-position[k]));if(distance>43)continue;
        const index=(/^wall-\d+$/.test(wall.id)?Number(wall.id.slice(5)):-1),old=found.get(index);if(!old||distance<old.distance)found.set(index,{normal:wall.normal,distance});
      }}
    for(const [index,data] of found)candidates.push({arenaKey:arena.key,index,...data});
  }
  candidates.sort((a,b)=>a.distance-b.distance||a.arenaKey.localeCompare(b.arenaKey)||a.index-b.index);
  const groups=new Map<string,typeof candidates>();for(const row of candidates.slice(0,MAX_ROWS)){const group=groups.get(row.arenaKey)??[];group.push(row);groups.set(row.arenaKey,group);}
  return [...groups].map(([arenaKey,rows])=>{rows.sort((a,b)=>a.index-b.index);const bytes=new Uint8Array(rows.length*STRIDE),view=new DataView(bytes.buffer);
    rows.forEach((row,i)=>{const at=i*STRIDE;view.setUint16(at,row.index,true);row.normal.forEach((n,k)=>view.setFloat32(at+2+k*4,n,true));});
    let raw="";for(let i=0;i<bytes.length;i+=8192)raw+=String.fromCharCode(...bytes.subarray(i,i+8192));return {arenaKey,poses:btoa(raw)};
  });
}
export function validCoverPackets(value:unknown,arenas:readonly SurfaceArenaView[]):boolean {
  if(value===undefined)return true;if(!isUnknownArray(value)||value.length>4)return false;
  let count=0;const seen=new Set<string>();
  for(const packet of value){if(!isRecord(packet)||typeof packet.arenaKey!=="string")return false;const arena=arenas.find(a=>a.key===packet?.arenaKey);if(!arena||seen.has(packet.arenaKey))return false;seen.add(packet.arenaKey);
    const rows=decodeCoverPoses(packet.poses,arena.arena.walls.length);if(!rows||(count+=rows.length)>MAX_ROWS)return false;}
  return true;
}
