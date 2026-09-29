import type { AdblockStats, BlockedTracker, DownloadRecord } from "../desktop";
import type { ClosedTab, Entry, QuickLink, Tab } from "../types";
import { entryOf, normalizeUrlKey, orderTabs } from "./selectors";
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
};

export type BrowserAction =
  | { type: "hydrate"; payload: HydratePayload | null }
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
  | { type: "nav/step"; delta: number }
  | { type: "address/set"; value: string }
  | { type: "links/add"; link: QuickLink }
  | { type: "links/remove"; url: string }
  | { type: "links/toggle-current" }
  | { type: "links/bookmark-all" }
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
  | { type: "view/crashed"; id: number }
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
  | { type: "adblock/stats"; stats: AdblockStats };

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
  return { ...state, activeId: tab.id, address: entryOf(tab).url, viewNav: null, find: null };
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
function removeTabs(state: BrowserState, doomed: Tab[], fallbackId?: number): BrowserState {
  if (!doomed.length) return state;
  const ids = new Set(doomed.map((tab) => tab.id));
  const remaining = state.tabs.filter((tab) => !ids.has(tab.id));
  const closedTabs = rememberClosed(state.closedTabs, doomed);
  const cleanup = {
    audioPlaying: state.audioPlaying.filter((id) => !ids.has(id)),
    crashed: state.crashed.filter((id) => !ids.has(id)),
    blocked: withoutKeys(state.blocked, ids),
    zoom: withoutKeys(state.zoom, ids),
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
        closedTabs: saved.closedTabs.slice(-CLOSED_TABS_LIMIT),
        tabs,
        nextId,
        activeId: active.id,
        address: entryOf(active).url,
      };
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
        audioPlaying: [],
        loginRejected: {},
        requestedUrl: null,
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
        requestedUrl: { id: state.activeId, url: action.entry.url },
      };
    }

    case "nav/step": {
      let address = state.address;
      const next = mapTab(state, state.activeId, (tab) => {
        const index = Math.min(Math.max(tab.index + action.delta, 0), tab.history.length - 1);
        if (index === tab.index) return tab;
        address = tab.history[index]!.url;
        return { ...tab, index };
      });
      return next === state ? state : { ...next, address };
    }

    case "address/set":
      return { ...state, address: action.value };

    case "links/add":
      return { ...state, links: [...state.links, action.link] };

    case "links/remove":
      return { ...state, links: state.links.filter((link) => link.url !== action.url) };

    case "links/toggle-current": {
      const tab = state.tabs.find((item) => item.id === state.activeId);
      const current = tab ? entryOf(tab) : homeEntry;
      if (current.kind === "home" || tab?.private) return state;
      const key = normalizeUrlKey(current.url);
      const exists = state.links.some((link) => normalizeUrlKey(link.url) === key);
      const clean = current.url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
      return {
        ...state,
        links: exists
          ? state.links.filter((link) => normalizeUrlKey(link.url) !== key)
          : [...state.links, { name: current.title, url: clean }],
      };
    }

    case "links/bookmark-all": {
      const known = new Set(state.links.map((link) => normalizeUrlKey(link.url)));
      const additions: QuickLink[] = [];
      for (const tab of state.tabs) {
        const entry = entryOf(tab);
        if (tab.private || entry.kind !== "page") continue;
        const url = entry.url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
        const key = normalizeUrlKey(url);
        if (known.has(key)) continue;
        known.add(key);
        additions.push({ name: entry.title, url });
      }
      return additions.length ? { ...state, links: [...state.links, ...additions] } : state;
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
      return {
        ...next,
        address: action.url,
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
      return { ...state, crashed: [...withoutId(state.crashed, action.id), action.id] };

    case "view/recovered":
      return { ...state, crashed: withoutId(state.crashed, action.id) };

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
  }
}

export { initialState };
