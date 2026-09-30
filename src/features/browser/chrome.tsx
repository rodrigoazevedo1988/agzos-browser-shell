import { MoreHorizontal } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type MouseEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { AiSidebar, type ChatMessage, initialChat } from "@/features/ai/sidebar";
import { BookmarkEditor } from "@/features/bookmarks/editor";
import { BookmarksManager, type BookmarkActions } from "@/features/bookmarks/manager";
import { batchProgress } from "@/features/downloads/format";
import { DownloadsPanel } from "@/features/downloads/panel";
import { profileFor, replyFor } from "@/features/ai/templates";
import { HistoryPage } from "@/features/history/page";
import { KeyPanel } from "@/features/key/panel";
import { PrivacyPanel } from "@/features/privacy/panel";
import { type AppMenuAction } from "@/features/settings/menu";
import { SettingsPage } from "@/features/settings/page";
import { SitePanel } from "@/features/site/panel";
import { originOf } from "@/features/site/permissions";
import { cn } from "@/lib/utils";

import { childrenOf, newBookmarkId } from "./bookmarks";
import { commandForKey, isEnabled, runCommand, type CommandContext } from "./commands";
import {
  desktopBridge,
  type DesktopPermissionRequest,
  type NativeMenuItem,
  type SitePermission,
  type StartupInfo,
  type UpdateState,
} from "./desktop";
import { useDesktopSync } from "./desktop-sync";
import { PanelView, type PanelSpec } from "./overlay/panels";
import { useLiveOverlay } from "./overlay/use-live-overlay";
import { engineOf } from "./engines";
import { STRIP_MENU, TAB_MENU, buildMenu } from "./menus";
import { resolveInput } from "./omnibox-input";
import { defaultHistoryStore } from "./persistence/history-store";
import { useCredentials } from "./persistence/use-credentials";
import { usePersistence } from "./persistence/use-persistence";
import { browserReducer } from "./store/reducer";
import {
  activeTabOf,
  currentBookmark,
  entryOf,
  hostOf,
  navState,
  orderTabs,
} from "./store/selectors";
import { BOOKMARKS_URL, HISTORY_URL, SETTINGS_URL, initialState, type Prefs } from "./store/state";
import { ContextMenu, useContextMenu } from "./tab-menu";
import { BOOKMARK_BAR, type BookmarkNode, type Entry, type Tab } from "./types";
import { BookmarksBar } from "./ui/bookmarks-bar";
import { folderMenu, webMenuGroups } from "./ui/shell-menu";
import { FindBar } from "./ui/find-bar";
import { PermissionBar } from "./ui/permission-bar";
import { TabSwitcher } from "./ui/tab-switcher";
import { TabRail, TabStrip } from "./ui/tab-list";
import type { TabHandlers } from "./ui/tab-item";
import { Toolbar } from "./ui/toolbar";
import { StartupNotice, UnresponsiveBar } from "./ui/notice-bars";
import { Viewport, type ErrorActions } from "./ui/viewport";
import { WhatsNew } from "./ui/whats-new";
import { tabCardOf, useTabPreview } from "./tab-preview";
import { TabPreviewCard } from "./ui/tab-preview-card";

type Panel = "key" | "privacy" | "menu" | "downloads" | "bookmark" | "site";

function isMacPlatform() {
  if (typeof navigator === "undefined") return false;
  return /Mac/i.test(navigator.platform || navigator.userAgent);
}

async function writeClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const temporary = document.createElement("textarea");
    temporary.value = value;
    temporary.style.position = "fixed";
    temporary.style.opacity = "0";
    document.body.appendChild(temporary);
    temporary.select();
    document.execCommand("copy");
    temporary.remove();
  }
}

export function AgzosBrowser() {
  const [state, dispatch] = useReducer(browserReducer, initialState);
  const desktop = useMemo(() => desktopBridge(), []);
  const isMac = useMemo(isMacPlatform, []);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>(initialChat);
  const [loading, setLoading] = useState(false);
  const [confirmingClose, setConfirmingClose] = useState<number | null>(null);
  const [permission, setPermission] = useState<DesktopPermissionRequest | null>(null);
  const [findFocus, setFindFocus] = useState(0);
  // O seletor só aparece se o Ctrl continuar pressionado: toque rápido troca sem piscar.
  const [switcherVisible, setSwitcherVisible] = useState(false);
  const [credentials, setCredentials] = useCredentials(desktop);
  const omniboxRef = useRef<HTMLInputElement | null>(null);
  const tabMenu = useContextMenu();
  const historyStore = useMemo(() => defaultHistoryStore(), []);
  const [omniboxOpen, setOmniboxOpen] = useState(false);
  // Favorito em edição (popover da estrela, "Editar…" da barra).
  const [editing, setEditing] = useState<{ id: string; added: boolean } | null>(null);
  const [sitePermissions, setSitePermissions] = useState<SitePermission[]>([]);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [startupInfo, setStartupInfo] = useState<StartupInfo | null>(null);
  // Aviso "Atualizado com sucesso" (celebrate) ou "Novidades" aberto pelas Configurações.
  const [whatsNew, setWhatsNew] = useState<{
    from: string | null;
    to: string;
    celebrate: boolean;
  } | null>(null);
  // "Esperar" na página sem resposta: a faixa some até ela travar de novo.
  const [waitingId, setWaitingId] = useState<number | null>(null);

  usePersistence(state, dispatch);

  const { prefs } = state;
  const activeTab = activeTabOf(state);
  const current = entryOf(activeTab);
  const nav = navState(state, desktop !== null);
  const orderedTabs = useMemo(() => orderTabs(state.tabs), [state.tabs]);
  // "Mudar para esta guia" na omnibox: as outras abas normais.
  const switchableTabs = useMemo(
    () => state.tabs.filter((tab) => tab.id !== state.activeId && !tab.private),
    [state.tabs, state.activeId],
  );

  const currentHost = hostOf(current.url);
  const privacyHost = currentHost ?? "inicio";
  const paused = prefs.pausedHosts.includes(privacyHost);
  const protectedNow = prefs.shield && !paused;
  const pageBlocked = state.blocked[activeTab.id];
  const blockedCount = protectedNow ? (pageBlocked?.count ?? 0) : 0;
  const blockedToday = prefs.shield ? (state.adblock?.today ?? 0) : null;
  const downloadBatch = useMemo(() => batchProgress(state.downloads), [state.downloads]);

  const setPrefs = useCallback(
    (patch: Partial<Prefs>) => dispatch({ type: "prefs/set", patch }),
    [],
  );

  const flash = useCallback(() => {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 500);
  }, []);

  const copyText = useCallback(async (id: string, value: string) => {
    await writeClipboard(value);
    setCopied(id);
    window.setTimeout(() => setCopied(null), 1400);
  }, []);

  // Aba fixada só fecha no segundo clique (em até 2,6 s).
  const confirmingRef = useRef(confirmingClose);
  confirmingRef.current = confirmingClose;
  const tabsRef = useRef(state.tabs);
  tabsRef.current = state.tabs;
  const requestClose = useCallback((id: number) => {
    const tab = tabsRef.current.find((item) => item.id === id);
    if (tab?.pinned && confirmingRef.current !== id) {
      setConfirmingClose(id);
      window.setTimeout(() => setConfirmingClose((value) => (value === id ? null : value)), 2600);
      return;
    }
    setConfirmingClose(null);
    dispatch({ type: "tab/close", id });
  }, []);

  const reload = useCallback(
    (id: number) => {
      flash();
      if (desktop) void desktop.reload(id);
    },
    [desktop, flash],
  );

  const focusOmnibox = useCallback(() => {
    omniboxRef.current?.focus();
    omniboxRef.current?.select();
  }, []);

  const openFind = useCallback(() => {
    dispatch({ type: "find/open" });
    setFindFocus((value) => value + 1);
  }, []);

  const stateRef = useRef(state);
  stateRef.current = state;

  const editBookmark = useCallback((id: string, added = false) => {
    setEditing({ id, added });
    setPanel("bookmark");
  }, []);

  // Estrela / Ctrl+D: favorita na barra e abre a edição; se já é favorito, só edita.
  const bookmarkPage = useCallback(() => {
    const current = stateRef.current;
    const tab = activeTabOf(current);
    const entry = entryOf(tab);
    if (tab.private || entry.kind !== "page") return;
    const existing = currentBookmark(current);
    if (existing) {
      editBookmark(existing.id);
      return;
    }
    const node: BookmarkNode = {
      id: newBookmarkId(),
      parentId: BOOKMARK_BAR,
      kind: "url",
      title: entry.title || hostOf(entry.url) || entry.url,
      url: entry.url,
      icon: tab.favicon,
      createdAt: Date.now(),
    };
    dispatch({ type: "bookmarks/add", nodes: [node] });
    editBookmark(node.id, true);
  }, [editBookmark]);

  const bookmarkAllTabs = useCallback(() => {
    const now = Date.now();
    const pages = orderTabs(stateRef.current.tabs).filter(
      (tab) => !tab.private && entryOf(tab).kind === "page",
    );
    if (!pages.length) return;
    const folder: BookmarkNode = {
      id: newBookmarkId(),
      parentId: BOOKMARK_BAR,
      kind: "folder",
      title: `Guias ${new Date(now).toLocaleDateString("pt-BR")}`,
      createdAt: now,
    };
    dispatch({
      type: "bookmarks/add",
      nodes: [
        folder,
        ...pages.map((tab): BookmarkNode => {
          const entry = entryOf(tab);
          return {
            id: newBookmarkId(),
            parentId: folder.id,
            kind: "url",
            title: entry.title,
            url: entry.url,
            icon: tab.favicon,
            createdAt: now,
          };
        }),
      ],
    });
    editBookmark(folder.id, true);
  }, [editBookmark]);

  const pictureInPicture = useCallback(
    (tabId: number) => {
      if (!desktop) return;
      void desktop.pictureInPicture(tabId).then(({ ok, active }) => {
        if (ok) dispatch({ type: "view/pip", id: tabId, active });
      });
    },
    [desktop],
  );

  const openUrl = useCallback(
    (url: string, newTab: boolean) => {
      const entry: Entry = { title: hostOf(url) ?? url, url, kind: "page" };
      if (newTab) {
        dispatch({ type: "tab/open-page", entry });
        return;
      }
      flash();
      dispatch({ type: "nav/push", entry });
    },
    [flash],
  );

  const openInternal = useCallback((url: string, title: string) => {
    dispatch({ type: "nav/open-internal", entry: { title, url, kind: "internal" } });
  }, []);

  // Menu nativo no app; na web, o menu da casca (pastas reabrem o menu com o conteúdo).
  const openContextMenu = tabMenu.open;
  const showMenu = useCallback(
    (x: number, y: number, items: NativeMenuItem[]) =>
      new Promise<string | null>((resolve) => {
        if (desktop) {
          void desktop.showMenu(items).then(resolve, () => resolve(null));
          return;
        }
        const open = (list: NativeMenuItem[]) =>
          openContextMenu(x, y, webMenuGroups(list, resolve, open));
        open(items);
      }),
    [desktop, openContextMenu],
  );

  const openBookmarkChoice = useCallback(
    (choice: string | null) => {
      if (!choice) return;
      const nodes = stateRef.current.bookmarks;
      if (choice.startsWith("open:")) {
        const node = nodes.find((item) => item.id === choice.slice("open:".length));
        if (node?.url) openUrl(node.url, false);
      } else if (choice.startsWith("open-all:")) {
        for (const node of childrenOf(nodes, choice.slice("open-all:".length))) {
          if (node.url) openUrl(node.url, true);
        }
      }
    },
    [openUrl],
  );

  const openFolderMenu = (event: MouseEvent<HTMLElement>, folderId: string) => {
    const rect = event.currentTarget.getBoundingClientRect();
    void showMenu(rect.left, rect.bottom + 4, folderMenu(state.bookmarks, folderId)).then(
      openBookmarkChoice,
    );
  };

  const openBookmarkMenu = (event: MouseEvent<HTMLElement>, node: BookmarkNode | null) => {
    event.preventDefault();
    const items: NativeMenuItem[] = node
      ? node.kind === "url"
        ? [
            { id: "open", label: "Abrir" },
            { id: "open-tab", label: "Abrir em nova guia" },
            { separator: true },
            { id: "edit", label: "Editar…" },
            { id: "remove", label: "Excluir" },
          ]
        : [
            { id: "open-all", label: "Abrir todos em novas guias" },
            { separator: true },
            { id: "edit", label: "Renomear…" },
            { id: "remove", label: "Excluir pasta" },
          ]
      : [
          { id: "add-page", label: "Adicionar esta página", enabled: current.kind === "page" },
          { id: "new-folder", label: "Nova pasta" },
          { separator: true },
          { id: "manager", label: "Gerenciar favoritos" },
          { id: "hide-bar", label: "Ocultar barra de favoritos" },
        ];
    void showMenu(event.clientX, event.clientY, items).then((choice) => {
      switch (choice) {
        case "open":
          if (node?.url) openUrl(node.url, false);
          return;
        case "open-tab":
          if (node?.url) openUrl(node.url, true);
          return;
        case "open-all":
          if (node) openBookmarkChoice(`open-all:${node.id}`);
          return;
        case "edit":
          if (node) editBookmark(node.id);
          return;
        case "remove":
          if (node) dispatch({ type: "bookmarks/remove", id: node.id });
          return;
        case "add-page":
          bookmarkPage();
          return;
        case "new-folder": {
          const folder: BookmarkNode = {
            id: newBookmarkId(),
            parentId: BOOKMARK_BAR,
            kind: "folder",
            title: "Nova pasta",
            createdAt: Date.now(),
          };
          dispatch({ type: "bookmarks/add", nodes: [folder] });
          editBookmark(folder.id, true);
          return;
        }
        case "manager":
          openInternal(BOOKMARKS_URL, "Favoritos");
          return;
        case "hide-bar":
          setPrefs({ bookmarksBar: false });
      }
    });
  };

  const bookmarkActions: BookmarkActions = useMemo(
    () => ({
      add: (nodes, index) =>
        dispatch(
          index === undefined
            ? { type: "bookmarks/add", nodes }
            : { type: "bookmarks/add", nodes, index },
        ),
      update: (id, changes) => dispatch({ type: "bookmarks/update", id, ...changes }),
      move: (id, parentId, index) =>
        dispatch(
          index === undefined
            ? { type: "bookmarks/move", id, parentId }
            : { type: "bookmarks/move", id, parentId, index },
        ),
      remove: (id) => dispatch({ type: "bookmarks/remove", id }),
    }),
    [],
  );

  // Web (preview): a casca registra as visitas. No app quem registra é o main.
  const requested = state.requestedUrl;
  useEffect(() => {
    if (desktop || !historyStore || !requested || !/^https?:/i.test(requested.url)) return;
    const tab = stateRef.current.tabs.find((item) => item.id === requested.id);
    if (!tab || tab.private) return;
    const entry = entryOf(tab);
    void historyStore.add({
      url: requested.url,
      title: entry.url === requested.url && entry.title !== requested.url ? entry.title : "",
    });
  }, [desktop, historyStore, requested]);

  // Página de configurações aberta: permissões e pasta de downloads atualizadas.
  const onSettingsPage = current.url === SETTINGS_URL;
  useEffect(() => {
    if (!desktop || !onSettingsPage) return;
    void refreshPermissionsRef.current();
    void desktop
      .downloadsDir()
      .then(setDownloadsDir)
      .catch(() => {});
  }, [desktop, onSettingsPage]);

  const refreshPermissions = useCallback(async () => {
    if (desktop) setSitePermissions(await desktop.permissionsList().catch(() => []));
  }, [desktop]);
  const refreshPermissionsRef = useRef(refreshPermissions);
  refreshPermissionsRef.current = refreshPermissions;
  useEffect(() => {
    if (panel === "site") void refreshPermissions();
  }, [panel, refreshPermissions]);

  // Primeiro início depois de uma atualização: aviso com as novidades e confetes.
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [downloadsDir, setDownloadsDir] = useState<string | null>(null);
  useEffect(() => {
    if (!desktop) return;
    void desktop
      .appVersion()
      .then(setAppVersion)
      .catch(() => {});
    void desktop
      .whatsNew()
      .then((info) => info && setWhatsNew({ ...info, celebrate: true }))
      .catch(() => {});
  }, [desktop]);

  // Fechamento inesperado na execução anterior: aviso na primeira janela restaurada.
  useEffect(() => {
    if (!desktop) return;
    void desktop
      .windowStartup()
      .then(setStartupInfo)
      .catch(() => {});
  }, [desktop]);

  // Título da janela (barra de tarefas, Alt+Tab) segue a guia ativa, como no Chrome.
  const windowTitle = current.kind === "home" ? "Nova aba" : current.title;
  useEffect(() => {
    if (!desktop) return;
    document.title = windowTitle ? `${windowTitle} - Agzos Browser` : "Agzos Browser";
  }, [desktop, windowTitle]);

  useEffect(() => {
    if (!desktop) return;
    void desktop
      .updateState()
      .then(setUpdate)
      .catch(() => {});
    return desktop.onUpdate(setUpdate);
  }, [desktop]);

  const ctx: CommandContext = {
    state,
    dispatch,
    desktop,
    ui: {
      focusOmnibox,
      reload,
      requestClose,
      copy: (id, value) => void copyText(id, value),
      step: (delta) => step(delta),
      openFind,
      toggleDownloads: () => togglePanel("downloads"),
      bookmarkPage,
      bookmarkAllTabs,
      pictureInPicture,
      showWhatsNew: () => {
        if (appVersion) setWhatsNew({ from: null, to: appVersion, celebrate: false });
      },
    },
  };
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const runCommandRef = useRef((id: string, tabId: number | null) => {
    runCommand(ctxRef.current, id, tabId);
  });
  // Ctrl+Tab com o foco na página: seletor na camada do main, acima da página, que continua
  // à vista e com o foco (o "soltar o Ctrl" chega sempre; ver switcher-layer.cjs).
  const [switcherLayer, setSwitcherLayer] = useState(false);
  const runHotkeyRef = useRef(
    (input: {
      key: string;
      shift: boolean;
      alt: boolean;
      meta: boolean;
      ctrl: boolean;
      layer?: boolean;
    }) => {
      const command = commandForKey(input);
      if (!command) return;
      if (input.layer && ctxRef.current.state.switcher === null) setSwitcherLayer(true);
      runCommand(ctxRef.current, command.id, null, "keyboard");
    },
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const command = commandForKey({
        key: event.key,
        code: event.code,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        shift: event.shiftKey,
        alt: event.altKey,
      });
      // Atalho desabilitado (ex.: Ctrl+F na web) fica com o navegador.
      if (!command || !isEnabled(ctxRef.current, command)) return;
      event.preventDefault();
      runCommand(ctxRef.current, command.id, null, "keyboard");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const switcherOpen = state.switcher !== null;
  useEffect(() => {
    if (!switcherOpen) {
      setSwitcherVisible(false);
      setSwitcherLayer(false);
      return;
    }
    const timer = window.setTimeout(() => setSwitcherVisible(true), 140);
    const commit = () => dispatch({ type: "switcher/commit" });
    // Mesmas teclas com o foco na casca ou na página (o main repassa: agzos:switcher-key).
    const handleKey = (key: string, index?: number) => {
      if (key === "commit")
        dispatch({ type: "switcher/commit", ...(index != null ? { index } : {}) });
      else if (key === "Escape") dispatch({ type: "switcher/cancel" });
      else if (key === "Enter") commit();
      else if (key === "ArrowRight" || key === "ArrowDown") {
        dispatch({ type: "switcher/step", delta: 1 });
      } else if (key === "ArrowLeft" || key === "ArrowUp") {
        dispatch({ type: "switcher/step", delta: -1 });
      } else return false;
      return true;
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Control" || event.key === "Meta") commit();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (handleKey(event.key)) event.preventDefault();
    };
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("keydown", onKeyDown);
    // Perdeu o foco com o Ctrl ainda apertado (ex.: Alt+Tab do sistema): confirma.
    window.addEventListener("blur", commit);
    void desktop?.setSwitcherOpen(true);
    const offKey = desktop?.onSwitcherKey(({ key, index }) => void handleKey(key, index));
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", commit);
      offKey?.();
      void desktop?.setSwitcherOpen(false);
    };
  }, [switcherOpen, desktop]);

  // Seletor na camada: os cartões vão uma vez ao abrir; depois só o índice.
  const layerShown = useRef(false);
  const switcherIds = state.switcher?.ids.join(",") ?? "";
  const switcherIndex = state.switcher?.index ?? 0;
  useEffect(() => {
    if (!desktop) return;
    if (!switcherLayer || !switcherVisible || !switcherIds) {
      if (layerShown.current) void desktop.renderSwitcher(null);
      layerShown.current = false;
      return;
    }
    const current = stateRef.current;
    if (!layerShown.current) {
      layerShown.current = true;
      const cards = switcherIds.split(",").flatMap((id) => {
        const tab = current.tabs.find((item) => item.id === Number(id));
        if (!tab) return [];
        const entry = entryOf(tab);
        const title = entry.kind === "home" ? "Nova aba" : entry.title;
        const image = current.thumbnails[tab.id];
        return [
          {
            title,
            letter: (hostOf(entry.url) ?? title).slice(0, 1).toUpperCase(),
            ...(image ? { image } : {}),
            ...(tab.favicon ? { icon: tab.favicon } : {}),
          },
        ];
      });
      void desktop.renderSwitcher({ cards, index: switcherIndex, dark: current.prefs.dark });
      return;
    }
    void desktop.renderSwitcher({ index: switcherIndex });
  }, [desktop, switcherLayer, switcherVisible, switcherIds, switcherIndex]);

  const openAddress = useCallback(
    (raw: string) => {
      const entry = resolveInput(raw, prefs.engine);
      if (!entry) return;
      if (entry.kind === "internal") {
        dispatch({ type: "nav/open-internal", entry });
        return;
      }
      flash();
      dispatch({ type: "nav/push", entry });
    },
    [flash, prefs.engine],
  );

  function step(delta: -1 | 1) {
    if (delta < 0 ? !nav.canBack : !nav.canForward) return;
    flash();
    if (nav.viewDriven && desktop) {
      void (delta < 0 ? desktop.goBack(activeTab.id) : desktop.goForward(activeTab.id));
      return;
    }
    dispatch({ type: "nav/step", delta });
  }

  const handleSend = useCallback(
    (text: string) => {
      const clean = text.trim();
      if (!clean) return;
      const profile = profileFor(current.url, current.title);
      setChat((list) => [
        ...list,
        { role: "user", text: clean },
        { role: "ai", text: replyFor(clean, profile) },
      ]);
    },
    [current.title, current.url],
  );

  const openTabMenu = (event: MouseEvent, tab: Tab) => {
    event.preventDefault();
    event.stopPropagation();
    if (desktop) {
      void desktop.showTabMenu({
        kind: "tab",
        tabId: tab.id,
        pinned: Boolean(tab.pinned),
        muted: Boolean(tab.muted),
        audio: state.audioPlaying.includes(tab.id),
        hasClosed: state.closedTabs.length > 0,
        orientation: prefs.orientation,
        url: entryOf(tab).url,
        tabCount: state.tabs.length,
        active: tab.id === state.activeId,
      });
      return;
    }
    tabMenu.open(event.clientX, event.clientY, buildMenu(TAB_MENU, ctx, tab.id, isMac));
  };

  const openStripMenu = (event: MouseEvent) => {
    event.preventDefault();
    if (desktop) {
      void desktop.showTabMenu({
        kind: "strip",
        hasClosed: state.closedTabs.length > 0,
        orientation: prefs.orientation,
      });
      return;
    }
    tabMenu.open(event.clientX, event.clientY, buildMenu(STRIP_MENU, ctx, activeTab.id, isMac));
  };

  // Travou de novo depois de "Esperar": a faixa volta.
  const unresponsiveKey = state.unresponsive.join(",");
  useEffect(() => {
    setWaitingId((id) => (id !== null && state.unresponsive.includes(id) ? id : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unresponsiveKey]);

  const errorActions: ErrorActions = {
    canBack: nav.canBack,
    onRetry: (id) => reload(id),
    onBack: (id) => {
      flash();
      void desktop?.goBack(id);
    },
    onAllowCertificate: (id) => {
      flash();
      void desktop?.allowCertificate(id);
    },
    onAllowSite: (id) => {
      const failure = state.failed[id];
      const host = failure ? hostOf(failure.url) : null;
      if (!host || !desktop) return;
      const pausedHosts = [...prefs.pausedHosts.filter((item) => item !== host), host];
      dispatch({ type: "prefs/pause-host", host, pause: true });
      // O escudo muda antes de recarregar (o prefs/set grava com atraso).
      void desktop.adblockConfig({ shield: prefs.shield, pausedHosts }).then(() => reload(id));
    },
    onSearch: (text) => openUrl(engineOf(prefs.engine).search(text), false),
  };

  const preview = useTabPreview({
    desktop,
    cardOf: (tabId) => {
      const tab = stateRef.current.tabs.find((item) => item.id === tabId);
      return tab ? tabCardOf(stateRef.current, tab, { desktop: desktop !== null }) : null;
    },
    side: prefs.orientation === "vertical" ? "right" : "below",
    // Um overlay por vez: painel, seletor, omnibox ou aviso abertos desligam a prévia.
    disabled:
      panel !== null ||
      omniboxOpen ||
      whatsNew !== null ||
      state.switcher !== null ||
      tabMenu.menu !== null,
  });

  const tabHandlers: TabHandlers = {
    onActivate: (tab) => dispatch({ type: "tab/activate", id: tab.id }),
    onContextMenu: (event, tab) => {
      preview.onHoverEnd(true);
      openTabMenu(event, tab);
    },
    onHoverStart: (tab, element) => preview.onHoverStart(tab.id, element),
    onHoverEnd: preview.onHoverEnd,
    onTogglePin: (id) => dispatch({ type: "tab/toggle-pin", id }),
    onClose: requestClose,
  };

  const listProps = {
    tabs: orderedTabs,
    activeId: state.activeId,
    audioPlaying: state.audioPlaying,
    hibernated: state.hibernated,
    confirmingClose,
    handlers: tabHandlers,
    onNewTab: () => dispatch({ type: "tab/new" }),
    onNewPrivateTab: () => dispatch({ type: "tab/new", private: true }),
    onStripMenu: openStripMenu,
    onMoveTab: (id: number, index: number) => dispatch({ type: "tab/move", id, index }),
  };

  // Esc fecha o painel aberto (rota de saída de qualquer painel).
  useEffect(() => {
    if (!panel) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setPanel(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel]);

  const closeWhatsNew = useCallback(() => setWhatsNew(null), []);

  const togglePanel = (target: Panel) => setPanel((open) => (open === target ? null : target));

  const settingsButton = (
    <Button
      variant={panel === "menu" ? "default" : "ghost"}
      size="icon"
      title="Menu do Agzos"
      aria-label="Menu do Agzos"
      aria-haspopup="menu"
      aria-expanded={panel === "menu"}
      onClick={() => togglePanel("menu")}
    >
      <MoreHorizontal />
    </Button>
  );

  const openSettings = () => openInternal(SETTINGS_URL, "Configurações");
  const runMenuAction = (action: AppMenuAction) => {
    switch (action) {
      case "settings.open":
        openSettings();
        return;
      case "whats-new":
        if (appVersion) setWhatsNew({ from: null, to: appVersion, celebrate: false });
        return;
      case "update.install":
        void desktop?.updateInstall();
        return;
      case "app.quit":
        void desktop?.quitApp();
        return;
      case "downloads.toggle":
        // O menu fecha antes; o painel de downloads abre em seguida.
        window.setTimeout(() => setPanel("downloads"), 0);
        return;
      default:
        runCommand(ctx, action, null, "menu");
    }
  };

  const closePanel = () => setPanel(null);
  const stageClasses = [
    prefs.dark && "dark",
    state.fullscreen && "fs",
    // App do Mac sem barra de título nativa: a casca desenha a área de arrastar.
    desktop && isMac && "mac-frameless",
    prefs.orientation === "vertical" && "vertical-tabs",
  ].filter((name): name is string => typeof name === "string");
  const bookmarkNode =
    panel === "bookmark" && editing
      ? state.bookmarks.find((item) => item.id === editing.id)
      : undefined;
  // Painel aberto: no app vai para a camada acima da página (a página segue viva); na web
  // (ou se a camada falhar) é desenhado aqui mesmo.
  const panelSpec: PanelSpec | null =
    panel === "privacy"
      ? {
          kind: "privacy",
          props: {
            host: currentHost,
            shield: prefs.shield,
            setShield: (shield) => setPrefs({ shield }),
            paused,
            onPauseChange: (pause) =>
              dispatch({ type: "prefs/pause-host", host: privacyHost, pause }),
            count: blockedCount,
            trackers: protectedNow ? (pageBlocked?.trackers ?? []) : [],
            protectedNow,
            desktop: desktop !== null,
            stats: state.adblock,
            onUpdateLists: async () => {
              if (!desktop) return;
              await desktop.adblockUpdate();
              dispatch({ type: "adblock/stats", stats: await desktop.adblockStats() });
            },
            onClose: closePanel,
          },
        }
      : panel === "downloads"
        ? {
            kind: "downloads",
            props: {
              downloads: state.downloads,
              desktop: desktop !== null,
              onAction: (id, action) => {
                if (!desktop) return;
                void desktop.downloadAction(id, action).then(async ({ ok }) => {
                  if (ok && action === "remove") {
                    dispatch({ type: "downloads/set", list: await desktop.downloadsList() });
                  }
                });
              },
              onClear: () => {
                if (!desktop) return;
                void desktop
                  .downloadsClear()
                  .then((list) => dispatch({ type: "downloads/set", list }));
              },
              onClose: closePanel,
            },
          }
        : panel === "menu"
          ? {
              kind: "menu",
              props: {
                desktop: desktop !== null,
                isMac,
                appVersion,
                updateReady: update?.status === "ready" ? update.version : null,
                zoom: state.zoom[activeTab.id] ?? 1,
                canZoom: desktop !== null && current.kind === "page",
                canFind: desktop !== null && current.kind === "page",
                dark: prefs.dark,
                onAction: runMenuAction,
                onZoom: (direction) => void desktop?.zoom(activeTab.id, direction),
                onFullscreen: () => void desktop?.toggleFullscreen(),
                onToggleDark: () => setPrefs({ dark: !prefs.dark }),
                onClose: closePanel,
              },
            }
          : panel === "bookmark" && editing && bookmarkNode
            ? {
                kind: "bookmark",
                key: bookmarkNode.id,
                props: {
                  node: bookmarkNode,
                  nodes: state.bookmarks,
                  added: editing.added,
                  onSave: ({ title, url, parentId }) => {
                    dispatch({
                      type: "bookmarks/update",
                      id: bookmarkNode.id,
                      title,
                      ...(url ? { url } : {}),
                    });
                    if (parentId !== bookmarkNode.parentId) {
                      dispatch({ type: "bookmarks/move", id: bookmarkNode.id, parentId });
                    }
                    setPanel(null);
                  },
                  onRemove: () => {
                    dispatch({ type: "bookmarks/remove", id: bookmarkNode.id });
                    setPanel(null);
                  },
                  onClose: closePanel,
                },
              }
            : panel === "site"
              ? {
                  kind: "site",
                  props: {
                    url: current.url,
                    privateTab: Boolean(activeTab.private),
                    permissions: sitePermissions,
                    zoom: state.zoom[activeTab.id] ?? 1,
                    onChange: (type, value) => {
                      const origin = originOf(current.url);
                      if (!desktop || !origin) return;
                      void desktop.permissionsSet(origin, type, value).then(refreshPermissions);
                    },
                    onReset: () => {
                      const origin = originOf(current.url);
                      if (!desktop || !origin) return;
                      void desktop.permissionsReset(origin).then(refreshPermissions);
                    },
                    onResetZoom: () => void desktop?.zoom(activeTab.id, 0),
                    onClose: closePanel,
                  },
                }
              : panel === "key"
                ? {
                    kind: "key",
                    props: {
                      credentials,
                      copied,
                      onCopy: (id, value) => void copyText(id, value),
                      onAdd: (item) => setCredentials((list) => [...list, item]),
                      onRemove: (domain) =>
                        setCredentials((list) => list.filter((item) => item.domain !== domain)),
                      onClose: closePanel,
                    },
                  }
                : null;

  const overlayStatus = useLiveOverlay(desktop, panelSpec, stageClasses, closePanel);
  const panelInline = panelSpec !== null && overlayStatus === "inline";

  // O WebContentsView fica por cima da casca: com seletor, omnibox ou aviso aberto (ou um
  // painel no plano B) ele sai da frente e uma foto da página entra no lugar (senão a área
  // fica preta). Painéis no app vão para a camada acima da página: nada de foto.
  const overlay =
    panelInline || (switcherVisible && !switcherLayer) || omniboxOpen || whatsNew !== null;

  const [viewHidden, setViewHidden] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const activeIdRef = useRef(state.activeId);
  activeIdRef.current = state.activeId;
  useEffect(() => {
    if (!overlay) {
      setViewHidden(false);
      // A página nativa volta por cima; a foto sai logo depois, sem piscar.
      const timer = window.setTimeout(() => setSnapshot(null), 150);
      return () => window.clearTimeout(timer);
    }
    if (!desktop) {
      setViewHidden(true);
      return;
    }
    let cancelled = false;
    void desktop
      .snapshotTab(activeIdRef.current)
      .catch(() => null)
      .then((image) => {
        if (cancelled) return;
        setSnapshot(image);
        setViewHidden(true);
      });
    return () => {
      cancelled = true;
    };
  }, [overlay, desktop]);

  useDesktopSync({
    desktop,
    state,
    dispatch,
    panelOpen: viewHidden,
    runCommandRef,
    runHotkeyRef,
    onPermission: setPermission,
  });

  return (
    <main
      className={cn("browser-stage", ...stageClasses)}
      data-ready={state.hydrated ? "true" : undefined}
    >
      <section className="browser-window" aria-label="Agzos Browser">
        {/* Guias verticais: sem a faixa de cima (o "⋯" vai para a toolbar), mais página. */}
        {prefs.orientation === "horizontal" && (
          <header className="titlebar">
            <TabStrip {...listProps} />
            {settingsButton}
          </header>
        )}

        <Toolbar
          ref={omniboxRef}
          address={state.address}
          privateTab={Boolean(activeTab.private)}
          canBack={nav.canBack}
          canForward={nav.canForward}
          loading={loading}
          favorite={currentBookmark(state) !== undefined}
          blockedCount={blockedCount}
          zoom={state.zoom[activeTab.id] ?? 1}
          pip={
            desktop &&
            current.kind === "page" &&
            (state.audioPlaying.includes(activeTab.id) || state.pip.includes(activeTab.id))
              ? {
                  active: state.pip.includes(activeTab.id),
                  onToggle: () => pictureInPicture(activeTab.id),
                }
              : null
          }
          downloads={{
            visible: desktop !== null && state.downloads.length > 0,
            open: panel === "downloads",
            active: downloadBatch.active,
            fraction: downloadBatch.fraction,
          }}
          keyOpen={panel === "key"}
          dark={prefs.dark}
          aiOpen={prefs.aiOpen}
          isMac={isMac}
          onBack={() => step(-1)}
          onForward={() => step(1)}
          onReload={() => reload(activeTab.id)}
          onAddressChange={(value) => dispatch({ type: "address/set", value })}
          onSubmit={openAddress}
          onToggleFavorite={bookmarkPage}
          onTogglePrivacy={() => togglePanel("privacy")}
          onResetZoom={() => void desktop?.zoom(activeTab.id, 0)}
          onToggleDownloads={() => togglePanel("downloads")}
          onToggleKey={() => togglePanel("key")}
          onToggleDark={() => setPrefs({ dark: !prefs.dark })}
          onToggleAi={() => setPrefs({ aiOpen: !prefs.aiOpen })}
          trailing={prefs.orientation === "vertical" ? settingsButton : null}
          omnibox={{
            currentUrl: current.url,
            engine: prefs.engine,
            remoteSuggestions: prefs.searchSuggestions,
            bookmarks: state.bookmarks,
            tabs: switchableTabs,
            history: historyStore,
            suggest: desktop ? (text) => desktop.suggest(prefs.engine, text) : null,
            onSwitchTab: (id) => dispatch({ type: "tab/activate", id }),
            onOpenChange: setOmniboxOpen,
          }}
          siteInfo={{
            available: desktop !== null && originOf(current.url) !== null,
            open: panel === "site",
            onToggle: () => togglePanel("site"),
          }}
          updateReady={update?.status === "ready" ? update.version : null}
          onInstallUpdate={() => void desktop?.updateInstall()}
        />

        {prefs.bookmarksBar && (
          <BookmarksBar
            nodes={state.bookmarks}
            onOpen={(node, newTab) => node.url && openUrl(node.url, newTab)}
            onFolder={openFolderMenu}
            onContextMenu={openBookmarkMenu}
            onMove={bookmarkActions.move}
          />
        )}

        {/* Faixa abaixo da barra de endereço (a página nativa cobriria algo flutuando). */}
        {permission && (
          <PermissionBar
            key={permission.id}
            request={permission}
            onAnswer={(allow, remember) => {
              void desktop?.respondPermission(permission.id, allow, remember);
              setPermission(null);
            }}
          />
        )}

        {state.unresponsive.includes(activeTab.id) &&
          !state.crashed.includes(activeTab.id) &&
          waitingId !== activeTab.id && (
            <UnresponsiveBar
              onWait={() => setWaitingId(activeTab.id)}
              onKill={() => {
                setWaitingId(null);
                void desktop?.killTab(activeTab.id);
              }}
            />
          )}

        {startupInfo && <StartupNotice info={startupInfo} onClose={() => setStartupInfo(null)} />}

        {state.find && state.find.id === activeTab.id && (
          <FindBar
            result={state.find}
            focusSignal={findFocus}
            onSearch={(text, options) => {
              if (!desktop) return;
              if (text) void desktop.findStart(activeTab.id, text, options);
              else {
                void desktop.findStop(activeTab.id);
                dispatch({ type: "view/find", id: activeTab.id, active: 0, total: 0 });
              }
            }}
            onClose={() => dispatch({ type: "find/clear" })}
          />
        )}

        <div className="browser-body">
          {prefs.orientation === "vertical" && (
            <TabRail
              {...listProps}
              collapsed={prefs.railCollapsed}
              onToggleCollapsed={() => setPrefs({ railCollapsed: !prefs.railCollapsed })}
            />
          )}
          <div className="workspace">
            <Viewport
              state={state}
              tab={activeTab}
              loading={loading}
              blockedToday={blockedToday}
              snapshot={viewHidden ? snapshot : null}
              desktop={desktop}
              onOpen={openAddress}
              onAddLink={(link) => dispatch({ type: "links/add", link })}
              onRemoveLink={(url) => dispatch({ type: "links/remove", url })}
              internal={
                current.url === HISTORY_URL ? (
                  <HistoryPage store={historyStore} onOpen={openUrl} />
                ) : current.url === BOOKMARKS_URL ? (
                  <BookmarksManager
                    nodes={state.bookmarks}
                    actions={bookmarkActions}
                    onOpen={openUrl}
                  />
                ) : current.url === SETTINGS_URL ? (
                  <SettingsPage
                    prefs={prefs}
                    setPrefs={setPrefs}
                    onUnpauseHost={(host) =>
                      dispatch({ type: "prefs/pause-host", host, pause: false })
                    }
                    desktop={desktop !== null}
                    isMac={isMac}
                    permissions={desktop ? sitePermissions : null}
                    onPermissionChange={(origin, type, value) => {
                      if (!desktop) return;
                      void desktop.permissionsSet(origin, type, value).then(refreshPermissions);
                    }}
                    update={update}
                    onCheckUpdate={() => void desktop?.updateCheck()}
                    onInstallUpdate={() => void desktop?.updateInstall()}
                    appVersion={appVersion}
                    onShowWhatsNew={
                      appVersion
                        ? () => setWhatsNew({ from: null, to: appVersion, celebrate: false })
                        : null
                    }
                    downloadsDir={downloadsDir}
                    onOpenDownloadsDir={desktop ? () => void desktop.openDownloadsDir() : null}
                    onOpenHistory={() => openInternal(HISTORY_URL, "Histórico")}
                    onOpenBookmarks={() => openInternal(BOOKMARKS_URL, "Favoritos")}
                    onReset={() => dispatch({ type: "tabs/reset" })}
                  />
                ) : null
              }
              errors={errorActions}
              onRecover={(id) => {
                dispatch({ type: "view/recovered", id });
                void desktop?.reload(id);
                void desktop?.activateTab(id);
                flash();
              }}
            />
            {prefs.aiOpen && (
              <AiSidebar
                url={current.url}
                title={current.title}
                chat={chat}
                onSend={handleSend}
                onClear={() => setChat(initialChat)}
                onClose={() => setPrefs({ aiOpen: false })}
              />
            )}
          </div>
        </div>

        {panelInline && panelSpec && <PanelView spec={panelSpec} />}
      </section>
      {state.switcher && switcherVisible && !switcherLayer && (
        <TabSwitcher
          tabs={state.switcher.ids.flatMap((id) => state.tabs.filter((tab) => tab.id === id))}
          index={state.switcher.index}
          thumbnails={state.thumbnails}
          onSelect={(index) => dispatch({ type: "switcher/select", index })}
          onCommit={(index) => dispatch({ type: "switcher/commit", index })}
          onCancel={() => dispatch({ type: "switcher/cancel" })}
        />
      )}
      {whatsNew && (
        <WhatsNew
          from={whatsNew.from}
          to={whatsNew.to}
          celebrate={whatsNew.celebrate}
          onClose={closeWhatsNew}
        />
      )}
      {preview.webCard && <TabPreviewCard {...preview.webCard} />}
      {tabMenu.menu && (
        <ContextMenu
          x={tabMenu.menu.x}
          y={tabMenu.menu.y}
          groups={tabMenu.menu.groups}
          onClose={tabMenu.close}
        />
      )}
    </main>
  );
}
