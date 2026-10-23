import { describe, expect, it } from "vitest";

import {
  applyColorAffine,
  colorAffine,
  compose,
  convolve3,
  isHexColor,
  keyAlpha,
  needsPixels,
  parseHex,
  sharpenKernel,
  vignetteAlpha,
} from "./filters";
import { DEFAULT_ADJUST, isNeutralAdjust, type Adjust } from "./model";

const pixel = (r: number, g: number, b: number, a = 255) => new Uint8ClampedArray([r, g, b, a]);
const adjust = (patch: Partial<Adjust>): Adjust => ({ ...DEFAULT_ADJUST, ...patch });
const run = (data: Uint8ClampedArray, patch: Partial<Adjust>) => {
  applyColorAffine(data, colorAffine(adjust(patch)));
  return [...data];
};

describe("matriz de cor", () => {
  it("sem ajuste, a imagem fica igual", () => {
    expect(isNeutralAdjust(DEFAULT_ADJUST)).toBe(true);
    expect(run(pixel(10, 120, 250), {})).toEqual([10, 120, 250, 255]);
  });

  it("brilho escala os canais e satura em 255", () => {
    expect(run(pixel(100, 100, 100), { brightness: 50 })).toEqual([150, 150, 150, 255]);
    expect(run(pixel(200, 0, 0), { brightness: 100 })).toEqual([255, 0, 0, 255]);
    expect(run(pixel(200, 100, 50), { brightness: -100 })).toEqual([0, 0, 0, 255]);
  });

  it("contraste empurra para longe de 50%", () => {
    const [r] = run(pixel(64, 0, 0), { contrast: 100 });
    expect(r).toBeLessThan(64);
    const mid = run(pixel(128, 128, 128), { contrast: 100 });
    expect(Math.abs(mid[0]! - 128)).toBeLessThanOrEqual(1);
  });

  it("tons de cinza, sépia e matiz seguem o modelo do CSS", () => {
    const [r, g, b] = run(pixel(200, 40, 40), { grayscale: 100 });
    expect(r).toBe(g);
    expect(g).toBe(b);
    const sepia = run(pixel(255, 255, 255), { sepia: 100 });
    expect(sepia[0]).toBeGreaterThan(sepia[2]!);
    const shifted = run(pixel(255, 0, 0), { hue: 120 });
    expect(shifted[1]).toBeGreaterThan(shifted[0]!);
  });

  it("composição aplica a primeira e depois a segunda", () => {
    const double = { m: [2, 0, 0, 0, 2, 0, 0, 0, 2], o: [0, 0, 0] };
    const plus = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], o: [0.1, 0.1, 0.1] };
    const both = compose(double, plus);
    expect(both.m[0]).toBe(2);
    expect(both.o[0]).toBeCloseTo(0.1);
    const other = compose(plus, double);
    expect(other.o[0]).toBeCloseTo(0.2);
  });

  it("precisa de pixels só quando algum ajuste de cor está ligado", () => {
    expect(needsPixels(DEFAULT_ADJUST)).toBe(false);
    expect(needsPixels(adjust({ blur: 4 }))).toBe(false);
    expect(needsPixels(adjust({ sepia: 10 }))).toBe(true);
  });
});

describe("nitidez e vinheta", () => {
  it("o núcleo soma 1 (preserva o brilho médio) e some com 0", () => {
    const kernel = sharpenKernel(50);
    expect(kernel.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1);
    expect(sharpenKernel(0)).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 0]);
  });

  it("convolução com núcleo identidade não muda nada", () => {
    const data = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 128, 7, 8, 9, 255, 10, 11, 12, 0]);
    const out = convolve3(data, 2, 2, sharpenKernel(0));
    expect([...out]).toEqual([...data]);
  });

  it("vinheta é zero no centro, cresce para a borda e some com 0 de força", () => {
    expect(vignetteAlpha(0, 80)).toBe(0);
    expect(vignetteAlpha(1.2, 80)).toBeGreaterThan(vignetteAlpha(0.8, 80));
    expect(vignetteAlpha(1.2, 0)).toBe(0);
    expect(vignetteAlpha(1.4, 100)).toBeLessThanOrEqual(1);
  });
});

describe("remoção de fundo por cor", () => {
  it("zera o alfa das cores perto da chave e mantém as longe", () => {
    const data = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
    keyAlpha(data, [255, 255, 255], 10);
    expect(data[3]).toBe(0);
    expect(data[7]).toBe(255);
  });

  it("tolerância maior apaga mais; a borda fica suave", () => {
    const near = new Uint8ClampedArray([200, 200, 200, 255]);
    keyAlpha(near, [255, 255, 255], 5);
    expect(near[3]).toBe(255);
    const wide = new Uint8ClampedArray([200, 200, 200, 255]);
    keyAlpha(wide, [255, 255, 255], 40);
    expect(wide[3]).toBe(0);
    const edge = new Uint8ClampedArray([255, 255, 255, 255]);
    keyAlpha(edge, [255, 255, 255], 0, 0.5);
    expect(edge[3]).toBe(0);
  });
});

describe("cores hex", () => {
  it("aceita #rgb, #rrggbb e #rrggbbaa; recusa o resto", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255, 255]);
    expect(parseHex("#D10A11")).toEqual([209, 10, 17, 255]);
    expect(parseHex("#00000080")?.[3]).toBe(128);
    expect(parseHex("red")).toBeNull();
    expect(isHexColor("#12345")).toBe(false);
  });
});
