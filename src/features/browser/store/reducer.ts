import { BOOKMARKS_LIMIT, moveNode, seedFromLinks, subtreeIds } from "../bookmarks";
import type {
  AdblockStats,
  BlockedTracker,
  CrashReason,
  DownloadRecord,
  LoadFailure,
} from "../desktop";
import type { BookmarkNode, ClosedTab, Entry, QuickLink, Tab } from "../types";
import { entryOf, orderTabs } from "./selectors";
import {
  CLOSED_TABS_LIMIT,
  HOME_URL,
  defaultLinks,
  homeEntry,
  initialState,
  type BrowserState,
  type Prefs,
} from "./state";

export type HydratePayload = {
  prefs: Prefs;
  tabs: Tab[] | null;
  activeId: number | null;
  links: QuickLink[] | null;
  closedTabs: ClosedTab[];
  bookmarks: BookmarkNode[] | null;
};

/** Seções compartilhadas que outra janela gravou. */
export type SyncPayload = {
  prefs?: Prefs;
  links?: QuickLink[] | null;
  closedTabs?: ClosedTab[];
  bookmarks?: BookmarkNode[] | null;
};

export type BrowserAction =
  | { type: "hydrate"; payload: HydratePayload | null }
  | { type: "sync"; payload: SyncPayload }
  /** A guia foi para outra janela: sai daqui sem entrar em "reabrir guia fechada". */
  | { type: "tab/detach"; id: number }
  | { type: "tab/new"; private?: boolean; rightOf?: number }
  | { type: "tab/open-page"; entry: Entry }
  | { type: "tab/activate"; id: number }
  /** Próxima (1) ou anterior (-1) na ordem exibida, dando a volta. */
  | { type: "tab/activate-relative"; delta: 1 | -1 }
  /** Posição na ordem exibida (0 = primeira); -1 = última. */
  | { type: "tab/activate-index"; index: number }
  | { type: "tab/close"; id: number }
  | { type: "tab/close-others"; id: number }
  | { type: "tab/close-side"; id: number; direction: 1 | -1 }
  | { type: "tab/duplicate"; id: number }
  | { type: "tab/toggle-pin"; id: number }
  | { type: "tab/toggle-mute"; id: number }
  | { type: "tab/reopen-closed" }
  | { type: "tabs/reset" }
  | { type: "nav/push"; entry: Entry }
  /**
   * Página da casca (histórico, favoritos): reaproveita a aba que já a mostra, ocupa a
   * aba atual se ela não tem site aberto, ou abre numa aba nova (a página do site fica).
   */
  | { type: "nav/open-internal"; entry: Entry }
  | { type: "nav/step"; delta: number }
  | { type: "address/set"; value: string }
  | { type: "links/add"; link: QuickLink }
  | { type: "links/remove"; url: string }
  /** Novos favoritos/pastas, no fim de cada pasta (ou em `index`, quando há um só). */
  | { type: "bookmarks/add"; nodes: BookmarkNode[]; index?: number }
  | { type: "bookmarks/update"; id: string; title?: string; url?: string }
  | { type: "bookmarks/move"; id: string; parentId: string; index?: number }
  /** Remove o nó e, se for pasta, tudo dentro dela. */
  | { type: "bookmarks/remove"; id: string }
  | { type: "prefs/set"; patch: Partial<Prefs> }
  | { type: "prefs/pause-host"; host: string; pause: boolean }
  | {
      type: "view/updated";
      id: number;
      url: string;
      title: string;
      canBack: boolean;
      canForward: boolean;
    }
  | { type: "view/favicon"; id: number; icon: string | null }
  | { type: "view/audio"; id: number; playing: boolean }
  | { type: "view/muted"; id: number; muted: boolean }
  | { type: "view/crashed"; id: number; reason?: CrashReason }
  | { type: "view/load-failed"; id: number; failure: LoadFailure | null }
  | { type: "view/hibernated"; id: number }
  | { type: "view/unresponsive"; id: number; value: boolean }
  | { type: "view/recovered"; id: number }
  | { type: "view/login-rejected"; id: number; continueUrl: string | null }
  | { type: "fullscreen/set"; active: boolean }
  | { type: "view/blocked"; id: number; count: number; trackers: BlockedTracker[] }
  | { type: "view/zoom"; id: number; factor: number }
  /** A navegação virou download: a URL do arquivo sai do histórico da aba. */
  | { type: "view/download-navigation"; id: number; urls: string[] }
  | { type: "view/find"; id: number; active: number; total: number }
  /** Abre a barra de busca na aba ativa. */
  | { type: "find/open" }
  | { type: "find/clear" }
  | { type: "downloads/set"; list: DownloadRecord[] }
  | { type: "downloads/upsert"; record: DownloadRecord }
  | { type: "adblock/stats"; stats: AdblockStats }
  /** Ctrl+Tab / Ctrl+Shift+Tab: abre o seletor (ordem de uso) ou anda nele. */
  | { type: "switcher/step"; delta: 1 | -1 }
  | { type: "switcher/select"; index: number }
  /** Soltou o Ctrl (ou clicou): ativa a aba selecionada. */
  | { type: "switcher/commit"; index?: number }
  | { type: "switcher/cancel" }
  | { type: "view/thumbnail"; id: number; dataUrl: string };

function homeTab(id: number, isPrivate?: boolean): Tab {
  return isPrivate
    ? { id, history: [homeEntry], index: 0, private: true }
    : { id, history: [homeEntry], index: 0 };
}

function withoutKeys<T>(record: Record<number, T>, ids: Set<number>): Record<number, T> {
  if (!Object.keys(record).some((key) => ids.has(Number(key)))) return record;
  const next = { ...record };
  for (const id of ids) delete next[id];
  return next;
}

function withoutId(list: number[], id: number) {
  return list.includes(id) ? list.filter((item) => item !== id) : list;
}

function withoutKey<T>(record: Record<number, T>, id: number): Record<number, T> {
  return id in record ? withoutKeys(record, new Set([id])) : record;
}

/** Abas anônimas e a página inicial nunca entram na pilha de "reabrir guia fechada". */
function rememberClosed(closed: ClosedTab[], tabs: Tab[]): ClosedTab[] {
  const additions = tabs
    .filter((tab) => !tab.private && entryOf(tab).kind === "page")
    .map((tab) => {
      const entry = entryOf(tab);
      return { title: entry.title, url: entry.url };
    });
  if (!additions.length) return closed;
  return [...closed, ...additions].slice(-CLOSED_TABS_LIMIT);
}

function activate(state: BrowserState, tab: Tab): BrowserState {
  const recent =
    state.recent[0] === tab.id ? state.recent : [tab.id, ...withoutId(state.recent, tab.id)];
  return {
    ...state,
    activeId: tab.id,
    address: entryOf(tab).url,
    addressEdited: false,
    viewNav: null,
    find: null,
    recent,
    // A guia visível volta a ter página (o main recria a hibernada).
    hibernated: withoutId(state.hibernated, tab.id),
  };
}

/** Abas na ordem do Ctrl+Tab: usadas mais recentemente primeiro, depois as nunca vistas. */
export function recentOrder(state: BrowserState): number[] {
  const alive = new Set(state.tabs.map((tab) => tab.id));
  const seen = state.recent.filter((id) => alive.has(id));
  const rest = orderTabs(state.tabs)
    .map((tab) => tab.id)
    .filter((id) => !seen.includes(id));
  return [...seen, ...rest];
}

function insertAfter(tabs: Tab[], id: number, tab: Tab): Tab[] {
  const at = tabs.findIndex((item) => item.id === id);
  if (at < 0) return [...tabs, tab];
  return [...tabs.slice(0, at + 1), tab, ...tabs.slice(at + 1)];
}

function mapTab(state: BrowserState, id: number, update: (tab: Tab) => Tab): BrowserState {
  let changed = false;
  const tabs = state.tabs.map((tab) => {
    if (tab.id !== id) return tab;
    const next = update(tab);
    if (next !== tab) changed = true;
    return next;
  });
  return changed ? { ...state, tabs } : state;
}

/** Remove as abas indicadas; se a ativa sumir, `fallbackId` (ou a vizinha) assume. */
function removeTabs(
  state: BrowserState,
  doomed: Tab[],
  fallbackId?: number,
  remember = true,
): BrowserState {
  if (!doomed.length) return state;
  const ids = new Set(doomed.map((tab) => tab.id));
  const remaining = state.tabs.filter((tab) => !ids.has(tab.id));
  const closedTabs = remember ? rememberClosed(state.closedTabs, doomed) : state.closedTabs;
  const cleanup = {
    audioPlaying: state.audioPlaying.filter((id) => !ids.has(id)),
    crashed: state.crashed.filter((id) => !ids.has(id)),
    crashReasons: withoutKeys(state.crashReasons, ids),
    failed: withoutKeys(state.failed, ids),
    hibernated: state.hibernated.filter((id) => !ids.has(id)),
    unresponsive: state.unresponsive.filter((id) => !ids.has(id)),
    blocked: withoutKeys(state.blocked, ids),
    zoom: withoutKeys(state.zoom, ids),
    thumbnails: withoutKeys(state.thumbnails, ids),
    recent: state.recent.filter((id) => !ids.has(id)),
    switcher: null,
  };

  if (!remaining.length) {
    const replacement = homeTab(state.nextId);
    return {
      ...state,
      ...cleanup,
      tabs: [replacement],
      activeId: replacement.id,
      nextId: state.nextId + 1,
      address: HOME_URL,
      viewNav: null,
      closedTabs,
    };
  }

  const next = { ...state, ...cleanup, tabs: remaining, closedTabs };
  if (!ids.has(state.activeId)) return next;
  const fallback =
    remaining.find((tab) => tab.id === fallbackId) ??
    (() => {
      const index = state.tabs.findIndex((tab) => tab.id === state.activeId);
      return remaining[Math.max(0, index - 1)] ?? remaining[0]!;
    })();
  return activate(next, fallback);
}

export function browserReducer(state: BrowserState, action: BrowserAction): BrowserState {
  switch (action.type) {
    case "hydrate": {
      const saved = action.payload;
      if (!saved) return { ...state, hydrated: true };
      const tabs = saved.tabs?.length ? saved.tabs : state.tabs;
      const active = tabs.find((tab) => tab.id === saved.activeId) ?? tabs[0]!;
      const nextId = Math.max(state.nextId, ...tabs.map((tab) => tab.id + 1));
      return {
        ...state,
        hydrated: true,
        prefs: saved.prefs,
        links: saved.links ?? defaultLinks,
        // Antes da 1.6 a estrela salvava nos atalhos: eles viram favoritos da barra.
        bookmarks: saved.bookmarks ?? seedFromLinks(saved.links ?? [], defaultLinks, 0),
        closedTabs: saved.closedTabs.slice(-CLOSED_TABS_LIMIT),
        tabs,
        nextId,
        activeId: active.id,
        address: entryOf(active).url,
        recent: [active.id],
        // Restauradas: só a guia ativa carrega; as outras esperam ser abertas.
        hibernated: tabs
          .filter((tab) => tab.id !== active.id && entryOf(tab).kind === "page")
          .map((tab) => tab.id),
      };
    }

    case "sync": {
      const { prefs, links, closedTabs, bookmarks } = action.payload;
      return {
        ...state,
        ...(prefs ? { prefs } : {}),
        ...(links !== undefined ? { links: links ?? defaultLinks } : {}),
        ...(closedTabs ? { closedTabs: closedTabs.slice(-CLOSED_TABS_LIMIT) } : {}),
        ...(bookmarks ? { bookmarks } : {}),
      };
    }

    case "tab/detach": {
      const tab = state.tabs.find((item) => item.id === action.id);
      return tab ? removeTabs(state, [tab], undefined, false) : state;
    }

    case "tab/new": {
      const tab = homeTab(state.nextId, action.private);
      const tabs =
        action.rightOf != null
          ? insertAfter(state.tabs, action.rightOf, tab)
          : [...state.tabs, tab];
      return activate({ ...state, tabs, nextId: state.nextId + 1 }, tab);
    }

    case "tab/open-page": {
      const tab: Tab = { id: state.nextId, history: [action.entry], index: 0 };
      return activate({ ...state, tabs: [...state.tabs, tab], nextId: state.nextId + 1 }, tab);
    }

    case "tab/activate": {
      const tab = state.tabs.find((item) => item.id === action.id);
      return tab ? activate(state, tab) : state;
    }

    case "tab/activate-relative": {
      const display = orderTabs(state.tabs);
      if (display.length < 2) return state;
      const index = display.findIndex((tab) => tab.id === state.activeId);
      const target = display[(index + action.delta + display.length) % display.length]!;
      return activate(state, target);
    }

    case "tab/activate-index": {
      const display = orderTabs(state.tabs);
      const target = action.index < 0 ? display[display.length - 1] : display[action.index];
      if (!target || target.id === state.activeId) return state;
      return activate(state, target);
    }

    case "tab/close": {
      const tab = state.tabs.find((item) => item.id === action.id);
      return tab ? removeTabs(state, [tab]) : state;
    }

    case "tab/close-others": {
      if (!state.tabs.some((tab) => tab.id === action.id)) return state;
      const doomed = state.tabs.filter((tab) => tab.id !== action.id && !tab.pinned);
      return removeTabs(state, doomed, action.id);
    }

    case "tab/close-side": {
      const display = orderTabs(state.tabs);
      const index = display.findIndex((tab) => tab.id === action.id);
      if (index < 0) return state;
      const doomed = display.filter((tab, position) => {
        if (position === index || tab.pinned) return false;
        return action.direction === 1 ? position > index : position < index;
      });
      return removeTabs(state, doomed, action.id);
    }

    case "tab/duplicate": {
      const source = state.tabs.find((tab) => tab.id === action.id);
      if (!source) return state;
      const clone: Tab = {
        id: state.nextId,
        history: source.history.slice(0, source.index + 1),
        index: source.index,
        ...(source.private ? { private: true } : {}),
      };
      return activate(
        { ...state, tabs: insertAfter(state.tabs, source.id, clone), nextId: state.nextId + 1 },
        clone,
      );
    }

    case "tab/toggle-pin":
      return mapTab(state, action.id, (tab) => ({ ...tab, pinned: !tab.pinned }));

    case "tab/toggle-mute":
      return mapTab(state, action.id, (tab) => ({ ...tab, muted: !tab.muted }));

    case "tab/reopen-closed": {
      const last = state.closedTabs[state.closedTabs.length - 1];
      if (!last) return state;
      const tab: Tab = {
        id: state.nextId,
        history: [{ title: last.title, url: last.url, kind: "page" }],
        index: 0,
      };
      return activate(
        {
          ...state,
          tabs: [...state.tabs, tab],
          nextId: state.nextId + 1,
          closedTabs: state.closedTabs.slice(0, -1),
        },
        tab,
      );
    }

    case "tabs/reset": {
      const tab = homeTab(state.nextId);
      return {
        ...state,
        tabs: [tab],
        activeId: tab.id,
        nextId: state.nextId + 1,
        address: HOME_URL,
        viewNav: null,
        crashed: [],
        crashReasons: {},
        failed: {},
        hibernated: [],
        unresponsive: [],
        audioPlaying: [],
        loginRejected: {},
        requestedUrl: null,
        recent: [tab.id],
        switcher: null,
        thumbnails: {},
      };
    }

    case "nav/push": {
      const next = mapTab(state, state.activeId, (tab) => ({
        ...tab,
        history: [...tab.history.slice(0, tab.index + 1), action.entry],
        index: tab.index + 1,
      }));
      return {
        ...next,
        address: action.entry.url,
        addressEdited: false,
        requestedUrl: { id: state.activeId, url: action.entry.url },
      };
    }

    case "nav/open-internal": {
      const showing = state.tabs.find(
        (tab) => !tab.private && entryOf(tab).url === action.entry.url,
      );
      if (showing) return showing.id === state.activeId ? state : activate(state, showing);
      const active = state.tabs.find((tab) => tab.id === state.activeId);
      if (active && !active.private && entryOf(active).kind !== "page") {
        const next = mapTab(state, active.id, (tab) => ({
          ...tab,
          history: [...tab.history.slice(0, tab.index + 1), action.entry],
          index: tab.index + 1,
        }));
        return { ...next, address: action.entry.url, addressEdited: false, viewNav: null };
      }
      const tab: Tab = { id: state.nextId, history: [action.entry], index: 0 };
      const tabs = active ? insertAfter(state.tabs, active.id, tab) : [...state.tabs, tab];
      return activate({ ...state, tabs, nextId: state.nextId + 1 }, tab);
    }

    case "nav/step": {
      let address = state.address;
      const next = mapTab(state, state.activeId, (tab) => {
        const index = Math.min(Math.max(tab.index + action.delta, 0), tab.history.length - 1);
        if (index === tab.index) return tab;
        address = tab.history[index]!.url;
        return { ...tab, index };
      });
      return next === state ? state : { ...next, address, addressEdited: false };
    }

    case "address/set":
      return { ...state, address: action.value, addressEdited: true };

    case "links/add":
      return { ...state, links: [...state.links, action.link] };

    case "links/remove":
      return { ...state, links: state.links.filter((link) => link.url !== action.url) };

    case "bookmarks/add": {
      const known = new Set(state.bookmarks.map((node) => node.id));
      const fresh = action.nodes.filter((node) => !known.has(node.id));
      if (!fresh.length || state.bookmarks.length + fresh.length > BOOKMARKS_LIMIT) return state;
      let bookmarks = [...state.bookmarks, ...fresh];
      if (fresh.length === 1 && action.index !== undefined) {
        bookmarks = moveNode(bookmarks, fresh[0]!.id, fresh[0]!.parentId, action.index);
      }
      return { ...state, bookmarks };
    }

    case "bookmarks/update": {
      let changed = false;
      const bookmarks = state.bookmarks.map((node) => {
        if (node.id !== action.id) return node;
        const title = action.title?.trim() || node.title;
        const url = node.kind === "url" && action.url ? action.url : node.url;
        if (title === node.title && url === node.url) return node;
        changed = true;
        return { ...node, title, url };
      });
      return changed ? { ...state, bookmarks } : state;
    }

    case "bookmarks/move": {
      const bookmarks = moveNode(state.bookmarks, action.id, action.parentId, action.index);
      return bookmarks === state.bookmarks ? state : { ...state, bookmarks };
    }

    case "bookmarks/remove": {
      if (!state.bookmarks.some((node) => node.id === action.id)) return state;
      const doomed = subtreeIds(state.bookmarks, action.id);
      return { ...state, bookmarks: state.bookmarks.filter((node) => !doomed.has(node.id)) };
    }

    case "prefs/set":
      return { ...state, prefs: { ...state.prefs, ...action.patch } };

    case "prefs/pause-host": {
      const others = state.prefs.pausedHosts.filter((host) => host !== action.host);
      const pausedHosts = action.pause ? [...others, action.host] : others;
      return { ...state, prefs: { ...state.prefs, pausedHosts } };
    }

    case "view/updated": {
      const next = mapTab(state, action.id, (tab) => {
        const entry = tab.history[tab.index];
        if (!entry || entry.kind !== "page") return tab;
        const title = action.title || entry.title;
        if (entry.url === action.url && entry.title === title) return tab;
        const history = [...tab.history];
        history[tab.index] = { ...entry, url: action.url, title };
        return { ...tab, history };
      });
      if (action.id !== state.activeId) return next;
      // Texto digitado sobrevive a título/recarga da mesma página; navegar para outro
      // endereço (link na página) mostra o endereço novo.
      const before = state.tabs.find((tab) => tab.id === action.id);
      const keep =
        state.addressEdited && before !== undefined && entryOf(before).url === action.url;
      return {
        ...next,
        address: keep ? state.address : action.url,
        addressEdited: keep,
        viewNav: { canBack: action.canBack, canForward: action.canForward },
      };
    }

    case "view/favicon":
      return mapTab(state, action.id, (tab) =>
        tab.favicon === (action.icon ?? undefined)
          ? tab
          : { ...tab, favicon: action.icon ?? undefined },
      );

    case "view/audio": {
      const without = withoutId(state.audioPlaying, action.id);
      return { ...state, audioPlaying: action.playing ? [...without, action.id] : without };
    }

    case "view/muted":
      return mapTab(state, action.id, (tab) =>
        Boolean(tab.muted) === action.muted ? tab : { ...tab, muted: action.muted },
      );

    case "view/crashed":
      return {
        ...state,
        crashed: [...withoutId(state.crashed, action.id), action.id],
        crashReasons: { ...state.crashReasons, [action.id]: action.reason ?? "crashed" },
        unresponsive: withoutId(state.unresponsive, action.id),
        audioPlaying: withoutId(state.audioPlaying, action.id),
      };

    case "view/recovered":
      return {
        ...state,
        crashed: withoutId(state.crashed, action.id),
        crashReasons: withoutKey(state.crashReasons, action.id),
      };

    case "view/load-failed": {
      if (!action.failure) {
        return action.id in state.failed
          ? { ...state, failed: withoutKey(state.failed, action.id) }
          : state;
      }
      if (!state.tabs.some((tab) => tab.id === action.id)) return state;
      return { ...state, failed: { ...state.failed, [action.id]: action.failure } };
    }

    case "view/hibernated":
      if (action.id === state.activeId || !state.tabs.some((tab) => tab.id === action.id)) {
        return state;
      }
      return {
        ...state,
        hibernated: [...withoutId(state.hibernated, action.id), action.id],
        audioPlaying: withoutId(state.audioPlaying, action.id),
        crashed: withoutId(state.crashed, action.id),
        crashReasons: withoutKey(state.crashReasons, action.id),
        failed: withoutKey(state.failed, action.id),
        unresponsive: withoutId(state.unresponsive, action.id),
      };

    case "view/unresponsive": {
      const without = withoutId(state.unresponsive, action.id);
      return { ...state, unresponsive: action.value ? [...without, action.id] : without };
    }

    case "view/login-rejected": {
      const loginRejected = { ...state.loginRejected };
      if (action.continueUrl) loginRejected[action.id] = action.continueUrl;
      else delete loginRejected[action.id];
      return { ...state, loginRejected };
    }

    case "fullscreen/set":
      return { ...state, fullscreen: action.active };

    case "view/blocked":
      if (!state.tabs.some((tab) => tab.id === action.id)) return state;
      return {
        ...state,
        blocked: {
          ...state.blocked,
          [action.id]: { count: action.count, trackers: action.trackers },
        },
      };

    case "view/download-navigation": {
      const tab = state.tabs.find((item) => item.id === action.id);
      const entry = tab?.history[tab.index];
      if (!tab || !entry || entry.kind !== "page" || !action.urls.includes(entry.url)) {
        return state;
      }
      if (tab.index === 0 || tab.history[tab.index - 1]!.kind === "home") {
        // Aba sem página antes do arquivo (como a guia em branco que o Chrome fecha): vira
        // uma aba nova, com outro id, para o main descartar o WebContentsView vazio.
        const replacement = homeTab(state.nextId, tab.private);
        const tabs = state.tabs.map((item) =>
          item.id === tab.id ? { ...replacement, ...(tab.pinned ? { pinned: true } : {}) } : item,
        );
        const next = { ...state, tabs, nextId: state.nextId + 1 };
        return state.activeId === tab.id
          ? activate(
              next,
              tabs.find((item) => item.id === replacement.id)!,
            )
          : next;
      }
      const next = mapTab(state, tab.id, (item) => ({
        ...item,
        history: item.history.slice(0, item.index),
        index: item.index - 1,
      }));
      if (state.activeId !== tab.id) return next;
      return { ...next, address: tab.history[tab.index - 1]!.url, requestedUrl: null };
    }

    case "view/zoom":
      if (state.zoom[action.id] === action.factor) return state;
      return { ...state, zoom: { ...state.zoom, [action.id]: action.factor } };

    case "view/find":
      // Resultado atrasado de uma busca já fechada ou de outra aba: ignora.
      if (!state.find || action.id !== state.activeId) return state;
      return { ...state, find: { id: action.id, active: action.active, total: action.total } };

    case "find/open":
      if (state.find?.id === state.activeId) return state;
      return { ...state, find: { id: state.activeId, active: 0, total: 0 } };

    case "find/clear":
      return state.find ? { ...state, find: null } : state;

    case "downloads/set":
      return { ...state, downloads: action.list };

    case "downloads/upsert": {
      const others = state.downloads.filter((item) => item.id !== action.record.id);
      if (action.record.removed) return { ...state, downloads: others };
      const exists = others.length !== state.downloads.length;
      const downloads = exists
        ? state.downloads.map((item) => (item.id === action.record.id ? action.record : item))
        : [action.record, ...state.downloads];
      return { ...state, downloads };
    }

    case "adblock/stats":
      return { ...state, adblock: action.stats };

    case "switcher/step": {
      if (!state.switcher) {
        const ids = recentOrder(state);
        if (ids.length < 2) return state;
        // A 1ª posição é a aba atual: Ctrl+Tab começa na anterior usada.
        return { ...state, switcher: { ids, index: action.delta > 0 ? 1 : ids.length - 1 } };
      }
      const { ids, index } = state.switcher;
      const next = (index + action.delta + ids.length) % ids.length;
      return { ...state, switcher: { ids, index: next } };
    }

    case "switcher/select":
      if (!state.switcher || !state.switcher.ids[action.index]) return state;
      return { ...state, switcher: { ...state.switcher, index: action.index } };

    case "switcher/commit": {
      if (!state.switcher) return state;
      const id = state.switcher.ids[action.index ?? state.switcher.index];
      const closed = { ...state, switcher: null };
      const tab = state.tabs.find((item) => item.id === id);
      return tab && tab.id !== state.activeId ? activate(closed, tab) : closed;
    }

    case "switcher/cancel":
      return state.switcher ? { ...state, switcher: null } : state;

    case "view/thumbnail":
      if (!state.tabs.some((tab) => tab.id === action.id)) return state;
      return { ...state, thumbnails: { ...state.thumbnails, [action.id]: action.dataUrl } };
  }
}

export { initialState };
