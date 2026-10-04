import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import type { DesktopBridge } from "./desktop";
import { describeCrash, describeLoadError, errorCodeName, isCertificateError } from "./load-errors";
import { SNAPSHOT_VERSION } from "./persistence/snapshot";
import { createDesktopStore, syncPayloadOf } from "./persistence/store";
import { browserReducer, type BrowserAction } from "./store/reducer";
import { initialState, type BrowserState } from "./store/state";

// 1.7: janelas (electron/windows.cjs), hibernação (electron/hibernate.cjs), telas de
// erro e sincronização entre janelas.
const require = createRequire(import.meta.url);
const electronDir = path.join(import.meta.dirname, "../../../electron");

type Session = { tabs: unknown[]; activeId: number | null };
type WindowRecord = {
  key: string;
  bounds: { x: number; y: number; width: number; height: number } | null;
  maximized: boolean;
  session: Session | null;
};
type WindowStore = {
  load(): WindowRecord[];
  list(): WindowRecord[];
  add(record?: Partial<WindowRecord>): string;
  update(key: string, patch: Partial<WindowRecord>): boolean;
  remove(key: string): void;
  flush(): boolean;
  beginRun(): { unclean: boolean; early: boolean };
  markStable(): void;
  endRun(): void;
};
const windows = require(path.join(electronDir, "windows.cjs")) as {
  createWindowStore: (options: Record<string, unknown>) => WindowStore;
  fitBounds: (bounds: unknown, areas: unknown) => WindowRecord["bounds"];
  cascadeBounds: (bounds: unknown, area: unknown) => WindowRecord["bounds"];
  safeSession: (session: unknown) => Session | null;
};
const hibernate = require(path.join(electronDir, "hibernate.cjs")) as {
  hibernateConfigOf: (
    prefs: unknown,
    override?: { afterMs?: number },
  ) => { enabled: boolean; afterMs: number };
  canHibernate: (
    tab: Record<string, unknown>,
    options: { now: number; afterMs: number },
  ) => boolean;
  restorableHistory: (
    entries: unknown,
    index: number,
  ) => { entries: { url: string }[]; index: number } | null;
};
const { openDatabase } = require(path.join(electronDir, "db.cjs")) as {
  openDatabase: (file: string) => {
    close(): void;
    saveState(sections: Record<string, unknown>): boolean;
    loadState(): Record<string, unknown>;
    getMeta(key: string): unknown;
    setMeta(key: string, value: unknown): void;
  };
};

const dirs: string[] = [];
function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-janelas-"));
  dirs.push(dir);
  return openDatabase(path.join(dir, "agzos.db"));
}
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

/** Store sem timers: grava na hora. */
function storeOf(database: ReturnType<typeof tempDb>, now = () => 1000) {
  return windows.createWindowStore({
    database,
    now,
    schedule: (work: () => void) => {
      work();
      return null;
    },
    cancel: () => {},
  });
}

const tab = (id: number, url: string) => ({
  id,
  history: [{ title: url, url, kind: "page" }],
  index: 0,
});

describe("windows.cjs", () => {
  it("guarda sessão e posição de cada janela e devolve tudo no próximo início", () => {
    const database = tempDb();
    const store = storeOf(database);
    const one = store.add({ session: { tabs: [tab(1, "https://a.com")], activeId: 1 } });
    const two = store.add({ bounds: { x: 40, y: 50, width: 1200, height: 800 } });
    expect(one).not.toBe(two);
    store.update(two, { session: { tabs: [tab(3, "https://b.com")], activeId: 3 } });
    store.update(two, { maximized: true });

    const records = storeOf(database).load();
    expect(records.map((record) => record.key)).toEqual([one, two]);
    expect(records[0]!.session?.tabs).toHaveLength(1);
    expect(records[1]).toMatchObject({
      bounds: { x: 40, y: 50, width: 1200, height: 800 },
      maximized: true,
      session: { activeId: 3 },
    });
    database.close();
  });

  it("janela fechada sai do registro", () => {
    const database = tempDb();
    const store = storeOf(database);
    const one = store.add({});
    store.add({});
    store.remove(one);
    expect(storeOf(database).load()).toHaveLength(1);
    database.close();
  });

  it("a sessão da 1.6 (seção 'session' do renderer) vira a primeira janela", () => {
    const database = tempDb();
    database.saveState({
      version: 1,
      session: { tabs: [tab(7, "https://antiga.com")], activeId: 7 },
    });
    const records = storeOf(database).load();
    expect(records).toHaveLength(1);
    expect(records[0]!.session).toEqual({ tabs: [tab(7, "https://antiga.com")], activeId: 7 });
    // Migrou uma vez: o registro novo já existe.
    expect(database.getMeta("windows")).toHaveLength(1);
    database.close();
  });

  it("marcador de execução: saída normal, crash e crash logo ao abrir", () => {
    const database = tempDb();
    const first = storeOf(database);
    expect(first.beginRun()).toEqual({ unclean: false, early: false });
    first.endRun();
    // Saída normal: próxima execução limpa.
    const second = storeOf(database);
    expect(second.beginRun()).toEqual({ unclean: false, early: false });
    second.markStable();
    // Caiu depois de estável (sem endRun).
    const third = storeOf(database);
    expect(third.beginRun()).toEqual({ unclean: true, early: false });
    // Caiu antes de ficar estável.
    expect(storeOf(database).beginRun()).toEqual({ unclean: true, early: true });
    database.close();
  });

  it("posição salva só vale se a janela aparece numa tela atual", () => {
    const screen = [{ x: 0, y: 0, width: 1920, height: 1080 }];
    expect(windows.fitBounds({ x: 100, y: 80, width: 1200, height: 800 }, screen)).toEqual({
      x: 100,
      y: 80,
      width: 1200,
      height: 800,
    });
    // Monitor desconectado (janela à direita da única tela).
    expect(windows.fitBounds({ x: 2500, y: 80, width: 1200, height: 800 }, screen)).toBeNull();
    expect(windows.fitBounds({ x: 0, y: 0, width: 50, height: 20 }, screen)).toBeNull();
    expect(windows.fitBounds(null, screen)).toBeNull();
  });

  it("janela nova em cascata, sem sair da tela", () => {
    const area = { x: 0, y: 0, width: 1920, height: 1080 };
    expect(windows.cascadeBounds({ x: 100, y: 100, width: 1200, height: 800 }, area)).toEqual({
      x: 130,
      y: 130,
      width: 1200,
      height: 800,
    });
    expect(windows.cascadeBounds({ x: 700, y: 270, width: 1200, height: 800 }, area)).toEqual({
      x: 0,
      y: 0,
      width: 1200,
      height: 800,
    });
  });

  it("modo seguro: guias voltam, mas a ativa vira uma Nova aba", () => {
    const session = windows.safeSession({
      tabs: [tab(2, "https://a.com"), tab(5, "https://b.com")],
      activeId: 5,
    });
    expect(session?.tabs).toHaveLength(3);
    expect(session?.activeId).toBe(6);
    expect(session?.tabs[2]).toMatchObject({ id: 6, history: [{ kind: "home" }] });
    expect(windows.safeSession({ tabs: [], activeId: null })).toEqual({ tabs: [], activeId: null });
  });
});

describe("hibernate.cjs", () => {
  const now = 10 * 60 * 1000;
  const idle = { visible: false, hiddenSince: 0 };

  it("minutos das preferências; desligada quando o usuário desliga", () => {
    expect(hibernate.hibernateConfigOf(null)).toEqual({ enabled: true, afterMs: 30 * 60 * 1000 });
    expect(hibernate.hibernateConfigOf({ hibernateMinutes: 15 }).afterMs).toBe(15 * 60 * 1000);
    expect(hibernate.hibernateConfigOf({ hibernateMinutes: 7 }).afterMs).toBe(30 * 60 * 1000);
    expect(hibernate.hibernateConfigOf({ hibernate: false }).enabled).toBe(false);
    expect(hibernate.hibernateConfigOf({}, { afterMs: 1200 }).afterMs).toBe(1200);
  });

  it("só hiberna guia escondida há tempo suficiente e sem nada acontecendo", () => {
    const options = { now, afterMs: 5 * 60 * 1000 };
    expect(hibernate.canHibernate(idle, options)).toBe(true);
    expect(hibernate.canHibernate({ ...idle, hiddenSince: now - 1000 }, options)).toBe(false);
    expect(hibernate.canHibernate({ ...idle, visible: true }, options)).toBe(false);
    expect(hibernate.canHibernate({ visible: false, hiddenSince: null }, options)).toBe(false);
    for (const busy of [
      "audible",
      "loading",
      "capturing",
      "pendingPermission",
      "fullscreen",
      "devtools",
    ]) {
      expect(hibernate.canHibernate({ ...idle, [busy]: true }, options)).toBe(false);
    }
  });

  it("histórico restaurável sem páginas internas, com o índice ajustado", () => {
    const history = hibernate.restorableHistory(
      [
        { url: "about:blank", title: "" },
        { url: "https://a.com/", title: "A", pageState: "xyz" },
        { url: "chrome-error://chromewebdata/", title: "" },
        { url: "https://b.com/", title: "B" },
      ],
      3,
    );
    expect(history).toEqual({
      entries: [
        { url: "https://a.com/", title: "A", pageState: "xyz" },
        { url: "https://b.com/", title: "B" },
      ],
      index: 1,
    });
    expect(hibernate.restorableHistory([{ url: "about:blank" }], 0)).toBeNull();
    expect(hibernate.restorableHistory(null, 0)).toBeNull();
  });
});

describe("telas de erro", () => {
  const failure = (code: number, url = "https://exemplo.com.br/pagina") => ({
    code,
    description: "",
    url,
  });

  it("cada erro de rede tem sua tela", () => {
    expect(describeLoadError(failure(-106))).toMatchObject({
      kind: "offline",
      code: "ERR_INTERNET_DISCONNECTED",
      retryWhenOnline: true,
    });
    expect(describeLoadError(failure(-105)).kind).toBe("dns");
    expect(describeLoadError(failure(-105)).message).toContain("exemplo.com.br");
    expect(describeLoadError(failure(-102)).kind).toBe("connection");
    expect(describeLoadError(failure(-118)).kind).toBe("timeout");
    expect(describeLoadError(failure(-20))).toMatchObject({
      kind: "blocked",
      code: "ERR_BLOCKED_BY_CLIENT",
    });
    expect(describeLoadError(failure(-310)).kind).toBe("redirects");
    expect(describeLoadError(failure(-999)).kind).toBe("generic");
  });

  it("certificados inválidos (-200 a -299)", () => {
    expect(isCertificateError(-202)).toBe(true);
    expect(isCertificateError(-105)).toBe(false);
    expect(describeLoadError(failure(-202))).toMatchObject({
      kind: "certificate",
      title: "Sua conexão não é particular",
      code: "ERR_CERT_AUTHORITY_INVALID",
    });
  });

  it("código desconhecido usa a descrição do Chromium", () => {
    expect(errorCodeName({ code: -9999, description: "net::ERR_ALGO_NOVO", url: "" })).toBe(
      "ERR_ALGO_NOVO",
    );
    expect(errorCodeName({ code: -9999, description: "falhou", url: "" })).toBe("ERRO -9999");
  });

  it("motivo do travamento da página", () => {
    expect(describeCrash("oom").title).toContain("memória");
    expect(describeCrash("killed").title).toContain("encerrada");
    expect(describeCrash(undefined).title).toBe("Esta guia travou");
  });
});

function run(...actions: BrowserAction[]): BrowserState {
  return actions.reduce(browserReducer, { ...initialState, hydrated: true });
}
const page = (url: string) => ({ title: url, url, kind: "page" as const });

describe("reducer (1.7)", () => {
  it("guias restauradas que não estão à vista ficam hibernadas até serem abertas", () => {
    const state = run({
      type: "hydrate",
      payload: {
        prefs: initialState.prefs,
        tabs: [
          { id: 1, history: [page("https://a.com")], index: 0 },
          { id: 2, history: [page("https://b.com")], index: 0 },
          {
            id: 3,
            history: [{ title: "Nova aba", url: "agzos://inicio", kind: "home" }],
            index: 0,
          },
        ],
        activeId: 1,
        links: null,
        closedTabs: [],
        bookmarks: [],
      },
    });
    expect(state.hibernated).toEqual([2]);
    const opened = browserReducer(state, { type: "tab/activate", id: 2 });
    expect(opened.hibernated).toEqual([]);
  });

  it("hibernada limpa som, travamento e erro; a ativa nunca hiberna", () => {
    let state = run({ type: "nav/push", entry: page("https://a.com") }, { type: "tab/new" });
    state = browserReducer(state, { type: "view/audio", id: 1, playing: true });
    state = browserReducer(state, {
      type: "view/load-failed",
      id: 1,
      failure: { code: -105, description: "", url: "https://a.com" },
    });
    state = browserReducer(state, { type: "view/hibernated", id: 1 });
    expect(state.hibernated).toEqual([1]);
    expect(state.audioPlaying).toEqual([]);
    expect(state.failed).toEqual({});
    expect(browserReducer(state, { type: "view/hibernated", id: state.activeId })).toBe(state);
  });

  it("falha de carga entra e sai; travamento guarda o motivo", () => {
    const failure = { code: -106, description: "", url: "https://a.com" };
    let state = run({ type: "view/load-failed", id: 1, failure });
    expect(state.failed[1]).toEqual(failure);
    state = browserReducer(state, { type: "view/load-failed", id: 1, failure: null });
    expect(state.failed).toEqual({});
    state = browserReducer(state, { type: "view/unresponsive", id: 1, value: true });
    expect(state.unresponsive).toEqual([1]);
    state = browserReducer(state, { type: "view/crashed", id: 1, reason: "oom" });
    expect(state.crashReasons[1]).toBe("oom");
    expect(state.unresponsive).toEqual([]);
    state = browserReducer(state, { type: "view/recovered", id: 1 });
    expect(state.crashReasons).toEqual({});
  });

  it("guia movida para outra janela não vai para 'reabrir guia fechada'", () => {
    const state = run(
      { type: "nav/push", entry: page("https://a.com") },
      { type: "tab/new" },
      { type: "nav/push", entry: page("https://b.com") },
      { type: "tab/detach", id: 2 },
    );
    expect(state.tabs.map((item) => item.id)).toEqual([1]);
    expect(state.closedTabs).toEqual([]);
    expect(state.activeId).toBe(1);
  });

  it("sync aplica o que outra janela gravou, sem mexer nas guias", () => {
    const before = run({ type: "nav/push", entry: page("https://a.com") });
    const state = browserReducer(before, {
      type: "sync",
      payload: {
        prefs: { ...before.prefs, dark: true },
        closedTabs: [{ title: "X", url: "https://x.com" }],
      },
    });
    expect(state.prefs.dark).toBe(true);
    expect(state.closedTabs).toHaveLength(1);
    expect(state.tabs).toBe(before.tabs);
    expect(state.bookmarks).toBe(before.bookmarks);
  });
});

/** Bridge falsa: guarda o que foi gravado e deixa disparar o state-sync. */
function fakeBridge(sections: Record<string, unknown>) {
  const saved: Record<string, unknown>[] = [];
  let listener: ((sections: Record<string, unknown>) => void) | null = null;
  const bridge = {
    stateLoad: async () => ({ available: true, sections }),
    stateSave: async (value: Record<string, unknown>) => {
      saved.push(value);
      return { ok: true };
    },
    onStateSync: (callback: (sections: Record<string, unknown>) => void) => {
      listener = callback;
      return () => {
        listener = null;
      };
    },
  } as unknown as DesktopBridge;
  return { bridge, saved, emit: (value: Record<string, unknown>) => listener?.(value) };
}

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
};

describe("sincronização entre janelas (store desktop)", () => {
  it("janela nova não regrava o que leu do SQLite (não desfaz a outra janela)", async () => {
    const prefs = { ...initialState.prefs, dark: true };
    const { bridge, saved } = fakeBridge({
      version: SNAPSHOT_VERSION,
      prefs,
      links: [],
      closedTabs: [],
      bookmarks: [],
    });
    const store = createDesktopStore(bridge, memory());
    const snapshot = (await store.load())!;
    await store.save({ ...snapshot, session: { tabs: [], activeId: null } });
    // Só a sessão e as seções novas ausentes no banco (Discador da 3.0, notas da 4.5,
    // ColorTools da 4.7): o resto não é regravado.
    expect(saved).toEqual([
      {
        session: { tabs: [], activeId: null },
        dial: null,
        notes: {},
        colors: { history: [], palettes: [] },
      },
    ]);
  });

  it("janela aberta só com a sessão (guia movida) usa a sessão e não grava os padrões", async () => {
    const session = { tabs: [tab(1, "https://a.com")], activeId: 1 };
    const { bridge, saved } = fakeBridge({ session });
    const store = createDesktopStore(bridge, memory());
    const snapshot = (await store.load())!;
    expect(snapshot.session.tabs).toHaveLength(1);
    await store.save(snapshot);
    // Só a sessão desta janela; preferências e favoritos padrão não sobrescrevem nada.
    expect(saved.map((sections) => Object.keys(sections))).toEqual([["session"]]);
  });

  it("o que chega de outra janela não volta para o SQLite (sem pingue-pongue)", async () => {
    const { bridge, saved, emit } = fakeBridge({});
    const store = createDesktopStore(bridge, memory());
    await store.load();
    const received: unknown[] = [];
    store.subscribe!((payload) => received.push(payload));
    const prefs = { ...initialState.prefs, dark: true, engine: "yandex" };
    emit({ prefs, version: 1 });
    expect(received).toEqual([{ prefs: syncPayloadOf({ prefs }).prefs }]);
    await store.save({
      version: SNAPSHOT_VERSION,
      prefs: syncPayloadOf({ prefs }).prefs!,
      session: { tabs: [], activeId: null },
      links: null,
      closedTabs: [],
      bookmarks: null,
    });
    expect(saved).toHaveLength(1);
    expect(Object.keys(saved[0]!)).not.toContain("prefs");
  });
});

describe("reordenar guias (1.5.1)", () => {
  const withTabs = () =>
    run(
      { type: "nav/push", entry: page("https://a.com") },
      { type: "tab/new" },
      { type: "nav/push", entry: page("https://b.com") },
      { type: "tab/new" },
      { type: "nav/push", entry: page("https://c.com") },
    );
  const order = (state: BrowserState) => state.tabs.map((tab) => tab.id);

  it("arrasta para qualquer posição da ordem exibida", () => {
    const state = withTabs();
    expect(order(browserReducer(state, { type: "tab/move", id: 3, index: 0 }))).toEqual([3, 1, 2]);
    expect(order(browserReducer(state, { type: "tab/move", id: 1, index: 2 }))).toEqual([2, 3, 1]);
    expect(order(browserReducer(state, { type: "tab/move", id: 1, index: 99 }))).toEqual([2, 3, 1]);
    // Mesma posição: estado intacto.
    expect(browserReducer(state, { type: "tab/move", id: 2, index: 1 })).toBe(state);
    expect(browserReducer(state, { type: "tab/move", id: 42, index: 0 })).toBe(state);
  });

  it("fixadas ficam no grupo das fixadas", () => {
    const pinned = browserReducer(withTabs(), { type: "tab/toggle-pin", id: 3 });
    // Guia normal não passa para antes da fixada.
    const moved = browserReducer(pinned, { type: "tab/move", id: 2, index: 0 });
    expect(order(moved)).toEqual([3, 2, 1]);
    // Fixada não sai do começo.
    expect(order(browserReducer(pinned, { type: "tab/move", id: 3, index: 2 }))).toEqual([3, 1, 2]);
  });

  it("Ctrl+Shift+PgUp/PgDn anda uma posição", () => {
    const state = withTabs();
    const left = browserReducer(state, { type: "tab/move-relative", id: 3, delta: -1 });
    expect(order(left)).toEqual([1, 3, 2]);
    expect(browserReducer(state, { type: "tab/move-relative", id: 3, delta: 1 })).toBe(state);
  });

  it("picture-in-picture por guia sai quando a guia fecha", () => {
    let state = withTabs();
    state = browserReducer(state, { type: "view/pip", id: 2, active: true });
    expect(state.pip).toEqual([2]);
    state = browserReducer(state, { type: "tab/close", id: 2 });
    expect(state.pip).toEqual([]);
  });
});
