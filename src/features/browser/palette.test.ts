import { describe, expect, it } from "vitest";

import { filterPalette, normalize, scoreItem, type PaletteItem } from "./palette";

const items: PaletteItem[] = [
  { id: "tab:1", group: "Guias", label: "YouTube", detail: "youtube.com" },
  { id: "cmd:settings.open", group: "Comandos", label: "Configurações", shortcut: "Ctrl+," },
  { id: "cmd:tab.new", group: "Comandos", label: "Nova guia", shortcut: "Ctrl+T" },
  { id: "cmd:tab.new-private", group: "Comandos", label: "Nova guia anônima" },
  { id: "url:https://github.com/", group: "Favoritos", label: "GitHub", detail: "github.com" },
];

describe("busca de comandos (Ctrl+K)", () => {
  it("ignora acentos e maiúsculas", () => {
    expect(normalize("Configurações")).toBe("configuracoes");
    expect(filterPalette(items, "configuracoes").map((item) => item.id)).toEqual([
      "cmd:settings.open",
    ]);
  });

  it("todas as palavras precisam aparecer, em qualquer ordem", () => {
    expect(filterPalette(items, "anônima nova").map((item) => item.id)).toEqual([
      "cmd:tab.new-private",
    ]);
    expect(scoreItem(items[0]!, "nada")).toBeNull();
  });

  it("começo do nome ganha de ocorrência no detalhe", () => {
    const list: PaletteItem[] = [
      { id: "a", group: "Comandos", label: "Abrir histórico", detail: "guia" },
      { id: "b", group: "Guias", label: "Guia de estilo" },
    ];
    expect(filterPalette(list, "guia")[0]!.id).toBe("b");
  });

  it("sem texto mostra os primeiros de cada grupo, na ordem dos grupos", () => {
    expect(filterPalette(items, "  ").map((item) => item.group)).toEqual([
      "Guias",
      "Comandos",
      "Comandos",
      "Comandos",
      "Favoritos",
    ]);
  });

  it("acha favorito pelo endereço", () => {
    expect(filterPalette(items, "github").map((item) => item.id)).toContain(
      "url:https://github.com/",
    );
  });
});
