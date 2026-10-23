import { describe, expect, it } from "vitest";

import { baseName, formatDuration, formatTotal } from "./format";

describe("formatDuration", () => {
  it("minutos e segundos com zero à esquerda", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(5)).toBe("0:05");
    expect(formatDuration(222)).toBe("3:42");
  });

  it("passa de uma hora", () => {
    expect(formatDuration(3600)).toBe("1:00:00");
    expect(formatDuration(3723.9)).toBe("1:02:03");
  });

  it("valor inválido vira 0:00", () => {
    expect(formatDuration(Number.NaN)).toBe("0:00");
    expect(formatDuration(-4)).toBe("0:00");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(formatDuration(null)).toBe("0:00");
    expect(formatDuration(undefined)).toBe("0:00");
  });
});

describe("formatTotal, formatBytes e baseName", () => {
  it("soma em texto curto", () => {
    expect(formatTotal(30)).toBe("30 s");
    expect(formatTotal(2640)).toBe("44 min");
    expect(formatTotal(8040)).toBe("2 h 14 min");
    expect(formatTotal(0)).toBe("0 min");
  });

  it("nome do arquivo com / e \\", () => {
    expect(baseName("/musica/rock/faixa.mp3")).toBe("faixa.mp3");
    expect(baseName("C:\\Music\\Disco\\a.flac")).toBe("a.flac");
    expect(baseName("solto.ogg")).toBe("solto.ogg");
  });
});
