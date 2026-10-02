import { describe, expect, it } from "vitest";

import type { VaultEntry } from "./types";
import {
  categoryOf,
  entryMatchesHost,
  groupByCategory,
  hostOf,
  knownCategories,
  loginUrlOf,
  matchesForUrl,
  searchLogins,
  siteOf,
  withLoginUrl,
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

describe("vault — mesmo site e entradas sem URL (2.2.7)", () => {
  it("acha o domínio registrável, inclusive .com.br e hospedagens compartilhadas", () => {
    expect(siteOf("mail.google.com")).toBe("google.com");
    expect(siteOf("internetbanking.itau.com.br")).toBe("itau.com.br");
    expect(siteOf("github.com")).toBe("github.com");
    expect(siteOf("rodrigo.github.io")).toBe("rodrigo.github.io");
  });

  it("login de um subdomínio serve para outro do mesmo site", () => {
    const e = entry({ url: "https://accounts.google.com/signin" });
    expect(entryMatchesHost(e, "mail.google.com")).toBe(true);
    expect(entryMatchesHost(e, "google.com.br")).toBe(false);
    const pages = entry({ url: "https://ana.github.io" });
    expect(entryMatchesHost(pages, "joao.github.io")).toBe(false);
  });

  it("entrada sem URL casa pelo nome do site e vem depois das com URL", () => {
    const entries = [
      entry({ id: "nome", title: "Conta Google" }),
      entry({ id: "url", url: "https://accounts.google.com" }),
      entry({ id: "outro", title: "Netflix" }),
      entry({ id: "nota", title: "Google", type: "secure_note" }),
      entry({ id: "com-url", title: "Google", url: "https://outra.com" }),
    ];
    expect(
      matchesForUrl(entries, "https://accounts.google.com/v3/signin").map((m) => m.id),
    ).toEqual(["url", "nome"]);
  });

  it("guarda a URL do login (sem query) só em entrada que não tem URL", () => {
    expect(loginUrlOf("https://app.site.com/login?next=/x#a")).toBe("https://app.site.com/login");
    expect(loginUrlOf("https://site.com/")).toBe("https://site.com");
    expect(loginUrlOf("agzos://home")).toBeNull();
    const linked = withLoginUrl(entry({ title: "Site" }), "https://site.com/entrar?x=1");
    expect(linked?.url).toBe("https://site.com/entrar");
    expect(withLoginUrl(entry({ url: "https://a.com" }), "https://site.com")).toBeNull();
  });

  it("busca logins no cofre por nome, usuário ou URL, sem acento", () => {
    const entries = [
      entry({ id: "a", title: "Itaú", username: "rodrigo" }),
      entry({ id: "b", title: "Nubank", url: "https://nubank.com.br" }),
      entry({ id: "c", title: "Wi-Fi casa", type: "wifi" }),
    ];
    expect(searchLogins(entries, "itau").map((e) => e.id)).toEqual(["a"]);
    expect(searchLogins(entries, "nubank.com").map((e) => e.id)).toEqual(["b"]);
    expect(searchLogins(entries, "casa")).toEqual([]);
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
