import { describe, expect, it } from "vitest";

import { DEFAULT_LIMITS } from "../control/limits";
import { DEFAULT_SIDE_PANELS } from "../side-panels";
import { DEFAULT_GESTURES } from "@/features/gestures/gestures";
import { DEFAULT_TERMINAL } from "@/features/terminal/config";
import { browserReducer } from "../store/reducer";
import { initialState } from "../store/state";
import {
  LEGACY_KEYS,
  SNAPSHOT_VERSION,
  parseSnapshot,
  readLegacySnapshot,
  snapshotOf,
  toHydratePayload,
} from "./snapshot";
import { STATE_KEY, createLocalStore } from "./store";

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

const legacyTabs = [
  {
    id: 1727000000000,
    history: [
      { title: "Nova aba", url: "agzos://inicio", kind: "home" },
      { title: "GitHub", url: "https://github.com", kind: "page" },
    ],
    index: 1,
    pinned: true,
  },
  { id: 1727000000001, history: [{ title: "X", url: "https://x.com", kind: "page" }], index: 0 },
];

describe("snapshot", () => {
  it("ida e volta preserva a sessão e descarta abas anônimas", () => {
    let state = browserReducer(initialState, {
      type: "nav/push",
      entry: { title: "A", url: "a.com", kind: "page" },
    });
    state = browserReducer(state, { type: "tab/new", private: true });
    const snapshot = snapshotOf(state);
    expect(snapshot.session.tabs.map((tab) => tab.id)).toEqual([1]);
    // A ativa era a anônima: não vai para o disco.
    expect(snapshot.session.activeId).toBeNull();
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot);
  });

  it("dados corrompidos caem no padrão sem derrubar", () => {
    const parsed = parseSnapshot({
      version: SNAPSHOT_VERSION,
      prefs: { dark: "sim", engine: "bing", orientation: 3, pausedHosts: ["a.com", 1, "a.com"] },
      session: {
        tabs: [
          { id: "1", history: [] },
          {
            id: 5,
            history: [{ title: "ok", url: "https://ok.com", kind: "page" }, { nope: 1 }],
            index: 9,
          },
          { id: 5, history: [{ title: "dup", url: "https://dup.com", kind: "page" }], index: 0 },
          {
            id: 6,
            private: true,
            history: [{ title: "s", url: "https://s.com", kind: "page" }],
            index: 0,
          },
          {
            id: 7,
            history: [{ title: "f", url: "https://f.com", kind: "page" }],
            index: 0,
            favicon: "javascript:alert(1)",
          },
        ],
        activeId: "5",
      },
      links: "nada",
      closedTabs: [{ title: "a", url: "https://a.com" }, null, { title: 1 }],
    });
    expect(parsed).toEqual({
      version: 1,
      prefs: { ...initialState.prefs, pausedHosts: ["a.com"] },
      session: {
        tabs: [
          { id: 5, history: [{ title: "ok", url: "https://ok.com", kind: "page" }], index: 0 },
          { id: 7, history: [{ title: "f", url: "https://f.com", kind: "page" }], index: 0 },
        ],
        activeId: null,
        groups: [],
        workspaces: [],
        split: null,
      },
      links: null,
      dial: null,
      closedTabs: [{ title: "a", url: "https://a.com" }],
      bookmarks: null,
      notes: {},
    });
  });

  it("versão desconhecida é ignorada", () => {
    expect(parseSnapshot({ version: 99 })).toBeNull();
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot([])).toBeNull();
  });

  it("vira payload de hydrate", () => {
    const payload = toHydratePayload(parseSnapshot({ version: 1 }));
    expect(payload).toEqual({
      prefs: initialState.prefs,
      tabs: null,
      activeId: null,
      links: null,
      dial: null,
      closedTabs: [],
      bookmarks: null,
      groups: [],
      workspaces: [],
      split: null,
      notes: {},
    });
  });

  it("2.0: grupos, workspaces e tela dividida vão e voltam; lixo é descartado", () => {
    const parsed = parseSnapshot({
      version: 1,
      session: {
        tabs: [
          {
            id: 1,
            history: [{ title: "a", url: "https://a.com", kind: "page" }],
            index: 0,
            groupId: 3,
            workspaceId: 2,
          },
        ],
        activeId: 1,
        groups: [
          { id: 3, title: "Trabalho", color: "blue" },
          { id: "x" },
          { id: 4, color: "neon" },
        ],
        workspaces: [
          { id: 2, name: "Estudos", icon: "📚" },
          { id: 5, name: "  " },
        ],
        split: { ids: [1, 1], ratio: 0.5 },
      },
    })!;
    expect(parsed.session.tabs[0]).toMatchObject({ groupId: 3, workspaceId: 2 });
    expect(parsed.session.groups).toEqual([
      { id: 3, title: "Trabalho", color: "blue" },
      { id: 4, title: "", color: "grey" },
    ]);
    expect(parsed.session.workspaces).toEqual([{ id: 2, name: "Estudos", icon: "📚" }]);
    expect(parsed.session.split).toBeNull();
  });
});

describe("migração da 1.3", () => {
  const legacy = {
    "agzos-theme": "dark",
    "agzos-tabs": JSON.stringify(legacyTabs),
    "agzos-engine": "yandex",
    "agzos-shield": "off",
    "agzos-ai": "off",
    "agzos-links": JSON.stringify([{ name: "Meu", url: "meu.dev" }]),
    "agzos-paused-hosts": JSON.stringify(["x.com"]),
    "agzos-tab-orientation": "vertical",
    "agzos-tab-rail-collapsed": "1",
    "agzos-closed-tabs": JSON.stringify([{ title: "Velha", url: "https://velha.com" }]),
    "agzos-credentials": "[]",
  };

  it("lê todas as chaves antigas", () => {
    const snapshot = readLegacySnapshot(memoryStorage(legacy));
    expect(snapshot).toEqual({
      version: 1,
      prefs: {
        dark: true,
        engine: "yandex",
        shield: false,
        aiOpen: false,
        aiSidebar: true,
        notesOpen: false,
        readerFontSize: 19,
        orientation: "vertical",
        railCollapsed: true,
        pausedHosts: ["x.com"],
        bookmarksBar: true,
        searchSuggestions: true,
        hibernate: true,
        hibernateMinutes: 30,
        sidebar: true,
        sidePanels: DEFAULT_SIDE_PANELS,
        sidePanelsSeen: DEFAULT_SIDE_PANELS,
        ...DEFAULT_LIMITS,
        sidePanelWidth: 400,
        sideBarWidth: 60,
        sidePanelWidths: {},
        sounds: true,
        soundHover: true,
        soundKeys: true,
        soundTick: "mecanico",
        soundVolume: 40,
        accentColor: "#D10A11",
        backgroundImage: "",
        backgroundBlur: 0,
        backgroundOpacity: 100,
        uiBlur: true,
        keyBarPinned: false,
        aiModel: "",
        gestures: DEFAULT_GESTURES,
        terminalOpen: false,
        terminalHeight: 280,
        terminalShell: "",
        terminalCwd: "",
        terminal: DEFAULT_TERMINAL,
      },
      session: {
        tabs: legacyTabs,
        activeId: 1727000000000,
        groups: [],
        workspaces: [],
        split: null,
      },
      links: [{ name: "Meu", url: "meu.dev" }],
      dial: null,
      closedTabs: [{ title: "Velha", url: "https://velha.com" }],
      bookmarks: null,
      notes: {},
    });
  });

  it("sem chaves antigas não inventa estado", () => {
    expect(readLegacySnapshot(memoryStorage({ "agzos-credentials": "[]" }))).toBeNull();
  });

  it("o store local migra uma vez, grava na chave nova e limpa as antigas", async () => {
    const storage = memoryStorage(legacy);
    const store = createLocalStore(storage);
    const first = await store.load();
    expect(first?.prefs.engine).toBe("yandex");
    for (const key of LEGACY_KEYS) expect(storage.data.has(key)).toBe(false);
    // O cofre não é mexido pela migração do navegador.
    expect(storage.data.get("agzos-credentials")).toBe("[]");
    expect(JSON.parse(storage.data.get(STATE_KEY)!)).toEqual(first);
    expect(await createLocalStore(storage).load()).toEqual(first);
  });

  it("JSON inválido na chave nova cai para o padrão", async () => {
    const store = createLocalStore(memoryStorage({ [STATE_KEY]: "{quebrado" }));
    expect(await store.load()).toBeNull();
  });
});
