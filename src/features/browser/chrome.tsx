import {
  ArrowLeft,
  ArrowRight,
  KeyRound,
  LockKeyhole,
  Moon,
  MoreHorizontal,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  VenetianMask,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

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
  defaultCredentials,
  defaultLinks,
  entryOf,
  homeEntry,
  hostOf,
  loadPersistedState,
  persistBrowserState,
  starterTabs,
} from "./storage";
import type { Credential, EngineId, Entry, QuickLink, Tab } from "./types";
import { WebFrame } from "./web-frame";

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

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? starterTabs[0]!,
    [activeId, tabs],
  );
  const current = entryOf(activeTab);
  const canBack = activeTab.index > 0;
  const canForward = activeTab.index < activeTab.history.length - 1;
  const isFavorite = links.some((link) => link.url === current.url.replace(/^https?:\/\//, ""));

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
    if (saved.credentials?.length) setCredentials(saved.credentials);
    if (saved.links) setLinks(saved.links);
    if (saved.pausedHosts.length) setPausedHosts(saved.pausedHosts);
  }, []);

  useEffect(() => {
    persistBrowserState({ dark, tabs, credentials, links, engine, shield, aiOpen, pausedHosts });
  }, [dark, tabs, credentials, links, engine, shield, aiOpen, pausedHosts]);

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

  const togglePin = useCallback((id: number) => {
    setTabs((list) => list.map((tab) => (tab.id === id ? { ...tab, pinned: !tab.pinned } : tab)));
  }, []);

  const closeTab = useCallback((id: number) => {
    setTabs((list) => {
      if (list.length === 1) return list;
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
  }, []);

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

  function activateTab(tab: Tab) {
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
    },
    [activeId, flash],
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
    [activeId, flash],
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
        flash();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeId, addTab, closeTab, flash, focusOmnibox]);

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

  return (
    <main className={cn("browser-stage", dark && "dark")}>
      <section className="browser-window" aria-label="Agzos Browser">
        <header className="titlebar">
          <div className="window-controls" aria-label="Controles da janela">
            <span />
            <span />
            <span />
          </div>
          <div className="tabs" role="tablist" aria-label="Abas abertas">
            {orderedTabs.map((tab) => {
              const entry = entryOf(tab);
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={tab.id === activeId}
                  onClick={() => activateTab(tab)}
                  className={cn(
                    "browser-tab",
                    tab.id === activeId && "active",
                    tab.pinned && "pinned",
                    tab.private && "private",
                  )}
                >
                  {tab.private ? (
                    <VenetianMask aria-hidden="true" />
                  ) : (
                    <img src={symbolUrl} alt="" />
                  )}
                  <span>{entry.title}</span>
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
            })}
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
              onClick={flash}
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
            <kbd>⌘ K</kbd>
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

        <div className="workspace">
          <section className={cn("viewport", activeTab.private && "private")}>
            {loading && <div className="loading-line" />}
            {current.kind === "home" ? (
              <StartPage
                links={links}
                engine={engineOf(engine)}
                blocked={blockedCount}
                onOpen={openAddress}
                onAdd={(link) => setLinks((list) => [...list, link])}
                onRemove={(url) => setLinks((list) => list.filter((link) => link.url !== url))}
              />
            ) : (
              <WebFrame key={current.url} title={current.title} url={current.url} />
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
              setTabs(starterTabs);
              setActiveId(1);
              setAddress(homeEntry.url);
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
    </main>
  );
}
