import type { Entry, Tab } from "../types";
import { DEFAULT_WORKSPACE_ID, homeEntry, type BrowserState } from "./state";

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

/** Ordem exibida: fixadas primeiro, o resto na ordem de abertura. */
export function orderTabs(tabs: Tab[]): Tab[] {
  return [...tabs].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false));
}

/** Workspace da guia (sem valor: o padrão). */
export function workspaceOf(tab: Tab): number {
  return tab.workspaceId ?? DEFAULT_WORKSPACE_ID;
}

/** Guias do workspace ativo, na ordem exibida (o que a barra mostra). */
export function workspaceTabs(
  state: Pick<BrowserState, "tabs" | "activeWorkspaceId">,
  workspaceId = state.activeWorkspaceId,
): Tab[] {
  return orderTabs(state.tabs.filter((tab) => workspaceOf(tab) === workspaceId));
}

/** A tela dividida está à vista (a guia ativa é uma das duas). */
export function splitShown(state: Pick<BrowserState, "split" | "activeId">) {
  return state.split !== null && state.split.ids.includes(state.activeId) ? state.split : null;
}

export function activeTabOf(state: BrowserState): Tab {
  return state.tabs.find((tab) => tab.id === state.activeId) ?? state.tabs[0]!;
}

/** No desktop, páginas web são dirigidas pelo WebContentsView, não pelo histórico local. */
export function navState(state: BrowserState, desktop: boolean) {
  const tab = activeTabOf(state);
  const viewDriven = desktop && entryOf(tab).kind === "page";
  return {
    viewDriven,
    canBack: viewDriven ? (state.viewNav?.canBack ?? false) : tab.index > 0,
    canForward: viewDriven
      ? (state.viewNav?.canForward ?? false)
      : tab.index < tab.history.length - 1,
  };
}

/** Favorito da página da aba ativa (a estrela da omnibox). */
export function currentBookmark(state: BrowserState) {
  const current = entryOf(activeTabOf(state));
  if (current.kind !== "page") return undefined;
  const key = normalizeUrlKey(current.url);
  return state.bookmarks.find(
    (node) => node.kind === "url" && node.url !== undefined && normalizeUrlKey(node.url) === key,
  );
}
