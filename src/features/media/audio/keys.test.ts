import { describe, expect, it } from "vitest";

import { isNativeTarget, musicAction } from "./keys";
import { isMusicUrl, musicFileOf, musicPageUrl } from "./model";

describe("atalhos do Música", () => {
  it("Espaço alterna tocar e pausar", () => {
    expect(musicAction({ key: " " }, false)).toEqual({ type: "toggle" });
  });

  it("setas andam 5 s; com Ctrl ou ⌘ trocam de faixa", () => {
    expect(musicAction({ key: "ArrowLeft" }, false)).toEqual({ type: "seek", seconds: -5 });
    expect(musicAction({ key: "ArrowRight" }, false)).toEqual({ type: "seek", seconds: 5 });
    expect(musicAction({ key: "ArrowLeft", ctrl: true }, false)).toEqual({ type: "prev" });
    expect(musicAction({ key: "ArrowRight", meta: true }, false)).toEqual({ type: "next" });
  });

  it("M silencia; Ctrl+↑/↓ muda o volume em 5%", () => {
    expect(musicAction({ key: "m" }, false)).toEqual({ type: "mute" });
    expect(musicAction({ key: "ArrowUp", ctrl: true }, false)).toEqual({
      type: "volumeStep",
      delta: 0.05,
    });
    expect(musicAction({ key: "ArrowDown", ctrl: true }, false)).toEqual({
      type: "volumeStep",
      delta: -0.05,
    });
  });

  it("não age quando o foco é campo de texto, botão ou link", () => {
    expect(isNativeTarget("INPUT", false)).toBe(true);
    expect(isNativeTarget("BUTTON", false)).toBe(true);
    expect(isNativeTarget("DIV", true)).toBe(true);
    expect(isNativeTarget("DIV", false)).toBe(false);
    expect(musicAction({ key: " " }, true)).toBeNull();
  });

  it("combinações com Alt e Shift ficam com o navegador", () => {
    expect(musicAction({ key: " ", shift: true }, false)).toBeNull();
    expect(musicAction({ key: "ArrowLeft", alt: true }, false)).toBeNull();
    expect(musicAction({ key: "m", shift: true }, false)).toBeNull();
  });
});

describe("URL do Música", () => {
  it("reconhece agzos://musica com e sem ?file=", () => {
    expect(isMusicUrl("agzos://musica")).toBe(true);
    expect(isMusicUrl("agzos://musica?file=%2Fa.mp3")).toBe(true);
    expect(isMusicUrl("agzos://musicas")).toBe(false);
    expect(isMusicUrl("agzos://videos")).toBe(false);
  });

  it("lê o caminho do ?file= e ignora o que não é arquivo", () => {
    const url = musicPageUrl("/Música/Faixa 1.mp3");
    expect(url.startsWith("agzos://musica?file=")).toBe(true);
    expect(musicFileOf(url)).toBe("/Música/Faixa 1.mp3");
    expect(musicFileOf("agzos://musica")).toBeNull();
    expect(musicFileOf("agzos://musica?file=")).toBeNull();
    expect(musicFileOf(`agzos://musica?file=${"x".repeat(5000)}`)).toBeNull();
  });
});
