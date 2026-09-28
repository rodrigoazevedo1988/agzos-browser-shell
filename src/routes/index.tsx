import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  ChevronDown,
  Copy,
  KeyRound,
  LockKeyhole,
  Moon,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

import logoUrl from "@/assets/agzos-logo.svg";
import symbolUrl from "@/assets/agzos-symbol-red.svg";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Tab = { id: number; title: string; url: string; kind: "home" | "page" };

const starterTabs: Tab[] = [{ id: 1, title: "Nova aba", url: "agzos://inicio", kind: "home" }];
const credentials = [
  { domain: "github.com", user: "mrcatofic", password: "agz-Gh8•2mK•93" },
  { domain: "figma.com", user: "design@agzos.com", password: "fg-4Wn•9Kp•17" },
  { domain: "notion.so", user: "equipe@agzos.com", password: "nt-7Ra•5Ls•26" },
];
const quickLinks = [
  { name: "GitHub", short: "GH" },
  { name: "Figma", short: "F" },
  { name: "Notion", short: "N" },
  { name: "Linear", short: "L" },
  { name: "Adicionar", short: "+" },
];

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
  const [address, setAddress] = useState("agzos://inicio");
  const [aiOpen, setAiOpen] = useState(true);
  const [panel, setPanel] = useState<"key" | "privacy" | "settings" | null>(null);
  const keyOpen = panel === "key";
  const setKeyOpen = (value: boolean | ((open: boolean) => boolean)) => setPanel((current) => { const next = typeof value === "function" ? value(current === "key") : value; return next ? "key" : current === "key" ? null : current; });
  const [shield, setShield] = useState(true);
  const [dark, setDark] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [chat, setChat] = useState(["Olá! Posso resumir, explicar ou responder perguntas sobre esta página."]);
  const [loading, setLoading] = useState(false);

  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeId) ?? tabs[0], [activeId, tabs]);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("agzos-theme");
    const savedTabs = window.localStorage.getItem("agzos-tabs");
    if (savedTheme === "dark") setDark(true);
    if (savedTabs) {
      try {
        const parsed = JSON.parse(savedTabs) as Tab[];
        const firstTab = parsed[0];
        if (firstTab) {
          setTabs(parsed);
          setActiveId(firstTab.id);
          setAddress(firstTab.url);
        }
      } catch {
        window.localStorage.removeItem("agzos-tabs");
      }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("agzos-theme", dark ? "dark" : "light");
    window.localStorage.setItem("agzos-tabs", JSON.stringify(tabs));
  }, [dark, tabs]);

  function addTab() {
    const id = Date.now();
    const next = { id, title: "Nova aba", url: "agzos://inicio", kind: "home" as const };
    setTabs((current) => [...current, next]);
    setActiveId(id);
    setAddress(next.url);
  }

  function closeTab(id: number) {
    if (tabs.length === 1) return;
    const index = tabs.findIndex((tab) => tab.id === id);
    const remaining = tabs.filter((tab) => tab.id !== id);
    setTabs(remaining);
    if (activeId === id) {
      const next = remaining[Math.max(0, index - 1)] ?? remaining[0];
      if (next) {
        setActiveId(next.id);
        setAddress(next.url);
      }
    }
  }

  function activateTab(tab: Tab) {
    setActiveId(tab.id);
    setAddress(tab.url);
  }

  function navigate(event: FormEvent) {
    event.preventDefault();
    const input = address.trim();
    if (!input) return;
    const isUrl = input.includes(".") || input.startsWith("http");
    const url = isUrl ? (input.startsWith("http") ? input : `https://${input}`) : `Busca: ${input}`;
    const title = isUrl ? (input.replace(/^https?:\/\//, "").split("/")[0] ?? input) : input;
    setLoading(true);
    window.setTimeout(() => setLoading(false), 550);
    setTabs((current) => current.map((tab) => (tab.id === activeId ? { ...tab, title, url, kind: "page" } : tab)));
    setAddress(url);
  }

  async function copyCredential(domain: string, password: string) {
    try {
      await navigator.clipboard.writeText(password);
    } catch {
      const temporary = document.createElement("textarea");
      temporary.value = password;
      temporary.style.position = "fixed";
      temporary.style.opacity = "0";
      document.body.appendChild(temporary);
      temporary.select();
      document.execCommand("copy");
      temporary.remove();
    }
    setCopied(domain);
    window.setTimeout(() => setCopied(null), 1400);
  }

  function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    setChat((current) => [...current, message, "Esta é uma resposta simulada da Agzos AI para a página atual."]);
    setMessage("");
  }

  return (
    <main className={cn("browser-stage", dark && "dark")}>
      <section className="browser-window" aria-label="Agzos Browser">
        <header className="titlebar">
          <div className="window-controls" aria-label="Controles da janela"><span /><span /><span /></div>
          <div className="tabs" role="tablist" aria-label="Abas abertas">
            {tabs.map((tab) => (
              <button key={tab.id} type="button" role="tab" aria-selected={tab.id === activeId} onClick={() => activateTab(tab)} className={cn("browser-tab", tab.id === activeId && "active")}>
                <img src={symbolUrl} alt="" />
                <span>{tab.title}</span>
                <span className="tab-close" role="button" aria-label={`Fechar ${tab.title}`} onClick={(event) => { event.stopPropagation(); closeTab(tab.id); }}><X /></span>
              </button>
            ))}
            <Button variant="ghost" size="icon" onClick={addTab} title="Nova aba" aria-label="Nova aba" className="new-tab"><Plus /></Button>
          </div>
          <Button variant={panel === "settings" ? "default" : "ghost"} size="icon" title="Configurações" aria-label="Configurações" onClick={() => setPanel((p) => p === "settings" ? null : "settings")}><MoreHorizontal /></Button>
        </header>

        <div className="toolbar">
          <div className="nav-actions">
            <Button variant="ghost" size="icon" title="Voltar" aria-label="Voltar"><ArrowLeft /></Button>
            <Button variant="ghost" size="icon" title="Avançar" aria-label="Avançar"><ArrowRight /></Button>
            <Button variant="ghost" size="icon" title="Recarregar" aria-label="Recarregar" onClick={() => { setLoading(true); window.setTimeout(() => setLoading(false), 500); }}><RefreshCw className={cn(loading && "spin")} /></Button>
          </div>
          <form className="omnibox" onSubmit={navigate}>
            <LockKeyhole aria-hidden="true" />
            <input value={address} onChange={(event) => setAddress(event.target.value)} aria-label="Pesquisar ou digitar endereço" placeholder="Pesquisar ou digitar endereço" />
            <kbd>⌘ K</kbd>
          </form>
          <div className="toolbar-actions">
            <button type="button" className="privacy-pill" onClick={() => setPanel((p) => p === "privacy" ? null : "privacy")} title="Rastreadores bloqueados"><ShieldCheck /><strong>{shield ? 12 : 0}</strong><span>bloqueados</span></button>
            <Button variant={keyOpen ? "default" : "ghost"} size="icon" onClick={() => setKeyOpen((open) => !open)} title="Abrir Agzos Key" aria-label="Abrir Agzos Key"><KeyRound /></Button>
            <Button variant="ghost" size="icon" onClick={() => setDark((current) => !current)} title={dark ? "Usar tema claro" : "Usar tema escuro"} aria-label={dark ? "Usar tema claro" : "Usar tema escuro"}>{dark ? <Sun /> : <Moon />}</Button>
            <Button variant={aiOpen ? "default" : "ghost"} size="icon" onClick={() => setAiOpen((open) => !open)} title="Alternar Agzos AI" aria-label="Alternar Agzos AI"><Sparkles /></Button>
          </div>
        </div>

        <div className="workspace">
          <section className="viewport">
            {loading && <div className="loading-line" />}
            {activeTab?.kind === "home" ? <StartPage onNavigate={(value) => { setAddress(value); window.setTimeout(() => document.querySelector<HTMLInputElement>(".omnibox input")?.focus(), 0); }} /> : <MockPage title={activeTab?.title ?? "Resultado"} address={activeTab?.url ?? address} />}
          </section>
          {aiOpen && <AiSidebar chat={chat} message={message} setMessage={setMessage} onSubmit={sendMessage} onClose={() => setAiOpen(false)} />}
        </div>

        {panel === "privacy" && <PrivacyPanel shield={shield} setShield={setShield} onClose={() => setPanel(null)} />}
        {panel === "settings" && <SettingsPanel dark={dark} setDark={setDark} aiOpen={aiOpen} setAiOpen={setAiOpen} shield={shield} setShield={setShield} onReset={() => { setTabs(starterTabs); setActiveId(1); setAddress("agzos://inicio"); }} onClose={() => setPanel(null)} />}
        {keyOpen && <KeyPanel copied={copied} onCopy={copyCredential} onClose={() => setKeyOpen(false)} />}
      </section>
    </main>
  );
}

function StartPage({ onNavigate }: { onNavigate: (value: string) => void }) {
  return (
    <div className="start-page">
      <div className="start-content">
        <img className="brand-logo" src={logoUrl} alt="Agzos" />
        <p className="brand-tagline">Navegue com clareza. Decida com controle.</p>
        <button type="button" className="start-search" onClick={() => onNavigate("")}>
          <span>Pesquisar na web</span><span className="search-key">⌘ K</span>
        </button>
        <div className="quick-links">
          {quickLinks.map((link) => <button key={link.name} type="button" onClick={() => onNavigate(link.name.toLowerCase() + ".com")}><span>{link.short}</span><small>{link.name}</small></button>)}
        </div>
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

function KeyPanel({ copied, onCopy, onClose }: { copied: string | null; onCopy: (domain: string, password: string) => void; onClose: () => void }) {
  return (
    <aside className="key-panel" aria-label="Agzos Key">
      <div className="panel-heading"><div className="panel-title"><span className="key-mark"><KeyRound /></span><div><strong>Agzos Key</strong><small>Cofre local</small></div></div><Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar cofre"><X /></Button></div>
      <div className="key-domain"><span>Credenciais salvas</span><ChevronDown /></div>
      <div className="credential-list">
        {credentials.map((item) => <div className="credential" key={item.domain}><div className="domain-icon">{item.domain.charAt(0).toUpperCase()}</div><div className="credential-copy"><strong>{item.domain}</strong><span>{item.user}</span></div><Button variant="ghost" size="icon" onClick={() => onCopy(item.domain, item.password)} title={`Copiar senha de ${item.domain}`} aria-label={`Copiar senha de ${item.domain}`}>{copied === item.domain ? <Check /> : <Copy />}</Button></div>)}
      </div>
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
      <div className="settings-actions"><Button variant="outline" size="sm" className="text-xs" onClick={onReset}>Restaurar abas iniciais</Button></div>
      <div className="key-footer"><ShieldCheck /><span>Preferências salvas neste dispositivo</span></div>
    </aside>
  );
}
