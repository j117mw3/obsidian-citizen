export type MotionLevel = "off" | "calm" | "lively";
export type PaletteName = "vibrant" | "colorblind" | "theme";
export type GroupBy = "folder" | "tag" | "none";
import { AFTERBURNER_SOUND_IDS, DEFAULT_PILOT_PROFILE, ENGINE_SOUND_IDS, LASER_SOUND_IDS, SHIP_IDS, type AfterburnerSoundId, type EngineSoundId, type LaserSoundId, type ShipId } from "./pilotProfile";
import { savedSurfaceLaserColor } from "./surfaceColor";

export interface ConstellationSettings {
  motion: MotionLevel;
  autoRotate: boolean;
  rotateSpeed: number;
  glow: number;
  bloom: boolean;
  labelCount: number;
  labelSize: number;
  palette: PaletteName;
  groupBy: GroupBy;
  folderDepth: number;
  showOrphans: boolean;
  highContrast: boolean;
  respectReducedMotion: boolean;
  highlightActive: boolean;
  excludeFolders: string;
  openOnStartup: boolean;
  pilotEnabled: boolean;
  pilotSensitivity: number;
  pilotInvertY: boolean;
  pilotView: "chase" | "cockpit";
  pilotSound: boolean;
  pilotMuteEngine: boolean;
  pilotMuteAfterburner: boolean;
  pilotVolume: number;
  pilotWireframe: boolean;
  pilotAgility: number;
  pilotSpeed: number;
  pilotMouse: "capture" | "cursor";
  pilotShip: ShipId;
  pilotEngineSound: EngineSoundId;
  pilotAfterburnerSound: AfterburnerSoundId;
  pilotLaserSound: LaserSoundId;
  pilotNearbyAudio: boolean;
  surfaceLaserColor: string;
  surfaceSensitivity: number;
  surfaceInvertY: boolean;
  surfaceFov: number;
  surfaceHeadBob: boolean;
  surfaceCrouchMode: "hold";
  surfaceForwardKey: string;
  surfaceBackKey: string;
  surfaceLeftKey: string;
  surfaceRightKey: string;
  surfaceJumpKey: string;
  surfaceSprintKey: string;
  surfaceCrouchKey: string;
  surfaceLeanLeftKey: string;
  surfaceLeanRightKey: string;
  surfaceInteractKey: string;
  multiplayerName: string;
  multiplayerConnectionMode: "public" | "custom";
  multiplayerCustomServerUrl: string;
  multiplayerRelayUrl: string;
  multiplayerLegacyServerUrl: string;
  settingsSchemaVersion: number;
}

export const DEFAULT_SETTINGS: ConstellationSettings = {
  motion: "calm",
  autoRotate: true,
  rotateSpeed: 0.5,
  glow: 1,
  bloom: true,
  labelCount: 14,
  labelSize: 13,
  palette: "vibrant",
  groupBy: "folder",
  folderDepth: 1,
  showOrphans: true,
  highContrast: false,
  respectReducedMotion: true,
  highlightActive: true,
  excludeFolders: "",
  openOnStartup: false,
  pilotEnabled: true,
  pilotSensitivity: 1,
  pilotInvertY: false,
  pilotView: "chase",
  pilotSound: true,
  pilotMuteEngine: false,
  pilotMuteAfterburner: false,
  pilotVolume: 0.5,
  pilotWireframe: true,
  pilotAgility: 1,
  pilotSpeed: 1,
  pilotMouse: "capture",
  pilotShip: DEFAULT_PILOT_PROFILE.ship,
  pilotEngineSound: DEFAULT_PILOT_PROFILE.engine,
  pilotAfterburnerSound: DEFAULT_PILOT_PROFILE.afterburner,
  pilotLaserSound: DEFAULT_PILOT_PROFILE.laser,
  pilotNearbyAudio: true,
  surfaceLaserColor: "#8CECFF",
  surfaceSensitivity: 1,
  surfaceInvertY: false,
  surfaceFov: 75,
  surfaceHeadBob: false,
  surfaceCrouchMode: "hold",
  surfaceForwardKey: "KeyW",
  surfaceBackKey: "KeyS",
  surfaceLeftKey: "KeyA",
  surfaceRightKey: "KeyD",
  surfaceJumpKey: "Space",
  surfaceSprintKey: "ShiftLeft",
  surfaceCrouchKey: "ControlLeft",
  surfaceLeanLeftKey: "KeyQ",
  surfaceLeanRightKey: "KeyE",
  surfaceInteractKey: "KeyF",
  multiplayerName: "Pilot",
  multiplayerConnectionMode: "public",
  multiplayerCustomServerUrl: "",
  multiplayerRelayUrl: "https://ntfy.sh",
  multiplayerLegacyServerUrl: "",
  settingsSchemaVersion: 5,
};

const clamp = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === "number" && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const validSurfaceKey = (value: unknown): value is string => typeof value === "string"
  && /^(?:Key[A-Z]|Digit[0-9]|Numpad[0-9]|Space|Enter|Escape|ShiftLeft|ShiftRight|ControlLeft|ControlRight|AltLeft|AltRight|Arrow(?:Up|Down|Left|Right))$/.test(value);
function sanitizeSurfaceKeys(raw: Record<string, unknown>): Record<string, string> {
  const definitions: Array<[string, string, string[]]> = [
    ["surfaceForwardKey", "KeyW", ["ArrowUp", "Numpad8", "KeyI"]], ["surfaceBackKey", "KeyS", ["ArrowDown", "Numpad2", "KeyK"]],
    ["surfaceLeftKey", "KeyA", ["ArrowLeft", "Numpad4", "KeyJ"]], ["surfaceRightKey", "KeyD", ["ArrowRight", "Numpad6", "KeyL"]],
    ["surfaceJumpKey", "Space", ["Numpad0", "Enter", "KeyV"]], ["surfaceSprintKey", "ShiftLeft", ["ShiftRight", "ControlLeft"]],
    ["surfaceCrouchKey", "ControlLeft", ["Numpad5", "KeyX", "ControlRight"]], ["surfaceLeanLeftKey", "KeyQ", ["Numpad7", "KeyZ"]],
    ["surfaceLeanRightKey", "KeyE", ["Numpad9", "KeyR"]], ["surfaceInteractKey", "KeyF", ["KeyG", "KeyT"]],
  ];
  const used = new Set<string>(), result: Record<string, string> = {};
  for (const [key, fallback, alternatives] of definitions) {
    const requested = validSurfaceKey(raw[key]) ? raw[key] : fallback;
    const chosen = !used.has(requested) ? requested : [fallback, ...alternatives].find(candidate => !used.has(candidate)) ?? "Escape";
    result[key] = chosen; used.add(chosen);
  }
  return result as Pick<ConstellationSettings, "surfaceForwardKey" | "surfaceBackKey" | "surfaceLeftKey" | "surfaceRightKey" | "surfaceJumpKey"
    | "surfaceSprintKey" | "surfaceCrouchKey" | "surfaceLeanLeftKey" | "surfaceLeanRightKey" | "surfaceInteractKey">;
}

/** Merge saved data over the defaults, dropping anything the wrong type or out of range (hand-edited or older data.json). */
export function sanitizeSettings(raw: unknown): ConstellationSettings {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const legacyServerUrl = typeof r.multiplayerSignalingUrl === "string" ? r.multiplayerSignalingUrl.slice(0, 512) : "";
  const oldCustomUrl = typeof r.multiplayerCustomServerUrl === "string" ? r.multiplayerCustomServerUrl.slice(0, 512) : "";
  const storedSchema = Math.max(0, Math.floor(clamp(r.settingsSchemaVersion, 0, 100, 0)));
  // 0.4.x upstream settings had a different Dart/Bulwark meaning and private
  // TURN fields. The upstream-only collapse/credential fields identify that
  // source, so preserve those selections as the imported variants.
  const fromUpstream = storedSchema === 0 && ("pilotCollapse" in r || "multiplayerTurnUrl" in r || "multiplayerTurnCredential" in r);
  const legacyShip = r.pilotShip === "striker" ? "classic"
    : fromUpstream && r.pilotShip === "dart" ? "dart-interceptor"
      : fromUpstream && r.pilotShip === "bulwark" ? "bulwark-gunship" : r.pilotShip;
  const legacyUrl = typeof r.multiplayerLegacyServerUrl === "string" ? r.multiplayerLegacyServerUrl.slice(0, 512)
    : [legacyServerUrl, oldCustomUrl].find(value => /^wss?:\/\//i.test(value)) ?? "";
  const migratedCustomUrl = oldCustomUrl && !/^wss?:\/\//i.test(oldCustomUrl) ? oldCustomUrl : "";
  const connectionMode = storedSchema < 2 ? d.multiplayerConnectionMode : pick(r.multiplayerConnectionMode, ["public", "custom"] as const, d.multiplayerConnectionMode);
  const migratedKeys = storedSchema < 4 && (r.surfaceCrouchKey === "KeyC" || r.surfaceCrouchKey === undefined) ? { ...r, surfaceCrouchKey: "ControlLeft" } : r;
  const surfaceKeys = sanitizeSurfaceKeys(migratedKeys) as Pick<ConstellationSettings, "surfaceForwardKey" | "surfaceBackKey" | "surfaceLeftKey" | "surfaceRightKey" | "surfaceJumpKey"
    | "surfaceSprintKey" | "surfaceCrouchKey" | "surfaceLeanLeftKey" | "surfaceLeanRightKey" | "surfaceInteractKey">;
  return {
    motion: pick(r.motion, ["off", "calm", "lively"] as const, d.motion),
    autoRotate: bool(r.autoRotate, d.autoRotate),
    rotateSpeed: clamp(r.rotateSpeed, 0.1, 2, d.rotateSpeed),
    glow: clamp(r.glow, 0, 1.5, d.glow),
    bloom: bool(r.bloom, d.bloom),
    labelCount: Math.round(clamp(r.labelCount, 0, 40, d.labelCount)),
    labelSize: Math.round(clamp(r.labelSize, 10, 24, d.labelSize)),
    palette: pick(r.palette, ["vibrant", "colorblind", "theme"] as const, d.palette),
    groupBy: pick(r.groupBy, ["folder", "tag", "none"] as const, d.groupBy),
    folderDepth: Math.round(clamp(r.folderDepth, 1, 4, d.folderDepth)),
    showOrphans: bool(r.showOrphans, d.showOrphans),
    highContrast: bool(r.highContrast, d.highContrast),
    respectReducedMotion: bool(r.respectReducedMotion, d.respectReducedMotion),
    highlightActive: bool(r.highlightActive, d.highlightActive),
    excludeFolders: typeof r.excludeFolders === "string" ? r.excludeFolders : d.excludeFolders,
    openOnStartup: bool(r.openOnStartup, d.openOnStartup),
    pilotEnabled: bool(r.pilotEnabled, d.pilotEnabled),
    pilotSensitivity: clamp(r.pilotSensitivity, 0.2, 3, d.pilotSensitivity),
    pilotInvertY: bool(r.pilotInvertY, d.pilotInvertY),
    pilotView: pick(r.pilotView, ["chase", "cockpit"] as const, d.pilotView),
    pilotSound: bool(r.pilotSound, d.pilotSound),
    pilotMuteEngine: bool(r.pilotMuteEngine, d.pilotMuteEngine),
    pilotMuteAfterburner: bool(r.pilotMuteAfterburner, d.pilotMuteAfterburner),
    pilotVolume: clamp(r.pilotVolume, 0, 1, d.pilotVolume),
    pilotWireframe: bool(r.pilotWireframe, d.pilotWireframe),
    pilotAgility: clamp(r.pilotAgility, 0.5, 1.5, d.pilotAgility),
    pilotSpeed: clamp(r.pilotSpeed, 0.4, 3, d.pilotSpeed),
    pilotMouse: pick(r.pilotMouse, ["capture", "cursor"] as const, d.pilotMouse),
    pilotShip: pick(legacyShip, SHIP_IDS, d.pilotShip),
    pilotEngineSound: pick(r.pilotEngineSound, ENGINE_SOUND_IDS, d.pilotEngineSound),
    pilotAfterburnerSound: pick(r.pilotAfterburnerSound, AFTERBURNER_SOUND_IDS, d.pilotAfterburnerSound),
    pilotLaserSound: pick(r.pilotLaserSound, LASER_SOUND_IDS, d.pilotLaserSound),
    pilotNearbyAudio: bool(r.pilotNearbyAudio, d.pilotNearbyAudio),
    surfaceLaserColor: savedSurfaceLaserColor(r.surfaceLaserColor),
    surfaceSensitivity: clamp(r.surfaceSensitivity, 0.2, 3, d.surfaceSensitivity),
    surfaceInvertY: bool(r.surfaceInvertY, d.surfaceInvertY),
    surfaceFov: clamp(r.surfaceFov, 60, 100, d.surfaceFov),
    surfaceHeadBob: bool(r.surfaceHeadBob, d.surfaceHeadBob),
    surfaceCrouchMode: "hold",
    ...surfaceKeys,
    multiplayerName: typeof r.multiplayerName === "string" ? r.multiplayerName.trim().slice(0, 24) || d.multiplayerName : d.multiplayerName,
    multiplayerConnectionMode: connectionMode,
    multiplayerCustomServerUrl: migratedCustomUrl,
    multiplayerRelayUrl: typeof r.multiplayerRelayUrl === "string" ? r.multiplayerRelayUrl.slice(0, 512) : d.multiplayerRelayUrl,
    multiplayerLegacyServerUrl: legacyUrl,
    settingsSchemaVersion: 5,
  };
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function prefersMoreContrast(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-contrast: more)").matches;
}

/** Motion level after the operating system's reduced-motion preference is applied. */
export function effectiveMotion(s: ConstellationSettings): MotionLevel {
  return s.respectReducedMotion && prefersReducedMotion() ? "off" : s.motion;
}

export function effectiveAutoRotate(s: ConstellationSettings): boolean {
  return s.autoRotate && !(s.respectReducedMotion && prefersReducedMotion());
}

/** High contrast is on when chosen here or when the operating system asks for more contrast. */
export function effectiveHighContrast(s: ConstellationSettings): boolean {
  return s.highContrast || prefersMoreContrast();
}
