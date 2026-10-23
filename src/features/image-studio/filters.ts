import type { Adjust } from "./model";

/**
 * Filtros e ajustes do Agzos Imagem, puros. Cor vira uma transformação afim (3×3 + deslocamento)
 * que se compõe numa matriz só; nitidez é uma convolução 3×3; remover fundo por cor escreve o
 * alfa. Quem desenha aplica tudo sobre uma cópia da foto, nunca sobre o original.
 */

export const ADJUST_RANGES: Record<keyof Adjust, { min: number; max: number; label: string }> = {
  brightness: { min: -100, max: 100, label: "Brilho" },
  contrast: { min: -100, max: 100, label: "Contraste" },
  saturation: { min: -100, max: 100, label: "Saturação" },
  hue: { min: -180, max: 180, label: "Matiz" },
  blur: { min: 0, max: 40, label: "Desfoque" },
  sharpen: { min: 0, max: 100, label: "Nitidez" },
  grayscale: { min: 0, max: 100, label: "Tons de cinza" },
  sepia: { min: 0, max: 100, label: "Sépia" },
  vignette: { min: 0, max: 100, label: "Vinheta" },
};

/** Transformação de cor: out = m · in + o, com canais em 0–1. */
export type Affine = { m: number[]; o: number[] };

const IDENTITY: Affine = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], o: [0, 0, 0] };

/** Aplica `first` e depois `second`. */
export function compose(first: Affine, second: Affine): Affine {
  const m = new Array<number>(9).fill(0);
  const o = [0, 0, 0];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      let sum = 0;
      for (let k = 0; k < 3; k += 1) sum += second.m[row * 3 + k]! * first.m[k * 3 + col]!;
      m[row * 3 + col] = sum;
    }
    o[row] =
      second.m[row * 3]! * first.o[0]! +
      second.m[row * 3 + 1]! * first.o[1]! +
      second.m[row * 3 + 2]! * first.o[2]! +
      second.o[row]!;
  }
  return { m, o };
}

const mat = (rows: number[][]): number[] => rows.flat();

function brightness(value: number): Affine {
  const f = 1 + value / 100;
  return { m: [f, 0, 0, 0, f, 0, 0, 0, f], o: [0, 0, 0] };
}

function contrast(value: number): Affine {
  const c = 1 + value / 100;
  const o = 0.5 - 0.5 * c;
  return { m: [c, 0, 0, 0, c, 0, 0, 0, c], o: [o, o, o] };
}

/** Saturação no mesmo modelo do CSS (saturate). */
function saturation(value: number): Affine {
  const s = 1 + value / 100;
  return {
    m: mat([
      [0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s],
      [0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s],
      [0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s],
    ]),
    o: [0, 0, 0],
  };
}

/** Matiz em graus (hue-rotate do CSS). */
function hue(degrees: number): Affine {
  const angle = (degrees * Math.PI) / 180;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return {
    m: mat([
      [0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928],
      [0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.14, 0.072 - c * 0.072 - s * 0.283],
      [0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072],
    ]),
    o: [0, 0, 0],
  };
}

/** Tons de cinza (amount 0–1, mesmo modelo do CSS grayscale). */
function grayscale(amount: number): Affine {
  const a = 1 - amount;
  return {
    m: mat([
      [0.2126 + 0.7874 * a, 0.7152 - 0.7152 * a, 0.0722 - 0.0722 * a],
      [0.2126 - 0.2126 * a, 0.7152 + 0.2848 * a, 0.0722 - 0.0722 * a],
      [0.2126 - 0.2126 * a, 0.7152 - 0.7152 * a, 0.0722 + 0.9278 * a],
    ]),
    o: [0, 0, 0],
  };
}

/** Sépia (amount 0–1, mesmo modelo do CSS sepia). */
function sepia(amount: number): Affine {
  const a = 1 - amount;
  return {
    m: mat([
      [0.393 + 0.607 * a, 0.769 - 0.769 * a, 0.189 - 0.189 * a],
      [0.349 - 0.349 * a, 0.686 + 0.314 * a, 0.168 - 0.168 * a],
      [0.272 - 0.272 * a, 0.534 - 0.534 * a, 0.131 + 0.869 * a],
    ]),
    o: [0, 0, 0],
  };
}

/** Todas as transformações de cor do ajuste, numa só (na ordem do painel). */
export function colorAffine(adjust: Adjust): Affine {
  let result = IDENTITY;
  const steps: Affine[] = [
    brightness(adjust.brightness),
    contrast(adjust.contrast),
    saturation(adjust.saturation),
    hue(adjust.hue),
    grayscale(adjust.grayscale / 100),
    sepia(adjust.sepia / 100),
  ];
  for (const step of steps) result = compose(result, step);
  return result;
}

/** Aplica a transformação de cor, in place, em RGBA (o alfa não muda). */
export function applyColorAffine(data: Uint8ClampedArray, affine: Affine): void {
  const { m, o } = affine;
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index]! / 255;
    const g = data[index + 1]! / 255;
    const b = data[index + 2]! / 255;
    data[index] = clamp255((m[0]! * r + m[1]! * g + m[2]! * b + o[0]!) * 255);
    data[index + 1] = clamp255((m[3]! * r + m[4]! * g + m[5]! * b + o[1]!) * 255);
    data[index + 2] = clamp255((m[6]! * r + m[7]! * g + m[8]! * b + o[2]!) * 255);
  }
}

const clamp255 = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : Math.round(value));

/** Núcleo 3×3 de nitidez (0 = sem efeito; 100 = o máximo do painel). */
export function sharpenKernel(amount: number): number[] {
  const a = Math.max(0, Math.min(100, amount)) / 100;
  const neg = a === 0 ? 0 : -a;
  return [0, neg, 0, neg, 1 + 4 * a, neg, 0, neg, 0];
}

/** Convolução 3×3 sobre RGB (o alfa é copiado). Devolve um buffer novo. */
export function convolve3(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  kernel: number[],
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        for (let ky = -1; ky <= 1; ky += 1) {
          const sy = Math.min(height - 1, Math.max(0, y + ky));
          for (let kx = -1; kx <= 1; kx += 1) {
            const sx = Math.min(width - 1, Math.max(0, x + kx));
            sum += data[(sy * width + sx) * 4 + channel]! * kernel[(ky + 1) * 3 + kx + 1]!;
          }
        }
        out[index + channel] = clamp255(sum);
      }
      out[index + 3] = data[index + 3]!;
    }
  }
  return out;
}

/** Vinheta: escurecimento radial. `distance` 0 no centro, 1 na borda do meio da tela. */
export function vignetteAlpha(distance: number, amount: number): number {
  const strength = Math.max(0, Math.min(100, amount)) / 100;
  if (strength === 0) return 0;
  const inner = 0.55 - 0.3 * strength;
  const t = Math.max(0, Math.min(1, (distance - inner) / (1.42 - inner)));
  return Math.min(1, t * t * strength * 0.9);
}

/** "#rgb", "#rrggbb" ou "#rrggbbaa" → [r, g, b, a] (0–255). Null se inválido. */
export function parseHex(value: string): [number, number, number, number] | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim());
  if (!match) return null;
  let hex = match[1]!;
  if (hex.length === 3)
    hex = hex
      .split("")
      .map((char) => char + char)
      .join("");
  const channel = (offset: number) => parseInt(hex.slice(offset, offset + 2), 16);
  return [channel(0), channel(2), channel(4), hex.length === 8 ? channel(6) : 255];
}

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && parseHex(value) !== null;
}

/**
 * Remoção de fundo por cor (varinha mágica): pixels a até `tolerance` (0–100, distância de
 * cor normalizada) da cor-chave ficam transparentes; uma faixa de transição suaviza a borda.
 */
export function keyAlpha(
  data: Uint8ClampedArray,
  key: [number, number, number],
  tolerance: number,
  softness = 0.06,
): void {
  const t = Math.max(0, Math.min(100, tolerance)) / 100;
  const max = Math.sqrt(3) * 255;
  for (let index = 0; index < data.length; index += 4) {
    const dr = data[index]! - key[0];
    const dg = data[index + 1]! - key[1];
    const db = data[index + 2]! - key[2];
    const d = Math.sqrt(dr * dr + dg * dg + db * db) / max;
    if (d <= t) data[index + 3] = 0;
    else if (d < t + softness)
      data[index + 3] = Math.round(data[index + 3]! * ((d - t) / softness));
  }
}

/** Ajustes que pedem processamento de pixels (o resto é `filter` do canvas). */
export function needsPixels(adjust: Adjust): boolean {
  return (
    adjust.brightness !== 0 ||
    adjust.contrast !== 0 ||
    adjust.saturation !== 0 ||
    adjust.hue !== 0 ||
    adjust.grayscale !== 0 ||
    adjust.sepia !== 0 ||
    adjust.sharpen !== 0
  );
}
