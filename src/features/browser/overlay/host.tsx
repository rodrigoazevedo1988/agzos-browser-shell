import { useEffect, useState, type PointerEvent, type WheelEvent } from "react";

import { cn } from "@/lib/utils";

import { hydrateProps, type OverlayBridge, type OverlayPayload } from "./bridge";
import { PanelView, type PanelSpec } from "./panels";

// O que precisa acontecer aqui, com o foco nesta página (a casca não tem o foco).
const LOCAL_EFFECTS: Partial<
  Record<PanelSpec["kind"], Record<string, (...args: unknown[]) => void>>
> = {
  key: {
    onCopy: (_id, value) => void navigator.clipboard?.writeText(String(value)).catch(() => {}),
  },
  autofill: {
    onCopy: (_id, value) => void navigator.clipboard?.writeText(String(value)).catch(() => {}),
  },
};

/** Fora do cartão do painel: o fundo transparente da camada. */
function isBackdrop(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.classList.contains("browser-stage") || target.classList.contains("browser-window"))
  );
}

const LINE_PX = 40;

/**
 * Camada dos painéis (dist/overlay.html): desenha só o painel, no mesmo lugar em que a
 * casca o desenharia, com fundo transparente. Clique fora ou Esc fecham; a rolagem fora
 * do painel vai para a página por baixo.
 */
export function OverlayHost({ bridge }: { bridge: OverlayBridge }) {
  const [model, setModel] = useState<OverlayPayload | null>(null);

  useEffect(() => {
    const off = bridge.onRender(setModel);
    bridge.ready();
    return off;
  }, [bridge]);

  useEffect(() => {
    if (!model) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) bridge.dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [bridge, model]);

  // Tema e vidro também no <html>: o dropdown da pasta (Radix) abre num portal no body,
  // fora de .browser-stage, como na casca.
  const classes = model?.classes.join(" ") ?? "";
  useEffect(() => {
    const root = document.documentElement;
    const list = classes.split(" ");
    root.classList.toggle("dark", list.includes("dark"));
    root.classList.toggle("ui-glass", list.includes("ui-glass"));
  }, [classes]);

  if (!model) return null;
  const props = hydrateProps(
    model.data,
    model.fns,
    (name, args) => bridge.call(name, args),
    LOCAL_EFFECTS[model.kind],
  );
  const spec = { kind: model.kind, key: model.key, props } as PanelSpec;

  const onPointerDown = (event: PointerEvent) => {
    // Como no Comet: o clique fora fecha o painel e vale para o que está embaixo (a
    // página, uma guia, outro botão da barra). O main repassa o clique.
    if (isBackdrop(event.target)) {
      event.preventDefault();
      bridge.dismiss({ x: event.clientX, y: event.clientY, button: event.button });
    }
  };
  const onWheel = (event: WheelEvent) => {
    if (!isBackdrop(event.target)) return;
    const scale = event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? window.innerHeight : 1;
    bridge.wheel({
      x: event.clientX,
      y: event.clientY,
      deltaX: event.deltaX * scale,
      deltaY: event.deltaY * scale,
    });
  };

  return (
    <main
      className={cn("browser-stage overlay-stage", ...model.classes)}
      data-overlay-kind={model.kind}
      onPointerDown={onPointerDown}
      onContextMenu={(event) => event.preventDefault()}
      onWheel={onWheel}
    >
      <section className="browser-window">
        <PanelView spec={spec} />
      </section>
    </main>
  );
}
