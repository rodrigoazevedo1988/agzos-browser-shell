import { RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";

import { RELOAD_MODE_LABELS, type ReloadMode } from "../reload";

const ICONS: Record<ReloadMode, typeof RefreshCw> = {
  normal: RefreshCw,
  hard: RotateCcw,
  empty: Trash2,
};

/**
 * 5.0.3: menu do botão Recarregar com o DevTools aberto (clique direito ou segurar). Roda na
 * camada dos painéis, como o resto dos menus da barra.
 */
export function ReloadMenu({
  left,
  top,
  onRun,
  onClose,
}: {
  left: number;
  top: number;
  onRun: (mode: ReloadMode) => void;
  onClose: () => void;
}) {
  const first = useRef<HTMLButtonElement | null>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <div
      className="app-menu reload-menu"
      role="menu"
      aria-label="Recarregar"
      style={{ left, top, right: "auto" }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      {(Object.keys(RELOAD_MODE_LABELS) as ReloadMode[]).map((mode, index) => {
        const Icon = ICONS[mode];
        return (
          <button
            key={mode}
            ref={index === 0 ? first : undefined}
            type="button"
            role="menuitem"
            className="app-menu-item"
            onClick={() => {
              onRun(mode);
              onClose();
            }}
          >
            <Icon aria-hidden="true" />
            <span>{RELOAD_MODE_LABELS[mode]}</span>
          </button>
        );
      })}
    </div>
  );
}
