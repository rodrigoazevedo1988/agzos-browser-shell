import { BOOKMARKS_LIMIT, moveNode, seedFromLinks, subtreeIds } from "../bookmarks";
import type {
  AdblockStats,
  BlockedTracker,
  CrashReason,
  DownloadRecord,
  LoadFailure,
} from "../desktop";
import {
  TAB_GROUP_COLORS,
  type BookmarkNode,
  type ClosedTab,
  type Entry,
  type QuickLink,
  type SplitView,
  type Tab,
  type TabGroup,
  type TabGroupColor,
  type Workspace,
} from "../types";
import { entryOf, orderTabs, workspaceOf, workspaceTabs } from "./selectors";
import {
  CLOSED_TABS_LIMIT,
  DEFAULT_WORKSPACE_ID,
  HOME_URL,
  defaultWorkspaces,
  defaultDial,
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
  dial?: QuickLink[] | null | undefined;
  closedTabs: ClosedTab[];
  bookmarks: BookmarkNode[] | null;
  groups?: TabGroup[] | undefined;
  workspaces?: Workspace[] | undefined;
  split?: SplitView | null | undefined;
};

/** Seções compartilhadas que outra janela gravou. */
export type SyncPayload = {
  prefs?: Prefs;
  links?: QuickLink[] | null;
  dial?: QuickLink[] | null;
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
  /**
   * Arrasta a guia para `index` da ordem exibida (contada sem ela). Fixadas ficam entre as
   * fixadas e as outras depois delas, como no Chrome.
   */
  | { type: "tab/move"; id: number; index: number }
  /** Uma posição para trás (-1) ou para frente (1) na ordem exibida (Ctrl+Shift+PgUp/PgDn). */
  | { type: "tab/move-relative"; id: number; delta: 1 | -1 }
  | { type: "tab/toggle-mute"; id: number }
  | { type: "tab/reopen-closed" }
  | { type: "tabs/reset" }
  | { type: "nav/push"; entry: Entry }
  /**
   * Página da casca (histórico, favoritos): reaproveita a aba que já a mostra, ocupa a
   * aba atual se ela não tem site aberto, ou abre numa aba nova (a página do site fica).
   */
  | { type: "nav/open-internal"; entry: Entry }
  /** Volta a guia ativa para a página inicial (atalho "Início" do Discador). */
  | { type: "nav/home" }
  | { type: "nav/step"; delta: number }
  | { type: "address/set"; value: string }
  | { type: "links/add"; link: QuickLink }
  | { type: "links/remove"; url: string }
  /** Discador (3.0): card novo no fim, remover e arrastar para outra posição. */
  | { type: "dial/add"; link: QuickLink }
  | { type: "dial/remove"; url: string }
  | { type: "dial/move"; url: string; index: number }
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
  | { type: "view/pip"; id: number; active: boolean }
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
  | { type: "view/thumbnail"; id: number; dataUrl: string }
  // --- Grupos de guias (2.0) ---
  /** Novo grupo com as guias (juntas, na posição da primeira). */
  | { type: "group/create"; ids: number[]; title?: string; color?: TabGroupColor }
  /** A guia entra no grupo (vai para o fim dele). */
  | { type: "group/add"; id: number; groupId: number }
  /** A guia sai do grupo (fica logo depois dele). */
  | { type: "group/leave"; id: number }
  | {
      type: "group/update";
      groupId: number;
      title?: string;
      color?: TabGroupColor;
      collapsed?: boolean;
    }
  /** Desfaz o grupo (as guias ficam). */
  | { type: "group/ungroup"; groupId: number }
  /** Fecha todas as guias do grupo. */
  | { type: "group/close"; groupId: number }
  // --- Workspaces (2.0) ---
  | { type: "workspace/create"; name: string; icon: string }
  | { type: "workspace/switch"; id: number }
  | { type: "workspace/update"; id: number; name?: string; icon?: string }
  /** Apaga o workspace e fecha as guias dele (o padrão não pode ser apagado). */
  | { type: "workspace/remove"; id: number }
  | { type: "tab/move-to-workspace"; id: number; workspaceId: number }
  // --- Tela dividida (2.0) ---
  /** Divide a tela: `id` ao lado da guia ativa (sem `id`: uma guia nova). */
  | { type: "split/open"; id?: number }
  | { type: "split/close" }
  | { type: "split/ratio"; ratio: number }
  /** Troca os lados da tela dividida. */
  | { type: "split/swap" };

function homeTab(id: number, isPrivate?: boolean): Tab {
  return isPrivate
    ? { id, history: [homeEntry], index: 0, private: true }
    : { id, history: [homeEntry], index: 0 };
}

/** Guia nova no workspace indicado (o padrão fica sem o campo). */
function inWorkspace(tab: Tab, workspaceId: number): Tab {
  if (workspaceId === DEFAULT_WORKSPACE_ID) {
    if (tab.workspaceId === undefined) return tab;
    const { workspaceId: _omit, ...rest } = tab;
    return rest;
  }
  return tab.workspaceId === workspaceId ? tab : { ...tab, workspaceId };
}

function withoutGroup(tab: Tab): Tab {
  if (tab.groupId === undefined) return tab;
  const { groupId: _omit, ...rest } = tab;
  return rest;
}

/** Grupos sem guias somem; a tela dividida some se uma das guias sumiu ou mudou de lugar. */
function pruneOrphans(state: BrowserState): BrowserState {
  const used = new Set(state.tabs.map((tab) => tab.groupId).filter((id) => id !== undefined));
  const groups = state.groups.some((group) => !used.has(group.id))
    ? state.groups.filter((group) => used.has(group.id))
    : state.groups;
  let split = state.split;
  if (split) {
    const [a, b] = split.ids.map((id) => state.tabs.find((tab) => tab.id === id));
    if (!a || !b || workspaceOf(a) !== workspaceOf(b)) split = null;
  }
  return groups === state.groups && split === state.split ? state : { ...state, groups, split };
}

function nextGroupColor(groups: TabGroup[]): TabGroupColor {
  const used = new Set(groups.map((group) => group.color));
  return TAB_GROUP_COLORS.find((color) => !used.has(color)) ?? TAB_GROUP_COLORS[groups.length % 9]!;
}

/** Reordena `ids` para ficarem juntos logo depois de `anchor` (ou no lugar da 1ª delas). */
function gather(tabs: Tab[], ids: Set<number>, update: (tab: Tab) => Tab): Tab[] {
  const first = tabs.findIndex((tab) => ids.has(tab.id));
  if (first < 0) return tabs;
  const moving = tabs.filter((tab) => ids.has(tab.id)).map(update);
  const rest = tabs.filter((tab) => !ids.has(tab.id));
  const at = tabs.slice(0, first).filter((tab) => !ids.has(tab.id)).length;
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

/** Grupo da guia depois de arrastada: entre duas do mesmo grupo entra nele; senão sai. */
function regroupAfterMove(tabs: Tab[], id: number): Tab[] {
  const display = orderTabs(tabs.filter((tab) => workspaceOf(tab) === workspaceOfId(tabs, id)));
  const at = display.findIndex((tab) => tab.id === id);
  const tab = display[at];
  if (!tab || tab.pinned) return tabs;
  const before = display[at - 1]?.groupId;
  const after = display[at + 1]?.groupId;
  let groupId: number | undefined;
  if (before !== undefined && before === after) groupId = before;
  else if (tab.groupId !== undefined && (before === tab.groupId || after === tab.groupId)) {
    groupId = tab.groupId;
  }
  if (groupId === tab.groupId) return tabs;
  return tabs.map((item) =>
    item.id !== id ? item : groupId === undefined ? withoutGroup(item) : { ...item, groupId },
  );
}

function workspaceOfId(tabs: Tab[], id: number) {
  const tab = tabs.find((item) => item.id === id);
  return tab ? workspaceOf(tab) : DEFAULT_WORKSPACE_ID;
}

/** Arrasta dentro do workspace da guia (`index` na ordem exibida dele, contada sem ela). */
function moveInWorkspace(tabs: Tab[], id: number, index: number): Tab[] {
  const workspaceId = workspaceOfId(tabs, id);
  const own = tabs.filter((tab) => workspaceOf(tab) === workspaceId);
  const moved = moveTab(own, id, index);
  if (moved === own) return tabs;
  return regroupAfterMove(
    [...tabs.filter((tab) => workspaceOf(tab) !== workspaceId), ...moved],
    id,
  );
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
  const workspaceId = workspaceOf(tab);
  // Guia de um grupo recolhido: o grupo abre (a guia ativa sempre aparece).
  const groups = state.groups.some((group) => group.id === tab.groupId && group.collapsed)
    ? state.groups.map((group) =>
        group.id === tab.groupId ? { ...group, collapsed: false } : group,
      )
    : state.groups;
  return {
    ...state,
    groups,
    activeWorkspaceId: workspaceId,
    workspaceActive:
      state.workspaceActive[workspaceId] === tab.id
        ? state.workspaceActive
        : { ...state.workspaceActive, [workspaceId]: tab.id },
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
  // Só as guias do workspace ativo (como a barra).
  const own = workspaceTabs(state);
  const alive = new Set(own.map((tab) => tab.id));
  const seen = state.recent.filter((id) => alive.has(id));
  const rest = own.map((tab) => tab.id).filter((id) => !seen.includes(id));
  return [...seen, ...rest];
}

function insertAfter(tabs: Tab[], id: number, tab: Tab): Tab[] {
  const at = tabs.findIndex((item) => item.id === id);
  if (at < 0) return [...tabs, tab];
  return [...tabs.slice(0, at + 1), tab, ...tabs.slice(at + 1)];
}

/** Nova ordem das guias com `id` na posição `index` (dentro do grupo dela). */
export function moveTab(tabs: Tab[], id: number, index: number): Tab[] {
  const display = orderTabs(tabs);
  const tab = display.find((item) => item.id === id);
  if (!tab) return tabs;
  const others = display.filter((item) => item.id !== id);
  const pinned = others.filter((item) => item.pinned).length;
  const [min, max] = tab.pinned ? [0, pinned] : [pinned, others.length];
  const target = Math.min(Math.max(Math.round(index), min), max);
  const next = [...others.slice(0, target), tab, ...others.slice(target)];
  return next.every((item, position) => item === display[position]) &&
    tabs.every((item, position) => item === display[position])
    ? tabs
    : next;
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
    pip: state.pip.filter((id) => !ids.has(id)),
    blocked: withoutKeys(state.blocked, ids),
    zoom: withoutKeys(state.zoom, ids),
    thumbnails: withoutKeys(state.thumbnails, ids),
    recent: state.recent.filter((id) => !ids.has(id)),
    switcher: null,
  };

  const workspaceId = state.activeWorkspaceId;
  if (!remaining.length) {
    const replacement = inWorkspace(homeTab(state.nextId), workspaceId);
    return pruneOrphans({
      ...state,
      ...cleanup,
      tabs: [replacement],
      activeId: replacement.id,
      nextId: state.nextId + 1,
      address: HOME_URL,
      viewNav: null,
      closedTabs,
      recent: [replacement.id],
      workspaceActive: { [workspaceId]: replacement.id },
    });
  }

  const next = pruneOrphans({ ...state, ...cleanup, tabs: remaining, closedTabs });
  if (!ids.has(state.activeId)) return next;
  // A vizinha da ativa, no mesmo workspace; workspace vazio ganha uma guia nova.
  const own = state.tabs.filter((tab) => workspaceOf(tab) === workspaceId);
  const index = own.findIndex((tab) => tab.id === state.activeId);
  const left = remaining.filter((tab) => workspaceOf(tab) === workspaceId);
  const fallback =
    left.find((tab) => tab.id === fallbackId) ?? left[Math.max(0, index - 1)] ?? left[0];
  if (fallback) return activate(next, fallback);
  const replacement = inWorkspace(homeTab(next.nextId), workspaceId);
  return activate(
    { ...next, tabs: [...next.tabs, replacement], nextId: next.nextId + 1 },
    replacement,
  );
}

export function browserReducer(state: BrowserState, action: BrowserAction): BrowserState {
  switch (action.type) {
    case "hydrate": {
      const saved = action.payload;
      if (!saved) return { ...state, hydrated: true };
      // Workspaces e grupos que as guias citam precisam existir (senão caem no padrão).
      const workspaces = saved.workspaces?.some((item) => item.id === DEFAULT_WORKSPACE_ID)
        ? saved.workspaces
        : [...defaultWorkspaces, ...(saved.workspaces ?? [])];
      const workspaceIds = new Set(workspaces.map((item) => item.id));
      const savedGroups = saved.groups ?? [];
      const groupIds = new Set(savedGroups.map((group) => group.id));
      const tabs = (saved.tabs?.length ? saved.tabs : state.tabs).map((tab) => {
        let next = tab;
        if (next.workspaceId !== undefined && !workspaceIds.has(next.workspaceId)) {
          next = inWorkspace(next, DEFAULT_WORKSPACE_ID);
        }
        if (next.groupId !== undefined && (!groupIds.has(next.groupId) || next.pinned)) {
          next = withoutGroup(next);
        }
        return next;
      });
      const active = tabs.find((tab) => tab.id === saved.activeId) ?? tabs[0]!;
      const nextId = Math.max(state.nextId, ...tabs.map((tab) => tab.id + 1));
      const restored = pruneOrphans({
        ...state,
        tabs,
        groups: savedGroups,
        split: saved.split ?? null,
      });
      return {
        ...state,
        hydrated: true,
        workspaces,
        groups: restored.groups,
        split: restored.split,
        activeWorkspaceId: workspaceOf(active),
        workspaceActive: { [workspaceOf(active)]: active.id },
        prefs: saved.prefs,
        links: saved.links ?? defaultLinks,
        dial: saved.dial ?? defaultDial,
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
      const { prefs, links, dial, closedTabs, bookmarks } = action.payload;
      return {
        ...state,
        ...(prefs ? { prefs } : {}),
        ...(links !== undefined ? { links: links ?? defaultLinks } : {}),
        ...(dial !== undefined ? { dial: dial ?? defaultDial } : {}),
        ...(closedTabs ? { closedTabs: closedTabs.slice(-CLOSED_TABS_LIMIT) } : {}),
        ...(bookmarks ? { bookmarks } : {}),
      };
    }

    case "tab/detach": {
      const tab = state.tabs.find((item) => item.id === action.id);
      return tab ? removeTabs(state, [tab], undefined, false) : state;
    }

    case "tab/new": {
      let tab = inWorkspace(homeTab(state.nextId, action.private), state.activeWorkspaceId);
      // "Nova guia à direita" de uma guia agrupada entra no grupo (como no Chrome).
      const reference = state.tabs.find((item) => item.id === action.rightOf);
      if (reference?.groupId !== undefined) tab = { ...tab, groupId: reference.groupId };
      const tabs =
        action.rightOf != null
          ? insertAfter(state.tabs, action.rightOf, tab)
          : [...state.tabs, tab];
      return activate({ ...state, tabs, nextId: state.nextId + 1 }, tab);
    }

    case "tab/open-page": {
      const tab = inWorkspace(
        { id: state.nextId, history: [action.entry], index: 0 },
        state.activeWorkspaceId,
      );
      return activate({ ...state, tabs: [...state.tabs, tab], nextId: state.nextId + 1 }, tab);
    }

    case "tab/activate": {
      const tab = state.tabs.find((item) => item.id === action.id);
      return tab ? activate(state, tab) : state;
    }

    case "tab/activate-relative": {
      const display = workspaceTabs(state);
      if (display.length < 2) return state;
      const index = display.findIndex((tab) => tab.id === state.activeId);
      const target = display[(index + action.delta + display.length) % display.length]!;
      return activate(state, target);
    }

    case "tab/activate-index": {
      const display = workspaceTabs(state);
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
      const doomed = workspaceTabs(state).filter((tab) => tab.id !== action.id && !tab.pinned);
      return removeTabs(state, doomed, action.id);
    }

    case "tab/close-side": {
      const display = workspaceTabs(state);
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
        ...(source.groupId !== undefined ? { groupId: source.groupId } : {}),
        ...(source.workspaceId !== undefined ? { workspaceId: source.workspaceId } : {}),
      };
      return activate(
        { ...state, tabs: insertAfter(state.tabs, source.id, clone), nextId: state.nextId + 1 },
        clone,
      );
    }

    case "tab/move": {
      const tabs = moveInWorkspace(state.tabs, action.id, action.index);
      return tabs === state.tabs ? state : pruneOrphans({ ...state, tabs });
    }

    case "tab/move-relative": {
      const tab = state.tabs.find((item) => item.id === action.id);
      if (!tab) return state;
      const display = workspaceTabs(state, workspaceOf(tab));
      const index = display.findIndex((item) => item.id === action.id);
      const tabs = moveInWorkspace(state.tabs, action.id, index + action.delta);
      return tabs === state.tabs ? state : pruneOrphans({ ...state, tabs });
    }

    case "tab/toggle-pin":
      // Guia fixada sai do grupo (as fixadas ficam antes de tudo, como no Chrome).
      return pruneOrphans(
        mapTab(state, action.id, (tab) =>
          tab.pinned ? { ...tab, pinned: false } : { ...withoutGroup(tab), pinned: true },
        ),
      );

    case "tab/toggle-mute":
      return mapTab(state, action.id, (tab) => ({ ...tab, muted: !tab.muted }));

    case "tab/reopen-closed": {
      const last = state.closedTabs[state.closedTabs.length - 1];
      if (!last) return state;
      const tab = inWorkspace(
        {
          id: state.nextId,
          history: [{ title: last.title, url: last.url, kind: "page" }],
          index: 0,
        },
        state.activeWorkspaceId,
      );
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
        groups: [],
        workspaces: defaultWorkspaces,
        activeWorkspaceId: DEFAULT_WORKSPACE_ID,
        workspaceActive: { [DEFAULT_WORKSPACE_ID]: tab.id },
        split: null,
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
        pip: [],
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
      const tab = inWorkspace(
        { id: state.nextId, history: [action.entry], index: 0 },
        state.activeWorkspaceId,
      );
      const tabs = active ? insertAfter(state.tabs, active.id, tab) : [...state.tabs, tab];
      return activate({ ...state, tabs, nextId: state.nextId + 1 }, tab);
    }

    case "nav/home": {
      const next = mapTab(state, state.activeId, (tab) =>
        entryOf(tab).kind === "home"
          ? tab
          : {
              ...tab,
              history: [...tab.history.slice(0, tab.index + 1), homeEntry],
              index: tab.index + 1,
            },
      );
      return next === state
        ? state
        : { ...next, address: HOME_URL, addressEdited: false, viewNav: null };
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

    case "dial/add":
      if (state.dial.some((link) => link.url === action.link.url)) return state;
      return { ...state, dial: [...state.dial, action.link] };

    case "dial/remove":
      return { ...state, dial: state.dial.filter((link) => link.url !== action.url) };

    case "dial/move": {
      const from = state.dial.findIndex((link) => link.url === action.url);
      if (from < 0) return state;
      const dial = state.dial.filter((_, index) => index !== from);
      const to = Math.max(0, Math.min(dial.length, action.index));
      if (to === from) return state;
      dial.splice(to, 0, state.dial[from]!);
      return { ...state, dial };
    }

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

    case "view/pip": {
      const without = withoutId(state.pip, action.id);
      if (action.active && !state.tabs.some((tab) => tab.id === action.id)) return state;
      return { ...state, pip: action.active ? [...without, action.id] : without };
    }

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
        const replacement = inWorkspace(homeTab(state.nextId, tab.private), workspaceOf(tab));
        const tabs = state.tabs.map((item) =>
          item.id === tab.id
            ? {
                ...replacement,
                ...(tab.pinned ? { pinned: true } : {}),
                ...(tab.groupId !== undefined ? { groupId: tab.groupId } : {}),
              }
            : item,
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

    // --- Grupos de guias ---

    case "group/create": {
      const members = state.tabs.filter((tab) => action.ids.includes(tab.id));
      if (!members.length) return state;
      const id = Math.max(0, ...state.groups.map((group) => group.id)) + 1;
      const group: TabGroup = {
        id,
        title: action.title?.trim() ?? "",
        color: action.color ?? nextGroupColor(state.groups),
      };
      const ids = new Set(members.map((tab) => tab.id));
      const tabs = gather(state.tabs, ids, (tab) => ({ ...tab, pinned: false, groupId: id }));
      return pruneOrphans({ ...state, tabs, groups: [...state.groups, group] });
    }

    case "group/add": {
      const tab = state.tabs.find((item) => item.id === action.id);
      const members = state.tabs.filter((item) => item.groupId === action.groupId);
      if (!tab || !members.length || tab.groupId === action.groupId) return state;
      // Vai para o fim do grupo, no workspace dele.
      const last = members[members.length - 1]!;
      const moved = inWorkspace(
        { ...tab, pinned: false, groupId: action.groupId },
        workspaceOf(last),
      );
      const rest = state.tabs.filter((item) => item.id !== tab.id);
      const next = pruneOrphans({ ...state, tabs: insertAfter(rest, last.id, moved) });
      return tab.id === state.activeId ? activate(next, moved) : next;
    }

    case "group/leave": {
      const tab = state.tabs.find((item) => item.id === action.id);
      if (!tab || tab.groupId === undefined) return state;
      const members = state.tabs.filter(
        (item) => item.groupId === tab.groupId && item.id !== tab.id,
      );
      const rest = state.tabs.filter((item) => item.id !== tab.id);
      const last = members[members.length - 1];
      const tabs = last
        ? insertAfter(rest, last.id, withoutGroup(tab))
        : state.tabs.map((item) => (item.id === tab.id ? withoutGroup(item) : item));
      return pruneOrphans({ ...state, tabs });
    }

    case "group/update": {
      const group = state.groups.find((item) => item.id === action.groupId);
      if (!group) return state;
      const next: TabGroup = {
        ...group,
        ...(action.title !== undefined ? { title: action.title.trim() } : {}),
        ...(action.color ? { color: action.color } : {}),
        ...(action.collapsed !== undefined ? { collapsed: action.collapsed } : {}),
      };
      let result: BrowserState = {
        ...state,
        groups: state.groups.map((item) => (item.id === group.id ? next : item)),
      };
      // Recolher o grupo da guia ativa: a ativa passa para a primeira guia fora dele.
      const active = state.tabs.find((tab) => tab.id === state.activeId);
      if (next.collapsed && active?.groupId === group.id) {
        const outside = workspaceTabs(state).find((tab) => tab.groupId !== group.id);
        if (!outside) return state;
        result = activate(result, outside);
      }
      return result;
    }

    case "group/ungroup": {
      if (!state.groups.some((group) => group.id === action.groupId)) return state;
      const tabs = state.tabs.map((tab) =>
        tab.groupId === action.groupId ? withoutGroup(tab) : tab,
      );
      return pruneOrphans({ ...state, tabs });
    }

    case "group/close":
      return removeTabs(
        state,
        state.tabs.filter((tab) => tab.groupId === action.groupId),
      );

    // --- Workspaces ---

    case "workspace/create": {
      const name = action.name.trim();
      if (!name) return state;
      const id = Math.max(0, ...state.workspaces.map((item) => item.id)) + 1;
      const workspace: Workspace = { id, name: name.slice(0, 40), icon: action.icon || "🗂️" };
      const tab = inWorkspace(homeTab(state.nextId), id);
      return activate(
        {
          ...state,
          workspaces: [...state.workspaces, workspace],
          tabs: [...state.tabs, tab],
          nextId: state.nextId + 1,
        },
        tab,
      );
    }

    case "workspace/switch": {
      if (action.id === state.activeWorkspaceId) return state;
      if (!state.workspaces.some((item) => item.id === action.id)) return state;
      const own = workspaceTabs(state, action.id);
      const remembered = own.find((tab) => tab.id === state.workspaceActive[action.id]);
      const target = remembered ?? own[0];
      if (target) return activate({ ...state, switcher: null }, target);
      const tab = inWorkspace(homeTab(state.nextId), action.id);
      return activate(
        { ...state, tabs: [...state.tabs, tab], nextId: state.nextId + 1, switcher: null },
        tab,
      );
    }

    case "workspace/update": {
      const workspaces = state.workspaces.map((item) =>
        item.id !== action.id
          ? item
          : {
              ...item,
              ...(action.name?.trim() ? { name: action.name.trim().slice(0, 40) } : {}),
              ...(action.icon ? { icon: action.icon } : {}),
            },
      );
      return { ...state, workspaces };
    }

    case "workspace/remove": {
      if (action.id === DEFAULT_WORKSPACE_ID) return state;
      if (!state.workspaces.some((item) => item.id === action.id)) return state;
      const doomed = state.tabs.filter((tab) => workspaceOf(tab) === action.id);
      let next: BrowserState = {
        ...state,
        workspaces: state.workspaces.filter((item) => item.id !== action.id),
      };
      // Apagando o workspace atual: vai para o padrão antes de fechar as guias.
      if (state.activeWorkspaceId === action.id) {
        next = browserReducer(next, { type: "workspace/switch", id: DEFAULT_WORKSPACE_ID });
      }
      const remembered = { ...next.workspaceActive };
      delete remembered[action.id];
      return removeTabs({ ...next, workspaceActive: remembered }, doomed);
    }

    case "tab/move-to-workspace": {
      const tab = state.tabs.find((item) => item.id === action.id);
      if (!tab || workspaceOf(tab) === action.workspaceId) return state;
      if (!state.workspaces.some((item) => item.id === action.workspaceId)) return state;
      const moved = inWorkspace(withoutGroup({ ...tab, pinned: false }), action.workspaceId);
      // Vai para o fim do workspace de destino.
      const tabs = [...state.tabs.filter((item) => item.id !== tab.id), moved];
      let next = pruneOrphans({ ...state, tabs });
      if (tab.id === state.activeId) {
        // A guia ativa saiu daqui: a vizinha assume (ou uma guia nova, se ficou vazio).
        const own = workspaceTabs(state);
        const index = own.findIndex((item) => item.id === tab.id);
        const left = workspaceTabs(next, state.activeWorkspaceId);
        const fallback = left[Math.max(0, index - 1)] ?? left[0];
        if (fallback) next = activate(next, fallback);
        else {
          const home = inWorkspace(homeTab(next.nextId), state.activeWorkspaceId);
          next = activate({ ...next, tabs: [...next.tabs, home], nextId: next.nextId + 1 }, home);
        }
      }
      return next;
    }

    // --- Tela dividida ---

    case "split/open": {
      const active = state.tabs.find((tab) => tab.id === state.activeId);
      if (!active) return state;
      if (action.id !== undefined) {
        const other = state.tabs.find((tab) => tab.id === action.id);
        if (!other || other.id === active.id) return state;
        // A outra guia vem para o workspace da ativa e fica ao lado dela.
        const moved = inWorkspace(other, workspaceOf(active));
        const tabs = insertAfter(
          state.tabs.filter((tab) => tab.id !== other.id),
          active.id,
          moved,
        );
        return pruneOrphans({
          ...state,
          tabs,
          split: { ids: [active.id, other.id], ratio: 0.5 },
        });
      }
      const tab = inWorkspace(homeTab(state.nextId), workspaceOf(active));
      const next = {
        ...state,
        tabs: insertAfter(state.tabs, active.id, tab),
        nextId: state.nextId + 1,
        split: { ids: [active.id, tab.id] as [number, number], ratio: 0.5 },
      };
      return activate(next, tab);
    }

    case "split/close":
      return state.split ? { ...state, split: null } : state;

    case "split/ratio": {
      if (!state.split) return state;
      const ratio = Math.min(0.8, Math.max(0.2, action.ratio));
      return ratio === state.split.ratio ? state : { ...state, split: { ...state.split, ratio } };
    }

    case "split/swap":
      if (!state.split) return state;
      return {
        ...state,
        split: {
          ids: [state.split.ids[1], state.split.ids[0]],
          ratio: 1 - state.split.ratio,
        },
      };
  }
}

export { initialState };
