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
import { batchProgress } from "@/features/downloads/format";
import { DownloadsPanel } from "@/features/downloads/panel";
import { profileFor, replyFor } from "@/features/ai/templates";
import { KeyPanel } from "@/features/key/panel";
import { PrivacyPanel } from "@/features/privacy/panel";
import { SettingsPanel } from "@/features/settings/panel";
import { cn } from "@/lib/utils";

import { commandForKey, isEnabled, runCommand, type CommandContext } from "./commands";
import { desktopBridge, type DesktopPermissionRequest } from "./desktop";
import { useDesktopSync } from "./desktop-sync";
import { STRIP_MENU, TAB_MENU, buildMenu } from "./menus";
import { resolveInput } from "./omnibox-input";
import { useCredentials } from "./persistence/use-credentials";
import { usePersistence } from "./persistence/use-persistence";
import { browserReducer } from "./store/reducer";
import { activeTabOf, entryOf, hostOf, isFavorite, navState, orderTabs } from "./store/selectors";
import { initialState, type Prefs } from "./store/state";
import { ContextMenu, useContextMenu } from "./tab-menu";
import type { Tab } from "./types";
import { FindBar } from "./ui/find-bar";
import { PermissionBar } from "./ui/permission-bar";
import { TabSwitcher } from "./ui/tab-switcher";
import { TabRail, TabStrip } from "./ui/tab-list";
import type { TabHandlers } from "./ui/tab-item";
import { Toolbar } from "./ui/toolbar";
import { Viewport } from "./ui/viewport";

type Panel = "key" | "privacy" | "settings" | "downloads";

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

  usePersistence(state, dispatch);

  const { prefs } = state;
  const activeTab = activeTabOf(state);
  const current = entryOf(activeTab);
  const nav = navState(state, desktop !== null);
  const orderedTabs = useMemo(() => orderTabs(state.tabs), [state.tabs]);

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
    },
  };
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  const runCommandRef = useRef((id: string, tabId: number | null) => {
    runCommand(ctxRef.current, id, tabId);
  });
  const runHotkeyRef = useRef(
    (input: { key: string; shift: boolean; alt: boolean; meta: boolean; ctrl: boolean }) => {
      const command = commandForKey(input);
      if (command) runCommand(ctxRef.current, command.id, null, "keyboard");
    },
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const command = commandForKey({
        key: event.key,
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
      return;
    }
    const timer = window.setTimeout(() => setSwitcherVisible(true), 140);
    const commit = () => dispatch({ type: "switcher/commit" });
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Control" || event.key === "Meta") commit();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        dispatch({ type: "switcher/cancel" });
      } else if (event.key === "Enter") {
        event.preventDefault();
        commit();
      }
    };
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("keydown", onKeyDown);
    // Perdeu o foco com o Ctrl ainda apertado (ex.: Alt+Tab do sistema): confirma.
    window.addEventListener("blur", commit);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", commit);
    };
  }, [switcherOpen]);

  // O WebContentsView fica por cima da casca: com painel ou seletor aberto ele sai da
  // frente. Antes, uma foto da página entra no lugar dela (senão a área fica preta).
  const overlay = panel !== null || switcherVisible;
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

  const openAddress = useCallback(
    (raw: string) => {
      const entry = resolveInput(raw, prefs.engine);
      if (!entry) return;
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

  const tabHandlers: TabHandlers = {
    onActivate: (tab) => dispatch({ type: "tab/activate", id: tab.id }),
    onContextMenu: openTabMenu,
    onTogglePin: (id) => dispatch({ type: "tab/toggle-pin", id }),
    onClose: requestClose,
  };

  const listProps = {
    tabs: orderedTabs,
    activeId: state.activeId,
    audioPlaying: state.audioPlaying,
    confirmingClose,
    handlers: tabHandlers,
    onNewTab: () => dispatch({ type: "tab/new" }),
    onNewPrivateTab: () => dispatch({ type: "tab/new", private: true }),
    onStripMenu: openStripMenu,
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

  const togglePanel = (target: Panel) => setPanel((open) => (open === target ? null : target));

  const settingsButton = (
    <Button
      variant={panel === "settings" ? "default" : "ghost"}
      size="icon"
      title="Configurações"
      aria-label="Configurações"
      onClick={() => togglePanel("settings")}
    >
      <MoreHorizontal />
    </Button>
  );

  return (
    <main
      className={cn(
        "browser-stage",
        prefs.dark && "dark",
        state.fullscreen && "fs",
        // App do Mac sem barra de título nativa: a casca desenha a área de arrastar.
        desktop && isMac && "mac-frameless",
        prefs.orientation === "vertical" && "vertical-tabs",
      )}
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
          favorite={isFavorite(state)}
          blockedCount={blockedCount}
          zoom={state.zoom[activeTab.id] ?? 1}
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
          onToggleFavorite={() => dispatch({ type: "links/toggle-current" })}
          onTogglePrivacy={() => togglePanel("privacy")}
          onResetZoom={() => void desktop?.zoom(activeTab.id, 0)}
          onToggleDownloads={() => togglePanel("downloads")}
          onToggleKey={() => togglePanel("key")}
          onToggleDark={() => setPrefs({ dark: !prefs.dark })}
          onToggleAi={() => setPrefs({ aiOpen: !prefs.aiOpen })}
          trailing={prefs.orientation === "vertical" ? settingsButton : null}
        />

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

        {panel === "privacy" && (
          <PrivacyPanel
            host={currentHost}
            shield={prefs.shield}
            setShield={(shield) => setPrefs({ shield })}
            paused={paused}
            onPauseChange={(pause) =>
              dispatch({ type: "prefs/pause-host", host: privacyHost, pause })
            }
            count={blockedCount}
            trackers={protectedNow ? (pageBlocked?.trackers ?? []) : []}
            protectedNow={protectedNow}
            desktop={desktop !== null}
            stats={state.adblock}
            onUpdateLists={async () => {
              if (!desktop) return;
              await desktop.adblockUpdate();
              dispatch({ type: "adblock/stats", stats: await desktop.adblockStats() });
            }}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === "downloads" && (
          <DownloadsPanel
            downloads={state.downloads}
            desktop={desktop !== null}
            onAction={(id, action) => {
              if (!desktop) return;
              void desktop.downloadAction(id, action).then(async ({ ok }) => {
                if (ok && action === "remove") {
                  dispatch({ type: "downloads/set", list: await desktop.downloadsList() });
                }
              });
            }}
            onClear={() => {
              if (!desktop) return;
              void desktop
                .downloadsClear()
                .then((list) => dispatch({ type: "downloads/set", list }));
            }}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === "settings" && (
          <SettingsPanel
            dark={prefs.dark}
            setDark={(dark) => setPrefs({ dark })}
            aiOpen={prefs.aiOpen}
            setAiOpen={(aiOpen) => setPrefs({ aiOpen })}
            shield={prefs.shield}
            setShield={(shield) => setPrefs({ shield })}
            engine={prefs.engine}
            setEngine={(engine) => setPrefs({ engine })}
            onReset={() => dispatch({ type: "tabs/reset" })}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === "key" && (
          <KeyPanel
            credentials={credentials}
            copied={copied}
            onCopy={(id, value) => void copyText(id, value)}
            onAdd={(item) => setCredentials((list) => [...list, item])}
            onRemove={(domain) =>
              setCredentials((list) => list.filter((item) => item.domain !== domain))
            }
            onClose={() => setPanel(null)}
          />
        )}
      </section>
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
      {state.switcher && switcherVisible && (
        <TabSwitcher
          tabs={state.switcher.ids.flatMap((id) => state.tabs.filter((tab) => tab.id === id))}
          index={state.switcher.index}
          thumbnails={state.thumbnails}
          onSelect={(index) => dispatch({ type: "switcher/select", index })}
          onCommit={(index) => dispatch({ type: "switcher/commit", index })}
          onCancel={() => dispatch({ type: "switcher/cancel" })}
        />
      )}
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
