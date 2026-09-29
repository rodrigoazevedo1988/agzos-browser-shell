import { Pin, PinOff, VenetianMask, Volume2, VolumeX, X } from "lucide-react";
import type { MouseEvent } from "react";

import symbolUrl from "@/assets/agzos-symbol-red.svg";
import { cn } from "@/lib/utils";

import { entryOf } from "../store/selectors";
import type { Tab } from "../types";

export type TabHandlers = {
  onActivate: (tab: Tab) => void;
  onContextMenu: (event: MouseEvent, tab: Tab) => void;
  onTogglePin: (id: number) => void;
  onClose: (id: number) => void;
  /** Mouse parou na guia (prévia). */
  onHoverStart?: (tab: Tab, element: HTMLElement) => void;
  /** Saiu da guia; `immediate` ao clicar ou começar a arrastar. */
  onHoverEnd?: (immediate?: boolean) => void;
};

export function TabItem({
  tab,
  active,
  playing,
  hibernated = false,
  dropMark = null,
  confirmingClose,
  handlers,
}: {
  tab: Tab;
  active: boolean;
  playing: boolean;
  hibernated?: boolean;
  /** Arrastando outra guia: ela cai antes/depois desta. */
  dropMark?: "before" | "after" | null;
  confirmingClose: boolean;
  handlers: TabHandlers;
}) {
  const entry = entryOf(tab);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      title={hibernated ? `${entry.title} (hibernada para economizar memória)` : entry.title}
      // O título some nas fixadas (só o ícone): o nome acessível não pode depender dele.
      aria-label={[
        entry.title,
        tab.pinned && "fixada",
        tab.private && "anônima",
        playing && !tab.muted && "tocando áudio",
        tab.muted && "sem som",
        hibernated && "hibernada",
      ]
        .filter(Boolean)
        .join(", ")}
      data-tab-id={tab.id}
      onClick={() => handlers.onActivate(tab)}
      // Botão do meio fecha a aba, como em todo navegador.
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button !== 1) return;
        event.preventDefault();
        handlers.onClose(tab.id);
      }}
      onContextMenu={(event) => handlers.onContextMenu(event, tab)}
      onMouseEnter={(event) => handlers.onHoverStart?.(tab, event.currentTarget)}
      onMouseLeave={() => handlers.onHoverEnd?.()}
      onPointerDown={() => handlers.onHoverEnd?.(true)}
      className={cn(
        "browser-tab",
        active && "active",
        tab.pinned && "pinned",
        tab.private && "private",
        hibernated && "hibernated",
        dropMark && `drop-${dropMark}`,
      )}
    >
      {tab.private ? (
        <VenetianMask aria-hidden="true" />
      ) : tab.favicon ? (
        <img
          src={tab.favicon}
          alt=""
          onError={(event) => {
            event.currentTarget.src = symbolUrl;
          }}
        />
      ) : (
        <img src={symbolUrl} alt="" />
      )}
      {tab.pinned && (
        <span className="pin-badge" aria-hidden="true">
          <Pin />
        </span>
      )}
      <span className="tab-title">{entry.title}</span>
      {playing && !tab.muted && <Volume2 aria-hidden="true" className="tab-audio" />}
      {tab.muted && <VolumeX aria-hidden="true" className="tab-audio muted" />}
      <span
        className="tab-pin"
        role="button"
        aria-label={tab.pinned ? `Desafixar ${entry.title}` : `Fixar ${entry.title}`}
        title={tab.pinned ? "Desafixar aba" : "Fixar aba"}
        onClick={(event) => {
          event.stopPropagation();
          handlers.onTogglePin(tab.id);
        }}
      >
        {tab.pinned ? <PinOff /> : <Pin />}
      </span>
      <span
        className={cn("tab-close", confirmingClose && "confirm")}
        role="button"
        aria-label={`Fechar ${entry.title}`}
        title={tab.pinned ? "Clique novamente para fechar" : undefined}
        onClick={(event) => {
          event.stopPropagation();
          handlers.onClose(tab.id);
        }}
      >
        <X />
      </span>
    </button>
  );
}
