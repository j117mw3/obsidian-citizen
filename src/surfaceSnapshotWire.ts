import { isUnknownArray } from "./validation";
import { bindSurfaceTerrain, terrainQuery } from "./surfaceTerrain";
import { validSurfaceArenaPayload, validSurfaceNetworkSnapshot, type SurfaceNetworkSnapshot } from "./surfaceAuthority";
import type { SurfaceArena } from "./surface";
import { MAX_GEOMETRY_BYTES, parseSurfaceTransfer, stringifySurfaceTransfer } from "./surfaceGeometryWire";

const LIMIT = 256;
function freezeGeometry(arena: SurfaceArena): SurfaceArena {
  for (const wall of arena.walls) { Object.freeze(wall.normal); Object.freeze(wall.tangent); Object.freeze(wall); }
  for (const pickup of arena.pickups) { Object.freeze(pickup.normal); Object.freeze(pickup); }
  if(arena.terrain){terrainQuery(arena.terrain).staticNear([0,arena.terrain.radius,0],16);Object.freeze(arena.terrain.chunkHashes);Object.freeze(arena.terrain);bindSurfaceTerrain(arena.walls,arena.terrain);}
  Object.freeze(arena.walls); Object.freeze(arena.pickups); return Object.freeze(arena);
}
export type SurfaceWireSnapshot = Omit<SurfaceNetworkSnapshot, "arenas"> & { arenas: Array<Omit<SurfaceNetworkSnapshot["arenas"][number], "arena"> & { arena: SurfaceArena | number; geometryId: number }> };

/** Per-connection acknowledged immutable geometry. Dynamic state is always a full snapshot. */
export class SurfaceSnapshotWire {
  private nextId = 0;
  private offered = new Map<string, number>();
  private acknowledged = new Set<number>();
  private received = new Map<number, SurfaceArena>();
  private transfers = new Map<number, { text: string; offset: number; lastSent: number }>();
  private incoming = new Map<number, { total: number; parts: Map<number, string>; bytes: number }>();
  private geometrySignatures = new WeakMap<SurfaceArena, Map<string, string>>();

  encode(snapshot: SurfaceNetworkSnapshot, referencesOnly = false): SurfaceWireSnapshot {
    const active = new Set<number>();
    const result = { ...snapshot, arenas: snapshot.arenas.map(arena => {
      let signatures = this.geometrySignatures.get(arena.arena);
      if (!signatures) this.geometrySignatures.set(arena.arena, signatures = new Map<string, string>());
      const identity = `${arena.key}/${arena.revision}`;
      const signature = referencesOnly ? identity : signatures.get(identity) ?? JSON.stringify([arena.key, arena.revision, arena.arena]);
      signatures.set(identity, signature);
      let id = this.offered.get(signature);
      if (id === undefined) {
        id = ++this.nextId; this.offered.set(signature, id);
        if (this.offered.size > LIMIT) { const oldest = this.offered.keys().next().value!; this.acknowledged.delete(this.offered.get(oldest)!); this.offered.delete(oldest); }
      }
      active.add(id);
      if (referencesOnly && !this.acknowledged.has(id) && !this.transfers.has(id)) {
        this.transfers.set(id, { text: stringifySurfaceTransfer(arena, MAX_GEOMETRY_BYTES), offset: 0, lastSent: 0 });
      }
      return { ...arena, geometryId: id, arena: referencesOnly || this.acknowledged.has(id) ? id : arena.arena };
    }) };
    for (const token of this.transfers.keys()) if (!active.has(token)) this.transfers.delete(token);
    return result;
  }

  /** Called each publishing tick; ordered reliable delivery provides chunk retransmission. */
  nextChunk(now = Date.now()): { token: number; index: number; total: number; data: string } | null {
    for (const [token, transfer] of this.transfers) {
      if (this.acknowledged.has(token)) { this.transfers.delete(token); continue; }
      if (transfer.offset >= transfer.text.length) {
        if (now - transfer.lastSent < 2000) continue;
        transfer.offset = 0;
      }
      // At most 12,000 ASCII characters plus JSON escaping stays below 16 KiB.
      const index = Math.floor(transfer.offset / 12_000), data = transfer.text.slice(transfer.offset, transfer.offset + 12_000);
      transfer.offset += data.length; transfer.lastSent = now;
      return { token, index, total: Math.ceil(transfer.text.length / 12_000), data };
    }
    return null;
  }

  receiveChunk(message: Record<string, unknown>): number | null {
    const { token, index, total, data } = message;
    if (!Number.isSafeInteger(token) || (token as number) < 1 || !Number.isSafeInteger(index) || !Number.isSafeInteger(total)
      || (total as number) < 1 || (total as number) > Math.ceil(MAX_GEOMETRY_BYTES / 12_000) || (index as number) < 0 || (index as number) >= (total as number)
      || typeof data !== "string" || !data.length || data.length > 12_000 || /[^\x20-\x7e]/.test(data)) return null;
    let transfer = this.incoming.get(token as number);
    if (!transfer) {
      if (this.incoming.size >= 4) return null;
      this.incoming.set(token as number, transfer = { total: total as number, parts: new Map(), bytes: 0 });
    }
    if (transfer.total !== total) return null;
    if (transfer.parts.has(index as number)) return null;
    transfer.parts.set(index as number, data); transfer.bytes += data.length;
    if (transfer.bytes > MAX_GEOMETRY_BYTES) { this.incoming.delete(token as number); return null; }
    if (transfer.parts.size !== total) return null;
    this.incoming.delete(token as number);
    try {
      const arena = parseSurfaceTransfer(Array.from({ length: total }, (_, i) => transfer.parts.get(i)!).join(""), MAX_GEOMETRY_BYTES);
      if (!validSurfaceArenaPayload(arena)) return null;
      const previous = this.received.get(token as number);
      if (previous && JSON.stringify(previous) !== JSON.stringify(arena.arena)) return null;
      this.received.set(token as number, freezeGeometry(arena.arena));
      if (this.received.size > LIMIT) this.received.delete(this.received.keys().next().value!);
      return token as number;
    } catch { return null; }
  }

  acknowledge(tokens: unknown, missing = false): void {
    if (!isUnknownArray(tokens) || tokens.length > 132 || !tokens.every((token): token is number => typeof token === "number" && Number.isSafeInteger(token) && token > 0)) return;
    const offered = new Set(this.offered.values());
    for (const token of tokens) if (offered.has(token)) {
      if (missing) this.acknowledged.delete(token); else this.acknowledged.add(token);
    }
  }

  decode(value: unknown, epoch: number): { snapshot: SurfaceNetworkSnapshot | null; acknowledge: number[]; missing: number[] } {
    const fail = { snapshot: null, acknowledge: [], missing: [] };
    if (!value || typeof value !== "object" || !isUnknownArray((value as SurfaceWireSnapshot).arenas) || (value as SurfaceWireSnapshot).arenas.length > 132) return fail;
    const wire = value as SurfaceWireSnapshot, missing: number[] = [];
    if (wire.epoch !== epoch) return fail;
    const active = new Set(wire.arenas.map(arena => arena?.geometryId));
    for (const token of this.incoming.keys()) if (!active.has(token)) this.incoming.delete(token);
    const arenas = wire.arenas.map(arena => {
      if (!arena || typeof arena !== "object") return arena;
      if (typeof arena.arena !== "number") return arena;
      if (!Number.isSafeInteger(arena.arena) || arena.arena < 1 || arena.geometryId !== arena.arena) return null;
      const geometry = this.received.get(arena.arena);
      if (!geometry) { missing.push(arena.arena); return null; }
      return { ...arena, arena: geometry };
    });
    if (missing.length) return { ...fail, missing };
    const expanded: unknown = { ...wire, arenas };
    if (!validSurfaceNetworkSnapshot(expanded, epoch)) return fail;
    const snapshot = expanded;
    const acknowledge: number[] = [];
    const pending = new Map<number, SurfaceArena>();
    for (const [index, arena] of snapshot.arenas.entries()) {
      const original = wire.arenas[index];
      if (typeof original.arena === "number") continue;
      const id = original.geometryId;
      // Plain full snapshots remain readable; only tagged geometry is acknowledged.
      if (!Number.isSafeInteger(id) || id < 1) continue;
      const existing = pending.get(id) ?? this.received.get(id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(arena.arena)) return fail;
      pending.set(id, arena.arena);
      acknowledge.push(id);
    }
    for (const [id, arena] of pending) {
      this.received.delete(id); this.received.set(id, freezeGeometry(JSON.parse(JSON.stringify(arena)) as SurfaceArena));
      if (this.received.size > LIMIT) this.received.delete(this.received.keys().next().value!);
    }
    return { snapshot, acknowledge, missing: [] };
  }

  clear(): void {
    this.offered.clear(); this.acknowledged.clear(); this.received.clear(); this.transfers.clear(); this.incoming.clear(); this.geometrySignatures = new WeakMap();
    // Do not reuse IDs while old messages from this connection may still arrive.
  }
}
