import {
  AppWindow,
  MousePointerClick,
  PanelBottom,
  PanelRight,
  Smartphone,
  SquareTerminal,
  Wrench,
  X,
} from "lucide-react";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import type { DesktopBridge } from "@/features/browser/desktop";
import type { DevtoolsSide } from "@/features/browser/desktop-v48";
import { cn } from "@/lib/utils";

import { DEVTOOLS_HEIGHT, DEVTOOLS_WIDTH, type DevtoolsTab } from "./devtools-limits";

/** Espaço mínimo que sobra para a página ao arrastar a alça. */
const PAGE_MIN = 240;

/**
 * 4.8 (Fase 1): o DevTools do Chromium encaixado à direita ou embaixo da página. A casca
 * reserva a área (corpo do dock) e manda o retângulo; o main põe ali o frontend da guia
 * ativa. A aba Terminal mostra o terminal da janela no mesmo lugar (as mesmas sessões).
 */
export function DevtoolsDock({
  desktop,
  side,
  size,
  tab,
  layout,
  hidden,
  onTab,
  onSide,
  onSize,
  onClose,
  onAction,
  terminal,
}: {
  desktop: DesktopBridge;
  side: Exclude<DevtoolsSide, "window">;
  size: number;
  tab: DevtoolsTab;
  /** Muda quando algo acima da página entra ou sai (a área se move sem mudar de tamanho). */
  layout: string;
  hidden: boolean;
  onTab: (tab: DevtoolsTab) => void;
  onSide: (side: DevtoolsSide) => void;
  onSize: (size: number) => void;
  onClose: () => void;
  onAction: (action: "inspect" | "device" | "console") => void;
  terminal: () => ReactNode;
}) {
  const vertical = side === "right";
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [dragSize, setDragSize] = useState<number | null>(null);
  const showFrontend = tab === "devtools" && !hidden;

  // Área do frontend: só com a aba DevTools à vista; senão o main esconde a view.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !showFrontend) {
      void desktop.devtoolsBounds(null);
      return;
    }
    const report = () => {
      const rect = body.getBoundingClientRect();
      void desktop.devtoolsBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    };
    report();
    const observer = new ResizeObserver(report);
    observer.observe(body);
    window.addEventListener("resize", report);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", report);
    };
  }, [desktop, showFrontend, side, layout]);

  useEffect(() => () => void desktop.devtoolsBounds(null), [desktop]);

  const limit = (edge: number) =>
    vertical
      ? Math.max(DEVTOOLS_WIDTH.min, Math.min(DEVTOOLS_WIDTH.max, edge - PAGE_MIN))
      : Math.max(DEVTOOLS_HEIGHT.min, Math.min(DEVTOOLS_HEIGHT.max, edge - PAGE_MIN));
  const clampSize = (value: number, max: number) =>
    Math.round(Math.min(max, Math.max(vertical ? DEVTOOLS_WIDTH.min : DEVTOOLS_HEIGHT.min, value)));

  // Alça: por cima das páginas nativas quem segue o cursor é o main (sidePanelDrag).
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const box = handle.parentElement!.getBoundingClientRect();
    const max = limit(vertical ? box.right : box.bottom);
    handle.setPointerCapture(event.pointerId);
    let latest = size;
    const apply = (x: number, y: number) => {
      latest = clampSize(vertical ? box.right - x : box.bottom - y, max);
      setDragSize(latest);
    };
    let finished = false;
    let offDrag = () => {};
    const move = (moveEvent: globalThis.PointerEvent) =>
      apply(moveEvent.clientX, moveEvent.clientY);
    const up = () => {
      if (finished) return;
      finished = true;
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      offDrag();
      void desktop.sidePanelDrag(false);
      setDragSize(null);
      onSize(latest);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
    offDrag = desktop.onSidePanelDrag(({ x, y, done }) => {
      if (done) up();
      else if (typeof x === "number" && typeof y === "number") apply(x, y);
    });
    void desktop.sidePanelDrag(true);
  };
  const keyResize = (event: KeyboardEvent<HTMLDivElement>) => {
    const grow = vertical ? "ArrowLeft" : "ArrowUp";
    const shrink = vertical ? "ArrowRight" : "ArrowDown";
    const step = event.key === grow ? 24 : event.key === shrink ? -24 : 0;
    if (!step) return;
    event.preventDefault();
    onSize(clampSize(size + step, vertical ? DEVTOOLS_WIDTH.max : DEVTOOLS_HEIGHT.max));
  };

  const current = dragSize ?? size;
  const tool = (label: string, icon: ReactNode, onClick: () => void, pressed?: boolean) => (
    <button
      type="button"
      className={cn("devtools-tool", pressed && "on")}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      {icon}
    </button>
  );

  return (
    <section
      className="devtools-dock"
      data-dock={side}
      style={vertical ? { width: current } : { height: current }}
      hidden={hidden}
      aria-label="DevTools"
    >
      <div
        className="devtools-resize"
        role="separator"
        aria-orientation={vertical ? "vertical" : "horizontal"}
        aria-label={vertical ? "Largura do DevTools" : "Altura do DevTools"}
        aria-valuemin={vertical ? DEVTOOLS_WIDTH.min : DEVTOOLS_HEIGHT.min}
        aria-valuemax={vertical ? DEVTOOLS_WIDTH.max : DEVTOOLS_HEIGHT.max}
        aria-valuenow={current}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={keyResize}
      />
      <header className="devtools-head">
        <div className="devtools-tabs" role="tablist" aria-label="Painel do desenvolvedor">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "devtools"}
            className={cn("devtools-tab", tab === "devtools" && "on")}
            onClick={() => onTab("devtools")}
          >
            <Wrench aria-hidden="true" />
            DevTools
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "terminal"}
            className={cn("devtools-tab", tab === "terminal" && "on")}
            onClick={() => onTab("terminal")}
          >
            <SquareTerminal aria-hidden="true" />
            Terminal
          </button>
        </div>
        <span className="devtools-spacer" />
        {tab === "devtools" && (
          <>
            {tool("Selecionar elemento (Ctrl+Shift+C)", <MousePointerClick />, () =>
              onAction("inspect"),
            )}
            {tool("Modo dispositivo", <Smartphone />, () => onAction("device"))}
            <span className="devtools-divider" aria-hidden="true" />
          </>
        )}
        {tool("Encaixar à direita", <PanelRight />, () => onSide("right"), side === "right")}
        {tool("Encaixar embaixo", <PanelBottom />, () => onSide("bottom"), side === "bottom")}
        {tool("Abrir em janela separada", <AppWindow />, () => onSide("window"))}
        {tool("Fechar DevTools (F12)", <X />, onClose)}
      </header>
      <div ref={bodyRef} className="devtools-body">
        {tab === "terminal" && !hidden && terminal()}
      </div>
    </section>
  );
}
