import {
  ArrowLeft,
  ArrowRight,
  KeyRound,
  LockKeyhole,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  VenetianMask,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import symbolUrl from "@/assets/agzos-symbol-red.svg";
import { AiSidebar, ChatMessage, initialChat } from "@/features/ai/sidebar";
import { profileFor, replyFor } from "@/features/ai/templates";
import { KeyPanel } from "@/features/key/panel";
import { PrivacyPanel } from "@/features/privacy/panel";
import { SettingsPanel } from "@/features/settings/panel";
import { cn } from "@/lib/utils";

import { engineOf } from "./engines";
import { blockedFor } from "./privacy";
import { StartPage } from "./start-page";
import {
  CLOSED_TABS_LIMIT,
  defaultCredentials,
  defaultLinks,
  entryOf,
  homeEntry,
  hostOf,
  loadPersistedState,
  normalizeUrlKey,
  persistBrowserState,
  starterTabs,
} from "./storage";
import { ContextMenu, useContextMenu } from "./tab-menu";
import type { ContextMenuGroup } from "./tab-menu";
import { desktopBridge } from "./desktop";
import type { DesktopPermissionRequest } from "./desktop";
import type { Credential, EngineId, Entry, QuickLink, Tab, TabOrientation } from "./types";
import { WebFrame } from "./web-frame";

function isMacPlatform() {
  if (typeof navigator === "undefined") return false;
  return /Mac/i.test(navigator.platform || navigator.userAgent);
}

export function AgzosBrowser() {
  const [tabs, setTabs] = useState<Tab[]>(starterTabs);
  const [activeId, setActiveId] = useState(1);
  const [address, setAddress] = useState(homeEntry.url);
  const [aiOpen, setAiOpen] = useState(true);
  const [panel, setPanel] = useState<"key" | "privacy" | "settings" | null>(null);
  const keyOpen = panel === "key";
  const [shield, setShield] = useState(true);
  const [dark, setDark] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>(initialChat);
  const [loading, setLoading] = useState(false);
  const [credentials, setCredentials] = useState<Credential[]>(defaultCredentials);
  const [links, setLinks] = useState<QuickLink[]>(defaultLinks);
  const [engine, setEngine] = useState<EngineId>("duckduckgo");
  const [pausedHosts, setPausedHosts] = useState<string[]>([]);
  const [confirmingClose, setConfirmingClose] = useState<number | null>(null);
  const [orientation, setOrientation] = useState<TabOrientation>("horizontal");
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [closedTabs, setClosedTabs] = useState<{ title: string; url: string }[]>([]);
  const [audioPlaying, setAudioPlaying] = useState<number[]>([]);
  const [viewNav, setViewNav] = useState<{ canBack: boolean; canForward: boolean } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [crashed, setCrashed] = useState<number[]>([]);
  const [requestedUrl, setRequestedUrl] = useState<{ id: number; url: string } | null>(null);
  const [permission, setPermission] = useState<DesktopPermissionRequest | null>(null);
  const [rememberPermission, setRememberPermission] = useState(true);
  const [credentialsReady, setCredentialsReady] = useState(false);

  const desktop = useMemo(() => desktopBridge(), []);
  const tabMenu = useContextMenu();
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const runActionRef = useRef<(action: string, tabId: number | null) => void>(() => {});
  const isMac = useMemo(isMacPlatform, []);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? starterTabs[0]!,
    [activeId, tabs],
  );
  const current = entryOf(activeTab);
  const viewDriven = desktop !== null && current.kind === "page";
  const canBack = viewDriven ? (viewNav?.canBack ?? false) : activeTab.index > 0;
  const canForward = viewDriven
    ? (viewNav?.canForward ?? false)
    : activeTab.index < activeTab.history.length - 1;
  const isFavorite = links.some(
    (link) => normalizeUrlKey(link.url) === normalizeUrlKey(current.url),
  );

  const orderedTabs = useMemo(
    () => [...tabs].sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false)),
    [tabs],
  );

  const currentHost = hostOf(current.url);
  const privacyHost = currentHost ?? "inicio";
  const trackers = useMemo(() => blockedFor(privacyHost), [privacyHost]);
  const paused = pausedHosts.includes(privacyHost);
  const protectedNow = shield && !paused;
  const blockedCount = protectedNow ? trackers.length : 0;

  useEffect(() => {
    const saved = loadPersistedState();
    setDark(saved.dark);
    const first = saved.tabs?.[0];
    if (saved.tabs && first?.history?.length) {
      setTabs(saved.tabs);
      setActiveId(first.id);
      setAddress(entryOf(first).url);
    }
    if (saved.engine === "duckduckgo" || saved.engine === "yandex") setEngine(saved.engine);
    if (saved.shieldOff) setShield(false);
    if (saved.aiOff) setAiOpen(false);
    if (saved.links) setLinks(saved.links);
    if (saved.pausedHosts.length) setPausedHosts(saved.pausedHosts);
    setOrientation(saved.orientation);
    setRailCollapsed(saved.railCollapsed);
    setClosedTabs(saved.closedTabs);
    if (desktop) {
      const legacy = saved.credentials;
      window.localStorage.removeItem("agzos-credentials");
      void desktop
        .keyLoad()
        .then((stored) => {
          if (stored?.length) {
            setCredentials(stored);
          } else if (legacy?.length) {
            setCredentials(legacy);
            void desktop.keySave(legacy);
          }
        })
        .finally(() => setCredentialsReady(true));
    } else {
      if (saved.credentials?.length) setCredentials(saved.credentials);
      setCredentialsReady(true);
    }
  }, [desktop]);

  useEffect(() => {
    persistBrowserState({
      dark,
      tabs,
      links,
      engine,
      shield,
      aiOpen,
      pausedHosts,
      orientation,
      railCollapsed,
      closedTabs,
    });
  }, [
    dark,
    tabs,
    links,
    engine,
    shield,
    aiOpen,
    pausedHosts,
    orientation,
    railCollapsed,
    closedTabs,
  ]);

  useEffect(() => {
    if (desktop || !credentialsReady) return;
    window.localStorage.setItem("agzos-credentials", JSON.stringify(credentials));
  }, [credentials, credentialsReady, desktop]);

  useEffect(() => {
    if (!desktop || !credentialsReady) return;
    void desktop.keySave(credentials);
  }, [credentials, credentialsReady, desktop]);

  const flash = useCallback(() => {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 500);
  }, []);

  const addTab = useCallback((options?: { private?: boolean }) => {
    const id = Date.now();
    setTabs((list) => [...list, { id, history: [homeEntry], index: 0, private: options?.private }]);
    setActiveId(id);
    setAddress(homeEntry.url);
  }, []);

  const addPrivateTab = useCallback(() => addTab({ private: true }), [addTab]);

  const openPageTab = useCallback((entry: Entry) => {
    const id = Date.now();
    setTabs((list) => [...list, { id, history: [entry], index: 0 }]);
    setActiveId(id);
    setAddress(entry.url);
  }, []);

  const togglePin = useCallback((id: number) => {
    setTabs((list) => list.map((tab) => (tab.id === id ? { ...tab, pinned: !tab.pinned } : tab)));
  }, []);

  const toggleMute = useCallback((id: number) => {
    setTabs((list) => list.map((tab) => (tab.id === id ? { ...tab, muted: !tab.muted } : tab)));
  }, []);

  const pushClosedTab = useCallback((entry: Entry) => {
    if (entry.kind !== "page") return;
    setClosedTabs((list) =>
      [...list, { title: entry.title, url: entry.url }].slice(-CLOSED_TABS_LIMIT),
    );
  }, []);

  const reopenClosedTab = useCallback(() => {
    const last = closedTabs[closedTabs.length - 1];
    if (!last) return;
    setClosedTabs((list) => list.slice(0, -1));
    openPageTab({ title: last.title, url: last.url, kind: "page" });
  }, [closedTabs, openPageTab]);

  const closeTab = useCallback(
    (id: number) => {
      const target = tabs.find((tab) => tab.id === id);
      if (!target) return;
      if (tabs.length === 1) {
        void desktop?.closeTab(id);
        const replacement: Tab = { id: Date.now(), history: [homeEntry], index: 0 };
        setTabs([replacement]);
        setActiveId(replacement.id);
        setAddress(homeEntry.url);
        setViewNav(null);
        setAudioPlaying((list) => list.filter((item) => item !== id));
        setCrashed((list) => list.filter((item) => item !== id));
        return;
      }
      if (!target.private) pushClosedTab(entryOf(target));
      void desktop?.closeTab(id);
      setTabs((list) => {
        const index = list.findIndex((tab) => tab.id === id);
        const remaining = list.filter((tab) => tab.id !== id);
        setActiveId((active) => {
          if (active !== id) return active;
          const next = remaining[Math.max(0, index - 1)] ?? remaining[0]!;
          setAddress(entryOf(next).url);
          return next.id;
        });
        return remaining;
      });
    },
    [desktop, pushClosedTab, tabs],
  );

  const requestCloseTab = useCallback(
    (id: number) => {
      const tab = tabs.find((item) => item.id === id);
      if (tab?.pinned && confirmingClose !== id) {
        setConfirmingClose(id);
        window.setTimeout(() => setConfirmingClose((value) => (value === id ? null : value)), 2600);
        return;
      }
      setConfirmingClose(null);
      closeTab(id);
    },
    [closeTab, confirmingClose, tabs],
  );

  const closeOthers = useCallback(
    (id: number) => {
      const doomed = tabs.filter((tab) => tab.id !== id && !tab.pinned);
      doomed.forEach((tab) => {
        pushClosedTab(entryOf(tab));
        void desktop?.closeTab(tab.id);
      });
      setTabs((list) => list.filter((tab) => tab.id === id || tab.pinned));
      if (doomed.some((tab) => tab.id === activeIdRef.current)) {
        const kept = tabs.find((tab) => tab.id === id);
        if (kept) {
          setActiveId(id);
          setAddress(entryOf(kept).url);
        }
      }
    },
    [desktop, pushClosedTab, tabs],
  );

  const closeSide = useCallback(
    (id: number, direction: 1 | -1) => {
      const display = [...tabs].sort(
        (a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false),
      );
      const index = display.findIndex((tab) => tab.id === id);
      if (index < 0) return;
      const doomed = display.filter((tab, position) => {
        if (position === index || tab.pinned) return false;
        return direction === 1 ? position > index : position < index;
      });
      doomed.forEach((tab) => {
        pushClosedTab(entryOf(tab));
        void desktop?.closeTab(tab.id);
      });
      const doomedIds = new Set(doomed.map((tab) => tab.id));
      setTabs((list) => list.filter((tab) => !doomedIds.has(tab.id)));
      if (doomedIds.has(activeIdRef.current)) {
        const kept = tabs.find((tab) => tab.id === id);
        if (kept) {
          setActiveId(id);
          setAddress(entryOf(kept).url);
        }
      }
    },
    [desktop, pushClosedTab, tabs],
  );

  const duplicateTab = useCallback(
    (id: number) => {
      const source = tabs.find((tab) => tab.id === id);
      if (!source) return;
      const clone: Tab = {
        id: Date.now(),
        history: source.history.slice(0, source.index + 1),
        index: source.index,
        private: source.private,
      };
      setTabs((list) => {
        const at = list.findIndex((tab) => tab.id === id);
        return [...list.slice(0, at + 1), clone, ...list.slice(at + 1)];
      });
      setActiveId(clone.id);
      setAddress(entryOf(clone).url);
    },
    [tabs],
  );

  const addTabRightOf = useCallback((id: number, options?: { private?: boolean }) => {
    const newTab: Tab = {
      id: Date.now(),
      history: [homeEntry],
      index: 0,
      private: options?.private,
    };
    setTabs((list) => {
      const at = list.findIndex((tab) => tab.id === id);
      if (at < 0) return [...list, newTab];
      return [...list.slice(0, at + 1), newTab, ...list.slice(at + 1)];
    });
    setActiveId(newTab.id);
    setAddress(homeEntry.url);
  }, []);

  const bookmarkAll = useCallback(() => {
    const pageTabs = tabs.filter((tab) => !tab.private && entryOf(tab).kind === "page");
    setLinks((list) => {
      const known = new Set(list.map((link) => normalizeUrlKey(link.url)));
      const additions: QuickLink[] = [];
      for (const tab of pageTabs) {
        const entry = entryOf(tab);
        const url = entry.url.replace(/^https?:\/\//, "").replace(/\/+$/, "");
        const key = normalizeUrlKey(url);
        if (known.has(key)) continue;
        known.add(key);
        additions.push({ name: entry.title, url });
      }
      return [...list, ...additions];
    });
  }, [tabs]);

  function activateTab(tab: Tab) {
    setViewNav(null);
    setActiveId(tab.id);
    setAddress(entryOf(tab).url);
  }

  const pushEntry = useCallback(
    (entry: Entry) => {
      flash();
      setTabs((list) =>
        list.map((tab) =>
          tab.id === activeId
            ? {
                ...tab,
                history: [...tab.history.slice(0, tab.index + 1), entry],
                index: tab.index + 1,
              }
            : tab,
        ),
      );
      setAddress(entry.url);
      if (desktop) setRequestedUrl({ id: activeId, url: entry.url });
    },
    [activeId, desktop, flash],
  );

  const openAddress = useCallback(
    (raw: string) => {
      const input = raw.trim();
      if (!input) return;
      const isUrl = /^https?:\/\//.test(input) || /^[\w-]+(\.[\w-]+)+(\/|$|\?)/.test(input);
      const url = isUrl
        ? input.startsWith("http")
          ? input
          : `https://${input}`
        : engineOf(engine).search(input);
      const title = isUrl ? (input.replace(/^https?:\/\//, "").split("/")[0] ?? input) : input;
      pushEntry({ title, url, kind: "page" });
    },
    [engine, pushEntry],
  );

  const step = useCallback(
    (delta: number) => {
      if (viewDriven && desktop) {
        if (delta < 0) void desktop.goBack(activeId);
        else void desktop.goForward(activeId);
        flash();
        return;
      }
      setTabs((list) =>
        list.map((tab) => {
          if (tab.id !== activeId) return tab;
          const index = Math.min(Math.max(tab.index + delta, 0), tab.history.length - 1);
          if (index === tab.index) return tab;
          setAddress(tab.history[index]!.url);
          flash();
          return { ...tab, index };
        }),
      );
    },
    [activeId, desktop, flash, viewDriven],
  );

  const reloadTab = useCallback(
    (id: number) => {
      flash();
      if (desktop) void desktop.reload(id);
    },
    [desktop, flash],
  );

  const focusOmnibox = useCallback(() => {
    const input = document.querySelector<HTMLInputElement>(".omnibox input");
    input?.focus();
    input?.select();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const key = event.key.toLowerCase();
      if (meta && event.shiftKey && key === "t") {
        event.preventDefault();
        reopenClosedTab();
        return;
      }
      if (meta && event.shiftKey && key === "d") {
        event.preventDefault();
        bookmarkAll();
        return;
      }
      if (key === "k" || key === "l") {
        event.preventDefault();
        focusOmnibox();
      } else if (key === "t") {
        event.preventDefault();
        addTab();
      } else if (key === "w") {
        event.preventDefault();
        closeTab(activeId);
      } else if (key === "r") {
        event.preventDefault();
        reloadTab(activeId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, addTab, bookmarkAll, closeTab, focusOmnibox, reloadTab, reopenClosedTab]);

  useEffect(() => {
    if (!desktop) return;
    const offTab = desktop.onTabEvent((event) => {
      if (event.type === "tab-updated") {
        setTabs((list) =>
          list.map((tab) => {
            if (tab.id !== event.id) return tab;
            const entry = tab.history[tab.index];
            if (!entry || entry.kind !== "page") return tab;
            const history = [...tab.history];
            history[tab.index] = { ...entry, url: event.url, title: event.title || entry.title };
            return { ...tab, history };
          }),
        );
        if (event.id === activeIdRef.current) {
          setAddress(event.url);
          setViewNav({ canBack: event.canBack, canForward: event.canForward });
        }
      } else if (event.type === "favicon") {
        setTabs((list) =>
          list.map((tab) =>
            tab.id === event.id ? { ...tab, favicon: event.icon ?? undefined } : tab,
          ),
        );
      } else if (event.type === "audio") {
        setAudioPlaying((list) =>
          event.playing ? [...new Set([...list, event.id])] : list.filter((id) => id !== event.id),
        );
      } else if (event.type === "muted") {
        setTabs((list) =>
          list.map((tab) => (tab.id === event.id ? { ...tab, muted: event.muted } : tab)),
        );
      } else if (event.type === "crashed") {
        setCrashed((list) => [...new Set([...list, event.id])]);
      }
    });
    const offOpen = desktop.onOpenRequest(({ url }) => {
      openPageTab({ title: hostOf(url) ?? url, url, kind: "page" });
    });
    const offFullscreen = desktop.onFullscreen(({ active }) => setFullscreen(active));
    const offHotkey = desktop.onHotkey(({ key, shift, alt, meta, ctrl }) => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: shift ? key.toUpperCase() : key,
          ctrlKey: ctrl,
          metaKey: meta,
          altKey: alt,
          shiftKey: shift,
          bubbles: true,
        }),
      );
    });
    const offMenu = desktop.onTabMenuAction(({ action, tabId }) => {
      runActionRef.current(action, tabId);
    });
    const offPermission = desktop.onRequestPermission((request) => {
      setPermission(request);
      setRememberPermission(true);
    });
    return () => {
      offTab();
      offOpen();
      offFullscreen();
      offHotkey();
      offMenu();
      offPermission();
    };
  }, [desktop, openPageTab]);

  useEffect(() => {
    if (desktop) void desktop.activateTab(activeId);
  }, [desktop, activeId]);

  useEffect(() => {
    if (desktop) void desktop.setPanelOpen(panel !== null);
  }, [desktop, panel]);

  function toggleFavorite() {
    const clean = current.url.replace(/^https?:\/\//, "");
    if (current.kind === "home") return;
    setLinks((list) =>
      list.some((link) => link.url === clean)
        ? list.filter((link) => link.url !== clean)
        : [...list, { name: current.title, url: clean }],
    );
  }

  async function copyText(id: string, value: string) {
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
    setCopied(id);
    window.setTimeout(() => setCopied(null), 1400);
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

  const clearChat = useCallback(() => setChat(initialChat), []);

  function togglePauseForSite(pause: boolean) {
    setPausedHosts((list) =>
      pause ? [...new Set([...list, privacyHost])] : list.filter((item) => item !== privacyHost),
    );
  }

  const tabMenuGroups = useCallback(
    (tab: Tab): ContextMenuGroup[] => {
      const entry = entryOf(tab);
      const audioItem =
        desktop && (audioPlaying.includes(tab.id) || tab.muted)
          ? [
              {
                id: "mute",
                label: tab.muted ? "Ativar som do site" : "Desativar som do site",
                onSelect: () => toggleMute(tab.id),
              },
            ]
          : [];
      return [
        [
          {
            id: "new-tab-right",
            label: "Nova guia à direita",
            shortcut: "Ctrl+T",
            onSelect: () => addTabRightOf(tab.id),
          },
          {
            id: "reopen-closed",
            label: "Reabrir guia fechada",
            shortcut: "Ctrl+Shift+T",
            disabled: closedTabs.length === 0,
            onSelect: reopenClosedTab,
          },
          { id: "duplicate", label: "Duplicar", onSelect: () => duplicateTab(tab.id) },
        ],
        "separator",
        [
          tab.pinned
            ? { id: "unpin", label: "Desfixar", onSelect: () => togglePin(tab.id) }
            : { id: "pin", label: "Fixar", onSelect: () => togglePin(tab.id) },
          ...audioItem,
        ],
        "separator",
        [
          {
            id: "reload",
            label: "Recarregar",
            shortcut: "Ctrl+R",
            onSelect: () => reloadTab(tab.id),
          },
          {
            id: "copy-url",
            label: "Copiar endereço",
            onSelect: () => void copyText("copy-url", entry.url),
          },
        ],
        "separator",
        [
          {
            id: "close",
            label: "Fechar",
            shortcut: "Ctrl+W",
            onSelect: () => requestCloseTab(tab.id),
          },
          {
            id: "close-others",
            label: "Fechar outras guias",
            onSelect: () => closeOthers(tab.id),
          },
          {
            id: "close-right",
            label: "Fechar guias à direita",
            onSelect: () => closeSide(tab.id, 1),
          },
          {
            id: "close-left",
            label: "Fechar guias à esquerda",
            onSelect: () => closeSide(tab.id, -1),
          },
        ],
        "separator",
        [
          {
            id: "bookmark-all",
            label: "Adicionar todas as guias aos favoritos…",
            shortcut: "Ctrl+Shift+D",
            onSelect: bookmarkAll,
          },
        ],
        "separator",
        [
          orientation === "horizontal"
            ? {
                id: "tabs-vertical",
                label: "Mostrar guias verticalmente",
                onSelect: () => setOrientation("vertical"),
              }
            : {
                id: "tabs-horizontal",
                label: "Mostrar guias horizontalmente",
                onSelect: () => setOrientation("horizontal"),
              },
        ],
      ];
    },
    [
      addTabRightOf,
      audioPlaying,
      bookmarkAll,
      closeOthers,
      closeSide,
      closedTabs.length,
      desktop,
      duplicateTab,
      orientation,
      reloadTab,
      reopenClosedTab,
      requestCloseTab,
      toggleMute,
      togglePin,
    ],
  );

  const stripMenuGroups = useCallback(
    (): ContextMenuGroup[] => [
      [
        {
          id: "strip-new",
          label: "Nova guia",
          shortcut: "Ctrl+T",
          onSelect: () => addTab(),
        },
        {
          id: "strip-reopen",
          label: "Reabrir guia fechada",
          shortcut: "Ctrl+Shift+T",
          disabled: closedTabs.length === 0,
          onSelect: reopenClosedTab,
        },
      ],
      "separator",
      [
        orientation === "horizontal"
          ? {
              id: "strip-vertical",
              label: "Mostrar guias verticalmente",
              onSelect: () => setOrientation("vertical"),
            }
          : {
              id: "strip-horizontal",
              label: "Mostrar guias horizontalmente",
              onSelect: () => setOrientation("horizontal"),
            },
      ],
    ],
    [addTab, closedTabs.length, orientation, reopenClosedTab],
  );

  const openTabMenu = useCallback(
    (event: React.MouseEvent, tab: Tab) => {
      event.preventDefault();
      event.stopPropagation();
      if (desktop) {
        void desktop.showTabMenu({
          kind: "tab",
          tabId: tab.id,
          pinned: Boolean(tab.pinned),
          muted: Boolean(tab.muted),
          audio: audioPlaying.includes(tab.id),
          hasClosed: closedTabs.length > 0,
          orientation,
          url: entryOf(tab).url,
        });
        return;
      }
      tabMenu.open(event.clientX, event.clientY, tabMenuGroups(tab));
    },
    [audioPlaying, closedTabs.length, desktop, orientation, tabMenu, tabMenuGroups],
  );

  const openStripMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      if (desktop) {
        void desktop.showTabMenu({
          kind: "strip",
          hasClosed: closedTabs.length > 0,
          orientation,
        });
        return;
      }
      tabMenu.open(event.clientX, event.clientY, stripMenuGroups());
    },
    [closedTabs.length, desktop, orientation, stripMenuGroups, tabMenu],
  );

  function runTabMenuAction(action: string, tabId: number | null) {
    switch (action) {
      case "new-tab-right":
        if (tabId != null) addTabRightOf(tabId);
        else addTab();
        return;
      case "strip-new":
        addTab();
        return;
      case "reopen-closed":
      case "strip-reopen":
        reopenClosedTab();
        return;
      case "duplicate":
        if (tabId != null) duplicateTab(tabId);
        return;
      case "pin":
      case "unpin":
        if (tabId != null) togglePin(tabId);
        return;
      case "mute":
        if (tabId != null) toggleMute(tabId);
        return;
      case "reload":
        if (tabId != null) reloadTab(tabId);
        return;
      case "copy-url":
        if (tabId != null) {
          const source = tabs.find((item) => item.id === tabId);
          if (source) void copyText("copy-url", entryOf(source).url);
        }
        return;
      case "close":
        if (tabId != null) requestCloseTab(tabId);
        return;
      case "close-others":
        if (tabId != null) closeOthers(tabId);
        return;
      case "close-right":
        if (tabId != null) closeSide(tabId, 1);
        return;
      case "close-left":
        if (tabId != null) closeSide(tabId, -1);
        return;
      case "bookmark-all":
        bookmarkAll();
        return;
      case "tabs-vertical":
      case "strip-vertical":
        setOrientation("vertical");
        return;
      case "tabs-horizontal":
      case "strip-horizontal":
        setOrientation("horizontal");
        return;
    }
  }
  runActionRef.current = runTabMenuAction;

  const answerPermission = useCallback(
    (allow: boolean) => {
      if (!permission || !desktop) return;
      void desktop.respondPermission(permission.id, allow, rememberPermission);
      setPermission(null);
    },
    [desktop, permission, rememberPermission],
  );

  const recoverCrashedTab = useCallback(
    (id: number) => {
      setCrashed((list) => list.filter((item) => item !== id));
      void desktop?.reload(id);
      void desktop?.activateTab(id);
      flash();
    },
    [desktop, flash],
  );

  function renderTab(tab: Tab) {
    const entry = entryOf(tab);
    const playing = audioPlaying.includes(tab.id) && !tab.muted;
    return (
      <button
        key={tab.id}
        type="button"
        role="tab"
        aria-selected={tab.id === activeId}
        onClick={() => activateTab(tab)}
        onContextMenu={(event) => openTabMenu(event, tab)}
        className={cn(
          "browser-tab",
          tab.id === activeId && "active",
          tab.pinned && "pinned",
          tab.private && "private",
        )}
      >
        {tab.private ? (
          <VenetianMask aria-hidden="true" />
        ) : tab.favicon ? (
          <img
            src={tab.favicon}
            alt=""
            onError={(event) => {
              event.currentTarget.src = symbolUrl;
            }}
          />
        ) : (
          <img src={symbolUrl} alt="" />
        )}
        <span>{entry.title}</span>
        {playing && <Volume2 aria-hidden="true" className="tab-audio" />}
        {tab.muted && <VolumeX aria-hidden="true" className="tab-audio muted" />}
        <span
          className="tab-pin"
          role="button"
          aria-label={tab.pinned ? `Desafixar ${entry.title}` : `Fixar ${entry.title}`}
          title={tab.pinned ? "Desafixar aba" : "Fixar aba"}
          onClick={(event) => {
            event.stopPropagation();
            togglePin(tab.id);
          }}
        >
          {tab.pinned ? <PinOff /> : <Pin />}
        </span>
        <span
          className={cn("tab-close", confirmingClose === tab.id && "confirm")}
          role="button"
          aria-label={`Fechar ${entry.title}`}
          title={tab.pinned ? "Clique novamente para fechar" : undefined}
          onClick={(event) => {
            event.stopPropagation();
            requestCloseTab(tab.id);
          }}
        >
          <X />
        </span>
      </button>
    );
  }

  return (
    <main className={cn("browser-stage", dark && "dark", fullscreen && "fs")}>
      <section className="browser-window" aria-label="Agzos Browser">
        <header className="titlebar">
          {isMac && (
            <div className="window-controls" aria-label="Controles da janela">
              <span />
              <span />
              <span />
            </div>
          )}
          {orientation === "horizontal" && (
            <div
              className="tabs"
              role="tablist"
              aria-label="Abas abertas"
              onContextMenu={openStripMenu}
            >
              {orderedTabs.map(renderTab)}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => addTab()}
                title="Nova aba (Ctrl/⌘ T)"
                aria-label="Nova aba"
                className="new-tab"
              >
                <Plus />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={addPrivateTab}
                title="Nova aba anônima"
                aria-label="Nova aba anônima"
                className="new-tab"
              >
                <VenetianMask />
              </Button>
            </div>
          )}
          {orientation === "vertical" && <div className="titlebar-spacer" />}
          <Button
            variant={panel === "settings" ? "default" : "ghost"}
            size="icon"
            title="Configurações"
            aria-label="Configurações"
            onClick={() => setPanel((p) => (p === "settings" ? null : "settings"))}
          >
            <MoreHorizontal />
          </Button>
        </header>

        <div className="toolbar">
          <div className="nav-actions">
            <Button
              variant="ghost"
              size="icon"
              title="Voltar"
              aria-label="Voltar"
              disabled={!canBack}
              onClick={() => step(-1)}
            >
              <ArrowLeft />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Avançar"
              aria-label="Avançar"
              disabled={!canForward}
              onClick={() => step(1)}
            >
              <ArrowRight />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              title="Recarregar (Ctrl/⌘ R)"
              aria-label="Recarregar"
              onClick={() => reloadTab(activeId)}
            >
              <RefreshCw className={cn(loading && "spin")} />
            </Button>
          </div>
          <form
            className="omnibox"
            onSubmit={(event) => {
              event.preventDefault();
              openAddress(address);
            }}
          >
            {activeTab.private ? (
              <VenetianMask aria-hidden="true" />
            ) : (
              <LockKeyhole aria-hidden="true" />
            )}
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              aria-label="Pesquisar ou digitar endereço"
              placeholder="Pesquisar ou digitar endereço"
            />
            <button
              type="button"
              className={cn("fav-button", isFavorite && "on")}
              onClick={toggleFavorite}
              title={isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
              aria-label="Favoritar página"
              aria-pressed={isFavorite}
            >
              <Star />
            </button>
            <kbd>{isMac ? "⌘ K" : "Ctrl K"}</kbd>
          </form>
          <div className="toolbar-actions">
            <button
              type="button"
              className="privacy-pill"
              onClick={() => setPanel((p) => (p === "privacy" ? null : "privacy"))}
              title="Rastreadores bloqueados"
            >
              <ShieldCheck />
              <strong>{blockedCount}</strong>
              <span>bloqueados</span>
            </button>
            <Button
              variant={keyOpen ? "default" : "ghost"}
              size="icon"
              onClick={() => setPanel((p) => (p === "key" ? null : "key"))}
              title="Abrir Agzos Key"
              aria-label="Abrir Agzos Key"
            >
              <KeyRound />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setDark((value) => !value)}
              title={dark ? "Usar tema claro" : "Usar tema escuro"}
              aria-label={dark ? "Usar tema claro" : "Usar tema escuro"}
            >
              {dark ? <Sun /> : <Moon />}
            </Button>
            <Button
              variant={aiOpen ? "default" : "ghost"}
              size="icon"
              onClick={() => setAiOpen((open) => !open)}
              title="Alternar Agzos AI"
              aria-label="Alternar Agzos AI"
            >
              <Sparkles />
            </Button>
          </div>
        </div>

        <div className="browser-body">
          {orientation === "vertical" && (
            <aside
              className={cn("tabs-rail", railCollapsed && "collapsed")}
              onContextMenu={openStripMenu}
            >
              <div className="rail-head">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setRailCollapsed((value) => !value)}
                  title={railCollapsed ? "Expandir barra de guias" : "Recolher barra de guias"}
                  aria-label="Alternar barra de guias"
                  className="rail-toggle"
                >
                  {railCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
                </Button>
                {!railCollapsed && (
                  <>
                    <span className="rail-title">Guias</span>
                    <div className="rail-actions">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => addTab()}
                        title="Nova aba (Ctrl/⌘ T)"
                        aria-label="Nova aba"
                      >
                        <Plus />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={addPrivateTab}
                        title="Nova aba anônima"
                        aria-label="Nova aba anônima"
                      >
                        <VenetianMask />
                      </Button>
                    </div>
                  </>
                )}
              </div>
              <div className="rail-tabs" role="tablist" aria-label="Abas verticais">
                {orderedTabs.map(renderTab)}
              </div>
            </aside>
          )}
          <div className="workspace">
            <section className={cn("viewport", activeTab.private && "private")}>
              {loading && <div className="loading-line" />}
              {crashed.includes(activeTab.id) ? (
                <div className="crash-page">
                  <ShieldCheck aria-hidden="true" />
                  <h1>Esta guia travou</h1>
                  <p>O processo desta página parou de responder.</p>
                  <Button onClick={() => recoverCrashedTab(activeTab.id)}>Recarregar</Button>
                </div>
              ) : current.kind === "home" ? (
                <StartPage
                  links={links}
                  engine={engineOf(engine)}
                  blocked={blockedCount}
                  onOpen={openAddress}
                  onAdd={(link) => setLinks((list) => [...list, link])}
                  onRemove={(url) => setLinks((list) => list.filter((link) => link.url !== url))}
                />
              ) : (
                <WebFrame
                  key={activeTab.id}
                  tabId={activeTab.id}
                  title={current.title}
                  url={current.url}
                  requestedUrl={requestedUrl?.id === activeTab.id ? requestedUrl.url : undefined}
                  dark={dark}
                  privateTab={Boolean(activeTab.private)}
                  muted={Boolean(activeTab.muted)}
                />
              )}
            </section>
            {aiOpen && (
              <AiSidebar
                url={current.url}
                title={current.title}
                chat={chat}
                onSend={handleSend}
                onClear={clearChat}
                onClose={() => setAiOpen(false)}
              />
            )}
          </div>
        </div>

        {panel === "privacy" && (
          <PrivacyPanel
            host={currentHost}
            shield={shield}
            setShield={setShield}
            paused={paused}
            onPauseChange={togglePauseForSite}
            trackers={trackers}
            protectedNow={protectedNow}
            onClose={() => setPanel(null)}
          />
        )}
        {panel === "settings" && (
          <SettingsPanel
            dark={dark}
            setDark={setDark}
            aiOpen={aiOpen}
            setAiOpen={setAiOpen}
            shield={shield}
            setShield={setShield}
            engine={engine}
            setEngine={setEngine}
            onReset={() => {
              tabs.forEach((tab) => void desktop?.closeTab(tab.id));
              setTabs(starterTabs);
              setActiveId(1);
              setAddress(homeEntry.url);
              setViewNav(null);
              setCrashed([]);
              setRequestedUrl(null);
            }}
            onClose={() => setPanel(null)}
          />
        )}
        {keyOpen && (
          <KeyPanel
            credentials={credentials}
            copied={copied}
            onCopy={copyText}
            onAdd={(item) => setCredentials((list) => [...list, item])}
            onRemove={(domain) =>
              setCredentials((list) => list.filter((item) => item.domain !== domain))
            }
            onClose={() => setPanel(null)}
          />
        )}
      </section>
      {permission && (
        <div className="permission-bar" role="alertdialog" aria-label="Pedido de permissão">
          <ShieldCheck aria-hidden="true" />
          <span>
            <strong>{hostOf(permission.origin) ?? permission.origin}</strong> quer usar{" "}
            {permission.mediaTypes.includes("video") && permission.mediaTypes.includes("audio")
              ? "a câmera e o microfone"
              : permission.mediaTypes.includes("video")
                ? "a câmera"
                : "o microfone"}
            .
          </span>
          <label className="permission-remember">
            <input
              type="checkbox"
              checked={rememberPermission}
              onChange={(event) => setRememberPermission(event.target.checked)}
            />
            Lembrar
          </label>
          <Button size="sm" onClick={() => answerPermission(true)}>
            Permitir
          </Button>
          <Button size="sm" variant="outline" onClick={() => answerPermission(false)}>
            Bloquear
          </Button>
        </div>
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
