import { deriveRoomKeys, makeRoomCode, parseRoomCode, seal, unseal, type RoomKeys } from "./netcrypto";
import { RelayChannel, cleanRelayUrl, type PostFn } from "./relay";
import { DEFAULT_PILOT_PROFILE, validPilotProfile, type PilotProfile } from "./pilotProfile";

export const ROOM_PROTOCOL = 14;
export interface RoomMember { id: string; name: string; joinedAt: number; slot: number; profile: PilotProfile }
export const ROOM_CAPACITY = 4;

export interface RoomCallbacks {
  /** The list of pilots changed (this includes you). */
  roster(members: RoomMember[], selfId: string): void;
  /** A connection-set-up message from another pilot. */
  signal(from: string, data: unknown): void;
  status(text: string, error?: boolean): void;
}

/** Where sealed messages go and come from. The real one is a public relay; tests use an in-memory stand-in. */
export interface RoomTransport { publish(text: string): Promise<void>; start(sinceSeconds?: number): void; stop(): void }
export type TransportFactory = (topic: string, onText: (text: string) => void, onProblem: (text: string) => void) => RoomTransport;

const NAME_MAX = 24;
const JOIN_TIMEOUT_MS = 20_000;
const HELLO_RETRY_MS = [4_000, 10_000];
const MAX_FRAGMENT_CHARS = 2300;
const MAX_FRAGMENTS = 128;
const MAX_FRAGMENT_TRANSFERS = 8;
const uuid = /^[0-9a-f-]{36}$/i;

/** Pilots whose names are shown to others: printable, no markup, never empty. */
export function cleanName(input: unknown): string {
  const s = typeof input === "string" ? input.replace(/[^\p{L}\p{N} _.'-]/gu, "").trim().slice(0, NAME_MAX) : "";
  return s || "Pilot";
}

function validMembers(value: unknown): value is RoomMember[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > ROOM_CAPACITY) return false;
  const ids = new Set<string>(), slots = new Set<number>();
  for (const m of value) {
    if (!m || typeof m !== "object") return false;
    const x = m as RoomMember;
    if (typeof x.id !== "string" || !uuid.test(x.id) || ids.has(x.id) || typeof x.name !== "string" || x.name.length > NAME_MAX
      || !Number.isSafeInteger(x.joinedAt) || !Number.isInteger(x.slot) || x.slot < 0 || x.slot >= ROOM_CAPACITY || slots.has(x.slot)
      || !validPilotProfile(x.profile)) return false;
    ids.add(x.id); slots.add(x.slot);
  }
  return true;
}

/**
 * A room of up to four pilots that finds its members through a relay. The relay is only a mailbox: every message is sealed
 * with a key made from the room code. The pilot who has been in the room longest answers newcomers and hands out the
 * four places (and if they leave, the next one takes over), so there is no server to run and nobody is in charge of the game.
 */
export class RelayRoom {
  private keys: RoomKeys | null = null;
  private transport: RoomTransport | null = null;
  private roomCode = "";
  private id = "";
  private name = "";
  private profile: PilotProfile = DEFAULT_PILOT_PROFILE;
  private list: RoomMember[] = [];
  private closed = true;
  private pending: { resolve: () => void; reject: (e: Error) => void; timers: number[] } | null = null;
  private seenNonces = new Set<string>();
  private fragments = new Map<string, { total: number; parts: string[]; bytes: number; received: number; createdAt: number }>();

  constructor(private relayUrl: string, private cb: RoomCallbacks, private makeTransport?: TransportFactory, private post?: PostFn) {}

  get code(): string { return this.roomCode; }
  get selfId(): string { return this.id; }
  get members(): RoomMember[] { return this.list; }
  get active(): boolean { return !this.closed && !!this.id && this.list.some(m => m.id === this.id); }

  async create(name: string, profile: PilotProfile = DEFAULT_PILOT_PROFILE): Promise<string> {
    await this.open(makeRoomCode(), name, profile);
    const me: RoomMember = { id: this.id, name: this.name, joinedAt: Date.now(), slot: 0, profile: this.profile };
    this.list = [me]; this.cb.roster(this.list, this.id);
    return this.roomCode;
  }

  async join(codeInput: string, name: string, profile: PilotProfile = DEFAULT_PILOT_PROFILE): Promise<void> {
    const code = parseRoomCode(codeInput);
    if (!code) {
      if (/^[A-HJ-NP-Z2-9]{8}$/i.test(codeInput.trim())) throw new Error("This room uses the previous protocol. Both pilots must update to the same OB Citizen build.");
      throw new Error("That is not a room code. It is ten letters and numbers, like ABCDE-FGHJK.");
    }
    await this.open(code, name, profile);
    const wait = new Promise<void>((resolve, reject) => {
      const timers: number[] = [];
      this.pending = { resolve, reject, timers };
      void this.sendHello();
      for (const t of HELLO_RETRY_MS) timers.push(window.setTimeout(() => { if (this.pending) void this.sendHello(); }, t));
      timers.push(window.setTimeout(() => this.failPending("Nobody answered. Check the code, and that the pilot who made the room is still online and in the plugin."), JOIN_TIMEOUT_MS));
    });
    await wait;
  }

  private async open(code: string, name: string, profile: PilotProfile): Promise<void> {
    if (!this.closed) throw new Error("Leave the current room before joining another.");
    const base = cleanRelayUrl(this.relayUrl);
    if (!base) throw new Error("The relay address must start with https:// (or http://localhost for testing). Check the multiplayer settings.");
    if (typeof crypto?.subtle === "undefined") throw new Error("This version of Obsidian cannot do the encryption multiplayer needs.");
    if (!validPilotProfile(profile)) throw new Error("The selected ship or sound profile is invalid.");
    this.name = cleanName(name); this.profile = profile; this.id = crypto.randomUUID(); this.roomCode = code; this.list = []; this.closed = false; this.seenNonces.clear();
    this.keys = await deriveRoomKeys(code);
    const post = this.post;
    if (!this.makeTransport && !post) throw new Error("Network access is not available here, so rooms cannot be made.");
    const make = this.makeTransport ?? ((topic, onText, onProblem) => new RelayChannel(base, topic, post as PostFn, onText, onProblem));
    this.transport = make(this.keys.topic, text => void this.onText(text), text => this.cb.status(text, true));
    this.transport.start(8);
  }

  /** Send a connection-set-up message to one pilot. */
  signal(to: string, data: object): void { void this.send({ k: "signal", protocol: ROOM_PROTOCOL, to, from: this.id, data }).catch(error => this.cb.status(error instanceof Error ? error.message : "Could not send connection setup data.", true)); }

  updateProfile(profile: PilotProfile): void {
    if (!this.active || !validPilotProfile(profile) || profile.revision <= this.profile.revision) return;
    this.profile = profile;
    this.list = this.list.map(member => member.id === this.id ? { ...member, profile } : member);
    void this.send({ k: "profile", protocol: ROOM_PROTOCOL, id: this.id, profile }).catch(error => this.cb.status(error instanceof Error ? error.message : "Could not update your pilot profile.", true));
    this.cb.roster(this.list, this.id);
  }

  /** A pilot has dropped (their direct connection died): forget them, and tell everyone else who is still reachable. */
  dropMember(id: string): void {
    if (!this.list.some(m => m.id === id)) return;
    void this.send({ k: "bye", protocol: ROOM_PROTOCOL, id }).catch(() => undefined);
    this.list = this.list.filter(m => m.id !== id);
    this.cb.roster(this.list, this.id);
    if (this.coordinator?.id === this.id) void this.send({ k: "roster", protocol: ROOM_PROTOCOL, members: this.list });
  }

  leave(): void {
    if (this.closed) return;
    if (this.id && this.list.length > 1) void this.send({ k: "bye", protocol: ROOM_PROTOCOL, id: this.id }).catch(() => undefined);
    this.failPending("Left the room.");
    this.closed = true;
    const t = this.transport; this.transport = null;
    window.setTimeout(() => t?.stop(), 600); // let the goodbye go out first
    this.list = []; this.id = ""; this.roomCode = ""; this.keys = null;
  }

  // ----------------------------------------------------------------- messages

  private async send(body: Record<string, unknown>): Promise<void> {
    const keys = this.keys, transport = this.transport; // held here, so a goodbye still goes out while the room is being closed
    if (!keys || !transport) return;
    const text = await seal(keys, { v: 1, n: crypto.randomUUID(), protocol: ROOM_PROTOCOL, ...body });
    if (text.length <= 3700) { await transport.publish(text); return; }
    const transferId = crypto.randomUUID(), total = Math.ceil(text.length / MAX_FRAGMENT_CHARS);
    if (total > MAX_FRAGMENTS) throw new Error("Connection setup is too large to send safely. Try again with fewer open rooms.");
    for (let index = 0; index < total; index++) {
      const part = text.slice(index * MAX_FRAGMENT_CHARS, (index + 1) * MAX_FRAGMENT_CHARS);
      const fragment = await seal(keys, { v: 1, n: crypto.randomUUID(), protocol: ROOM_PROTOCOL, k: "fragment", transferId, index, total, part });
      await transport.publish(fragment);
    }
  }

  private sendHello(): Promise<void> {
    return this.send({ k: "hello", protocol: ROOM_PROTOCOL, id: this.id, name: this.name, profile: this.profile, at: Date.now() }).catch(e => this.failPending(e instanceof Error ? e.message : "Could not reach the relay."));
  }

  private failPending(message: string): void {
    const p = this.pending; if (!p) return;
    this.pending = null; p.timers.forEach(t => window.clearTimeout(t));
    p.reject(new Error(message));
    this.closed = true; this.transport?.stop(); this.transport = null; this.id = ""; this.roomCode = ""; this.keys = null; this.list = [];
  }

  /** The pilot who has been here longest is the one who answers newcomers. */
  private get coordinator(): RoomMember | undefined {
    return [...this.list].sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id))[0];
  }

  private async onText(text: string): Promise<void> {
    if (this.closed || !this.keys) return;
    const msg = await unseal(this.keys, text) as Record<string, unknown> | null;
    if (!msg || typeof msg !== "object" || msg.v !== 1 || typeof msg.k !== "string" || typeof msg.n !== "string" || msg.n.length > 64) return;
    if (msg.protocol !== ROOM_PROTOCOL && msg.k !== "hello") {
      this.cb.status("This room uses a different multiplayer protocol. Everyone must update to the same OB Citizen build.", true); return;
    }
    if (msg.k === "hello" && msg.protocol !== ROOM_PROTOCOL) {
      if (typeof msg.id === "string" && uuid.test(msg.id)) void this.send({ k: "incompatible", protocol: ROOM_PROTOCOL, to: msg.id });
      return;
    }
    if (this.seenNonces.has(msg.n)) return;
    this.seenNonces.add(msg.n); if (this.seenNonces.size > 400) this.seenNonces.delete(this.seenNonces.values().next().value as string);
    if (msg.k === "fragment") { await this.acceptFragment(msg); return; }

    switch (msg.k) {
      case "hello": return this.onHello(msg);
      case "roster": return this.onRoster(msg);
      case "full": if (msg.to === this.id) this.failPending("That room already has four pilots."); return;
      case "incompatible": if (msg.to === this.id) this.failPending("This room uses a different multiplayer protocol. Everyone must update to the same OB Citizen build."); return;
      case "signal": if (msg.to === this.id && typeof msg.from === "string" && uuid.test(msg.from) && this.list.some(m => m.id === msg.from)) this.cb.signal(msg.from, msg.data); return;
      case "profile": return this.onProfile(msg);
      case "bye": return this.onBye(msg);
    }
  }

  private onHello(msg: Record<string, unknown>): void {
    if (typeof msg.id !== "string" || !uuid.test(msg.id) || msg.id === this.id || !this.active || this.coordinator?.id !== this.id || !validPilotProfile(msg.profile)) return;
    const known = this.list.find(m => m.id === msg.id);
    if (!known) {
      if (this.list.length >= ROOM_CAPACITY) { void this.send({ k: "full", to: msg.id }); return; }
      const used = new Set(this.list.map(m => m.slot)), slot = [0, 1, 2, 3].find(s => !used.has(s));
      if (slot === undefined) { void this.send({ k: "full", to: msg.id }); return; }
      this.list = [...this.list, { id: msg.id, name: cleanName(msg.name), joinedAt: Date.now(), slot, profile: msg.profile }];
      this.cb.roster(this.list, this.id);
    }
    void this.send({ k: "roster", protocol: ROOM_PROTOCOL, members: this.list }); // every listener gets the same assigned roster
  }

  private onRoster(msg: Record<string, unknown>): void {
    if (msg.protocol !== ROOM_PROTOCOL) { this.failPending("This room uses a different multiplayer protocol. Everyone must update to the same OB Citizen build."); return; }
    if (!validMembers(msg.members)) return;
    const members = msg.members;
    if (!members.some(m => m.id === this.id)) return;
    const changed = JSON.stringify(members) !== JSON.stringify(this.list);
    this.list = members;
    if (this.pending) { const p = this.pending; this.pending = null; p.timers.forEach(t => window.clearTimeout(t)); p.resolve(); }
    if (changed) this.cb.roster(this.list, this.id);
  }

  private onProfile(msg: Record<string, unknown>): void {
    if (typeof msg.id !== "string" || !validPilotProfile(msg.profile)) return;
    const current = this.list.find(member => member.id === msg.id);
    if (!current || msg.profile.revision <= current.profile.revision) return;
    this.list = this.list.map(member => member.id === msg.id ? { ...member, profile: msg.profile as PilotProfile } : member);
    this.cb.roster(this.list, this.id);
  }

  private onBye(msg: Record<string, unknown>): void {
    if (typeof msg.id !== "string" || !this.list.some(member => member.id === msg.id)) return;
    this.list = this.list.filter(member => member.id !== msg.id);
    this.cb.roster(this.list, this.id);
    if (this.coordinator?.id === this.id) void this.send({ k: "roster", protocol: ROOM_PROTOCOL, members: this.list });
  }

  private async acceptFragment(msg: Record<string, unknown>): Promise<void> {
    if (typeof msg.transferId !== "string" || !uuid.test(msg.transferId) || !Number.isInteger(msg.index) || !Number.isInteger(msg.total)
      || (msg.total as number) < 1 || (msg.total as number) > MAX_FRAGMENTS || (msg.index as number) < 0 || (msg.index as number) >= (msg.total as number)
      || typeof msg.part !== "string" || msg.part.length > MAX_FRAGMENT_CHARS) return;
    const now = Date.now();
    for (const [key, transfer] of this.fragments) if (now - transfer.createdAt > 20_000) this.fragments.delete(key);
    let transfer = this.fragments.get(msg.transferId);
    if (!transfer) {
      if (this.fragments.size >= MAX_FRAGMENT_TRANSFERS) this.fragments.delete(this.fragments.keys().next().value as string);
      transfer = { total: msg.total as number, parts: new Array(msg.total as number), bytes: 0, received: 0, createdAt: now };
      this.fragments.set(msg.transferId, transfer);
    }
    if (transfer.total !== msg.total || transfer.parts[msg.index as number] !== undefined) return;
    transfer.parts[msg.index as number] = msg.part; transfer.bytes += msg.part.length; transfer.received++;
    if (transfer.bytes > 300_000) { this.fragments.delete(msg.transferId); return; }
    if (transfer.received !== transfer.total) return;
    this.fragments.delete(msg.transferId);
    await this.onText(transfer.parts.join(""));
  }
}
