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
};

export function TabItem({
  tab,
  active,
  playing,
  confirmingClose,
  handlers,
}: {
  tab: Tab;
  active: boolean;
  playing: boolean;
  confirmingClose: boolean;
  handlers: TabHandlers;
}) {
  const entry = entryOf(tab);
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={() => handlers.onActivate(tab)}
      onContextMenu={(event) => handlers.onContextMenu(event, tab)}
      className={cn(
        "browser-tab",
        active && "active",
        tab.pinned && "pinned",
        tab.private && "private",
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
      <span>{entry.title}</span>
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
