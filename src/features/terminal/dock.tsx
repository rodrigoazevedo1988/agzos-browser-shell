import "@xterm/xterm/css/xterm.css";

import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { ChevronDown, Plus, SquareTerminal, X } from "lucide-react";
import { type KeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { DesktopBridge, TerminalShell } from "@/features/browser/desktop";
import { cn } from "@/lib/utils";
import {
  TERMINAL_HEIGHT,
  clampTerminalHeight,
  clipboardKey,
  sessionTitle,
  terminalHeightLimit,
} from "./model";

type Session = { id: number; shell: string; label: string; cwd: string };
type Live = { term: Terminal; fit: FitAddon; host: HTMLDivElement };

const THEME = {
  background: "#0e0e0e",
  foreground: "#e8e6e3",
  cursor: "#d43420",
  selectionBackground: "#d4342055",
};

function platformOf(isMac: boolean): "mac" | "windows" | "linux" {
  if (isMac) return "mac";
  return typeof navigator !== "undefined" && /win/i.test(navigator.platform) ? "windows" : "linux";
}

/**
 * Terminal (4.0): painel embaixo da página com abas de sessão. Cada aba é um shell de
 * verdade num PTY do main; aqui só o xterm.js desenha e manda as teclas. Escondido, o
 * painel continua montado (os shells e o histórico da tela seguem vivos).
 */
export function TerminalDock({
  desktop,
  hidden,
  height,
  onHeight,
  defaultShell,
  defaultCwd,
  isMac,
  onClose,
}: {
  desktop: DesktopBridge;
  hidden: boolean;
  height: number;
  onHeight: (height: number) => void;
  defaultShell: string;
  defaultCwd: string;
  isMac: boolean;
  onClose: () => void;
}) {
  const [shells, setShells] = useState<TerminalShell[] | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const live = useRef(new Map<number, Live>());
  // Saída que chega antes de o xterm da sessão existir.
  const pending = useRef(new Map<number, string>());
  const bodyRef = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  // A lista só é regravada depois que as sessões lembradas reabriram.
  const [ready, setReady] = useState(false);
  const platform = platformOf(isMac);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  async function openSession(shell: string, cwd: string) {
    const result = await desktop.terminalOpen({ shell, cwd, cols: 80, rows: 24 });
    if (!result.ok) {
      setUnavailable(
        result.error === "limit"
          ? "Limite de sessões abertas nesta janela."
          : "Não foi possível abrir o shell.",
      );
      return;
    }
    setSessions((list) => [
      ...list,
      { id: result.id, shell: result.shell, label: result.label, cwd: result.cwd },
    ]);
    setActive(result.id);
  }

  // Primeira abertura: as sessões lembradas (na última pasta) ou uma nova no padrão.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    void (async () => {
      const info = await desktop.terminalAvailable();
      setShells(info.shells);
      if (!info.ok) {
        setUnavailable("O terminal não está disponível neste sistema (node-pty não carregou).");
        return;
      }
      const saved = await desktop.terminalSaved();
      const list = saved.length ? saved : [{ shell: defaultShell, cwd: defaultCwd }];
      for (const item of list) await openSession(item.shell, item.cwd || defaultCwd);
      setReady(true);
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
    // Shell encerrado (exit): a aba sai; sem nenhuma, o painel fecha.
    const offExit = desktop.onTerminalExit(({ id }) => {
      live.current.get(id)?.term.dispose();
      live.current.delete(id);
      pending.current.delete(id);
      setSessions((list) => {
        const next = list.filter((item) => item.id !== id);
        if (!next.length && list.length) setTimeout(() => closeRef.current(), 0);
        return next;
      });
    });
    return () => {
      offData();
      offCwd();
      offExit();
    };
  }, [desktop]);

  // Lista lembrada para o próximo início (shell e última pasta de cada aba).
  const savedKey = JSON.stringify(sessions.map(({ shell, cwd }) => ({ shell, cwd })));
  useEffect(() => {
    if (ready) void desktop.terminalSave(JSON.parse(savedKey));
  }, [desktop, savedKey, ready]);

  useEffect(() => {
    if (active !== null && !sessions.some((item) => item.id === active)) {
      setActive(sessions[sessions.length - 1]?.id ?? null);
    }
  }, [sessions, active]);

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
  }, [active, hidden]);

  // Encerrar o painel de vez (o componente sai): mata os shells desta janela.
  useEffect(
    () => () => {
      for (const [id, entry] of live.current) {
        entry.term.dispose();
        void desktop.terminalKill(id);
      }
      live.current.clear();
      void desktop.terminalFocus(false);
    },
    [desktop],
  );

  /** Cria o xterm da sessão quando a área dela aparece no DOM. */
  function attach(session: Session, host: HTMLDivElement | null) {
    if (!host || live.current.has(session.id)) return;
    void (async () => {
      const [{ Terminal: XTerm }, { FitAddon: Fit }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (live.current.has(session.id)) return;
      const term = new XTerm({
        fontFamily: 'ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace',
        fontSize: 13,
        cursorBlink: true,
        allowProposedApi: false,
        scrollback: 5000,
        theme: THEME,
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
        const action = clipboardKey(event, platform, term.hasSelection());
        if (action === "copy") {
          void desktop.clipboardWrite(term.getSelection());
          term.clearSelection();
          return false;
        }
        if (action === "paste") {
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

  function closeSession(id: number) {
    live.current.get(id)?.term.dispose();
    live.current.delete(id);
    void desktop.terminalKill(id);
    setSessions((list) => {
      const next = list.filter((item) => item.id !== id);
      if (!next.length) setTimeout(() => closeRef.current(), 0);
      return next;
    });
  }

  // Alça: arrasta para cima/baixo. Por cima da página quem segue o cursor é o main.
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const bottom = handle.parentElement!.getBoundingClientRect().bottom;
    const max = terminalHeightLimit(bottom);
    handle.setPointerCapture(event.pointerId);
    let latest = height;
    const apply = (y: number) => {
      latest = Math.min(max, clampTerminalHeight(bottom - y));
      setDragHeight(latest);
    };
    let finished = false;
    let offDrag = () => {};
    const move = (moveEvent: globalThis.PointerEvent) => apply(moveEvent.clientY);
    const up = () => {
      if (finished) return;
      finished = true;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      offDrag();
      void desktop.sidePanelDrag(false);
      setDragHeight(null);
      onHeight(latest);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
    offDrag = desktop.onSidePanelDrag(({ y, done }) => {
      if (done) up();
      else if (typeof y === "number") apply(y);
    });
    void desktop.sidePanelDrag(true);
  };
  const keyResize = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowUp" ? 24 : event.key === "ArrowDown" ? -24 : 0;
    if (!step) return;
    event.preventDefault();
    onHeight(clampTerminalHeight(height + step));
  };

  const shown = dragHeight ?? height;
  return (
    <section
      className="terminal-dock"
      style={{ height: shown }}
      hidden={hidden}
      aria-label="Terminal"
    >
      <div
        className="terminal-resize"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Altura do terminal"
        aria-valuemin={TERMINAL_HEIGHT.min}
        aria-valuemax={TERMINAL_HEIGHT.max}
        aria-valuenow={shown}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={keyResize}
      />
      <header className="terminal-head">
        <SquareTerminal className="terminal-icon" />
        <div className="terminal-tabs" role="tablist" aria-label="Sessões do terminal">
          {sessions.map((session) => (
            <div
              key={session.id}
              className={cn("terminal-tab", session.id === active && "active")}
              role="tab"
              aria-selected={session.id === active}
              tabIndex={0}
              title={session.cwd}
              onClick={() => setActive(session.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") setActive(session.id);
              }}
            >
              <span>{sessionTitle(session.label, session.cwd)}</span>
              <button
                type="button"
                aria-label={`Fechar ${sessionTitle(session.label, session.cwd)}`}
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
        <div className="terminal-actions">
          <Button
            variant="ghost"
            size="icon"
            title="Nova sessão"
            aria-label="Nova sessão do terminal"
            disabled={!shells || Boolean(unavailable && !sessions.length)}
            onClick={() => void openSession(defaultShell, defaultCwd)}
          >
            <Plus />
          </Button>
          {shells && shells.length > 1 && (
            <div className="terminal-shell-menu">
              <Button
                variant="ghost"
                size="icon"
                title="Escolher o shell"
                aria-label="Escolher o shell da nova sessão"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <ChevronDown />
              </Button>
              {menuOpen && (
                <ul role="menu">
                  {shells.map((shell) => (
                    <li key={shell.id}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          void openSession(shell.id, defaultCwd);
                        }}
                      >
                        {shell.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            title="Esconder o terminal (as sessões continuam)"
            aria-label="Esconder o terminal"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </header>
      <div className="terminal-body" ref={bodyRef}>
        {unavailable && <p className="terminal-message">{unavailable}</p>}
        {sessions.map((session) => (
          <div
            key={session.id}
            className="terminal-screen"
            hidden={session.id !== active}
            ref={(host) => attach(session, host)}
          />
        ))}
      </div>
    </section>
  );
}
