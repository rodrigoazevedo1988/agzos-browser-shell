import { PanelLeftClose, PanelLeftOpen, Plus, VenetianMask } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { Tab } from "../types";
import { TabItem, type TabHandlers } from "./tab-item";

type ListProps = {
  tabs: Tab[];
  activeId: number;
  audioPlaying: number[];
  confirmingClose: number | null;
  handlers: TabHandlers;
  onNewTab: () => void;
  onNewPrivateTab: () => void;
  onStripMenu: (event: MouseEvent) => void;
};

/**
 * Teclado na lista de abas (padrão WAI-ARIA de tabs): setas movem o foco, Home/End vão
 * às pontas, Delete fecha a aba focada. Enter/Espaço ativam (é um botão).
 */
function tabsKeyDown(
  event: KeyboardEvent<HTMLElement>,
  vertical: boolean,
  onClose: (id: number) => void,
) {
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
  const current = items.indexOf(document.activeElement as HTMLElement);
  if (current < 0) return;
  const next = vertical ? "ArrowDown" : "ArrowRight";
  const previous = vertical ? "ArrowUp" : "ArrowLeft";
  let target: number | null = null;
  if (event.key === next) target = (current + 1) % items.length;
  else if (event.key === previous) target = (current - 1 + items.length) % items.length;
  else if (event.key === "Home") target = 0;
  else if (event.key === "End") target = items.length - 1;
  else if (event.key === "Delete") {
    event.preventDefault();
    const id = Number(items[current]!.dataset["tabId"]);
    (items[current + 1] ?? items[current - 1])?.focus();
    onClose(id);
    return;
  }
  if (target === null) return;
  event.preventDefault();
  items[target]!.focus();
}

function renderTabs({ tabs, activeId, audioPlaying, confirmingClose, handlers }: ListProps) {
  return tabs.map((tab) => (
    <TabItem
      key={tab.id}
      tab={tab}
      active={tab.id === activeId}
      playing={audioPlaying.includes(tab.id)}
      confirmingClose={confirmingClose === tab.id}
      handlers={handlers}
    />
  ));
}

export function TabStrip(props: ListProps) {
  return (
    <div
      className="tabs"
      role="tablist"
      aria-label="Abas abertas"
      onContextMenu={props.onStripMenu}
      onKeyDown={(event) => tabsKeyDown(event, false, props.handlers.onClose)}
      // Duplo clique no espaço vazio da barra abre uma aba nova.
      onDoubleClick={(event) => {
        if (event.target === event.currentTarget) props.onNewTab();
      }}
    >
      {renderTabs(props)}
      <Button
        variant="ghost"
        size="icon"
        onClick={props.onNewTab}
        title="Nova aba (Ctrl/⌘ T)"
        aria-label="Nova aba"
        className="new-tab"
      >
        <Plus />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={props.onNewPrivateTab}
        title="Nova aba anônima"
        aria-label="Nova aba anônima"
        className="new-tab"
      >
        <VenetianMask />
      </Button>
    </div>
  );
}

/** Barra recolhida: pausar o mouse sobre ela abre uma espiada (sem mudar a preferência). */
const PEEK_OPEN_MS = 260;
const PEEK_CLOSE_MS = 320;

export function TabRail({
  collapsed,
  onToggleCollapsed,
  ...props
}: ListProps & { collapsed: boolean; onToggleCollapsed: () => void }) {
  const [peek, setPeek] = useState(false);
  const timer = useRef<number | null>(null);
  const schedule = (open: boolean) => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPeek(open), open ? PEEK_OPEN_MS : PEEK_CLOSE_MS);
  };
  useEffect(() => {
    setPeek(false);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [collapsed]);
  const expanded = !collapsed || peek;

  return (
    <aside
      className={cn("tabs-rail", collapsed && "collapsed", peek && "peek")}
      onContextMenu={props.onStripMenu}
      onMouseEnter={() => collapsed && schedule(true)}
      onMouseLeave={() => collapsed && schedule(false)}
    >
      <div className="rail-head">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapsed}
          title={collapsed ? "Expandir barra de guias" : "Recolher barra de guias"}
          aria-label="Alternar barra de guias"
          className="rail-toggle"
        >
          {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
        </Button>
        {expanded && (
          <>
            <span className="rail-title">Guias</span>
            <div className="rail-actions">
              <Button
                variant="ghost"
                size="icon"
                onClick={props.onNewTab}
                title="Nova aba (Ctrl/⌘ T)"
                aria-label="Nova aba"
              >
                <Plus />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={props.onNewPrivateTab}
                title="Nova aba anônima"
                aria-label="Nova aba anônima"
              >
                <VenetianMask />
              </Button>
            </div>
          </>
        )}
      </div>
      <div
        className="rail-tabs"
        role="tablist"
        aria-label="Abas verticais"
        aria-orientation="vertical"
        onKeyDown={(event) => tabsKeyDown(event, true, props.handlers.onClose)}
        onDoubleClick={(event) => {
          if (event.target === event.currentTarget) props.onNewTab();
        }}
      >
        {renderTabs(props)}
      </div>
    </aside>
  );
}
