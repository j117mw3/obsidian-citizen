// Typed views of private state for integration fixtures only. No runtime hooks or vault data.
import type { MultiplayerSession } from "../src/multiplayer";

import type { SurfaceAuthority } from "../src/surfaceAuthority";

import type { SurfaceWorld } from "../src/surfaceWorld";

import type { ConstellationRenderer } from "../src/renderer";

import type { SurfacePilot } from "../src/surfacePilot";

import type { ConstellationApp } from "../src/app";
export type SessionFixture = Pick<MultiplayerSession, keyof MultiplayerSession> & {
  peers: MultiplayerSession["peers"];
  liveLatest: MultiplayerSession["liveLatest"];
  world: MultiplayerSession["world"];
  surfaceAuthority: MultiplayerSession["surfaceAuthority"];
  surfaceRoundId: MultiplayerSession["surfaceRoundId"];
  surfaceSimulatedAt: MultiplayerSession["surfaceSimulatedAt"];
  surfaceClock: MultiplayerSession["surfaceClock"];
  onPeerMessage: MultiplayerSession["onPeerMessage"];
  publishSurfaceState: MultiplayerSession["publishSurfaceState"];
  pingSurfaceHost: MultiplayerSession["pingSurfaceHost"];
};
export type AuthorityFixture = Pick<SurfaceAuthority, keyof SurfaceAuthority> & {
  connectionTiming: SurfaceAuthority["connectionTiming"];
  projectiles: SurfaceAuthority["projectiles"];
  hitConfirmations: SurfaceAuthority["hitConfirmations"];
};
export type WorldFixture = Pick<SurfaceWorld, keyof SurfaceWorld> & {
  bots: SurfaceWorld["bots"];

  players: SurfaceWorld["players"];
  arenas: SurfaceWorld["arenas"];
};
export type RendererFixture = Pick<ConstellationRenderer, keyof ConstellationRenderer> & {
  requestSurfaceDock: ConstellationRenderer["requestSurfaceDock"];
  sim: ConstellationRenderer["sim"];
  surfacePilot: ConstellationRenderer["surfacePilot"];
  surfaceWorld: ConstellationRenderer["surfaceWorld"];
  camera: ConstellationRenderer["camera"];
  controls: ConstellationRenderer["controls"];
  scene: ConstellationRenderer["scene"];
  isSurfacePointOccluded: ConstellationRenderer["isSurfacePointOccluded"];
  distantLodEnabled: ConstellationRenderer["distantLodEnabled"];
  visible: ConstellationRenderer["visible"];
  contextLost: ConstellationRenderer["contextLost"];
  frameNo: ConstellationRenderer["frameNo"];
  localSurfaceGroups: ConstellationRenderer["localSurfaceGroups"];

  roomSurfaceArenas: ConstellationRenderer["roomSurfaceArenas"];
  roomSurfaceHostTime: ConstellationRenderer["roomSurfaceHostTime"];
  roomSurfaceReceivedAt: ConstellationRenderer["roomSurfaceReceivedAt"];
  roomSurfaceLocalArena: ConstellationRenderer["roomSurfaceLocalArena"];
  roomSurfaceLocalView: ConstellationRenderer["roomSurfaceLocalView"];
  networkSurfaceBolts: ConstellationRenderer["networkSurfaceBolts"];
  reconcileSurfaceFire: ConstellationRenderer["reconcileSurfaceFire"];
  upsertNetworkSurfaceBolt: ConstellationRenderer["upsertNetworkSurfaceBolt"];
  updateNetworkSurfaceBolts: ConstellationRenderer["updateNetworkSurfaceBolts"];
  clearRoomSurfacePresentation: ConstellationRenderer["clearRoomSurfacePresentation"];
  onSurfaceFire: ConstellationRenderer["onSurfaceFire"];
};
export type PilotFixture = Pick<SurfacePilot, keyof SurfacePilot> & {
  keys: SurfacePilot["keys"];
  fire: SurfacePilot["fire"];
  heldFire: SurfacePilot["heldFire"];
  chargeStartedAt: SurfacePilot["chargeStartedAt"];
  fireSequence: SurfacePilot["fireSequence"];

  hitMarkerUntil: SurfacePilot["hitMarkerUntil"];
  applyCombatEvents: SurfacePilot["applyCombatEvents"];
};

export type AppFixture = { renderer: ConstellationApp["renderer"] };

export function fixture(value: MultiplayerSession): SessionFixture;

export function fixture(value: SurfaceAuthority): AuthorityFixture;

export function fixture(value: SurfaceWorld): WorldFixture;

export function fixture(value: ConstellationRenderer): RendererFixture;

export function fixture(value: SurfacePilot): PilotFixture;

export function fixture(value: ConstellationApp): AppFixture;

export function fixture(value: unknown): unknown { return value; }

export function requireFixture<T>(value: T | null | undefined): T { if (value == null) throw new Error("Fixture setup did not produce the required state"); return value; }
