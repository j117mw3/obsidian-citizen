export const SHIP_IDS = ["classic", "vector", "dart", "bulwark", "crescent", "revenant", "dart-interceptor", "bulwark-gunship"] as const;
export const ENGINE_SOUND_IDS = ["classic", "ion", "turbine", "stellar"] as const;
export const AFTERBURNER_SOUND_IDS = ["classic", "plasma", "fusion", "stellar"] as const;
export const LASER_SOUND_IDS = ["classic", "pulse", "arc", "pulse-xl"] as const;

export type ShipId = typeof SHIP_IDS[number];
export type EngineSoundId = typeof ENGINE_SOUND_IDS[number];
export type AfterburnerSoundId = typeof AFTERBURNER_SOUND_IDS[number];
export type LaserSoundId = typeof LASER_SOUND_IDS[number];

export interface PilotProfile {
  revision: number;
  ship: ShipId;
  engine: EngineSoundId;
  afterburner: AfterburnerSoundId;
  laser: LaserSoundId;
}

export const DEFAULT_PILOT_PROFILE: PilotProfile = { revision: 1, ship: "classic", engine: "classic", afterburner: "classic", laser: "classic" };

export function stepPresentation(bank: number, tilt: number, input: { yaw: number; strafe: number; pitch: number; lift: number }, dt: number): [number, number] {
  const ease = 1 - Math.exp(-8 * Math.max(0, Math.min(0.1, dt)));
  const targetBank = Math.max(-0.55, Math.min(0.55, input.yaw * 0.45 - input.strafe * 0.22));
  const targetTilt = Math.max(-0.4, Math.min(0.4, input.pitch * 0.28 + input.lift * 0.1));
  return [bank + (targetBank - bank) * ease, tilt + (targetTilt - tilt) * ease];
}

export function validPilotProfile(value: unknown): value is PilotProfile {
  if (!value || typeof value !== "object") return false;
  const p = value as PilotProfile;
  return Number.isSafeInteger(p.revision) && p.revision > 0
    && (SHIP_IDS as readonly string[]).includes(p.ship)
    && (ENGINE_SOUND_IDS as readonly string[]).includes(p.engine)
    && (AFTERBURNER_SOUND_IDS as readonly string[]).includes(p.afterburner)
    && (LASER_SOUND_IDS as readonly string[]).includes(p.laser);
}
