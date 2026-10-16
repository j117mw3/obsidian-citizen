export const DEFAULT_SURFACE_LASER_COLOR = "#8CECFF";
export const MIN_SURFACE_LASER_LUMINANCE = 0.30;

function linearChannel(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function encodedChannel(value: number): number {
  const linear = Math.max(0, Math.min(1, value));
  const encoded = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(encoded * 255)));
}

function luminanceOfLinear(rgb: readonly [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

export function surfaceLaserLuminance(value: unknown): number | null {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) return null;
  const rgb: [number, number, number] = [
    linearChannel(parseInt(value.slice(1, 3), 16)),
    linearChannel(parseInt(value.slice(3, 5), 16)),
    linearChannel(parseInt(value.slice(5, 7), 16)),
  ];
  return luminanceOfLinear(rgb);
}

/** Normalize a valid custom color and mix dark colors toward white in linear RGB. */
export function normalizeSurfaceLaserColor(value: unknown): string | null {
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) return null;
  const rgb: [number, number, number] = [
    linearChannel(parseInt(value.slice(1, 3), 16)),
    linearChannel(parseInt(value.slice(3, 5), 16)),
    linearChannel(parseInt(value.slice(5, 7), 16)),
  ];
  const luminance = luminanceOfLinear(rgb);
  if (luminance < MIN_SURFACE_LASER_LUMINANCE) {
    // A small rounding margin keeps the encoded 8-bit result above the floor.
    const target = Math.min(1, MIN_SURFACE_LASER_LUMINANCE + 0.002);
    const mix = Math.min(1, (target - luminance) / (1 - luminance));
    for (let i = 0; i < 3; i++) rgb[i] += (1 - rgb[i]) * mix;
  }
  let normalized = `#${rgb.map(encodedChannel).map(channel => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  // Protect the contract against any rounding edge case in the sRGB encoding.
  while ((surfaceLaserLuminance(normalized) ?? 0) < MIN_SURFACE_LASER_LUMINANCE) {
    const channels = [1, 3, 5].map(offset => parseInt(normalized.slice(offset, offset + 2), 16));
    normalized = `#${channels.map(channel => Math.min(255, channel + 1).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  }
  return normalized;
}

/** Saved settings have a safe fallback; malformed network updates are rejected instead. */
export function savedSurfaceLaserColor(value: unknown): string {
  return normalizeSurfaceLaserColor(value) ?? DEFAULT_SURFACE_LASER_COLOR;
}

export function isApprovedSurfaceLaserColor(value: unknown): value is string {
  return typeof value === "string" && normalizeSurfaceLaserColor(value) === value && value === value.toUpperCase();
}
