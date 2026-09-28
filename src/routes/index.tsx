import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Moon,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import logoUrl from "@/assets/agzos-logo.svg";
import symbolUrl from "@/assets/agzos-symbol-red.svg";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Entry = { title: string; url: string; kind: "home" | "page" };
type Tab = { id: number; history: Entry[]; index: number };
type Credential = { domain: string; user: string; password: string };
type QuickLink = { name: string; url: string };
type EngineId = "duckduckgo" | "yandex";

const engines: { id: EngineId; name: string; hint: string; search: (q: string) => string }[] = [
  { id: "duckduckgo", name: "DuckDuckGo", hint: "Busca sem rastreamento", search: (q) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}` },
  { id: "yandex", name: "Yandex", hint: "Busca alternativa", search: (q) => `https://yandex.com/search/?text=${encodeURIComponent(q)}` },
];

function engineOf(id: EngineId) {
  return engines.find((item) => item.id === id) ?? engines[0]!;
}

const homeEntry: Entry = { title: "Nova aba", url: "agzos://inicio", kind: "home" };
const starterTabs: Tab[] = [{ id: 1, history: [homeEntry], index: 0 }];

const defaultCredentials: Credential[] = [
  { domain: "github.com", user: "mrcatofic", password: "agz-Gh8x2mK93" },
  { domain: "figma.com", user: "design@agzos.com", password: "fg-4Wn9Kp17" },
  { domain: "notion.so", user: "equipe@agzos.com", password: "nt-7Ra5Ls26" },
];

const defaultLinks: QuickLink[] = [
  { name: "GitHub", url: "github.com" },
  { name: "Figma", url: "figma.com" },
  { name: "Notion", url: "notion.so" },
  { name: "Linear", url: "linear.app" },
];

function entryOf(tab: Tab): Entry {
  return tab.history[tab.index] ?? homeEntry;
}

function shortOf(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}

function generatePassword() {
  const chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*";
  const values = new Uint32Array(18);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => chars[value % chars.length]).join("");
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Agzos Browser — Navegue com controle" },
      { name: "description", content: "Interface do Agzos Browser com IA, privacidade e cofre integrados." },
      { property: "og:title", content: "Agzos Browser — Navegue com controle" },
      { property: "og:description", content: "Interface do Agzos Browser com IA, privacidade e cofre integrados." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AgzosBrowser,
});

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
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState(["Olá! Posso resumir, explicar ou responder perguntas sobre esta página."]);
  const [loading, setLoading] = useState(false);
  const [credentials, setCredentials] = useState<Credential[]>(defaultCredentials);
  const [links, setLinks] = useState<QuickLink[]>(defaultLinks);
  const [engine, setEngine] = useState<EngineId>("duckduckgo");

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeId) ?? tabs[0] ?? starterTabs[0]!, [activeId, tabs]);
  const current = entryOf(activeTab);
  const canBack = activeTab.index > 0;
  const canForward = activeTab.index < activeTab.history.length - 1;
  const isFavorite = links.some((link) => link.url === current.url.replace(/^https?:\/\//, ""));

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("agzos-theme");
    if (savedTheme === "dark") setDark(true);
    try {
      const savedTabs = JSON.parse(window.localStorage.getItem("agzos-tabs") ?? "null") as Tab[] | null;
      const first = savedTabs?.[0];
      if (savedTabs && first?.history?.length) {
        setTabs(savedTabs);
        setActiveId(first.id);
        setAddress(entryOf(first).url);
      }
    } catch {
      window.localStorage.removeItem("agzos-tabs");
    }
    const savedEngine = window.localStorage.getItem("agzos-engine");
    if (savedEngine === "duckduckgo" || savedEngine === "yandex") setEngine(savedEngine);
    if (window.localStorage.getItem("agzos-shield") === "off") setShield(false);
    if (window.localStorage.getItem("agzos-ai") === "off") setAiOpen(false);
    try {
      const savedKeys = JSON.parse(window.localStorage.getItem("agzos-credentials") ?? "null") as Credential[] | null;
      if (savedKeys?.length) setCredentials(savedKeys);
      const savedLinks = JSON.parse(window.localStorage.getItem("agzos-links") ?? "null") as QuickLink[] | null;
      if (savedLinks) setLinks(savedLinks);
    } catch {
      /* ignora dados inválidos */
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("agzos-theme", dark ? "dark" : "light");
    window.localStorage.setItem("agzos-tabs", JSON.stringify(tabs));
    window.localStorage.setItem("agzos-credentials", JSON.stringify(credentials));
    window.localStorage.setItem("agzos-links", JSON.stringify(links));
    window.localStorage.setItem("agzos-engine", engine);
    window.localStorage.setItem("agzos-shield", shield ? "on" : "off");
    window.localStorage.setItem("agzos-ai", aiOpen ? "on" : "off");
  }, [dark, tabs, credentials, links, engine, shield, aiOpen]);

  const flash = useCallback(() => {
    setLoading(true);
    window.setTimeout(() => setLoading(false), 500);
  }, []);

  const addTab = useCallback(() => {
    const id = Date.now();
    setTabs((list) => [...list, { id, history: [homeEntry], index: 0 }]);
    setActiveId(id);
    setAddress(homeEntry.url);
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
            ? { ...tab, history: [...tab.history.slice(0, tab.index + 1), entry], index: tab.index + 1 }
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
      const url = isUrl ? (input.startsWith("http") ? input : `https://${input}`) : engineOf(engine).search(input);
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
    setLinks((list) => (list.some((link) => link.url === clean) ? list.filter((link) => link.url !== clean) : [...list, { name: current.title, url: clean }]));
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

  function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    setChat((list) => [...list, message, "Esta é uma resposta simulada da Agzos AI para a página atual."]);
    setMessage("");
  }

  return (
    <main className={cn("browser-stage", dark && "dark")}>
      <section className="browser-window" aria-label="Agzos Browser">
        <header className="titlebar">
          <div className="window-controls" aria-label="Controles da janela"><span /><span /><span /></div>
          <div className="tabs" role="tablist" aria-label="Abas abertas">
            {tabs.map((tab) => {
              const entry = entryOf(tab);
              return (
                <button key={tab.id} type="button" role="tab" aria-selected={tab.id === activeId} onClick={() => activateTab(tab)} className={cn("browser-tab", tab.id === activeId && "active")}>
                  <img src={symbolUrl} alt="" />
                  <span>{entry.title}</span>
                  <span className="tab-close" role="button" aria-label={`Fechar ${entry.title}`} onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }}><X /></span>
                </button>
              );
            })}
            <Button variant="ghost" size="icon" onClick={addTab} title="Nova aba (Ctrl/⌘ T)" aria-label="Nova aba" className="new-tab"><Plus /></Button>
          </div>
          <Button variant={panel === "settings" ? "default" : "ghost"} size="icon" title="Configurações" aria-label="Configurações" onClick={() => setPanel((p) => (p === "settings" ? null : "settings"))}><MoreHorizontal /></Button>
        </header>

        <div className="toolbar">
          <div className="nav-actions">
            <Button variant="ghost" size="icon" title="Voltar" aria-label="Voltar" disabled={!canBack} onClick={() => step(-1)}><ArrowLeft /></Button>
            <Button variant="ghost" size="icon" title="Avançar" aria-label="Avançar" disabled={!canForward} onClick={() => step(1)}><ArrowRight /></Button>
            <Button variant="ghost" size="icon" title="Recarregar (Ctrl/⌘ R)" aria-label="Recarregar" onClick={flash}><RefreshCw className={cn(loading && "spin")} /></Button>
          </div>
          <form className="omnibox" onSubmit={(event) => { event.preventDefault(); openAddress(address); }}>
            <LockKeyhole aria-hidden="true" />
            <input value={address} onChange={(event) => setAddress(event.target.value)} aria-label="Pesquisar ou digitar endereço" placeholder="Pesquisar ou digitar endereço" />
            <button type="button" className={cn("fav-button", isFavorite && "on")} onClick={toggleFavorite} title={isFavorite ? "Remover dos favoritos" : "Adicionar aos favoritos"} aria-label="Favoritar página" aria-pressed={isFavorite}><Star /></button>
            <kbd>⌘ K</kbd>
          </form>
          <div className="toolbar-actions">
            <button type="button" className="privacy-pill" onClick={() => setPanel((p) => (p === "privacy" ? null : "privacy"))} title="Rastreadores bloqueados"><ShieldCheck /><strong>{shield ? 12 : 0}</strong><span>bloqueados</span></button>
            <Button variant={keyOpen ? "default" : "ghost"} size="icon" onClick={() => setPanel((p) => (p === "key" ? null : "key"))} title="Abrir Agzos Key" aria-label="Abrir Agzos Key"><KeyRound /></Button>
            <Button variant="ghost" size="icon" onClick={() => setDark((value) => !value)} title={dark ? "Usar tema claro" : "Usar tema escuro"} aria-label={dark ? "Usar tema claro" : "Usar tema escuro"}>{dark ? <Sun /> : <Moon />}</Button>
            <Button variant={aiOpen ? "default" : "ghost"} size="icon" onClick={() => setAiOpen((open) => !open)} title="Alternar Agzos AI" aria-label="Alternar Agzos AI"><Sparkles /></Button>
          </div>
        </div>

        <div className="workspace">
          <section className="viewport">
            {loading && <div className="loading-line" />}
            {current.kind === "home" ? (
              <StartPage
                links={links}
                onOpen={openAddress}
                onSearch={focusOmnibox}
                onAdd={(link) => setLinks((list) => [...list, link])}
                onRemove={(url) => setLinks((list) => list.filter((link) => link.url !== url))}
              />
            ) : (
              <MockPage title={current.title} address={current.url} />
            )}
          </section>
          {aiOpen && <AiSidebar chat={chat} message={message} setMessage={setMessage} onSubmit={sendMessage} onClose={() => setAiOpen(false)} />}
        </div>

        {panel === "privacy" && <PrivacyPanel shield={shield} setShield={setShield} onClose={() => setPanel(null)} />}
        {panel === "settings" && <SettingsPanel dark={dark} setDark={setDark} aiOpen={aiOpen} setAiOpen={setAiOpen} shield={shield} setShield={setShield} onReset={() => { setTabs(starterTabs); setActiveId(1); setAddress(homeEntry.url); }} onClose={() => setPanel(null)} />}
        {keyOpen && (
          <KeyPanel
            credentials={credentials}
            copied={copied}
            onCopy={copyText}
            onAdd={(item) => setCredentials((list) => [...list, item])}
            onRemove={(domain) => setCredentials((list) => list.filter((item) => item.domain !== domain))}
            onClose={() => setPanel(null)}
          />
        )}
      </section>
    </main>
  );
}

function StartPage({ links, onOpen, onSearch, onAdd, onRemove }: { links: QuickLink[]; onOpen: (value: string) => void; onSearch: () => void; onAdd: (link: QuickLink) => void; onRemove: (url: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const clean = url.trim().replace(/^https?:\/\//, "");
    if (!clean) return;
    onAdd({ name: name.trim() || clean, url: clean });
    setName("");
    setUrl("");
    setAdding(false);
  }

  return (
    <div className="start-page">
      <div className="start-content">
        <img className="brand-logo" src={logoUrl} alt="Agzos" />
        <p className="brand-tagline">Navegue com clareza. Decida com controle.</p>
        <button type="button" className="start-search" onClick={onSearch}>
          <span>Pesquisar na web</span><span className="search-key">⌘ K</span>
        </button>
        <div className="quick-links">
          {links.map((link) => (
            <div className="quick-link" key={link.url}>
              <button type="button" onClick={() => onOpen(link.url)} title={link.url}><span>{shortOf(link.name)}</span><small>{link.name}</small></button>
              <button type="button" className="quick-remove" onClick={() => onRemove(link.url)} aria-label={`Remover ${link.name}`}><X /></button>
            </div>
          ))}
          <div className="quick-link">
            <button type="button" onClick={() => setAdding(true)} aria-label="Adicionar atalho"><span>+</span><small>Adicionar</small></button>
          </div>
        </div>
        {adding && (
          <form className="quick-form" onSubmit={submit}>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nome" aria-label="Nome do atalho" />
            <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="site.com" aria-label="Endereço do atalho" />
            <Button size="sm" type="submit">Salvar</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setAdding(false)}>Cancelar</Button>
          </form>
        )}
      </div>
      <div className="privacy-note"><ShieldCheck /><span><strong>Proteção ativa</strong><small>12 rastreadores bloqueados hoje</small></span></div>
    </div>
  );
}

function MockPage({ title, address }: { title: string; address: string }) {
  const isSearch = address.startsWith("Busca:");
  return (
    <div className="mock-page">
      <div className="mock-eyebrow">{isSearch ? "Resultados protegidos" : "Visualização segura"}</div>
      <h1>{isSearch ? `Resultados para “${title}”` : title}</h1>
      <p>A Agzos protege sua navegação enquanto organiza o conteúdo importante desta página.</p>
      <div className="result-list">
        {["Uma visão mais clara para sua pesquisa", "Privacidade que trabalha em silêncio", "Informação sem distrações"].map((item, index) => (
          <article key={item}><span>0{index + 1}</span><div><small>agzos.com / conteúdo</small><h2>{item}</h2><p>Conteúdo demonstrativo para visualizar a experiência de navegação do Agzos Browser.</p></div></article>
        ))}
      </div>
    </div>
  );
}

function AiSidebar({ chat, message, setMessage, onSubmit, onClose }: { chat: string[]; message: string; setMessage: (value: string) => void; onSubmit: (event: FormEvent) => void; onClose: () => void }) {
  const [mode, setMode] = useState<"Resumo" | "Explicar" | "Chat">("Resumo");
  return (
    <aside className="ai-sidebar">
      <div className="panel-heading"><div className="panel-title"><span className="ai-mark"><Sparkles /></span><div><strong>Agzos AI</strong><small>Pronta para ajudar</small></div></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar Agzos AI"><X /></Button></div>
      <div className="mode-switch">{(["Resumo", "Explicar", "Chat"] as const).map((item) => <button key={item} type="button" className={cn(mode === item && "selected")} onClick={() => setMode(item)}>{item}</button>)}</div>
      <div className="ai-body">
        {mode === "Resumo" && <><div className="summary-label"><Bot /> RESUMO DA PÁGINA</div><h3>Seu espaço de navegação, organizado.</h3><p>A página inicial reúne seus acessos mais usados e mantém as proteções de privacidade visíveis sem interromper o fluxo.</p><ul><li>Acesso rápido aos sites frequentes</li><li>12 rastreadores bloqueados</li><li>Cofre de credenciais disponível</li></ul></>}
        {mode === "Explicar" && <><div className="summary-label"><Sparkles /> EXPLICAÇÃO</div><h3>Como a proteção funciona?</h3><p>O indicador na barra mostra quantas tentativas de rastreamento foram interrompidas durante sua sessão.</p><div className="insight">Tudo acontece localmente nesta demonstração — nenhum dado é enviado.</div></>}
        {mode === "Chat" && <div className="chat-log">{chat.map((item, index) => <div key={`${item}-${index}`} className={cn("chat-bubble", index % 2 === 1 && "mine")}>{item}</div>)}</div>}
      </div>
      <form className="chat-input" onSubmit={onSubmit}><input value={message} onChange={(event) => setMessage(event.target.value)} onFocus={() => setMode("Chat")} placeholder="Pergunte sobre esta página…" aria-label="Mensagem para Agzos AI" /><Button size="icon" aria-label="Enviar mensagem"><Send /></Button></form>
      <p className="ai-disclaimer">A IA pode cometer erros. Verifique informações importantes.</p>
    </aside>
  );
}

function KeyPanel({ credentials, copied, onCopy, onAdd, onRemove, onClose }: { credentials: Credential[]; copied: string | null; onCopy: (id: string, value: string) => void; onAdd: (item: Credential) => void; onRemove: (domain: string) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [domain, setDomain] = useState("");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");

  const filtered = credentials.filter((item) => `${item.domain} ${item.user}`.toLowerCase().includes(query.toLowerCase()));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!domain.trim() || !password.trim()) return;
    onAdd({ domain: domain.trim().replace(/^https?:\/\//, ""), user: user.trim(), password });
    setDomain("");
    setUser("");
    setPassword("");
    setAdding(false);
  }

  return (
    <aside className="key-panel" aria-label="Agzos Key">
      <div className="panel-heading"><div className="panel-title"><span className="key-mark"><KeyRound /></span><div><strong>Agzos Key</strong><small>Cofre local</small></div></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar cofre"><X /></Button></div>
      <div className="key-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar credencial" aria-label="Buscar credencial" /></div>
      <div className="key-domain"><span>Credenciais salvas</span><ChevronDown /></div>
      <div className="credential-list">
        {filtered.length === 0 && <p className="key-empty">Nenhuma credencial encontrada.</p>}
        {filtered.map((item) => (
          <div className="credential" key={item.domain}>
            <div className="domain-icon">{item.domain.charAt(0).toUpperCase()}</div>
            <div className="credential-copy">
              <strong>{item.domain}</strong>
              <span>{visible === item.domain ? item.password : item.user}</span>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setVisible((value) => (value === item.domain ? null : item.domain))} title="Mostrar senha" aria-label={`Mostrar senha de ${item.domain}`}>{visible === item.domain ? <EyeOff /> : <Eye />}</Button>
            <Button variant="ghost" size="icon" onClick={() => onCopy(item.domain, item.password)} title={`Copiar senha de ${item.domain}`} aria-label={`Copiar senha de ${item.domain}`}>{copied === item.domain ? <Check /> : <Copy />}</Button>
            <Button variant="ghost" size="icon" onClick={() => onRemove(item.domain)} title="Excluir" aria-label={`Excluir credencial de ${item.domain}`}><Trash2 /></Button>
          </div>
        ))}
      </div>
      {adding ? (
        <form className="key-form" onSubmit={submit}>
          <input value={domain} onChange={(event) => setDomain(event.target.value)} placeholder="site.com" aria-label="Domínio" />
          <input value={user} onChange={(event) => setUser(event.target.value)} placeholder="usuário ou e-mail" aria-label="Usuário" />
          <div className="key-password">
            <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="senha" aria-label="Senha" />
            <Button type="button" variant="ghost" size="icon" onClick={() => setPassword(generatePassword())} title="Gerar senha forte" aria-label="Gerar senha forte"><Wand2 /></Button>
          </div>
          <div className="key-form-actions">
            <Button size="sm" type="submit">Salvar</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setAdding(false)}>Cancelar</Button>
          </div>
        </form>
      ) : (
        <div className="settings-actions"><Button variant="outline" size="sm" className="text-xs" onClick={() => setAdding(true)}><Plus /> Nova credencial</Button></div>
      )}
      <div className="key-footer"><ShieldCheck /><span>Criptografado neste dispositivo</span></div>
    </aside>
  );
}

const trackers = [
  { name: "Anúncios", count: 5 },
  { name: "Análise e métricas", count: 4 },
  { name: "Redes sociais", count: 2 },
  { name: "Impressão digital", count: 1 },
];

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="setting-row">
      <span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
      <button type="button" role="switch" aria-checked={checked} className={cn("switch", checked && "on")} onClick={() => onChange(!checked)}><i /></button>
    </label>
  );
}

function PrivacyPanel({ shield, setShield, onClose }: { shield: boolean; setShield: (value: boolean) => void; onClose: () => void }) {
  return (
    <aside className="key-panel" aria-label="Rastreadores bloqueados">
      <div className="panel-heading"><div className="panel-title"><span className="ai-mark"><ShieldCheck /></span><div><strong>Proteção de privacidade</strong><small>{shield ? "12 bloqueados nesta página" : "Proteção desativada"}</small></div></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar proteção"><X /></Button></div>
      <Toggle label="Bloquear rastreadores" hint="Neste site" checked={shield} onChange={setShield} />
      <div className="key-domain"><span>Bloqueados por tipo</span></div>
      <div className="credential-list">
        {trackers.map((t) => <div className="credential" key={t.name}><div className="credential-copy"><strong>{t.name}</strong></div><strong className="tracker-count">{shield ? t.count : 0}</strong></div>)}
      </div>
      <div className="key-footer"><ShieldCheck /><span>Números simulados nesta demonstração</span></div>
    </aside>
  );
}

function SettingsPanel({ dark, setDark, aiOpen, setAiOpen, shield, setShield, onReset, onClose }: { dark: boolean; setDark: (value: boolean) => void; aiOpen: boolean; setAiOpen: (value: boolean) => void; shield: boolean; setShield: (value: boolean) => void; onReset: () => void; onClose: () => void }) {
  return (
    <aside className="key-panel" aria-label="Configurações">
      <div className="panel-heading"><div className="panel-title"><span className="key-mark"><MoreHorizontal /></span><div><strong>Configurações</strong><small>Preferências do navegador</small></div></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar configurações"><X /></Button></div>
      <Toggle label="Tema escuro" checked={dark} onChange={setDark} />
      <Toggle label="Agzos AI visível" hint="Barra lateral de IA" checked={aiOpen} onChange={setAiOpen} />
      <Toggle label="Bloquear rastreadores" hint="Em todos os sites" checked={shield} onChange={setShield} />
      <div className="settings-shortcuts">
        <strong>Atalhos</strong>
        <ul>
          <li><kbd>⌘/Ctrl K</kbd> Barra de endereços</li>
          <li><kbd>⌘/Ctrl T</kbd> Nova aba</li>
          <li><kbd>⌘/Ctrl W</kbd> Fechar aba</li>
          <li><kbd>⌘/Ctrl R</kbd> Recarregar</li>
        </ul>
      </div>
      <div className="settings-actions"><Button variant="outline" size="sm" className="text-xs" onClick={onReset}>Restaurar abas iniciais</Button></div>
      <div className="key-footer"><ShieldCheck /><span>Preferências salvas neste dispositivo</span></div>
    </aside>
  );
}
