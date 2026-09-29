import { describe, expect, it } from "vitest";

import type { Entry, Tab } from "../types";
import { browserReducer, type BrowserAction } from "./reducer";
import { entryOf, navState, orderTabs } from "./selectors";
import { CLOSED_TABS_LIMIT, HOME_URL, initialState, type BrowserState } from "./state";

const page = (url: string, title = url): Entry => ({ title, url, kind: "page" });

function run(...actions: BrowserAction[]): BrowserState {
  return actions.reduce(browserReducer, { ...initialState, hydrated: true });
}

/** Estado com abas já navegadas: cada string vira uma aba com aquela página. */
function withPages(...urls: string[]): BrowserState {
  let state = run();
  urls.forEach((url, index) => {
    if (index > 0) state = browserReducer(state, { type: "tab/new" });
    state = browserReducer(state, { type: "nav/push", entry: page(url) });
  });
  return state;
}

const titles = (state: BrowserState) => orderTabs(state.tabs).map((tab) => entryOf(tab).title);
const activeTitle = (state: BrowserState) =>
  entryOf(state.tabs.find((tab) => tab.id === state.activeId)!).title;

describe("abas", () => {
  it("cria abas com IDs sequenciais e ativa a nova", () => {
    const state = run({ type: "tab/new" }, { type: "tab/new" }, { type: "tab/new", private: true });
    expect(state.tabs.map((tab) => tab.id)).toEqual([1, 2, 3, 4]);
    expect(state.activeId).toBe(4);
    expect(state.tabs[3]!.private).toBe(true);
    expect(state.address).toBe(HOME_URL);
  });

  it("nova aba à direita entra logo após a de origem", () => {
    const state = browserReducer(withPages("a.com", "b.com"), { type: "tab/new", rightOf: 1 });
    expect(state.tabs.map((tab) => tab.id)).toEqual([1, 3, 2]);
    expect(state.activeId).toBe(3);
  });

  it("duplicar copia o histórico até a página atual, sem colidir ID", () => {
    let state = withPages("a.com");
    state = browserReducer(state, { type: "nav/push", entry: page("b.com") });
    state = browserReducer(state, { type: "nav/step", delta: -1 });
    state = browserReducer(state, { type: "tab/duplicate", id: 1 });
    const clone = state.tabs[1]!;
    expect(clone.id).toBe(2);
    expect(clone.history.map((entry) => entry.url)).toEqual([HOME_URL, "a.com"]);
    expect(state.activeId).toBe(2);
  });

  it("fechar a ativa ativa a vizinha da esquerda", () => {
    let state = withPages("a.com", "b.com", "c.com");
    state = browserReducer(state, { type: "tab/activate", id: 2 });
    state = browserReducer(state, { type: "tab/close", id: 2 });
    expect(titles(state)).toEqual(["a.com", "c.com"]);
    expect(activeTitle(state)).toBe("a.com");
    expect(state.address).toBe("a.com");
  });

  it("fechar a última aba cria uma nova e permite reabrir a fechada", () => {
    let state = withPages("a.com");
    state = browserReducer(state, { type: "tab/close", id: 1 });
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]!.id).toBe(2);
    expect(entryOf(state.tabs[0]!).kind).toBe("home");
    state = browserReducer(state, { type: "tab/reopen-closed" });
    expect(activeTitle(state)).toBe("a.com");
    expect(state.closedTabs).toEqual([]);
  });

  it("fechar outras preserva as fixadas e ativa a escolhida", () => {
    let state = withPages("a.com", "b.com", "c.com");
    state = browserReducer(state, { type: "tab/toggle-pin", id: 3 });
    state = browserReducer(state, { type: "tab/activate", id: 1 });
    state = browserReducer(state, { type: "tab/close-others", id: 2 });
    expect(titles(state)).toEqual(["c.com", "b.com"]);
    expect(state.activeId).toBe(2);
    expect(state.closedTabs.map((tab) => tab.url)).toEqual(["a.com"]);
  });

  it("fechar à direita/esquerda usa a ordem exibida (fixadas primeiro)", () => {
    let state = withPages("a.com", "b.com", "c.com", "d.com");
    state = browserReducer(state, { type: "tab/toggle-pin", id: 4 });
    expect(titles(state)).toEqual(["d.com", "a.com", "b.com", "c.com"]);
    const right = browserReducer(state, { type: "tab/close-side", id: 2, direction: 1 });
    expect(titles(right)).toEqual(["d.com", "a.com", "b.com"]);
    const left = browserReducer(state, { type: "tab/close-side", id: 2, direction: -1 });
    expect(titles(left)).toEqual(["d.com", "b.com", "c.com"]);
  });

  it("abas anônimas nunca entram na pilha de reabrir", () => {
    let state = withPages("a.com");
    state = browserReducer(state, { type: "tab/new", private: true });
    state = browserReducer(state, { type: "nav/push", entry: page("segredo.com") });
    const others = browserReducer(state, { type: "tab/close-others", id: 1 });
    const direct = browserReducer(state, { type: "tab/close", id: 2 });
    const side = browserReducer(state, { type: "tab/close-side", id: 1, direction: 1 });
    for (const result of [others, direct, side]) {
      expect(result.closedTabs).toEqual([]);
    }
  });

  it("a pilha de fechadas guarda no máximo 20", () => {
    let state = run();
    for (let index = 0; index < CLOSED_TABS_LIMIT + 5; index++) {
      state = browserReducer(state, { type: "tab/new" });
      state = browserReducer(state, { type: "nav/push", entry: page(`s${index}.com`) });
      state = browserReducer(state, { type: "tab/close", id: state.activeId });
    }
    expect(state.closedTabs).toHaveLength(CLOSED_TABS_LIMIT);
    expect(state.closedTabs.at(-1)!.url).toBe(`s${CLOSED_TABS_LIMIT + 4}.com`);
  });

  it("reset troca todas as abas por uma nova com ID inédito", () => {
    const state = browserReducer(withPages("a.com", "b.com"), { type: "tabs/reset" });
    expect(state.tabs).toEqual([{ id: 3, history: [initialState.tabs[0]!.history[0]], index: 0 }]);
    expect(state.activeId).toBe(3);
  });
});

describe("navegação", () => {
  it("push trunca o futuro e pede a URL ao desktop", () => {
    let state = withPages("a.com");
    state = browserReducer(state, { type: "nav/push", entry: page("b.com") });
    state = browserReducer(state, { type: "nav/step", delta: -1 });
    state = browserReducer(state, { type: "nav/push", entry: page("c.com") });
    expect(state.tabs[0]!.history.map((entry) => entry.url)).toEqual([HOME_URL, "a.com", "c.com"]);
    expect(state.requestedUrl).toEqual({ id: 1, url: "c.com" });
  });

  it("step respeita os limites do histórico", () => {
    const state = withPages("a.com");
    const back = browserReducer(state, { type: "nav/step", delta: -5 });
    expect(back.address).toBe(HOME_URL);
    expect(browserReducer(back, { type: "nav/step", delta: -1 })).toBe(back);
  });

  it("no desktop, voltar/avançar vêm do WebContentsView", () => {
    let state = withPages("a.com");
    expect(navState(state, true)).toEqual({ viewDriven: true, canBack: false, canForward: false });
    state = browserReducer(state, {
      type: "view/updated",
      id: 1,
      url: "https://a.com/x",
      title: "A",
      canBack: true,
      canForward: false,
    });
    expect(navState(state, true).canBack).toBe(true);
    expect(entryOf(state.tabs[0]!)).toEqual({ title: "A", url: "https://a.com/x", kind: "page" });
    expect(state.address).toBe("https://a.com/x");
  });

  it("evento de aba em segundo plano não mexe na omnibox", () => {
    let state = withPages("a.com", "b.com");
    state = browserReducer(state, {
      type: "view/updated",
      id: 1,
      url: "https://a.com/novo",
      title: "",
      canBack: true,
      canForward: false,
    });
    expect(state.address).toBe("b.com");
    expect(entryOf(state.tabs[0]!).title).toBe("a.com");
  });
});

describe("favoritos e preferências", () => {
  it("favoritar alterna pelo endereço normalizado", () => {
    let state = withPages("https://linear.app/team/");
    state = browserReducer(state, { type: "links/toggle-current" });
    expect(state.links.at(-1)).toEqual({
      name: "https://linear.app/team/",
      url: "linear.app/team",
    });
    state = browserReducer(state, { type: "links/toggle-current" });
    expect(state.links.some((link) => link.url === "linear.app/team")).toBe(false);
  });

  it("não favorita aba anônima nem a página inicial", () => {
    let state = run();
    expect(browserReducer(state, { type: "links/toggle-current" })).toBe(state);
    state = browserReducer(state, { type: "tab/new", private: true });
    state = browserReducer(state, { type: "nav/push", entry: page("segredo.com") });
    expect(browserReducer(state, { type: "links/toggle-current" }).links).toEqual(state.links);
  });

  it("favoritar todas ignora anônimas e repetidas", () => {
    let state = withPages("https://github.com", "https://novo.dev/");
    state = browserReducer(state, { type: "tab/new", private: true });
    state = browserReducer(state, { type: "nav/push", entry: page("https://segredo.com") });
    state = browserReducer(state, { type: "links/bookmark-all" });
    expect(state.links.map((link) => link.url)).toEqual([
      "github.com",
      "figma.com",
      "notion.so",
      "linear.app",
      "novo.dev",
    ]);
  });

  it("pausar proteção por site não duplica hosts", () => {
    let state = run({ type: "prefs/pause-host", host: "a.com", pause: true });
    state = browserReducer(state, { type: "prefs/pause-host", host: "a.com", pause: true });
    expect(state.prefs.pausedHosts).toEqual(["a.com"]);
    state = browserReducer(state, { type: "prefs/pause-host", host: "a.com", pause: false });
    expect(state.prefs.pausedHosts).toEqual([]);
  });
});

describe("hydrate", () => {
  const saved: Tab[] = [
    { id: 1700000000000, history: [page("a.com")], index: 0 },
    { id: 1700000000001, history: [page("b.com")], index: 0, pinned: true },
  ];

  it("restaura a sessão, a aba ativa e continua os IDs depois do maior", () => {
    const state = browserReducer(initialState, {
      type: "hydrate",
      payload: {
        prefs: { ...initialState.prefs, dark: true },
        tabs: saved,
        activeId: 1700000000001,
        links: null,
        closedTabs: [],
      },
    });
    expect(state.hydrated).toBe(true);
    expect(state.activeId).toBe(1700000000001);
    expect(state.address).toBe("b.com");
    expect(state.prefs.dark).toBe(true);
    expect(state.links).toBe(initialState.links);
    expect(browserReducer(state, { type: "tab/new" }).activeId).toBe(1700000000002);
  });

  it("sem nada salvo, só marca como carregado", () => {
    const state = browserReducer(initialState, { type: "hydrate", payload: null });
    expect(state).toEqual({ ...initialState, hydrated: true });
  });
});

describe("eventos do desktop", () => {
  it("áudio, travamento e login recusado", () => {
    let state = withPages("a.com", "b.com");
    state = browserReducer(state, { type: "view/audio", id: 1, playing: true });
    state = browserReducer(state, { type: "view/audio", id: 1, playing: true });
    expect(state.audioPlaying).toEqual([1]);
    state = browserReducer(state, { type: "view/crashed", id: 2 });
    state = browserReducer(state, {
      type: "view/login-rejected",
      id: 2,
      continueUrl: "https://accounts.google.com/",
    });
    expect(state.loginRejected).toEqual({ 2: "https://accounts.google.com/" });
    state = browserReducer(state, { type: "tab/close", id: 1 });
    expect(state.audioPlaying).toEqual([]);
    state = browserReducer(state, { type: "view/recovered", id: 2 });
    state = browserReducer(state, { type: "view/login-rejected", id: 2, continueUrl: null });
    expect(state.crashed).toEqual([]);
    expect(state.loginRejected).toEqual({});
  });
});

describe("1.5: navegação por atalho, bloqueios, zoom, busca e downloads", () => {
  it("Ctrl+Tab dá a volta na ordem exibida (fixadas primeiro)", () => {
    let state = withPages("a", "b", "c");
    state = browserReducer(state, { type: "tab/toggle-pin", id: 3 });
    // Ordem exibida: c (fixada), a, b. Ativa: c.
    expect(titles(state)).toEqual(["c", "a", "b"]);
    state = browserReducer(state, { type: "tab/activate-relative", delta: 1 });
    expect(activeTitle(state)).toBe("a");
    state = browserReducer(state, { type: "tab/activate-relative", delta: -1 });
    state = browserReducer(state, { type: "tab/activate-relative", delta: -1 });
    expect(activeTitle(state)).toBe("b");
  });

  it("Ctrl+N vai para a guia N; -1 é a última; índice inexistente não muda nada", () => {
    const state = withPages("a", "b", "c");
    expect(activeTitle(browserReducer(state, { type: "tab/activate-index", index: 0 }))).toBe("a");
    expect(activeTitle(browserReducer(state, { type: "tab/activate-index", index: -1 }))).toBe("c");
    expect(browserReducer(state, { type: "tab/activate-index", index: 7 })).toBe(state);
  });

  it("bloqueios e zoom por aba somem quando a aba fecha", () => {
    let state = withPages("a", "b");
    state = browserReducer(state, {
      type: "view/blocked",
      id: 2,
      count: 3,
      trackers: [{ host: "ads.test", category: "Anúncios" }],
    });
    state = browserReducer(state, { type: "view/zoom", id: 2, factor: 1.25 });
    expect(state.blocked[2]?.count).toBe(3);
    expect(state.zoom[2]).toBe(1.25);
    state = browserReducer(state, { type: "tab/close", id: 2 });
    expect(state.blocked).toEqual({});
    expect(state.zoom).toEqual({});
    // Evento atrasado de aba que já fechou não recria a entrada.
    expect(
      browserReducer(state, { type: "view/blocked", id: 2, count: 1, trackers: [] }).blocked,
    ).toEqual({});
  });

  it("busca: só aceita resultado com a barra aberta na aba ativa; trocar de aba fecha", () => {
    let state = withPages("a", "b");
    expect(browserReducer(state, { type: "view/find", id: 2, active: 1, total: 4 }).find).toBe(
      null,
    );
    state = browserReducer(state, { type: "find/open" });
    state = browserReducer(state, { type: "view/find", id: 2, active: 1, total: 4 });
    expect(state.find).toEqual({ id: 2, active: 1, total: 4 });
    expect(browserReducer(state, { type: "view/find", id: 1, active: 1, total: 9 }).find).toEqual(
      state.find,
    );
    state = browserReducer(state, { type: "tab/activate", id: 1 });
    expect(state.find).toBeNull();
  });

  it("downloads: insere no topo, atualiza no lugar e remove o cancelado no diálogo", () => {
    const record = (id: number, extra = {}) => ({
      id,
      url: `https://x.test/${id}`,
      filename: `${id}.zip`,
      path: `/tmp/${id}.zip`,
      mime: "",
      totalBytes: 100,
      receivedBytes: 0,
      state: "progressing" as const,
      startedAt: id,
      endedAt: null,
      private: false,
      paused: false,
      canResume: false,
      ...extra,
    });
    let state = run({ type: "downloads/set", list: [record(1, { state: "completed" })] });
    state = browserReducer(state, { type: "downloads/upsert", record: record(2) });
    expect(state.downloads.map((item) => item.id)).toEqual([2, 1]);
    state = browserReducer(state, {
      type: "downloads/upsert",
      record: record(2, { receivedBytes: 50 }),
    });
    expect(state.downloads.map((item) => [item.id, item.receivedBytes])).toEqual([
      [2, 50],
      [1, 0],
    ]);
    state = browserReducer(state, {
      type: "downloads/upsert",
      record: record(2, { removed: true }),
    });
    expect(state.downloads.map((item) => item.id)).toEqual([1]);
  });
});

describe("navegação que vira download", () => {
  it("tira a URL do arquivo do histórico e volta para a página anterior", () => {
    let state = withPages("https://site.test/");
    state = browserReducer(state, { type: "nav/push", entry: page("https://site.test/a.zip") });
    state = browserReducer(state, {
      type: "view/download-navigation",
      id: 1,
      urls: ["https://site.test/a.zip", "https://cdn.test/a.zip"],
    });
    const tab = state.tabs[0]!;
    expect(tab.history.map((entry) => entry.url)).toEqual([HOME_URL, "https://site.test/"]);
    expect(state.address).toBe("https://site.test/");
  });

  it("aba aberta direto no arquivo vira uma aba nova (outro id)", () => {
    // Página inicial → arquivo: não há página para onde voltar.
    let state = withPages("https://site.test/a.zip");
    const before = state.tabs[0]!;
    state = browserReducer(state, {
      type: "view/download-navigation",
      id: before.id,
      urls: ["https://site.test/a.zip"],
    });
    expect(state.tabs).toHaveLength(1);
    expect(state.tabs[0]!.id).not.toBe(before.id);
    expect(entryOf(state.tabs[0]!).kind).toBe("home");
    expect(state.activeId).toBe(state.tabs[0]!.id);
  });

  it("URL que não é a da aba (link baixado de dentro da página) não muda nada", () => {
    const state = withPages("https://site.test/");
    expect(
      browserReducer(state, {
        type: "view/download-navigation",
        id: 1,
        urls: ["https://site.test/a.zip"],
      }),
    ).toBe(state);
  });
});

describe("Ctrl+Tab em ordem de uso (seletor)", () => {
  // Abas a, b, c, d; uso: d (atual) → b → c → a.
  function used() {
    let state = withPages("a", "b", "c", "d");
    for (const id of [1, 3, 2, 4]) state = browserReducer(state, { type: "tab/activate", id });
    return state;
  }

  it("guarda a ordem de uso, a mais recente primeiro", () => {
    expect(used().recent).toEqual([4, 2, 3, 1]);
  });

  it("toque rápido (step + commit) volta para a última aba usada", () => {
    let state = used();
    state = browserReducer(state, { type: "switcher/step", delta: 1 });
    expect(state.switcher).toEqual({ ids: [4, 2, 3, 1], index: 1 });
    state = browserReducer(state, { type: "switcher/commit" });
    expect(activeTitle(state)).toBe("b");
    expect(state.switcher).toBeNull();
    // De novo: volta para a "d" (alterna entre as duas últimas, como no Opera).
    state = browserReducer(state, { type: "switcher/step", delta: 1 });
    state = browserReducer(state, { type: "switcher/commit" });
    expect(activeTitle(state)).toBe("d");
  });

  it("segurando o Ctrl, Tab anda (dando a volta) e Shift+Tab volta", () => {
    let state = used();
    for (let i = 0; i < 3; i++) state = browserReducer(state, { type: "switcher/step", delta: 1 });
    expect(state.switcher?.index).toBe(3);
    state = browserReducer(state, { type: "switcher/step", delta: 1 });
    expect(state.switcher?.index).toBe(0);
    state = browserReducer(state, { type: "switcher/step", delta: -1 });
    state = browserReducer(state, { type: "switcher/commit" });
    expect(activeTitle(state)).toBe("a");
  });

  it("Ctrl+Shift+Tab abre já na aba usada há mais tempo; Esc cancela", () => {
    let state = used();
    state = browserReducer(state, { type: "switcher/step", delta: -1 });
    expect(state.switcher?.index).toBe(3);
    state = browserReducer(state, { type: "switcher/cancel" });
    expect(state.switcher).toBeNull();
    expect(activeTitle(state)).toBe("d");
  });

  it("clique escolhe direto; aba fechada sai do histórico de uso e fecha o seletor", () => {
    let state = used();
    state = browserReducer(state, { type: "switcher/step", delta: 1 });
    expect(activeTitle(browserReducer(state, { type: "switcher/commit", index: 2 }))).toBe("c");
    state = browserReducer(state, { type: "tab/close", id: 2 });
    expect(state.switcher).toBeNull();
    expect(state.recent).toEqual([4, 3, 1]);
  });

  it("abas nunca ativadas entram no fim; com uma aba só não abre", () => {
    let state = withPages("a", "b");
    state = browserReducer(state, { type: "hydrate", payload: null });
    expect(browserReducer(run(), { type: "switcher/step", delta: 1 }).switcher).toBeNull();
    state = browserReducer(state, { type: "switcher/step", delta: 1 });
    expect(state.switcher?.ids).toEqual([2, 1]);
  });
});
