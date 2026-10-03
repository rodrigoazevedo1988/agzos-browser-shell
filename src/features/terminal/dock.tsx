import { type KeyboardEvent, type PointerEvent, useState } from "react";

import type { DesktopBridge } from "@/features/browser/desktop";
import {
  TERMINAL_WIDTH,
  terminalWidthLimit,
  type TerminalDockMode,
  type TerminalSettings,
} from "./config";
import { TERMINAL_HEIGHT, clampTerminalHeight, terminalHeightLimit } from "./model";
import { TerminalView } from "./view";

/**
 * Terminal na janela (4.0/4.1): embaixo da página ou à direita dela, com a alça para
 * redimensionar. Escondido, continua montado (os shells e a tela seguem vivos).
 */
export function TerminalDock({
  desktop,
  hidden,
  height,
  onHeight,
  settings,
  onSettings,
  onDock,
  defaultShell,
  defaultCwd,
  isMac,
  onClose,
}: {
  desktop: DesktopBridge;
  hidden: boolean;
  height: number;
  onHeight: (height: number) => void;
  settings: TerminalSettings;
  onSettings: (patch: Partial<TerminalSettings>) => void;
  onDock: (mode: TerminalDockMode) => void;
  defaultShell: string;
  defaultCwd: string;
  isMac: boolean;
  onClose: () => void;
}) {
  const vertical = settings.dock === "right";
  const [dragSize, setDragSize] = useState<number | null>(null);

  // Alça: por cima da página nativa quem segue o cursor é o main (sidePanelDrag).
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const box = handle.parentElement!.getBoundingClientRect();
    const max = vertical ? terminalWidthLimit(box.right) : terminalHeightLimit(box.bottom);
    handle.setPointerCapture(event.pointerId);
    let latest = vertical ? settings.width : height;
    const apply = (x: number, y: number) => {
      latest = vertical
        ? Math.round(Math.min(max, Math.max(TERMINAL_WIDTH.min, box.right - x)))
        : Math.min(max, clampTerminalHeight(box.bottom - y));
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
      if (vertical) onSettings({ width: latest });
      else onHeight(latest);
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
    if (vertical) {
      onSettings({
        width: Math.min(TERMINAL_WIDTH.max, Math.max(TERMINAL_WIDTH.min, settings.width + step)),
      });
    } else {
      onHeight(clampTerminalHeight(height + step));
    }
  };

  const size = dragSize ?? (vertical ? settings.width : height);
  return (
    <section
      className="terminal-dock"
      data-dock={vertical ? "right" : "bottom"}
      style={vertical ? { width: size } : { height: size }}
      hidden={hidden}
      aria-label="Terminal"
    >
      <div
        className="terminal-resize"
        role="separator"
        aria-orientation={vertical ? "vertical" : "horizontal"}
        aria-label={vertical ? "Largura do terminal" : "Altura do terminal"}
        aria-valuemin={vertical ? TERMINAL_WIDTH.min : TERMINAL_HEIGHT.min}
        aria-valuemax={vertical ? TERMINAL_WIDTH.max : TERMINAL_HEIGHT.max}
        aria-valuenow={size}
        tabIndex={0}
        onPointerDown={startResize}
        onKeyDown={keyResize}
      />
      <TerminalView
        desktop={desktop}
        settings={settings}
        defaultShell={defaultShell}
        defaultCwd={defaultCwd}
        isMac={isMac}
        mode={vertical ? "right" : "bottom"}
        hidden={hidden}
        onHide={onClose}
        onDock={onDock}
        onSettings={onSettings}
      />
    </section>
  );
}
