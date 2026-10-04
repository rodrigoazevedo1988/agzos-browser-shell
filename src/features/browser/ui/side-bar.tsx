import {
  Bot,
  BriefcaseBusiness,
  ExternalLink,
  Gamepad2,
  Gauge,
  Instagram,
  Mail,
  Maximize2,
  MessageCircle,
  Minimize2,
  MessagesSquare,
  Music,
  Network,
  Pin,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Twitter,
  Video,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { DesktopBridge } from "../desktop";
import { faviconSources } from "../favicon";
import { HOVER_SOUND } from "@/features/sounds/sounds";

import {
  SIDE_BAR_WIDTH,
  clampSideBarWidth,
  dragPanelWidth,
  panelWidthLimits,
  sideBarFit,
  sideBarLayout,
  type SidePanelApp,
} from "../side-panels";

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
/** Painel de portas (4.5): processos escutando no PC, matar e expor por túnel. */
export const PORTS_PANEL = "ports";

/** Altura de um app na barra (ícone + nome) antes da primeira medida. */
const ITEM_FALLBACK_PX = 52;

/** Âncora da caixinha "Mais": canto direito do botão, em px da janela. */
export type SideMoreAnchor = { x: number; y: number; bottom: number };

/**
 * Barra lateral (como no Opera GX): GX Control no topo e um ícone com nome por app; clicar
 * abre ou fecha o painel do app ao lado da página. O que não cabe fica atrás do "Mais".
 */
export function SideBar({
  apps,
  open,
  moreOpen = false,
  onToggle,
  onManage,
  onMore,
  onTools,
  width = SIDE_BAR_WIDTH.initial,
}: {
  apps: SidePanelApp[];
  /** 4.6: largura escolhida pelo usuário (a alça fica em SideBarResize). */
  width?: number;
  open: string | null;
  /** Caixinha dos apps que não couberam está aberta. */
  moreOpen?: boolean;
  onToggle: (id: string) => void;
  /** "+": escolher quais painéis aparecem. */
  onManage: (event: React.MouseEvent) => void;
  /** "Mais": abre a caixinha com os apps escondidos. */
  onMore: (anchor: SideMoreAnchor, hidden: SidePanelApp[]) => void;
  /** 4.6: menu das ferramentas (Session Tab, Scratchpad, mira…); só no app. */
  onTools?: ((anchor: DOMRect) => void) | undefined;
}) {
  const navRef = useRef<HTMLElement | null>(null);
  const itemHeight = useRef(ITEM_FALLBACK_PX);
  const [fit, setFit] = useState<number | null>(null);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const style = getComputedStyle(nav);
      const gap = parseFloat(style.rowGap) || 0;
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const item = nav.querySelector<HTMLElement>(".side-bar-item.app");
      if (item?.offsetHeight) itemHeight.current = item.offsetHeight;
      const fixed = [...nav.querySelectorAll<HTMLElement>("[data-side-fixed]")].reduce(
        (sum, element) => sum + element.offsetHeight + gap,
        0,
      );
      setFit(
        sideBarFit(apps.length, {
          height: nav.clientHeight - padding,
          fixed,
          item: itemHeight.current,
          gap,
        }),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [apps.length]);

  const shown = fit === null ? apps : apps.slice(0, fit);
  const hidden = fit === null ? [] : apps.slice(fit);
  const hiddenOpen = hidden.some((app) => app.id === open);

  const layout = sideBarLayout(width);
  return (
    <nav
      ref={navRef}
      className={cn("side-bar", `side-bar-${layout.mode}`)}
      aria-label="Painéis laterais"
      onContextMenu={onManage}
      data-mode={layout.mode}
      style={
        {
          "--side-bar-w": `${clampSideBarWidth(width)}px`,
          "--side-icon": `${layout.icon}px`,
          "--side-img": `${layout.image}px`,
          "--side-font": `${layout.font}px`,
        } as CSSProperties
      }
    >
      <button
        type="button"
        className={cn("side-bar-item control", open === CONTROL_PANEL && "on")}
        onClick={() => onToggle(CONTROL_PANEL)}
        title="GX Control: CPU, RAM, rede e limpeza"
        aria-label="GX Control"
        aria-pressed={open === CONTROL_PANEL}
        data-side-fixed
        {...HOVER_SOUND}
      >
        <span className="side-app-icon gx">
          <Gauge aria-hidden="true" />
        </span>
        <span className="side-bar-name">Control</span>
      </button>
      <button
        type="button"
        className={cn("side-bar-item control", open === PORTS_PANEL && "on")}
        onClick={() => onToggle(PORTS_PANEL)}
        title="Portas em uso: matar processo e expor por túnel HTTPS"
        aria-label="Portas em uso"
        aria-pressed={open === PORTS_PANEL}
        data-side-fixed
        {...HOVER_SOUND}
      >
        <span className="side-app-icon gx">
          <Network aria-hidden="true" />
        </span>
        <span className="side-bar-name">Portas</span>
      </button>
      {onTools && (
        <button
          type="button"
          className="side-bar-item control"
          onClick={(event) => onTools(event.currentTarget.getBoundingClientRect())}
          title="Ferramentas: Session Tab, Scratchpad, mira, captura, leitura, notas"
          aria-label="Ferramentas"
          data-side-fixed
          {...HOVER_SOUND}
        >
          <span className="side-app-icon gx">
            <Wrench aria-hidden="true" />
          </span>
          <span className="side-bar-name">Ferramentas</span>
        </button>
      )}
      <span className="side-bar-divider" aria-hidden="true" data-side-fixed />
      {shown.map((app) => (
        <button
          key={app.id}
          type="button"
          className={cn("side-bar-item app", open === app.id && "on")}
          onClick={() => onToggle(app.id)}
          title={app.name}
          aria-label={app.name}
          aria-pressed={open === app.id}
          {...HOVER_SOUND}
        >
          <SidePanelIcon app={app} />
          <span className="side-bar-name" aria-hidden="true">
            {app.name}
          </span>
        </button>
      ))}
      {hidden.length > 0 && (
        <button
          type="button"
          className={cn("side-bar-item app more", (moreOpen || hiddenOpen) && "on")}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            onMore(
              {
                x: Math.round(rect.right),
                y: Math.round(rect.top),
                bottom: Math.round(rect.bottom),
              },
              hidden,
            );
          }}
          title={hidden.map((app) => app.name).join(", ")}
          aria-label={`Mais ${hidden.length} ${hidden.length === 1 ? "app" : "apps"}`}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          data-side-more
          {...HOVER_SOUND}
        >
          <span className="side-app-icon more-icon">
            <span className="side-more-count">+{hidden.length}</span>
          </span>
          <span className="side-bar-name" aria-hidden="true">
            Mais
          </span>
        </button>
      )}
      <button
        type="button"
        className="side-bar-item add"
        onClick={onManage}
        title="Escolher painéis"
        aria-label="Escolher painéis laterais"
        data-side-fixed
        {...HOVER_SOUND}
      >
        <Plus />
      </button>
    </nav>
  );
}

/**
 * Caixinha flutuante com os apps que não couberam na barra (3.1.1). Na app fica na camada
 * acima da página; clicar fora ou escolher um app fecha.
 */
export function SideAppsMenu({
  apps,
  open,
  anchor,
  onPick,
  onClose,
}: {
  apps: SidePanelApp[];
  open: string | null;
  anchor: SideMoreAnchor;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Na casca (web): clique fora fecha (o botão "Mais" alterna sozinho).
  useEffect(() => {
    const onDown = (event: globalThis.PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || menuRef.current?.contains(target) || target.closest("[data-side-more]")) {
        return;
      }
      onClose();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [onClose]);

  useEffect(() => {
    menuRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, []);

  const bottom =
    typeof window === "undefined" ? 8 : Math.max(8, window.innerHeight - anchor.bottom);
  return (
    <div
      ref={menuRef}
      className="side-apps-menu glass-panel"
      role="menu"
      aria-label="Mais apps da barra lateral"
      style={{ left: anchor.x + 8, bottom }}
    >
      {apps.map((app) => (
        <button
          key={app.id}
          type="button"
          role="menuitem"
          className={cn("side-bar-item app", open === app.id && "on")}
          onClick={() => {
            onPick(app.id);
            onClose();
          }}
          title={app.name}
          aria-label={app.name}
          {...HOVER_SOUND}
        >
          <SidePanelIcon app={app} />
          <span className="side-bar-name" aria-hidden="true">
            {app.name}
          </span>
        </button>
      ))}
    </div>
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
  expanded = false,
  onClose,
  onOpenInTab,
  onExpand,
  onResize,
}: {
  app: SidePanelApp;
  width: number;
  desktop: DesktopBridge | null;
  /** 4.5: o painel ocupa a área principal (as guias saem de cena; o painel menor some). */
  expanded?: boolean;
  onClose: () => void;
  onOpenInTab: (url: string) => void;
  onExpand: (expanded: boolean) => void;
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

  // Mesma view nos dois tamanhos: só a área muda (o main esconde as guias quando expande).
  useEffect(() => {
    void desktop?.sidePanelExpand(expanded);
  }, [desktop, app.id, expanded]);

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
  }, [desktop, app.id, expanded]);

  // Zoom só deste painel (Ctrl+roda, Ctrl +/−/0 com o foco nele): mostrado no cabeçalho.
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    void desktop.sidePanelZoomGet(app.id).then((factor) => alive && setZoom(factor));
    const off = desktop.onSidePanelZoom((payload) => {
      if (payload.app === app.id) setZoom(payload.factor);
    });
    return () => {
      alive = false;
      off();
    };
  }, [desktop, app.id]);

  // Arrastar a borda direita aumenta ou diminui a largura (gravada por painel). Por cima
  // das páginas quem segue o cursor é o main (sidePanelDrag); na casca, o próprio ponteiro.
  const resizeRef = useRef(onResize);
  resizeRef.current = onResize;
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    const box = hostRef.current?.parentElement?.getBoundingClientRect();
    if (!box || event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const apply = (x: number) => resizeRef.current(dragPanelWidth(x - box.left, window.innerWidth));
    let finished = false;
    let offDrag = () => {};
    const move = (moveEvent: globalThis.PointerEvent) => apply(moveEvent.clientX);
    const up = () => {
      if (finished) return;
      finished = true;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      offDrag();
      void desktop?.sidePanelDrag(false);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
    if (desktop) {
      offDrag = desktop.onSidePanelDrag(({ x, done }) => {
        if (done) up();
        else if (typeof x === "number") apply(x);
      });
      void desktop.sidePanelDrag(true);
    }
  };
  const keyResize = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" ? 24 : event.key === "ArrowLeft" ? -24 : 0;
    if (!step) return;
    event.preventDefault();
    onResize(dragPanelWidth(width + step, window.innerWidth));
  };
  const limits = panelWidthLimits(typeof window === "undefined" ? 1280 : window.innerWidth);

  return (
    <aside
      className={cn("side-panel", expanded && "expanded")}
      style={expanded ? undefined : { width }}
      aria-label={`Painel ${app.name}`}
      data-side-panel={app.id}
      data-expanded={expanded || undefined}
    >
      <header className="side-panel-head">
        <SidePanelIcon app={app} />
        <strong>{app.name}</strong>
        {zoom !== 1 && (
          <button
            type="button"
            className="side-panel-zoom"
            title="Zoom deste painel (clique para voltar a 100%)"
            aria-label={`Zoom de ${app.name}: ${Math.round(zoom * 100)}%. Voltar a 100%`}
            onClick={() => void desktop?.sidePanelZoom(app.id, 0)}
          >
            {Math.round(zoom * 100)}%
          </button>
        )}
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
          variant={expanded ? "default" : "outline"}
          size="sm"
          className="side-panel-expand"
          title={expanded ? "Voltar para o painel lateral" : "Abrir este painel na tela toda"}
          aria-label={expanded ? `Recolher ${app.name}` : `Expandir ${app.name}`}
          aria-pressed={expanded}
          onClick={() => onExpand(!expanded)}
        >
          {expanded ? <Minimize2 /> : <Maximize2 />}
          {expanded ? "Recolher" : "Tela toda"}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          title="Abrir numa guia (fecha o painel)"
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
      {!expanded && (
        <div
          className="side-panel-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label="Largura do painel lateral"
          aria-valuemin={limits.min}
          aria-valuemax={limits.max}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={keyResize}
        />
      )}
    </aside>
  );
}

/**
 * Alça da borda direita da barra lateral (4.6): arrastar muda a largura; duplo clique volta
 * ao padrão; setas do teclado ajustam de 8 em 8 px. Por cima das páginas quem segue o
 * cursor é o main (o mesmo arraste do painel lateral).
 */
export function SideBarResize({
  width,
  desktop,
  onResize,
}: {
  width: number;
  desktop: DesktopBridge | null;
  onResize: (width: number) => void;
}) {
  const resizeRef = useRef(onResize);
  resizeRef.current = onResize;
  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const bar = event.currentTarget.previousElementSibling?.getBoundingClientRect();
    const left = bar?.left ?? 0;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const apply = (x: number) => resizeRef.current(clampSideBarWidth(x - left));
    let finished = false;
    let offDrag = () => {};
    const move = (moveEvent: globalThis.PointerEvent) => apply(moveEvent.clientX);
    const up = () => {
      if (finished) return;
      finished = true;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      offDrag();
      void desktop?.sidePanelDrag(false);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
    if (desktop) {
      offDrag = desktop.onSidePanelDrag(({ x, done }) => {
        if (done) up();
        else if (typeof x === "number") apply(x);
      });
      void desktop.sidePanelDrag(true);
    }
  };
  return (
    <div
      className="side-bar-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Largura da barra lateral"
      aria-valuemin={SIDE_BAR_WIDTH.min}
      aria-valuemax={SIDE_BAR_WIDTH.max}
      aria-valuenow={width}
      tabIndex={0}
      title="Arraste para mudar a largura (duplo clique volta ao padrão)"
      onPointerDown={start}
      onDoubleClick={() => onResize(SIDE_BAR_WIDTH.initial)}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        const step = event.key === "ArrowRight" ? 8 : event.key === "ArrowLeft" ? -8 : 0;
        if (!step) return;
        event.preventDefault();
        onResize(clampSideBarWidth(width + step));
      }}
    />
  );
}
