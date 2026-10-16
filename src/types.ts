import type { ConstellationSettings } from "./settings";
import type { PilotProfile } from "./pilotProfile";
import type { AnonymousTopology } from "./multiplayer";
import type { FlightInput, ImpactSnapshot, Pose, ShotSnapshot } from "./multiplayer";
import type { NavigationTarget } from "./multiplayer";
import type { SurfaceInput } from "./surfacePhysics";
import type { SurfaceNetworkSnapshot } from "./surfaceAuthority";

export interface RawNode {
  id: string;
  name: string;
  group: string;
  deg: number;
  /** When the note was created (ms since epoch); orders the "Animate" timelapse. */
  ctime?: number;
}

export interface RawLink {
  source: string;
  target: string;
}

export interface GroupInfo {
  key: string;
  label: string;
  color: string;
  count: number;
}

export interface GraphData {
  nodes: RawNode[];
  links: RawLink[];
  groups: GroupInfo[];
}

export interface SimNode extends RawNode {
  index: number;
  gi: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  phase: number;
  speed: number;
  /** While set, the layout holds the note here (used while it is being dragged). */
  fx?: number | null;
  fy?: number | null;
  fz?: number | null;
}

/** What the view needs from its host (Obsidian, or the dev harness). */
export interface Host {
  openNote(id: string, newTab: boolean): void;
  /** Send small room-discovery messages through Obsidian's native HTTP adapter. */
  post?(url: string, body: string): Promise<number>;
  /** Read the backend's short-lived ICE relay configuration through Obsidian's native HTTP adapter. */
  request?(url: string, token?: string): Promise<{ status: number; body: unknown }>;
  updateSettings?(patch: Partial<ConstellationSettings>): void;
}

export interface RendererCallbacks {
  onHover(idx: number): void;
  onSelect(idx: number): void;
  onOpen(idx: number, newTab: boolean): void;
  /** A timed show started, progressed or ended. `kind` is null when nothing is running. */
  onActivity?(kind: "animate" | "supernova" | null, text: string): void;
  /** Pilot mode started or stopped; `text` is a message for the reader (read out by screen readers too). */
  onPilot?(active: boolean, text: string): void;
  onAudioMute?(which: "engine" | "afterburner", muted: boolean): void;
  onHangar?(): void;
  onToggleGroups?(): void;
  onFoldGroup?(index: number, all: boolean): void;
  onPilotChoice?(patch: Partial<Pick<ConstellationSettings, "pilotShip" | "pilotEngineSound" | "pilotAfterburnerSound" | "pilotLaserSound" | "pilotNearbyAudio">>): void;
  onNetworkFrame?(input: FlightInput): void;
  onWeaponSelect?(sequence: number, weapon: 0 | 1): void;
  onShowScores?(held: boolean): void;
  onNavigationTarget?(target: NavigationTarget | null): void;
  onFastTravel?(target: NavigationTarget): void;
  onFire?(sequence: number, gun: number, weapon: 0 | 1, aimPoint: [number, number, number]): void;
  onSurfaceDock?(target: NavigationTarget): void;
  onSurfaceInput?(input: SurfaceInput & { interact: boolean }, arenaKey: string, lifeId: number): number | undefined;
  onSurfaceCharge?(active: boolean, arenaKey: string, lifeId: number): void;
  onSurfaceFire?(sequence: number, viewTime: number, arenaKey: string, lifeId: number, direction: [number, number, number], kind?: "normal" | "charged"): void;
  onSurfaceColorChoice?(color: string): void;
}

/** The 3D renderer and the list-only fallback expose the same surface, so the UI never has to care which it has. */
export interface GraphRenderer {
  setSurfaceDockResult?(accepted: boolean, reason?: "preparation"): void;
  readonly nodes: SimNode[];
  readonly inMultiplayer: boolean;
  readonly selectedIndex: number;
  readonly isPaused: boolean;
  indexOf(id: string): number;
  neighbors(i: number): number[];
  setData(data: GraphData): void;
  applySettings(s: ConstellationSettings): void;
  setPaused(p: boolean): void;
  setHover(i: number): void;
  setSelected(i: number, fly?: boolean): void;
  setActive(i: number): void;
  setSearch(matches: Set<number> | null): void;
  setHidden(groupIndex: number, hide: boolean): void;
  isHidden(groupIndex: number): boolean;
  flyTo(i: number): void;
  resetView(): void;
  /** Timelapse: notes appear in creation order and their links form. Calling again stops it. */
  animate(): void;
  /** Collapse, explode, re-settle, then trace the shortest paths from the main hub. Calling again stops it. */
  supernova(): void;
  /** Generate the owner's next anonymous room layout and show the shared-round detonation. */
  regenerateRoomLayout(remainingMs: number): void;
  /** Align the visible victory pulse to the host's replicated phase timer. */
  syncRoomNova(remainingMs: number): void;
  setRoundDisplay(kills: number, leader: number, phase: string, remainingMs: number): void;
  readonly activity: "animate" | "supernova" | null;
  readonly canShow: boolean;
  /** Free flight through the constellation. Not available without WebGL. */
  readonly canPilot: boolean;
  readonly pilotActive: boolean;
  setPilot(on: boolean): void;
  setWorldOrigin(slot: number): void;
  setMultiplayer(active: boolean): void;
  setRoomAuthority?(localHost: boolean): void;
  resetRemoteInterpolation?(): void;
  setRemoteTopology(playerId: string, topology: AnonymousTopology): void;
  setLocalTopology(playerId: string, topology: AnonymousTopology | null): void;
  setPlayerNames(names: Map<string, string>): void;
  setRemotePositions(playerId: string, positions: Float32Array): void;
  setRemoteShip(playerId: string, pose: Pose, name?: string, profile?: PilotProfile): void;
  setPlayerProfile(playerId: string, profile: PilotProfile): void;
  setHangarOpen(open: boolean): void;
  previewSound(kind: "engine" | "afterburner" | "laser"): void;
  setRemoteShots(shots: ShotSnapshot[], impacts: ImpactSnapshot[], localPlayerId?: string): void;
  reconcileLocalShot(sequence: number, accepted: boolean): void;
  setSurfaceSnapshot?(snapshot: SurfaceNetworkSnapshot, estimatedHostTime: number, rttMs: number): void;
  reconcileSurfaceFire?(sequence: number, accepted: boolean): void;
  setSurfaceLaserColor?(color: string): void;
  setAuthoritativePose(pose: Pose): void;
  clearSelection(): void;
  requestFastTravel(): void;
  removeRemote(playerId: string): void;
  destroy(): void;
}
