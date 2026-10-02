import type { Prefs } from "../store/state";

/**
 * Limites do GX Control (3.0). Os mesmos intervalos estão em electron/gx-control.cjs, que
 * aplica os limites no main (hibernação, desaceleração de CPU e emulação de rede).
 */
export const LIMIT_RANGES = {
  ramLimitMB: { min: 512, max: 16_384, step: 256 },
  cpuLimitPercent: { min: 10, max: 100, step: 5 },
  netDownKbps: { min: 256, max: 100_000, step: 256 },
  netUpKbps: { min: 128, max: 50_000, step: 128 },
} as const;

export type LimitPrefs = Pick<
  Prefs,
  | "ramLimitOn"
  | "ramLimitMB"
  | "cpuLimitOn"
  | "cpuLimitPercent"
  | "netLimitOn"
  | "netDownKbps"
  | "netUpKbps"
>;

export const DEFAULT_LIMITS: LimitPrefs = {
  ramLimitOn: false,
  ramLimitMB: 2048,
  cpuLimitOn: false,
  cpuLimitPercent: 50,
  netLimitOn: false,
  netDownKbps: 10_000,
  netUpKbps: 2_000,
};

export function clampLimit(key: keyof typeof LIMIT_RANGES, value: unknown): number {
  const range = LIMIT_RANGES[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIMITS[key];
  return Math.round(Math.min(range.max, Math.max(range.min, value)));
}

/** Preferências gravadas → limites válidos (o que vier estranho volta ao padrão). */
export function parseLimits(raw: Record<string, unknown>): LimitPrefs {
  const bool = (key: "ramLimitOn" | "cpuLimitOn" | "netLimitOn") =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : DEFAULT_LIMITS[key];
  return {
    ramLimitOn: bool("ramLimitOn"),
    ramLimitMB: clampLimit("ramLimitMB", raw["ramLimitMB"]),
    cpuLimitOn: bool("cpuLimitOn"),
    cpuLimitPercent: clampLimit("cpuLimitPercent", raw["cpuLimitPercent"]),
    netLimitOn: bool("netLimitOn"),
    netDownKbps: clampLimit("netDownKbps", raw["netDownKbps"]),
    netUpKbps: clampLimit("netUpKbps", raw["netUpKbps"]),
  };
}
