import { useLayoutEffect, useRef, useState } from "react";

import { TOOLS, shortcutText, type ToolId } from "./tools";

/**
 * Menu "Ferramentas" (4.6), aberto pelo item da barra lateral. Mesmo visual do menu "⋯":
 * vidro translúcido, tema escuro ou claro e a cor de acento (não é menu nativo).
 */
export function ToolsMenu({
  left,
  top,
  mac,
  onRun,
  onClose,
}: {
  left: number;
  top: number;
  mac: boolean;
  onRun: (id: ToolId) => void;
  onClose: () => void;
}) {
  // 5.0.4: o menu nasce na altura do item da barra lateral; em telas baixas (1366×768 a
  // 125 %) a parte de baixo ficava fora da janela e a rolagem não chegava nela. Sobe o
  // menu até caber e limita a altura à janela.
  const ref = useRef<HTMLDivElement | null>(null);
  const [fitTop, setFitTop] = useState(top);
  useLayoutEffect(() => {
    const height = ref.current?.offsetHeight ?? 0;
    setFitTop(Math.max(8, Math.min(top, window.innerHeight - height - 8)));
  }, [top]);
  return (
    <div
      ref={ref}
      className="app-menu tools-menu"
      role="menu"
      aria-label="Ferramentas"
      style={{ left, top: fitTop, right: "auto", maxHeight: "calc(100vh - 16px)" }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="app-menu-head tools-menu-head">
        <span>
          <strong>Ferramentas</strong>
          <small>Para quem desenvolve e lê na web</small>
        </span>
      </div>
      <div className="app-menu-group">
        {TOOLS.filter((tool) => tool.id !== "ports.open").map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.id}
              type="button"
              role="menuitem"
              className="app-menu-item"
              title={tool.hint}
              onClick={() => {
                onClose();
                onRun(tool.id);
              }}
            >
              <Icon aria-hidden="true" />
              <span>{tool.label}</span>
              {tool.shortcut && <kbd>{shortcutText(tool.shortcut, mac)}</kbd>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
