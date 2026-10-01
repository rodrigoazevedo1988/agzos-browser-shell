import { describe, expect, it } from "vitest";

import type { VaultEntry } from "./types";
import {
  categoryOf,
  entryMatchesHost,
  groupByCategory,
  hostOf,
  knownCategories,
  matchesForUrl,
} from "./vault";

function entry(partial: Partial<VaultEntry>): VaultEntry {
  return {
    id: partial.id ?? crypto.randomUUID(),
    title: partial.title ?? "x",
    category: partial.category ?? "Pessoal",
    updatedAt: partial.updatedAt ?? 0,
    ...partial,
  };
}

describe("vault — host e correspondência", () => {
  it("tira o www e o esquema do host", () => {
    expect(hostOf("https://www.github.com/foo")).toBe("github.com");
    expect(hostOf("github.com")).toBe("github.com");
    expect(hostOf("")).toBeNull();
    expect(hostOf("não é url com espaços")).toBeNull();
  });

  it("casa host igual e subdomínio", () => {
    const e = entry({ url: "https://github.com" });
    expect(entryMatchesHost(e, "github.com")).toBe(true);
    expect(entryMatchesHost(e, "gist.github.com")).toBe(true);
    expect(entryMatchesHost(e, "gitlab.com")).toBe(false);
  });

  it("acha entradas do cofre para a URL aberta", () => {
    const entries = [
      entry({ id: "a", url: "https://github.com", favorite: true, updatedAt: 1 }),
      entry({ id: "b", url: "https://github.com", updatedAt: 2 }),
      entry({ id: "c", url: "https://figma.com" }),
      entry({ id: "d", url: "https://github.com", deletedAt: 5 }),
    ];
    const match = matchesForUrl(entries, "https://github.com/rodrigo");
    expect(match.map((m) => m.id)).toEqual(["a", "b"]); // favorita primeiro, apagada fora
  });

  it("não casa nada quando a URL não tem host", () => {
    expect(matchesForUrl([entry({ url: "https://x.com" })], "agzos://home")).toEqual([]);
  });
});

describe("vault — categorias", () => {
  it("cai em Pessoal quando sem categoria", () => {
    expect(categoryOf(entry({ category: "" }))).toBe("Pessoal");
    expect(categoryOf(entry({ category: "Trabalho" }))).toBe("Trabalho");
  });

  it("agrupa por categoria em ordem alfabética", () => {
    const groups = groupByCategory([
      entry({ id: "1", category: "Trabalho" }),
      entry({ id: "2", category: "Pessoal", favorite: true, updatedAt: 1 }),
      entry({ id: "3", category: "Pessoal", updatedAt: 2 }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(["Pessoal", "Trabalho"]);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(["2", "3"]); // favorita primeiro
  });

  it("lista categorias conhecidas incluindo as padrão", () => {
    const cats = knownCategories([entry({ category: "Estudos" })]);
    expect(cats).toContain("Estudos");
    expect(cats).toContain("Pessoal");
    expect(cats).toContain("Trabalho");
  });
});
