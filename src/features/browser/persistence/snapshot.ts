import { parseBookmarks } from "../bookmarks";
import { parseLimits } from "../control/limits";
import {
  clampPanelWidth,
  parsePanelWidths,
  parseSidePanels,
  withNewSidePanels,
} from "../side-panels";
import { parseSoundTick, parseSoundVolume } from "@/features/sounds/sounds";
import { parseGestures } from "@/features/gestures/gestures";
import { clampTerminalHeight } from "@/features/terminal/model";
import { parseTerminalSettings } from "@/features/terminal/config";
import type { HydratePayload } from "../store/reducer";
import {
  BOOKMARKS_URL,
  CLOSED_TABS_LIMIT,
  DIAL_URL,
  HIBERNATE_MINUTES,
  HISTORY_URL,
  SETTINGS_URL,
  defaultPrefs,
  type BrowserState,
  type Prefs,
} from "../store/state";
import {
  TAB_GROUP_COLORS,
  type BookmarkNode,
  type ClosedTab,
  type Entry,
  type QuickLink,
  type SplitView,
  type Tab,
  type TabGroup,
  type Workspace,
} from "../types";

export const SNAPSHOT_VERSION = 1;

/** Formato gravado em disco (localStorage na web, tabela kv do SQLite no desktop). */
export type Snapshot = {
  version: typeof SNAPSHOT_VERSION;
  prefs: Prefs;
  session: {
    tabs: Tab[];
    activeId: number | null;
    /** 2.0: grupos, workspaces e tela dividida desta janela. */
    groups?: TabGroup[];
    workspaces?: Workspace[];
    split?: SplitView | null;
  };
  /** null = usar os atalhos padrão. */
  links: QuickLink[] | null;
  /** Cards do Discador (3.0); null/ausente = os padrão. */
  dial?: QuickLink[] | null;
  closedTabs: ClosedTab[];
  /** null = ainda não existia (antes da 1.6): os favoritos nascem dos atalhos. */
  bookmarks: BookmarkNode[] | null;
};

export const SNAPSHOT_SECTIONS = [
  "version",
  "prefs",
  "session",
  "links",
  "closedTabs",
  "bookmarks",
  "dial",
] as const;

const INTERNAL_URLS = new Set([HISTORY_URL, BOOKMARKS_URL, SETTINGS_URL, DIAL_URL]);

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";

function parseEntry(value: unknown): Entry | null {
  if (!isObject(value) || !isString(value["title"]) || !isString(value["url"])) return null;
  const kind =
    value["kind"] === "home"
      ? "home"
      : value["kind"] === "page"
        ? "page"
        : value["kind"] === "internal" && INTERNAL_URLS.has(value["url"])
          ? "internal"
          : null;
  return kind ? { title: value["title"], url: value["url"], kind } : null;
}

function parseTab(value: unknown): Tab | null {
  if (!isObject(value) || !Number.isSafeInteger(value["id"]) || !Array.isArray(value["history"])) {
    return null;
  }
  const history = value["history"].map(parseEntry).filter((entry) => entry !== null);
  if (!history.length) return null;
  const rawIndex = Number.isInteger(value["index"]) ? (value["index"] as number) : 0;
  const tab: Tab = {
    id: value["id"] as number,
    history,
    index: Math.min(Math.max(rawIndex, 0), history.length - 1),
  };
  if (value["pinned"] === true) tab.pinned = true;
  if (Number.isSafeInteger(value["groupId"])) tab.groupId = value["groupId"] as number;
  if (Number.isSafeInteger(value["workspaceId"])) {
    tab.workspaceId = value["workspaceId"] as number;
  }
  if (value["muted"] === true) tab.muted = true;
  if (isString(value["favicon"]) && /^(https?:|data:image\/)/.test(value["favicon"])) {
    tab.favicon = value["favicon"];
  }
  return tab;
}

export function parseTabs(value: unknown): Tab[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const tabs: Tab[] = [];
  for (const item of value) {
    // Abas anônimas nunca deveriam estar em disco; se estiverem, são descartadas.
    if (isObject(item) && item["private"] === true) continue;
    const tab = parseTab(item);
    if (tab && !seen.has(tab.id)) {
      seen.add(tab.id);
      tabs.push(tab);
    }
  }
  return tabs;
}

export function parseGroups(value: unknown): TabGroup[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const groups: TabGroup[] = [];
  for (const item of value) {
    if (!isObject(item) || !Number.isSafeInteger(item["id"]) || seen.has(item["id"] as number)) {
      continue;
    }
    const color = (TAB_GROUP_COLORS as readonly unknown[]).includes(item["color"])
      ? (item["color"] as TabGroup["color"])
      : "grey";
    seen.add(item["id"] as number);
    groups.push({
      id: item["id"] as number,
      title: isString(item["title"]) ? item["title"].slice(0, 60) : "",
      color,
      ...(item["collapsed"] === true ? { collapsed: true } : {}),
    });
  }
  return groups;
}

export function parseWorkspaces(value: unknown): Workspace[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const workspaces: Workspace[] = [];
  for (const item of value) {
    if (!isObject(item) || !Number.isSafeInteger(item["id"]) || seen.has(item["id"] as number)) {
      continue;
    }
    if (!isString(item["name"]) || !item["name"].trim()) continue;
    seen.add(item["id"] as number);
    workspaces.push({
      id: item["id"] as number,
      name: item["name"].trim().slice(0, 40),
      icon: isString(item["icon"]) && item["icon"] ? item["icon"].slice(0, 8) : "🗂️",
    });
  }
  return workspaces;
}

export function parseSplit(value: unknown): SplitView | null {
  if (!isObject(value) || !Array.isArray(value["ids"]) || value["ids"].length !== 2) return null;
  const [a, b] = value["ids"];
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b) || a === b) return null;
  const ratio = typeof value["ratio"] === "number" ? value["ratio"] : 0.5;
  return { ids: [a as number, b as number], ratio: Math.min(0.8, Math.max(0.2, ratio)) };
}

export function parseLinks(value: unknown): QuickLink[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter(
      (item): item is QuickLink =>
        isObject(item) && isString(item["name"]) && isString(item["url"]),
    )
    .map((link) => quickLinkOf(link));
}

/** Só os campos conhecidos; a categoria entra quando é um texto não vazio. */
function quickLinkOf(link: QuickLink): QuickLink {
  const category = isString(link.category) ? link.category.trim().slice(0, 40) : "";
  return category
    ? { name: link.name, url: link.url, category }
    : { name: link.name, url: link.url };
}

/** Cards do Discador: só nome e endereço válidos, sem repetir endereço. */
export function parseDial(value: unknown): QuickLink[] | null {
  const links = parseLinks(value);
  if (!links) return null;
  const seen = new Set<string>();
  return links
    .filter((link) => link.url.trim() && !seen.has(link.url) && Boolean(seen.add(link.url)))
    .map((link) => quickLinkOf(link));
}

export function parseClosedTabs(value: unknown): ClosedTab[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is ClosedTab =>
        isObject(item) && isString(item["title"]) && isString(item["url"]),
    )
    .map((item) => ({ title: item.title, url: item.url }))
    .slice(-CLOSED_TABS_LIMIT);
}

export function parsePrefs(value: unknown): Prefs {
  const raw = isObject(value) ? value : {};
  const bool = (key: keyof Prefs) =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : (defaultPrefs[key] as boolean);
  return {
    dark: bool("dark"),
    shield: bool("shield"),
    aiOpen: bool("aiOpen"),
    railCollapsed: bool("railCollapsed"),
    bookmarksBar: bool("bookmarksBar"),
    searchSuggestions: bool("searchSuggestions"),
    keyBarPinned: bool("keyBarPinned"),
    hibernate: bool("hibernate"),
    sidebar: bool("sidebar"),
    ...withNewSidePanels(parseSidePanels(raw["sidePanels"]), raw["sidePanelsSeen"]),
    ...parseLimits(raw),
    sidePanelWidth: clampPanelWidth(raw["sidePanelWidth"]),
    sidePanelWidths: parsePanelWidths(raw["sidePanelWidths"]),
    sounds: bool("sounds"),
    soundHover: bool("soundHover"),
    soundKeys: bool("soundKeys"),
    soundTick: parseSoundTick(raw["soundTick"]),
    soundVolume: parseSoundVolume(raw["soundVolume"], defaultPrefs.soundVolume),
    hibernateMinutes: (HIBERNATE_MINUTES as readonly unknown[]).includes(raw["hibernateMinutes"])
      ? (raw["hibernateMinutes"] as number)
      : defaultPrefs.hibernateMinutes,
    engine:
      raw["engine"] === "yandex" || raw["engine"] === "duckduckgo" ? raw["engine"] : "duckduckgo",
    orientation: raw["orientation"] === "vertical" ? "vertical" : "horizontal",
    pausedHosts: Array.isArray(raw["pausedHosts"])
      ? [...new Set(raw["pausedHosts"].filter(isString))]
      : [],
    accentColor: isString(raw["accentColor"]) ? raw["accentColor"] : defaultPrefs.accentColor,
    backgroundImage: isString(raw["backgroundImage"])
      ? raw["backgroundImage"]
      : defaultPrefs.backgroundImage,
    backgroundBlur:
      typeof raw["backgroundBlur"] === "number"
        ? raw["backgroundBlur"]
        : defaultPrefs.backgroundBlur,
    backgroundOpacity:
      typeof raw["backgroundOpacity"] === "number"
        ? raw["backgroundOpacity"]
        : defaultPrefs.backgroundOpacity,
    uiBlur: typeof raw["uiBlur"] === "boolean" ? raw["uiBlur"] : defaultPrefs.uiBlur,
    aiModel: isString(raw["aiModel"]) ? raw["aiModel"].slice(0, 120) : defaultPrefs.aiModel,
    gestures: parseGestures(raw["gestures"]),
    terminalOpen: bool("terminalOpen"),
    terminalHeight: clampTerminalHeight(raw["terminalHeight"]),
    terminalShell: isString(raw["terminalShell"])
      ? raw["terminalShell"].slice(0, 260)
      : defaultPrefs.terminalShell,
    terminal: parseTerminalSettings(raw["terminal"]),
    terminalCwd: isString(raw["terminalCwd"])
      ? raw["terminalCwd"].slice(0, 1024)
      : defaultPrefs.terminalCwd,
  };
}

/** Aceita qualquer coisa vinda do disco; campos inválidos voltam ao padrão. */
export function parseSnapshot(value: unknown): Snapshot | null {
  if (!isObject(value) || value["version"] !== SNAPSHOT_VERSION) return null;
  const session = isObject(value["session"]) ? value["session"] : {};
  const activeId = Number.isSafeInteger(session["activeId"])
    ? (session["activeId"] as number)
    : null;
  return {
    version: SNAPSHOT_VERSION,
    prefs: parsePrefs(value["prefs"]),
    session: {
      tabs: parseTabs(session["tabs"]),
      activeId,
      groups: parseGroups(session["groups"]),
      workspaces: parseWorkspaces(session["workspaces"]),
      split: parseSplit(session["split"]),
    },
    links: parseLinks(value["links"]),
    dial: parseDial(value["dial"]),
    closedTabs: parseClosedTabs(value["closedTabs"]),
    bookmarks: parseBookmarks(value["bookmarks"]),
  };
}

export type PersistedSlice = Pick<
  BrowserState,
  "tabs" | "activeId" | "prefs" | "links" | "closedTabs" | "bookmarks"
> &
  Partial<Pick<BrowserState, "groups" | "workspaces" | "split" | "dial">>;

export function snapshotOf(state: PersistedSlice): Snapshot {
  const tabs = state.tabs.filter((tab) => !tab.private).map(({ private: _private, ...tab }) => tab);
  return {
    version: SNAPSHOT_VERSION,
    prefs: state.prefs,
    session: {
      tabs,
      activeId: tabs.some((tab) => tab.id === state.activeId) ? state.activeId : null,
      groups: state.groups ?? [],
      workspaces: state.workspaces ?? [],
      split:
        state.split && state.split.ids.every((id) => tabs.some((tab) => tab.id === id))
          ? state.split
          : null,
    },
    links: state.links,
    dial: state.dial ?? null,
    closedTabs: state.closedTabs.slice(-CLOSED_TABS_LIMIT),
    bookmarks: state.bookmarks,
  };
}

export function toHydratePayload(snapshot: Snapshot | null): HydratePayload | null {
  if (!snapshot) return null;
  return {
    prefs: snapshot.prefs,
    tabs: snapshot.session.tabs.length ? snapshot.session.tabs : null,
    activeId: snapshot.session.activeId,
    links: snapshot.links,
    dial: snapshot.dial ?? null,
    closedTabs: snapshot.closedTabs,
    bookmarks: snapshot.bookmarks,
    groups: snapshot.session.groups ?? [],
    workspaces: snapshot.session.workspaces ?? [],
    split: snapshot.session.split ?? null,
  };
}

// --- Formato antigo (v1.3.x): uma chave de localStorage por preferência. ---

export const LEGACY_KEYS = [
  "agzos-theme",
  "agzos-tabs",
  "agzos-engine",
  "agzos-shield",
  "agzos-ai",
  "agzos-links",
  "agzos-paused-hosts",
  "agzos-tab-orientation",
  "agzos-tab-rail-collapsed",
  "agzos-closed-tabs",
] as const;

function readJson(storage: StorageLike, key: string): unknown {
  try {
    return JSON.parse(storage.getItem(key) ?? "null");
  } catch {
    return null;
  }
}

/** Lê o estado gravado pela 1.3.x. Retorna null quando nenhuma chave antiga existe. */
export function readLegacySnapshot(storage: StorageLike): Snapshot | null {
  if (!LEGACY_KEYS.some((key) => storage.getItem(key) !== null)) return null;
  const tabs = parseTabs(readJson(storage, "agzos-tabs"));
  return {
    version: SNAPSHOT_VERSION,
    prefs: parsePrefs({
      dark: storage.getItem("agzos-theme") === "dark",
      shield: storage.getItem("agzos-shield") !== "off",
      aiOpen: storage.getItem("agzos-ai") !== "off",
      engine: storage.getItem("agzos-engine"),
      orientation: storage.getItem("agzos-tab-orientation"),
      railCollapsed: storage.getItem("agzos-tab-rail-collapsed") === "1",
      pausedHosts: readJson(storage, "agzos-paused-hosts"),
    }),
    // A 1.3 abria sempre na primeira aba.
    session: { tabs, activeId: tabs[0]?.id ?? null, groups: [], workspaces: [], split: null },
    links: parseLinks(readJson(storage, "agzos-links")),
    dial: null,
    // A 1.3 empilhava no fim e reabria o último.
    closedTabs: parseClosedTabs(readJson(storage, "agzos-closed-tabs")),
    bookmarks: null,
  };
}

export function clearLegacy(storage: StorageLike) {
  for (const key of LEGACY_KEYS) storage.removeItem(key);
}
