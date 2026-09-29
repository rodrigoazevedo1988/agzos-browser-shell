import { PanelLeftClose, PanelLeftOpen, Plus, VenetianMask } from "lucide-react";
import type { MouseEvent } from "react";

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

export function TabRail({
  collapsed,
  onToggleCollapsed,
  ...props
}: ListProps & { collapsed: boolean; onToggleCollapsed: () => void }) {
  return (
    <aside className={cn("tabs-rail", collapsed && "collapsed")} onContextMenu={props.onStripMenu}>
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
        {!collapsed && (
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
      <div className="rail-tabs" role="tablist" aria-label="Abas verticais">
        {renderTabs(props)}
      </div>
    </aside>
  );
}
