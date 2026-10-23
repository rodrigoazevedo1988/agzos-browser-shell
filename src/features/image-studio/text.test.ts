import { describe, expect, it } from "vitest";

import { detectInstalled, fontCss, layoutLines, stackOf, textHeight, wrapParagraph } from "./text";
import { newText, transformAt } from "./model";

// Largura fixa: cada caractere mede 10 px.
const measure = (line: string) => line.length * 10;

describe("quebra de linha", () => {
  it("quebra nas palavras que não cabem", () => {
    expect(wrapParagraph("um dois tres", 80, measure)).toEqual(["um dois", "tres"]);
    expect(wrapParagraph("curto", 100, measure)).toEqual(["curto"]);
  });

  it("corta palavra maior que a caixa por caractere", () => {
    expect(wrapParagraph("abcdefghij", 30, measure)).toEqual(["abc", "def", "ghi", "j"]);
  });

  it("respeita as quebras explícitas e linha vazia", () => {
    expect(layoutLines("a\n\nb", 100, measure)).toEqual(["a", "", "b"]);
  });

  it("altura da caixa é linhas × entrelinha, com o respiro do fundo", () => {
    const text = newText("t", transformAt(0, 0, 100, 10), "x", 50, "#000000");
    expect(textHeight(text, 3)).toBe(180);
    const boxed = { ...text, background: { color: "#fff", padding: 10, radius: 0 } };
    expect(textHeight(boxed, 1)).toBe(80);
  });
});

describe("fontes", () => {
  it("famílias da lista têm pilha de reserva; as outras citam o nome", () => {
    expect(stackOf("Arial")).toContain("Helvetica");
    expect(stackOf("Fonte Rara")).toBe('"Fonte Rara", sans-serif');
    expect(fontCss("Serif", 700, 40)).toBe('700 40px Georgia, "Times New Roman", serif');
  });

  it("detecta fontes instaladas pela largura medida, sem contar as da lista", () => {
    const fake = (font: string) => (font.includes("Rara") ? 99 : 50);
    expect(detectInstalled(["Arial", "Rara"], fake)).toEqual(["Rara"]);
  });
});
