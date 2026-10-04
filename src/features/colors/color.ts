/**
 * ColorTools (4.7): conversões, formatos, gradiente, histórico e paletas. Tudo local; a
 * biblioteca vai para a seção `colors` do BrowserStore (SQLite no app).
 */
import type { AutoCopy } from "@/features/browser/feature-prefs";

export type Rgb = { r: number; g: number; b: number };
export type Hsl = { h: number; s: number; l: number };

export type ColorEntry = { hex: string; at: number; pinned: boolean; source?: string };
export type Palette = { id: string; name: string; colors: string[] };
export type ColorLibrary = { history: ColorEntry[]; palettes: Palette[] };

export const emptyColorLibrary: ColorLibrary = { history: [], palettes: [] };

const HEX = /^#([0-9a-f]{6})$/i;
const HISTORY_MAX = 500;
const PALETTES_MAX = 50;
const PALETTE_COLORS_MAX = 64;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function hexOfRgb({ r, g, b }: Rgb): string {
  return `#${[r, g, b].map((value) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0")).join("")}`;
}

export function rgbOfHex(hex: string): Rgb | null {
  const match = HEX.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1]!, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

export function hslOfRgb({ r, g, b }: Rgb): Hsl {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h =
      max === red
        ? (green - blue) / d + (green < blue ? 6 : 0)
        : max === green
          ? (blue - red) / d + 2
          : (red - green) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h) % 360, s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function rgbOfHsl({ h, s, l }: Hsl): Rgb {
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}

export function formatColor(hex: string, format: Exclude<AutoCopy, "off">): string {
  const rgb = rgbOfHex(hex);
  if (!rgb) return hex;
  if (format === "rgb") return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  if (format === "hsl") {
    const { h, s, l } = hslOfRgb(rgb);
    return `hsl(${h}, ${s}%, ${l}%)`;
  }
  return hex.toUpperCase();
}

/** "#abc", "#aabbcc", "rgb(…)", "hsl(…)" → "#aabbcc" (null se não for cor). */
export function parseColor(input: string): string | null {
  const text = input.trim().toLowerCase();
  const short = /^#?([0-9a-f]{3})$/.exec(text);
  if (short) return `#${[...short[1]!].map((char) => char + char).join("")}`;
  const long = /^#?([0-9a-f]{6})$/.exec(text);
  if (long) return `#${long[1]}`;
  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(text);
  if (rgb) {
    const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number) as [number, number, number];
    if ([r, g, b].every((value) => value <= 255)) return hexOfRgb({ r, g, b });
  }
  const hsl =
    /^hsla?\(\s*(\d{1,3}(?:\.\d+)?)(?:deg)?[\s,]+(\d{1,3}(?:\.\d+)?)%[\s,]+(\d{1,3}(?:\.\d+)?)%/.exec(
      text,
    );
  if (hsl) {
    return hexOfRgb(rgbOfHsl({ h: Number(hsl[1]) % 360, s: Number(hsl[2]), l: Number(hsl[3]) }));
  }
  return null;
}

/** Texto escuro ou claro por cima da cor (contraste). */
export function readableOn(hex: string): "#000000" | "#ffffff" {
  const rgb = rgbOfHex(hex);
  if (!rgb) return "#000000";
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
  return lum > 0.4 ? "#000000" : "#ffffff";
}

export type GradientStop = { color: string; at: number };
export type Gradient = {
  kind: "linear" | "radial";
  angle: number;
  shape: "circle" | "ellipse";
  stops: GradientStop[];
};

export const defaultGradient: Gradient = {
  kind: "linear",
  angle: 90,
  shape: "circle",
  stops: [
    { color: "#d10a11", at: 0 },
    { color: "#1c7ed6", at: 100 },
  ],
};

/** CSS do gradiente (paradas em ordem de posição). */
export function gradientCss(gradient: Gradient): string {
  const stops = [...gradient.stops]
    .sort((a, b) => a.at - b.at)
    .map((stop) => `${stop.color} ${clamp(Math.round(stop.at), 0, 100)}%`)
    .join(", ");
  return gradient.kind === "radial"
    ? `radial-gradient(${gradient.shape}, ${stops})`
    : `linear-gradient(${clamp(Math.round(gradient.angle), 0, 360)}deg, ${stops})`;
}

/** Nova cor no topo do histórico (sem repetir; fixadas nunca saem pelo limite). */
export function addToHistory(
  library: ColorLibrary,
  hex: string,
  now: number,
  limit: number,
  source?: string,
): ColorLibrary {
  const clean = parseColor(hex);
  if (!clean) return library;
  const old = library.history.find((item) => item.hex === clean);
  const entry: ColorEntry = {
    hex: clean,
    at: now,
    pinned: old?.pinned ?? false,
    ...(source ? { source: source.slice(0, 200) } : {}),
  };
  const history = [entry, ...library.history.filter((item) => item.hex !== clean)];
  // Passou do limite: saem as mais antigas que não estão fixadas.
  let free = limit;
  const kept = history.filter((item) => {
    if (item.pinned) return true;
    free -= 1;
    return free >= 0;
  });
  return { ...library, history: kept };
}

/** Busca no histórico: HEX, RGB ou o site de onde veio. */
export function searchHistory(history: ColorEntry[], query: string): ColorEntry[] {
  const text = query.trim().toLowerCase().replace(/^#/, "");
  if (!text) return history;
  return history.filter((item) => {
    const rgb = rgbOfHex(item.hex);
    const haystack = [
      item.hex.slice(1),
      rgb ? `${rgb.r},${rgb.g},${rgb.b} ${rgb.r} ${rgb.g} ${rgb.b}` : "",
      item.source ?? "",
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(text);
  });
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parsePalette(value: unknown, index: number): Palette | null {
  if (!isObject(value)) return null;
  const name = typeof value["name"] === "string" ? value["name"].trim().slice(0, 60) : "";
  const colors = Array.isArray(value["colors"])
    ? [
        ...new Set(
          value["colors"]
            .map((item) => (typeof item === "string" ? parseColor(item) : null))
            .filter((item): item is string => item !== null),
        ),
      ].slice(0, PALETTE_COLORS_MAX)
    : [];
  const id =
    typeof value["id"] === "string" && /^[\w-]{1,40}$/.test(value["id"])
      ? value["id"]
      : `p${index + 1}`;
  return { id, name: name || `Paleta ${index + 1}`, colors };
}

/** Biblioteca gravada (ou importada) → só o que é válido. */
export function parseColorLibrary(value: unknown): ColorLibrary {
  if (!isObject(value)) return emptyColorLibrary;
  const seen = new Set<string>();
  const history: ColorEntry[] = [];
  for (const item of Array.isArray(value["history"]) ? value["history"] : []) {
    if (!isObject(item) || typeof item["hex"] !== "string") continue;
    const hex = parseColor(item["hex"]);
    if (!hex || seen.has(hex)) continue;
    seen.add(hex);
    history.push({
      hex,
      at: Number.isFinite(item["at"]) ? (item["at"] as number) : 0,
      pinned: item["pinned"] === true,
      ...(typeof item["source"] === "string" && item["source"]
        ? { source: item["source"].slice(0, 200) }
        : {}),
    });
    if (history.length >= HISTORY_MAX) break;
  }
  const ids = new Set<string>();
  const palettes: Palette[] = [];
  for (const [index, item] of (Array.isArray(value["palettes"])
    ? value["palettes"]
    : []
  ).entries()) {
    const palette = parsePalette(item, index);
    if (!palette || ids.has(palette.id)) continue;
    ids.add(palette.id);
    palettes.push(palette);
    if (palettes.length >= PALETTES_MAX) break;
  }
  return { history, palettes };
}

/** Arquivo de exportação (histórico e paletas). */
export function exportColorLibrary(library: ColorLibrary): string {
  return `${JSON.stringify({ app: "Agzos Browser", kind: "color-tools", ...library }, null, 2)}\n`;
}

/** Importa juntando com o que já existe (paletas com o mesmo id são trocadas). */
export function importColorLibrary(current: ColorLibrary, text: string): ColorLibrary | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(parsed) || parsed["kind"] !== "color-tools") return null;
  const incoming = parseColorLibrary(parsed);
  const history = parseColorLibrary({
    history: [...current.history, ...incoming.history].sort((a, b) => b.at - a.at),
  }).history;
  const byId = new Map(current.palettes.map((item) => [item.id, item]));
  for (const palette of incoming.palettes) byId.set(palette.id, palette);
  return { history, palettes: [...byId.values()].slice(0, PALETTES_MAX) };
}
