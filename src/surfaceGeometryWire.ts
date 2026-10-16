import { isRecord, isUnknownArray } from "./validation";
import { isFiniteNumber, isSafeInteger } from "./validation";
import { validTerrainDefinition, bindSurfaceTerrain } from "./surfaceTerrain";
import type { SurfaceArena } from "./surface";
import { zlibSync, unzlibSync } from "fflate";

export const MAX_GEOMETRY_BYTES = 4 * 1024 * 1024;
export const MAX_CHECKPOINT_BYTES = 32 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
function base64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
}
function checksum(bytes: Uint8Array): number {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}
/** Numeric rows avoid repeating property names and anonymous connection identifiers. */
export function compactSurfaceGeometry(arena: SurfaceArena): object {
  if(arena.terrain&&!validTerrainDefinition(arena.terrain,arena.radius??27))throw new Error("Terrain definition mismatch");
  const connections = arena.walls.map(wall => wall.connectionId ?? "");
  const numeric = { surfaceGeometry9: 1, hub: arena.hubId, seed: arena.seed, radius: arena.radius ?? 27, connections, ...(arena.terrain?{terrain:arena.terrain}:{}),
    walls: arena.walls.flatMap(wall => [...wall.normal.map(n => Math.round(n * 1e6) / 1e6), ...wall.tangent.map(n => Math.round(n * 1e6) / 1e6), wall.height, wall.length]), pickups: arena.pickups };
  const bytes = encoder.encode(JSON.stringify(numeric));
  if (bytes.length > MAX_GEOMETRY_BYTES) throw new Error("Surface geometry exceeds protocol 14 size limit");
  // Independently compressed immutable arenas keep aggregate supported graphs inside checkpoint bounds.
  return bytes.length < 4096 ? numeric : { surfaceGeometry9: 2, size: bytes.length, data: base64(zlibSync(bytes, { level: 1 })) };
}

export function expandSurfaceGeometry(value: unknown): SurfaceArena {
  if (!isRecord(value)) throw new Error("Invalid arena geometry");
  if (value.surfaceGeometry9 === 2) {
    if (!isSafeInteger(value.size) || value.size < 1 || value.size > MAX_GEOMETRY_BYTES || typeof value.data !== "string"
      || value.data.length > Math.ceil(MAX_GEOMETRY_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data)) throw new Error("Invalid compressed arena geometry");
    const binary = atob(value.data), packed = Uint8Array.from(binary, char => char.charCodeAt(0));
    if (packed.length < 6) throw new Error("Incomplete arena geometry");
    const bytes = unzlibSync(packed, { out: new Uint8Array(value.size + 1) });
    if (bytes.length !== value.size || checksum(bytes) !== new DataView(packed.buffer).getUint32(packed.length - 4)) throw new Error("Corrupt arena geometry");
    const numeric: unknown = JSON.parse(decoder.decode(bytes));
    if (!isRecord(numeric) || numeric.surfaceGeometry9 !== 1) throw new Error("Invalid nested arena geometry");
    return expandSurfaceGeometry(numeric);
  }
  if (!value || value.surfaceGeometry9 !== 1 || !isUnknownArray(value.connections) || value.connections.length > 39_998
    || !value.connections.every((id: unknown) => typeof id === "string" && id.length <= 128)
    || !isUnknownArray(value.walls) || value.walls.length !== value.connections.length * 8
    || !value.walls.every((n: unknown) => typeof n === "number" && isFiniteNumber(n))) throw new Error("Invalid arena geometry");
  if (typeof value.hub !== "string" || !isSafeInteger(value.seed) || !isFiniteNumber(value.radius) || !Array.isArray(value.pickups)) throw new Error("Invalid arena metadata");
  if(value.terrain!==undefined&&!validTerrainDefinition(value.terrain,value.radius))throw new Error("Terrain definition mismatch");
  const connections = value.connections as string[], walls = value.walls;
  const arena:SurfaceArena = { hubId: value.hub, seed: value.seed, radius: value.radius, pickups: value.pickups as SurfaceArena["pickups"], ...(value.terrain?{terrain:value.terrain}:{}),
    walls: connections.map((connectionId: string, index: number) => {
      const row = walls.slice(index * 8, index * 8 + 8);
      return { id: `wall-${index}`, ...(connectionId ? { connectionId } : {}), normal: row.slice(0, 3) as [number, number, number], tangent: row.slice(3, 6) as [number, number, number], height: row[6], length: row[7] };
    }) };
  bindSurfaceTerrain(arena.walls,arena.terrain);return arena;
}

export function stringifySurfaceTransfer(value: unknown, limit: number): string {
  const definitions=new WeakMap<object,number>();let next=0;
  const text = JSON.stringify(value, (_key: string, item: unknown): unknown => {
    if(!isRecord(item)||typeof item.hubId!=="string"||!Array.isArray(item.walls)||!Array.isArray(item.pickups))return item;
    const existing=definitions.get(item);if(existing)return {surfaceGeometryRef:existing};
    const id=++next;definitions.set(item,id);return {surfaceGeometryId:id,definition:compactSurfaceGeometry(item as unknown as SurfaceArena)};
  });
  if (encoder.encode(text).byteLength > limit) throw new Error("Surface transfer exceeds protocol 14 size limit");
  return text;
}
export function parseSurfaceTransfer(text: string, limit: number): unknown {
  if (encoder.encode(text).byteLength > limit) throw new Error("Surface transfer exceeds protocol 14 size limit");
  const definitions=new Map<number,SurfaceArena>();
  return JSON.parse(text, (_key: string, item: unknown): unknown => {
    if(isRecord(item)&&(item.surfaceGeometry9===1||item.surfaceGeometry9===2))return expandSurfaceGeometry(item);
    if(isRecord(item)&&"surfaceGeometryId" in item){
      const id=item.surfaceGeometryId,arena=item.definition;
      if(!isSafeInteger(id)||id<1||id>1024||definitions.has(id)||!isRecord(arena)||typeof arena.hubId!=="string"||!Array.isArray(arena.walls)||!Array.isArray(arena.pickups))throw new Error("Invalid geometry definition");
      definitions.set(id,arena as unknown as SurfaceArena);return arena;
    }
    if(isRecord(item)&&"surfaceGeometryRef" in item){const arena=definitions.get(isSafeInteger(item.surfaceGeometryRef) ? item.surfaceGeometryRef : -1);if(!arena)throw new Error("Invalid geometry reference");return arena;}
    return item;
  });
}
