import { describe, expect, it } from "vitest";

import {
  exportNetscapeBookmarks,
  folderOptions,
  folderPath,
  normalizeBookmarkUrl,
  parseBookmarks,
  parseNetscapeBookmarks,
} from "./bookmarks";
import { resolveInput } from "./omnibox-input";
import { buildSuggestions, inlineCompletion } from "./omnibox-suggest";
import { createLocalHistory } from "./persistence/history-store";
import { BOOKMARK_BAR, BOOKMARK_OTHER, type BookmarkNode, type Tab } from "./types";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 29, 12);

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

describe("favoritos: HTML do Netscape (Chrome, Firefox, Edge)", () => {
  const chromeExport = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1" PERSONAL_TOOLBAR_FOLDER="true">Barra de favoritos</H3>
    <DL><p>
        <DT><A HREF="https://github.com/" ADD_DATE="1700000000">GitHub</A>
        <DT><H3 ADD_DATE="1">Trabalho &amp; estudo</H3>
        <DL><p>
            <DT><A HREF="https://linear.app/team?a=1&amp;b=2">Linear</A>
            <DT><A HREF="javascript:alert(1)">Bookmarklet</A>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://notion.so/">Notion</A>
</DL><p>`;

  it("lê pastas aninhadas, decodifica entidades e ignora o que não é http(s)", () => {
    let seq = 0;
    const nodes = parseNetscapeBookmarks(chromeExport, BOOKMARK_BAR, () => `n${++seq}`, NOW);
    expect(nodes.map((node) => [node.kind, node.title, node.parentId])).toEqual([
      ["url", "GitHub", BOOKMARK_BAR],
      ["folder", "Trabalho & estudo", BOOKMARK_BAR],
      ["url", "Linear", "n2"],
      ["url", "Notion", BOOKMARK_BAR],
    ]);
    expect(nodes[0]!.createdAt).toBe(1700000000 * 1000);
    expect(nodes[2]!.url).toBe("https://linear.app/team?a=1&b=2");
  });

  it("exporta e lê de volta a mesma árvore", () => {
    const tree: BookmarkNode[] = [
      { id: "f", parentId: BOOKMARK_BAR, kind: "folder", title: 'Pasta "A" <b>', createdAt: 0 },
      {
        id: "a",
        parentId: "f",
        kind: "url",
        title: "A & B",
        url: "https://a.test/?x=1&y=2",
        createdAt: 0,
      },
      {
        id: "o",
        parentId: BOOKMARK_OTHER,
        kind: "url",
        title: "Outro",
        url: "https://o.test/",
        createdAt: 0,
      },
    ];
    const html = exportNetscapeBookmarks(tree);
    let seq = 0;
    const back = parseNetscapeBookmarks(html, BOOKMARK_BAR, () => `x${++seq}`);
    expect(back.map((node) => [node.kind, node.title, node.url])).toEqual([
      ["folder", 'Pasta "A" <b>', undefined],
      ["url", "A & B", "https://a.test/?x=1&y=2"],
      ["url", "Outro", "https://o.test/"],
    ]);
  });
});

describe("favoritos: árvore", () => {
  const nodes: BookmarkNode[] = [
    { id: "f", parentId: BOOKMARK_BAR, kind: "folder", title: "Trabalho", createdAt: 0 },
    { id: "g", parentId: "f", kind: "folder", title: "Clientes", createdAt: 0 },
  ];

  it("lista pastas em ordem de árvore e monta o caminho", () => {
    expect(folderOptions(nodes).map((option) => [option.title, option.depth])).toEqual([
      ["Barra de favoritos", 0],
      ["Trabalho", 1],
      ["Clientes", 2],
      ["Outros favoritos", 0],
    ]);
    expect(folderPath(nodes, "g")).toEqual(["Barra de favoritos", "Trabalho", "Clientes"]);
  });

  it("do disco: descarta inválidos e manda órfãos e ciclos para Outros favoritos", () => {
    const parsed = parseBookmarks([
      ...nodes,
      { id: "x", parentId: "sumiu", kind: "url", title: "X", url: "x.test", createdAt: 1 },
      { id: "c1", parentId: "c2", kind: "folder", title: "C1", createdAt: 1 },
      { id: "c2", parentId: "c1", kind: "folder", title: "C2", createdAt: 1 },
      { id: "js", parentId: BOOKMARK_BAR, kind: "url", title: "JS", url: "javascript:1" },
      { id: "bar", parentId: BOOKMARK_BAR, kind: "folder", title: "raiz falsa" },
      "lixo",
    ])!;
    expect(parsed.map((node) => [node.id, node.parentId])).toEqual([
      ["f", BOOKMARK_BAR],
      ["g", "f"],
      ["x", BOOKMARK_OTHER],
      ["c1", BOOKMARK_OTHER],
      ["c2", BOOKMARK_OTHER],
    ]);
    expect(parsed[2]!.url).toBe("https://x.test/");
    expect(parseBookmarks("x")).toBeNull();
  });

  it("endereço de favorito sempre com http(s)", () => {
    expect(normalizeBookmarkUrl("site.com/a")).toBe("https://site.com/a");
    expect(normalizeBookmarkUrl("http://a.test")).toBe("http://a.test/");
    expect(normalizeBookmarkUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeBookmarkUrl("   ")).toBeNull();
  });
});

describe("omnibox: sugestões", () => {
  const tab = (id: number, url: string, title: string): Tab => ({
    id,
    history: [{ title, url, kind: "page" }],
    index: 0,
  });
  const base = {
    engine: "duckduckgo" as const,
    history: [],
    bookmarks: [],
    tabs: [],
    remote: [],
    now: NOW,
  };

  it("o digitado vem primeiro: endereço abre, texto pesquisa", () => {
    expect(buildSuggestions({ ...base, input: "github.com" })[0]).toMatchObject({
      kind: "go",
      url: "https://github.com",
    });
    expect(buildSuggestions({ ...base, input: "agzos browser" })[0]).toMatchObject({
      kind: "search",
      url: "https://duckduckgo.com/?q=agzos%20browser",
      detail: "Pesquisar no DuckDuckGo",
    });
    expect(buildSuggestions({ ...base, input: "   " })).toEqual([]);
  });

  it("prefixo do domínio, frequência e recência ordenam o histórico", () => {
    const list = buildSuggestions({
      ...base,
      input: "you",
      history: [
        { url: "https://blog.test/about-you", title: "About you", visitCount: 20, lastVisit: NOW },
        { url: "https://www.youtube.com/", title: "YouTube", visitCount: 3, lastVisit: NOW - DAY },
        { url: "https://younow.test/", title: "YouNow", visitCount: 2, lastVisit: NOW - 60 * DAY },
      ],
    });
    expect(list.map((item) => item.url)).toEqual([
      "https://duckduckgo.com/?q=you",
      "https://www.youtube.com/",
      "https://younow.test/",
      "https://blog.test/about-you",
    ]);
  });

  it("aba aberta vira 'Mudar para esta guia' e não repete no histórico", () => {
    const list = buildSuggestions({
      ...base,
      input: "linear",
      tabs: [tab(7, "https://linear.app/team", "Linear")],
      history: [{ url: "https://linear.app/team", title: "Linear", visitCount: 9, lastVisit: NOW }],
      bookmarks: [
        {
          id: "b",
          parentId: BOOKMARK_BAR,
          kind: "url",
          title: "Linear docs",
          url: "https://linear.app/docs",
          createdAt: 0,
        },
      ],
    });
    expect(list.map((item) => [item.kind, item.url])).toEqual([
      ["search", "https://duckduckgo.com/?q=linear"],
      ["bookmark", "https://linear.app/docs"],
      ["tab", "https://linear.app/team"],
    ]);
    expect(list[2]).toMatchObject({ tabId: 7, detail: "Mudar para esta guia" });
  });

  it("sugestões do buscador vão no fim, sem repetir o digitado", () => {
    const list = buildSuggestions({
      ...base,
      input: "agzos",
      remote: ["agzos", "agzos browser", "Agzos Browser", "agzos agency"],
    });
    expect(list.map((item) => item.title)).toEqual(["agzos", "agzos browser", "agzos agency"]);
    expect(list[1]).toMatchObject({
      kind: "remote",
      url: "https://duckduckgo.com/?q=agzos%20browser",
    });
  });

  it("autocompleta o domínio (ou o caminho, depois da /)", () => {
    const list = buildSuggestions({
      ...base,
      input: "you",
      history: [
        { url: "https://www.youtube.com/watch?v=1", title: "Vídeo", visitCount: 5, lastVisit: NOW },
      ],
    });
    expect(inlineCompletion("you", list)).toBe("youtube.com");
    expect(inlineCompletion("YouT", list)).toBe("YouTube.com");
    expect(inlineCompletion("youtube.com/wa", list)).toBe("youtube.com/watch?v=1");
    expect(inlineCompletion("you tube", list)).toBeNull();
    expect(inlineCompletion("zzz", list)).toBeNull();
  });

  it("agzos://historico e agzos://favoritos abrem as páginas da casca", () => {
    expect(resolveInput("agzos://historico", "duckduckgo")).toEqual({
      title: "Histórico",
      url: "agzos://historico",
      kind: "internal",
    });
    expect(resolveInput("AGZOS://favoritos/", "duckduckgo")?.kind).toBe("internal");
  });
});

describe("histórico da versão web (localStorage)", () => {
  it("registra, junta a mesma visita, busca e limpa", async () => {
    const storage = memoryStorage();
    const store = createLocalHistory(storage);
    await store.add({ url: "https://a.test/", title: "Alfa", at: NOW - 60_000 });
    await store.add({ url: "https://a.test/", title: "", at: NOW - 50_000 });
    await store.add({ url: "https://b.test/", title: "Beta", at: NOW - 40_000 });
    await store.add({ url: "https://a.test/", title: "Alfa", at: NOW });
    const list = await store.list();
    expect(list.map((visit) => visit.url)).toEqual([
      "https://a.test/",
      "https://b.test/",
      "https://a.test/",
    ]);
    expect(await store.search("alfa")).toEqual([
      { url: "https://a.test/", title: "Alfa", visitCount: 2, lastVisit: NOW },
    ]);
    await store.clear({ from: NOW - 45_000 });
    expect((await store.list()).map((visit) => visit.url)).toEqual(["https://a.test/"]);
    await store.deleteUrl("https://a.test/");
    expect(storage.data.size).toBe(0);
  });
});
