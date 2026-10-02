import {
  Bot,
  BriefcaseBusiness,
  ExternalLink,
  Gamepad2,
  Gauge,
  Instagram,
  Mail,
  MessageCircle,
  MessagesSquare,
  Music,
  Pin,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Twitter,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { DesktopBridge } from "../desktop";
import { faviconSources } from "../favicon";
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
  claude: Sparkles,
  gemini: Sparkles,
  duckai: Bot,
  tiktok: Video,
  kwai: Video,
  youtube: Video,
  linkedin: BriefcaseBusiness,
  reddit: MessagesSquare,
  spotify: Music,
  deezer: Music,
  pinterest: Pin,
};

/** Logo do app (favicon do site); sem rede, o ícone genérico na cor da marca. */
export function SidePanelIcon({ app }: { app: SidePanelApp }) {
  const Icon = ICONS[app.id] ?? MessageCircle;
  // Google primeiro, /favicon.ico do site depois; os dois falhando, o ícone genérico.
  const sources = faviconSources(app.url, 64);
  const [attempt, setAttempt] = useState(0);
  const [ok, setOk] = useState(false);
  const source = sources[attempt];
  // O Google devolve 16 px quando só conhece um ícone pequeno: tenta o do site.
  const settle = (image: HTMLImageElement) => {
    const minimum = attempt === 0 ? 24 : 1;
    if (image.naturalWidth >= minimum) setOk(true);
    else setAttempt(attempt + 1);
  };
  return (
    <span
      className={cn("side-app-icon", ok && "has-logo")}
      style={{ "--app-color": app.color } as CSSProperties}
    >
      {!ok && <Icon aria-hidden="true" />}
      {source && (
        <img
          key={source}
          src={source}
          alt=""
          aria-hidden="true"
          draggable={false}
          referrerPolicy="no-referrer"
          hidden={!ok}
          // Renderizada no servidor, a imagem pode carregar antes da hidratação (sem onLoad).
          ref={(image) => {
            if (image?.complete && !ok) settle(image);
          }}
          onLoad={(event) => settle(event.currentTarget)}
          onError={() => setAttempt(attempt + 1)}
        />
      )}
    </span>
  );
}

/** Id do painel do GX Control (da casca, sem página): o primeiro da barra. */
export const CONTROL_PANEL = "control";

/**
 * Barra lateral (como no Opera GX): GX Control no topo e um ícone com nome por app; clicar
 * abre ou fecha o painel do app ao lado da página.
 */
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
      <button
        type="button"
        className={cn("side-bar-item control", open === CONTROL_PANEL && "on")}
        onClick={() => onToggle(CONTROL_PANEL)}
        title="GX Control: CPU, RAM, rede e limpeza"
        aria-label="GX Control"
        aria-pressed={open === CONTROL_PANEL}
      >
        <span className="side-app-icon gx">
          <Gauge aria-hidden="true" />
        </span>
        <span className="side-bar-name">Control</span>
      </button>
      <span className="side-bar-divider" aria-hidden="true" />
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
          <span className="side-bar-name" aria-hidden="true">
            {app.name}
          </span>
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
