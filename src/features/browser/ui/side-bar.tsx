import {
  Bot,
  ExternalLink,
  Gamepad2,
  Instagram,
  Mail,
  MessageCircle,
  MessagesSquare,
  Plus,
  RefreshCw,
  Send,
  Twitter,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, type CSSProperties, type PointerEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { DesktopBridge } from "../desktop";
import { SIDE_PANEL_WIDTH, clampPanelWidth, type SidePanelApp } from "../side-panels";

const ICONS: Record<string, LucideIcon> = {
  whatsapp: MessageCircle,
  telegram: Send,
  messenger: MessagesSquare,
  instagram: Instagram,
  discord: Gamepad2,
  x: Twitter,
  gmail: Mail,
  chatgpt: Bot,
};

export function SidePanelIcon({ app }: { app: SidePanelApp }) {
  const Icon = ICONS[app.id] ?? MessageCircle;
  return (
    <span className="side-app-icon" style={{ "--app-color": app.color } as CSSProperties}>
      <Icon aria-hidden="true" />
    </span>
  );
}

/** Barra lateral (como no Opera): um ícone por painel; clicar abre ou fecha o painel. */
export function SideBar({
  apps,
  open,
  onToggle,
  onManage,
}: {
  apps: SidePanelApp[];
  open: string | null;
  onToggle: (id: string) => void;
  /** "+": escolher quais painéis aparecem. */
  onManage: (event: React.MouseEvent) => void;
}) {
  return (
    <nav className="side-bar" aria-label="Painéis laterais" onContextMenu={onManage}>
      {apps.map((app) => (
        <button
          key={app.id}
          type="button"
          className={cn("side-bar-item", open === app.id && "on")}
          onClick={() => onToggle(app.id)}
          title={app.name}
          aria-label={app.name}
          aria-pressed={open === app.id}
        >
          <SidePanelIcon app={app} />
        </button>
      ))}
      <button
        type="button"
        className="side-bar-item add"
        onClick={onManage}
        title="Escolher painéis"
        aria-label="Escolher painéis laterais"
      >
        <Plus />
      </button>
    </nav>
  );
}

/**
 * Painel lateral aberto: cabeçalho da casca (nome, recarregar, abrir numa guia, fechar) e
 * a área onde o main põe a página do app (WebContentsView próprio, sessão das guias).
 */
export function SidePanel({
  app,
  width,
  desktop,
  onClose,
  onOpenInTab,
  onResize,
}: {
  app: SidePanelApp;
  width: number;
  desktop: DesktopBridge | null;
  onClose: () => void;
  onOpenInTab: (url: string) => void;
  onResize: (width: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!desktop) return;
    void desktop.sidePanelShow(app.id, app.url);
    return () => {
      void desktop.sidePanelHide();
    };
  }, [desktop, app.id, app.url]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !desktop) return;
    const report = () => {
      const rect = host.getBoundingClientRect();
      void desktop.sidePanelBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(host);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [desktop, app.id]);

  // Arrastar a borda direita muda a largura (fica salva nas preferências).
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    const box = hostRef.current?.parentElement?.getBoundingClientRect();
    if (!box) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: globalThis.PointerEvent) =>
      onResize(clampPanelWidth(moveEvent.clientX - box.left));
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  return (
    <aside
      className="side-panel"
      style={{ width }}
      aria-label={`Painel ${app.name}`}
      data-side-panel={app.id}
    >
      <header className="side-panel-head">
        <SidePanelIcon app={app} />
        <strong>{app.name}</strong>
        <Button
          variant="ghost"
          size="icon"
          title="Recarregar"
          aria-label={`Recarregar ${app.name}`}
          onClick={() => void desktop?.sidePanelReload(app.id)}
        >
          <RefreshCw />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Abrir numa guia"
          aria-label={`Abrir ${app.name} numa guia`}
          onClick={() => onOpenInTab(app.url)}
        >
          <ExternalLink />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Fechar painel"
          aria-label={`Fechar ${app.name}`}
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
      <div ref={hostRef} className="side-panel-host">
        {!desktop && (
          <div className="side-panel-web">
            <SidePanelIcon app={app} />
            <p>Os painéis laterais funcionam no app Agzos para computador.</p>
            <Button onClick={() => onOpenInTab(app.url)}>Abrir {app.name}</Button>
          </div>
        )}
      </div>
      <div
        className="side-panel-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Largura do painel lateral"
        aria-valuemin={SIDE_PANEL_WIDTH.min}
        aria-valuemax={SIDE_PANEL_WIDTH.max}
        aria-valuenow={width}
        onPointerDown={startResize}
      />
    </aside>
  );
}
