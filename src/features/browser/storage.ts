import type {
  ClosedTab,
  Credential,
  EngineId,
  Entry,
  QuickLink,
  Tab,
  TabOrientation,
} from "./types";

export const homeEntry: Entry = { title: "Nova aba", url: "agzos://inicio", kind: "home" };
export const starterTabs: Tab[] = [{ id: 1, history: [homeEntry], index: 0 }];

export const defaultCredentials: Credential[] = [
  { domain: "github.com", user: "mrcatofic", password: "agz-Gh8x2mK93" },
  { domain: "figma.com", user: "design@agzos.com", password: "fg-4Wn9Kp17" },
  { domain: "notion.so", user: "equipe@agzos.com", password: "nt-7Ra5Ls26" },
];

export const defaultLinks: QuickLink[] = [
  { name: "GitHub", url: "github.com" },
  { name: "Figma", url: "figma.com" },
  { name: "Notion", url: "notion.so" },
  { name: "Linear", url: "linear.app" },
];

export function entryOf(tab: Tab): Entry {
  return tab.history[tab.index] ?? homeEntry;
}

export function hostOf(url: string): string | null {
  const target = url.startsWith("view-source:") ? url.slice("view-source:".length) : url;
  try {
    const parsed = new URL(target);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function normalizeUrlKey(url: string): string {
  return url
    .replace(/^https?:\/\//, "")
    .replace(/\/+$/, "")
    .toLowerCase();
}

export const CLOSED_TABS_LIMIT = 20;

export type PersistedState = {
  dark: boolean;
  tabs: Tab[] | null;
  engine: EngineId | null;
  shieldOff: boolean;
  aiOff: boolean;
  credentials: Credential[] | null;
  links: QuickLink[] | null;
  pausedHosts: string[];
  orientation: TabOrientation;
  railCollapsed: boolean;
  closedTabs: ClosedTab[];
};

export function loadPersistedState(): PersistedState {
  const state: PersistedState = {
    dark: false,
    tabs: null,
    engine: null,
    shieldOff: false,
    aiOff: false,
    credentials: null,
    links: null,
    pausedHosts: [],
    orientation: "horizontal",
    railCollapsed: false,
    closedTabs: [],
  };
  try {
    state.dark = window.localStorage.getItem("agzos-theme") === "dark";
    state.tabs = JSON.parse(window.localStorage.getItem("agzos-tabs") ?? "null") as Tab[] | null;
    state.engine = window.localStorage.getItem("agzos-engine") as EngineId | null;
    state.shieldOff = window.localStorage.getItem("agzos-shield") === "off";
    state.aiOff = window.localStorage.getItem("agzos-ai") === "off";
    state.credentials = JSON.parse(window.localStorage.getItem("agzos-credentials") ?? "null") as
      Credential[] | null;
    state.links = JSON.parse(window.localStorage.getItem("agzos-links") ?? "null") as
      QuickLink[] | null;
    const paused = JSON.parse(
      window.localStorage.getItem("agzos-paused-hosts") ?? "null",
    ) as unknown;
    if (Array.isArray(paused)) {
      state.pausedHosts = paused.filter((host): host is string => typeof host === "string");
    }
    const storedOrientation = window.localStorage.getItem("agzos-tab-orientation");
    if (storedOrientation === "vertical" || storedOrientation === "horizontal") {
      state.orientation = storedOrientation;
    }
    state.railCollapsed = window.localStorage.getItem("agzos-tab-rail-collapsed") === "1";
    const closed = JSON.parse(
      window.localStorage.getItem("agzos-closed-tabs") ?? "null",
    ) as unknown;
    if (Array.isArray(closed)) {
      state.closedTabs = closed
        .filter(
          (item): item is ClosedTab =>
            typeof item === "object" &&
            item !== null &&
            typeof (item as ClosedTab).title === "string" &&
            typeof (item as ClosedTab).url === "string",
        )
        .slice(0, CLOSED_TABS_LIMIT);
    }
  } catch {
    window.localStorage.removeItem("agzos-tabs");
  }
  return state;
}

export function persistBrowserState(state: {
  dark: boolean;
  tabs: Tab[];
  links: QuickLink[];
  engine: EngineId;
  shield: boolean;
  aiOpen: boolean;
  pausedHosts: string[];
  orientation: TabOrientation;
  railCollapsed: boolean;
  closedTabs: ClosedTab[];
}) {
  window.localStorage.setItem("agzos-theme", state.dark ? "dark" : "light");
  window.localStorage.setItem(
    "agzos-tabs",
    JSON.stringify(state.tabs.filter((tab) => !tab.private)),
  );
  window.localStorage.setItem("agzos-links", JSON.stringify(state.links));
  window.localStorage.setItem("agzos-engine", state.engine);
  window.localStorage.setItem("agzos-shield", state.shield ? "on" : "off");
  window.localStorage.setItem("agzos-ai", state.aiOpen ? "on" : "off");
  window.localStorage.setItem("agzos-paused-hosts", JSON.stringify(state.pausedHosts));
  window.localStorage.setItem("agzos-tab-orientation", state.orientation);
  window.localStorage.setItem("agzos-tab-rail-collapsed", state.railCollapsed ? "1" : "0");
  window.localStorage.setItem(
    "agzos-closed-tabs",
    JSON.stringify(state.closedTabs.slice(0, CLOSED_TABS_LIMIT)),
  );
}
