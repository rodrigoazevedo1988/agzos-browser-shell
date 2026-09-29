import { VenetianMask } from "lucide-react";
import type { CSSProperties } from "react";

import { cn } from "@/lib/utils";

import { entryOf, hostOf } from "../store/selectors";
import type { Tab } from "../types";

/**
 * Seletor do Ctrl+Tab (ordem de uso, como no Opera/Vivaldi). Segurando o Ctrl, Tab e
 * Shift+Tab andam; soltar o Ctrl, clicar ou Enter ativa; Esc cancela.
 */
export function TabSwitcher({
  tabs,
  index,
  thumbnails,
  onSelect,
  onCommit,
  onCancel,
}: {
  tabs: Tab[];
  index: number;
  thumbnails: Record<number, string>;
  onSelect: (index: number) => void;
  onCommit: (index: number) => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="tab-switcher-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="tab-switcher" role="listbox" aria-label="Alternar guias">
        {tabs.map((tab, position) => {
          const entry = entryOf(tab);
          const thumbnail = thumbnails[tab.id];
          const label = entry.kind === "home" ? "Nova aba" : entry.title;
          return (
            <button
              type="button"
              role="option"
              aria-selected={position === index}
              key={tab.id}
              className={cn("switcher-card", position === index && "selected")}
              style={{ "--i": Math.min(position, 10) } as CSSProperties}
              onMouseEnter={() => onSelect(position)}
              onClick={() => onCommit(position)}
            >
              <span className="switcher-preview">
                {thumbnail ? (
                  <img src={thumbnail} alt="" />
                ) : (
                  <span className="switcher-placeholder">
                    {tab.favicon ? (
                      <img src={tab.favicon} alt="" />
                    ) : (
                      (hostOf(entry.url) ?? label).slice(0, 1).toUpperCase()
                    )}
                  </span>
                )}
              </span>
              <span className="switcher-title">
                {tab.private && <VenetianMask aria-label="Anônima" />}
                {tab.favicon && thumbnail && <img src={tab.favicon} alt="" />}
                <span>{label}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
