import type { KeyboardEvent, PointerEvent } from "react";

import type { DesktopBridge } from "@/features/browser/desktop";
import { AI_CHAT_WIDTH } from "@/features/browser/store/state";

/** Página que sobra à esquerda do Agzos AI quando ele cresce até o limite. */
const KEEP_PAGE = 360;

/** Largura do chat para a borda esquerda em `x`, dentro dos limites e da janela. */
function aiChatWidthAt(x: number, right: number, extra: number) {
  const max = Math.max(AI_CHAT_WIDTH.min, Math.min(AI_CHAT_WIDTH.max, right - KEEP_PAGE - extra));
  return Math.round(Math.min(max, Math.max(AI_CHAT_WIDTH.min, right - x - extra)));
}

/**
 * Alça na borda esquerda do Agzos AI (como a do terminal à direita). Muda só a coluna do
 * chat: a lista de conversas e o artifact (`extra`, em px) mantêm a largura deles.
 */
export function AiResizeHandle({
  desktop,
  width,
  extra,
  onLive,
  onWidth,
}: {
  desktop: DesktopBridge | null;
  width: number;
  extra: number;
  /** Largura durante o arrasto (null ao soltar). */
  onLive: (width: number | null) => void;
  onWidth: (width: number) => void;
}) {
  // Por cima da página nativa quem segue o cursor é o main (sidePanelDrag).
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const right = handle.parentElement!.getBoundingClientRect().right;
    handle.setPointerCapture(event.pointerId);
    let latest = width;
    const apply = (x: number) => {
      latest = aiChatWidthAt(x, right, extra);
      onLive(latest);
    };
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
      onLive(null);
      onWidth(latest);
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
    const step = event.key === "ArrowLeft" ? 24 : event.key === "ArrowRight" ? -24 : 0;
    if (!step) return;
    event.preventDefault();
    onWidth(Math.min(AI_CHAT_WIDTH.max, Math.max(AI_CHAT_WIDTH.min, width + step)));
  };
  return (
    <div
      className="ai-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Largura do Agzos AI"
      aria-valuemin={AI_CHAT_WIDTH.min}
      aria-valuemax={AI_CHAT_WIDTH.max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={startResize}
      onKeyDown={keyResize}
    />
  );
}
