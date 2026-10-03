import "@xterm/xterm/css/xterm.css";

import type { FitAddon } from "@xterm/addon-fit";
import type { ITheme, Terminal } from "@xterm/xterm";
import {
  Bot,
  Download,
  FolderTree,
  Loader2,
  Mic,
  PanelBottom,
  PanelRight,
  PictureInPicture2,
  Plus,
  Rocket,
  Server,
  Sparkles,
  Square,
  SquareTerminal,
  TerminalSquare,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { DesktopBridge, SshConnection, TerminalShell } from "@/features/browser/desktop";
import { cn } from "@/lib/utils";
import {
  FONT_SIZE,
  fontStack,
  shortcutText,
  terminalAction,
  type TerminalAction,
  type TerminalDockMode,
  type TerminalSettings,
} from "./config";
import { AgentCanvas } from "./agent-canvas";
import { cdCommand, clipboardKey, quotePath, sessionTitle } from "./model";
import { CliSetup } from "./setup";
import { TerminalSidePanel, type SideMode } from "./side-panel";
import { useVoice } from "./voice";

type Session = {
  id: number;
  shell: string;
  label: string;
  cwd: string;
  ssh: boolean;
  /** Nome dado pelo usuário (4.1.1). */
  title: string | null;
};
type Live = { term: Terminal; fit: FitAddon; host: HTMLDivElement };

function platformOf(isMac: boolean): "mac" | "windows" | "linux" {
  if (isMac) return "mac";
  return typeof navigator !== "undefined" && /win/i.test(navigator.platform) ? "windows" : "linux";
}

function themeOf(settings: TerminalSettings): ITheme {
  const { background, foreground, cursor } = settings.theme;
  return {
    background,
    foreground,
    cursor,
    cursorAccent: background,
    selectionBackground: `${cursor}55`,
  };
}

const DOCK_LABELS: Record<TerminalDockMode, string> = {
  bottom: "Embaixo da página",
  right: "À direita da página",
  window: "Janela flutuante (PiP)",
};

/**
 * Terminal (4.0/4.1): abas de sessão, cada uma um shell (ou ssh) num PTY do main. O mesmo
 * componente serve embaixo, à direita e na janela flutuante: ao montar, ele pega as
 * sessões vivas da janela com a saída recente, então trocar de lugar não perde nada.
 */
export function TerminalView({
  desktop,
  settings,
  defaultShell,
  defaultCwd,
  isMac,
  mode,
  hidden = false,
  onHide,
  onDock,
  onSettings,
}: {
  desktop: DesktopBridge;
  settings: TerminalSettings;
  defaultShell: string;
  defaultCwd: string;
  isMac: boolean;
  mode: TerminalDockMode;
  hidden?: boolean;
  onHide: () => void;
  onDock: (mode: TerminalDockMode) => void;
  onSettings: (patch: Partial<TerminalSettings>) => void;
}) {
  const [shells, setShells] = useState<TerminalShell[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [launcher, setLauncher] = useState(false);
  const [tools, setTools] = useState<Record<string, boolean>>({});
  // 4.1.1: aba sendo renomeada, painel lateral, modo agente e preparação das CLIs.
  const [editing, setEditing] = useState<{ id: number; value: string } | null>(null);
  const [side, setSide] = useState<SideMode | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentMounted, setAgentMounted] = useState(false);
  const [setup, setSetup] = useState<"first" | "manual" | null>(null);
  const live = useRef(new Map<number, Live>());
  // Saída que chega antes de o xterm da sessão existir (inclui a saída recente).
  const pending = useRef(new Map<number, string>());
  const bodyRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const [ready, setReady] = useState(false);
  const platform = platformOf(isMac);
  const hideRef = useRef(onHide);
  hideRef.current = onHide;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  function addSession(session: Session, history = "", focus = true) {
    if (history) pending.current.set(session.id, history + (pending.current.get(session.id) ?? ""));
    setSessions((list) =>
      list.some((item) => item.id === session.id) ? list : [...list, session],
    );
    if (focus) setActive(session.id);
  }

  async function openSession(shell: string, cwd: string) {
    const result = await desktop.terminalOpen({ shell, cwd, cols: 80, rows: 24 });
    if (!result.ok) {
      setUnavailable(
        result.error === "limit"
          ? "Limite de sessões abertas nesta janela."
          : "Não foi possível abrir o shell.",
      );
      return null;
    }
    addSession({
      id: result.id,
      shell: result.shell,
      label: result.label,
      cwd: result.cwd,
      ssh: false,
      title: null,
    });
    return result.id;
  }

  async function openSsh(connection: SshConnection) {
    const result = await desktop.terminalOpenSsh(connection, 80, 24);
    if (!result.ok) {
      setUnavailable(
        result.error === "no-ssh"
          ? "O ssh não foi encontrado neste sistema."
          : "Não foi possível abrir a conexão SSH.",
      );
      return;
    }
    addSession({
      id: result.id,
      shell: "ssh",
      label: result.label,
      cwd: result.cwd,
      ssh: true,
      title: null,
    });
  }

  /** CLIs de IA escolhidas: aba nova que instala e põe no PATH. */
  async function installTools(ids: string[]) {
    setSetup(null);
    if (settingsRef.current.cliSetup !== "done") onSettings({ cliSetup: "done" });
    const result = await desktop.terminalInstallTools(ids, 100, 28);
    if (!result.ok) {
      setUnavailable("Não foi possível abrir a instalação das CLIs.");
      return;
    }
    addSession({
      id: result.id,
      shell: result.shell,
      label: result.label,
      cwd: result.cwd,
      ssh: false,
      title: null,
    });
  }

  function commitRename() {
    if (!editing) return;
    const title = editing.value.trim().slice(0, 60);
    setSessions((list) =>
      list.map((item) => (item.id === editing.id ? { ...item, title: title || null } : item)),
    );
    void desktop.terminalRename(editing.id, title);
    setEditing(null);
    live.current.get(editing.id)?.term.focus();
  }

  const activeSession = sessions.find((item) => item.id === active) ?? null;
  const canType = Boolean(activeSession && !activeSession.ssh && activeSession.shell !== "program");

  /** Texto no prompt da sessão ativa (modo ls, snippets, skills). */
  function typeText(text: string, run: boolean) {
    if (active === null) return;
    desktop.terminalWrite(active, run ? `${text}\r` : text);
    live.current.get(active)?.term.focus();
  }

  function cdTo(dir: string) {
    if (!activeSession) return;
    const command = cdCommand(activeSession.shell, dir);
    if (command) desktop.terminalWrite(activeSession.id, command);
  }

  function toggleAgent() {
    setAgentMounted(true);
    setAgentOpen((open) => !open);
  }

  /** Ferramenta de IA: sessão nova no shell padrão com o comando digitado (você pediu). */
  async function launchTool(command: string) {
    const id = await openSession(defaultShell, defaultCwd);
    if (id !== null) desktop.terminalWrite(id, `${command}\r`);
  }

  function runSnippet(command: string, run: boolean) {
    if (active === null) return;
    desktop.terminalWrite(active, run ? `${command}\r` : command);
    live.current.get(active)?.term.focus();
  }

  // Montagem: as sessões vivas (com a saída recente); sem nenhuma, as lembradas na última
  // pasta ou uma nova no padrão.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      const info = await desktop.terminalAvailable();
      setShells(info.shells);
      if (!info.ok) {
        setUnavailable("O terminal não está disponível neste sistema (node-pty não carregou).");
        return;
      }
      const alive = await desktop.terminalList();
      if (alive.length) {
        for (const item of alive) {
          addSession(
            {
              id: item.id,
              shell: item.shell,
              label: item.label,
              cwd: item.cwd,
              ssh: item.shell === "ssh",
              title: item.title ?? null,
            },
            item.history,
          );
        }
      } else {
        const saved = await desktop.terminalSaved();
        const list = saved.length ? saved : [{ shell: defaultShell, cwd: defaultCwd }];
        for (const item of list) await openSession(item.shell, item.cwd || defaultCwd);
      }
      setReady(true);
      // 4.1.1: primeira abertura do terminal → preparar as CLIs de IA.
      if (settingsRef.current.cliSetup === "pending") setSetup("first");
    })();
    // Só na montagem: depois disso as sessões são do usuário.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const offData = desktop.onTerminalData(({ id, data }) => {
      const entry = live.current.get(id);
      if (entry) entry.term.write(data);
      else pending.current.set(id, (pending.current.get(id) ?? "") + data);
    });
    const offCwd = desktop.onTerminalCwd(({ id, cwd }) =>
      setSessions((list) => list.map((item) => (item.id === id ? { ...item, cwd } : item))),
    );
    // Renomeada em outra vista (terminal flutuante ↔ janela).
    const offTitle = desktop.onTerminalTitle(({ id, title }) =>
      setSessions((list) =>
        list.map((item) => (item.id === id ? { ...item, title: title || null } : item)),
      ),
    );
    // Shell encerrado (exit): a aba sai; sem nenhuma, o terminal esconde.
    const offExit = desktop.onTerminalExit(({ id }) => {
      live.current.get(id)?.term.dispose();
      live.current.delete(id);
      pending.current.delete(id);
      setSessions((list) => {
        const next = list.filter((item) => item.id !== id);
        if (!next.length && list.length) setTimeout(() => hideRef.current(), 0);
        return next;
      });
    });
    return () => {
      offData();
      offCwd();
      offTitle();
      offExit();
    };
  }, [desktop]);

  // Lista lembrada para o próximo início (só shells; SSH não volta sozinho).
  const savedKey = JSON.stringify(
    sessions.filter((item) => !item.ssh).map(({ shell, cwd }) => ({ shell, cwd })),
  );
  useEffect(() => {
    if (ready) void desktop.terminalSave(JSON.parse(savedKey));
  }, [desktop, savedKey, ready]);

  useEffect(() => {
    if (active !== null && !sessions.some((item) => item.id === active)) {
      setActive(sessions[sessions.length - 1]?.id ?? null);
    }
  }, [sessions, active]);

  // Ferramentas de IA instaladas (PATH do app) para o lançador.
  const toolKey = settings.tools.map((tool) => tool.command).join("\n");
  useEffect(() => {
    if (!launcher) return;
    void desktop.terminalTools(toolKey.split("\n").filter(Boolean)).then(setTools);
  }, [desktop, launcher, toolKey]);

  /** Ajusta colunas/linhas ao tamanho do painel e avisa o PTY. */
  function fitActive() {
    if (active === null || hidden) return;
    const entry = live.current.get(active);
    if (!entry || !entry.host.offsetWidth) return;
    try {
      entry.fit.fit();
    } catch {
      return;
    }
    void desktop.terminalResize(active, entry.term.cols, entry.term.rows);
  }
  const fitRef = useRef(fitActive);
  fitRef.current = fitActive;

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const observer = new ResizeObserver(() => fitRef.current());
    observer.observe(body);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    fitRef.current();
    if (!hidden && active !== null) live.current.get(active)?.term.focus();
  }, [active, hidden, mode]);

  // Tema, fonte e cursor valem na hora em todas as sessões.
  const look = JSON.stringify([
    settings.theme,
    settings.fontFamily,
    settings.fontSize,
    settings.cursor,
  ]);
  useEffect(() => {
    for (const entry of live.current.values()) {
      entry.term.options.theme = themeOf(settingsRef.current);
      entry.term.options.fontFamily = fontStack(settingsRef.current.fontFamily);
      entry.term.options.fontSize = settingsRef.current.fontSize;
      entry.term.options.cursorStyle = settingsRef.current.cursor;
    }
    fitRef.current();
  }, [look]);

  // Sair da tela (troca de lugar, janela fechando) não encerra os shells: eles são do main.
  useEffect(
    () => () => {
      for (const entry of live.current.values()) entry.term.dispose();
      live.current.clear();
      void desktop.terminalFocus(false);
    },
    [desktop],
  );

  const voice = useVoice(desktop, settings.voice.language, (text) => {
    if (active === null) return;
    live.current.get(active)?.term.paste(text);
    if (settingsRef.current.voice.enter) desktop.terminalWrite(active, "\r");
    live.current.get(active)?.term.focus();
  });

  function closeSession(id: number) {
    live.current.get(id)?.term.dispose();
    live.current.delete(id);
    void desktop.terminalKill(id);
    setSessions((list) => {
      const next = list.filter((item) => item.id !== id);
      if (!next.length) setTimeout(() => hideRef.current(), 0);
      return next;
    });
  }

  /** Atalhos com o foco no terminal (ver TERMINAL_SHORTCUTS). */
  function runAction(action: TerminalAction) {
    const index = sessions.findIndex((item) => item.id === active);
    const size = settingsRef.current.fontSize;
    switch (action) {
      case "new":
        void openSession(defaultShell, defaultCwd);
        return;
      case "close":
        if (active !== null) closeSession(active);
        return;
      case "next":
      case "previous": {
        if (!sessions.length) return;
        const step = action === "next" ? 1 : -1;
        setActive(sessions[(index + step + sessions.length) % sessions.length]!.id);
        return;
      }
      case "voice":
        voice.toggle();
        return;
      case "launcher":
        setLauncher((open) => !open);
        return;
      case "font-up":
        onSettings({ fontSize: Math.min(FONT_SIZE.max, size + 1) });
        return;
      case "font-down":
        onSettings({ fontSize: Math.max(FONT_SIZE.min, size - 1) });
        return;
      case "font-reset":
        onSettings({ fontSize: FONT_SIZE.initial });
        return;
      case "rename": {
        const session = sessions.find((item) => item.id === active);
        if (session) setEditing({ id: session.id, value: session.title ?? titleOf(session) });
        return;
      }
      case "files":
        setSide((current) => (current === "files" ? null : "files"));
        return;
      case "agent":
        toggleAgent();
    }
  }
  const actionRef = useRef(runAction);
  actionRef.current = runAction;

  /** Cria o xterm da sessão quando a área dela aparece no DOM. */
  function attach(session: Session, host: HTMLDivElement | null) {
    if (!host || live.current.has(session.id)) return;
    void (async () => {
      const [{ Terminal: XTerm }, { FitAddon: Fit }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (live.current.has(session.id)) return;
      const current = settingsRef.current;
      const term = new XTerm({
        fontFamily: fontStack(current.fontFamily),
        fontSize: current.fontSize,
        cursorStyle: current.cursor,
        cursorBlink: true,
        allowProposedApi: false,
        scrollback: 5000,
        theme: themeOf(current),
        // Windows (ConPTY) reflui as linhas no resize sozinho.
        ...(platform === "windows" ? { windowsPty: { backend: "conpty" as const } } : {}),
      });
      const fit = new Fit();
      term.loadAddon(fit);
      term.open(host);
      live.current.set(session.id, { term, fit, host });
      term.onData((data) => desktop.terminalWrite(session.id, data));
      term.attachCustomKeyEventHandler((event) => {
        if (event.type !== "keydown") return true;
        const action = terminalAction(event, isMac);
        if (action) {
          event.preventDefault();
          actionRef.current(action);
          return false;
        }
        const clip = clipboardKey(event, platform, term.hasSelection());
        if (clip === "copy") {
          void desktop.clipboardWrite(term.getSelection());
          term.clearSelection();
          return false;
        }
        if (clip === "paste") {
          event.preventDefault();
          void desktop.clipboardRead().then((text) => text && term.paste(text));
          return false;
        }
        return true;
      });
      term.textarea?.addEventListener("focus", () => void desktop.terminalFocus(true));
      term.textarea?.addEventListener("blur", () => void desktop.terminalFocus(false));
      const early = pending.current.get(session.id);
      if (early) term.write(early);
      pending.current.delete(session.id);
      fitRef.current();
      term.focus();
    })();
  }

  const recording = voice.state.status === "recording";
  const enabledTools = settings.tools.filter((tool) => tool.on);
  function titleOf(session: Session) {
    if (session.title) return session.title;
    return session.ssh || session.shell === "program"
      ? session.label
      : sessionTitle(session.label, session.cwd);
  }

  return (
    <div
      className="terminal-view"
      data-mode={mode}
      style={{ background: settings.theme.background, color: settings.theme.foreground }}
    >
      <header className="terminal-head">
        <SquareTerminal className="terminal-icon" />
        <div className="terminal-tabs" role="tablist" aria-label="Sessões do terminal">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={cn(
                "terminal-tab",
                session.id === active && "active",
                session.ssh && "ssh",
              )}
              role="tab"
              aria-selected={session.id === active}
              tabIndex={0}
              title={session.ssh ? session.label : session.cwd}
              onClick={() => setActive(session.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") setActive(session.id);
                if (event.key === "F2") setEditing({ id: session.id, value: titleOf(session) });
              }}
            >
              {session.ssh && <Server className="terminal-tab-icon" />}
              {editing?.id === session.id ? (
                <input
                  className="terminal-tab-input"
                  value={editing.value}
                  autoFocus
                  aria-label="Nome da aba"
                  maxLength={60}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => setEditing({ id: session.id, value: event.target.value })}
                  onBlur={commitRename}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter") commitRename();
                    if (event.key === "Escape") {
                      setEditing(null);
                      live.current.get(session.id)?.term.focus();
                    }
                  }}
                />
              ) : (
                <span
                  title="Duplo clique (ou F2) para renomear"
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    setEditing({ id: session.id, value: titleOf(session) });
                  }}
                >
                  {titleOf(session)}
                </span>
              )}
              <button
                type="button"
                aria-label={`Fechar ${titleOf(session)}`}
                onClick={(event) => {
                  event.stopPropagation();
                  closeSession(session.id);
                }}
              >
                <X />
              </button>
            </div>
          ))}
        </div>
        {voice.state.status === "recording" && (
          <span className="terminal-voice-status recording" role="status">
            ● Gravando
          </span>
        )}
        {voice.state.status === "transcribing" && (
          <span className="terminal-voice-status" role="status">
            <Loader2 className="spin" /> Transcrevendo…
          </span>
        )}
        <div className="terminal-actions">
          <Button
            variant="ghost"
            size="icon"
            title={`Nova sessão (${shortcutText("Ctrl+Shift+E", isMac)})`}
            aria-label="Nova sessão do terminal"
            disabled={!shells || Boolean(unavailable && !sessions.length)}
            onClick={() => void openSession(defaultShell, defaultCwd)}
          >
            <Plus />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title={`Lançador: IA, SSH e comandos rápidos (${shortcutText("Ctrl+Shift+K", isMac)})`}
            aria-label="Abrir o lançador do terminal"
            aria-expanded={launcher}
            onClick={() => setLauncher((open) => !open)}
          >
            <Rocket />
          </Button>
          {(
            [
              [
                "files",
                FolderTree,
                `Arquivos — modo ls lateral (${shortcutText("Ctrl+Shift+O", isMac)})`,
              ],
              ["snippets", Zap, "Snippets (comandos rápidos)"],
              ["skills", Sparkles, "Skills das CLIs de IA"],
            ] as const
          ).map(([item, Icon, label]) => (
            <Button
              key={item}
              variant="ghost"
              size="icon"
              title={label}
              aria-label={label}
              aria-pressed={side === item}
              className={cn(side === item && "terminal-dock-on")}
              onClick={() => setSide((current) => (current === item ? null : item))}
            >
              <Icon />
            </Button>
          ))}
          <Button
            variant="ghost"
            size="icon"
            title={`Modo agente — canvas com multiagentes (${shortcutText("Ctrl+Shift+G", isMac)})`}
            aria-label="Modo agente"
            aria-pressed={agentOpen}
            className={cn(agentOpen && "terminal-dock-on")}
            onClick={toggleAgent}
          >
            <Workflow />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={cn(recording && "terminal-mic-on")}
            title={`Modo voz (${shortcutText("Ctrl+Shift+M", isMac)})`}
            aria-label={
              recording ? "Parar a gravação e transcrever" : "Falar um comando (modo voz)"
            }
            aria-pressed={recording}
            disabled={voice.state.status === "transcribing" || active === null}
            onClick={voice.toggle}
          >
            {recording ? <Square /> : <Mic />}
          </Button>
          <span className="terminal-divider" aria-hidden="true" />
          {(["bottom", "right", "window"] as const).map((item) => {
            const Icon =
              item === "bottom" ? PanelBottom : item === "right" ? PanelRight : PictureInPicture2;
            return (
              <Button
                key={item}
                variant="ghost"
                size="icon"
                title={DOCK_LABELS[item]}
                aria-label={`Terminal: ${DOCK_LABELS[item]}`}
                aria-pressed={mode === item}
                className={cn(mode === item && "terminal-dock-on")}
                onClick={() => mode !== item && onDock(item)}
              >
                <Icon />
              </Button>
            );
          })}
          <Button
            variant="ghost"
            size="icon"
            title="Esconder o terminal (as sessões continuam)"
            aria-label="Esconder o terminal"
            onClick={onHide}
          >
            <X />
          </Button>
        </div>
      </header>
      <div className="terminal-body">
        {side && (
          <TerminalSidePanel
            mode={side}
            desktop={desktop}
            settings={settings}
            cwd={activeSession?.cwd || defaultCwd}
            canType={canType}
            quote={(file) => quotePath(activeSession?.shell ?? "", file)}
            onSettings={onSettings}
            onCd={cdTo}
            onType={typeText}
            onClose={() => setSide(null)}
          />
        )}
        <div className="terminal-screens" ref={bodyRef}>
          {unavailable && <p className="terminal-message">{unavailable}</p>}
          {voice.state.status === "error" && (
            <p className="terminal-message terminal-voice-error" role="alert">
              {voice.state.message}{" "}
              <button type="button" className="link-button" onClick={voice.dismiss}>
                Fechar
              </button>
            </p>
          )}
          {sessions.map((session) => (
            <div
              key={session.id}
              className="terminal-screen"
              hidden={session.id !== active}
              ref={(host) => attach(session, host)}
            />
          ))}
          {launcher && (
            <div
              className="terminal-launcher"
              role="dialog"
              aria-label="Lançador do terminal"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setLauncher(false);
                  if (active !== null) live.current.get(active)?.term.focus();
                }
              }}
            >
              <section>
                <h3>
                  <TerminalSquare /> Shells
                </h3>
                {(shells ?? []).map((shell) => (
                  <button
                    key={shell.id}
                    type="button"
                    onClick={() => {
                      setLauncher(false);
                      void openSession(shell.id, defaultCwd);
                    }}
                  >
                    {shell.label}
                  </button>
                ))}
              </section>
              {enabledTools.length > 0 && (
                <section>
                  <h3>
                    <Bot /> Ferramentas de IA
                  </h3>
                  {enabledTools.map((tool) => {
                    const name = tool.command.split(/\s+/)[0]!;
                    const found = tools[name];
                    return (
                      <button
                        key={tool.id}
                        type="button"
                        title={tool.command}
                        onClick={() => {
                          setLauncher(false);
                          void launchTool(tool.command);
                        }}
                      >
                        {tool.name}
                        <small>{found === false ? "não encontrado no PATH" : tool.command}</small>
                      </button>
                    );
                  })}
                </section>
              )}
              {settings.ssh.length > 0 && (
                <section>
                  <h3>
                    <Server /> SSH
                  </h3>
                  {settings.ssh.map((connection) => (
                    <button
                      key={connection.id}
                      type="button"
                      onClick={() => {
                        setLauncher(false);
                        void openSsh(connection);
                      }}
                    >
                      {connection.name || connection.host}
                      <small>
                        {connection.user ? `${connection.user}@` : ""}
                        {connection.host}
                        {connection.port !== 22 ? `:${connection.port}` : ""}
                      </small>
                    </button>
                  ))}
                </section>
              )}
              {settings.snippets.length > 0 && (
                <section>
                  <h3>
                    <Zap /> Comandos rápidos
                  </h3>
                  {settings.snippets.map((snippet) => (
                    <button
                      key={snippet.id}
                      type="button"
                      title={snippet.command}
                      disabled={active === null}
                      onClick={() => {
                        setLauncher(false);
                        runSnippet(snippet.command, snippet.run);
                      }}
                    >
                      {snippet.name}
                      <small>{snippet.run ? "executa" : "só digita"}</small>
                    </button>
                  ))}
                </section>
              )}
              <section>
                <button
                  type="button"
                  onClick={() => {
                    setLauncher(false);
                    setSetup("manual");
                  }}
                >
                  <span>
                    <Download className="terminal-inline-icon" /> Instalar CLIs de IA
                  </span>
                  <small>claude, codex, kiro-cli, opencode…</small>
                </button>
              </section>
              <p className="terminal-launcher-hint">
                Edite as listas em Configurações → Terminal avançado.
              </p>
            </div>
          )}
          {setup && (
            <CliSetup
              desktop={desktop}
              first={setup === "first"}
              onInstall={(ids) => void installTools(ids)}
              onClose={() => {
                setSetup(null);
                if (settingsRef.current.cliSetup !== "done") onSettings({ cliSetup: "done" });
                // O foco volta para o prompt (o cartão não pode engolir a digitação).
                if (active !== null) live.current.get(active)?.term.focus();
              }}
            />
          )}
        </div>
        {agentMounted && (
          <AgentCanvas
            desktop={desktop}
            graph={settings.agent}
            cwd={activeSession?.cwd || defaultCwd}
            hidden={!agentOpen}
            onGraph={(agent) => onSettings({ agent })}
            onSession={(result, title) =>
              addSession(
                {
                  id: result.id,
                  shell: result.shell,
                  label: result.label,
                  cwd: result.cwd,
                  ssh: false,
                  title: `⚙ ${title}`,
                },
                "",
                false,
              )
            }
            onFocusSession={(id) => {
              setAgentOpen(false);
              setActive(id);
            }}
            onClose={() => setAgentOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
