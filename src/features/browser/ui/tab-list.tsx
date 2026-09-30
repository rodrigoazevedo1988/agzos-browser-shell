import { PanelLeftClose, PanelLeftOpen, Plus, VenetianMask } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { Tab, TabGroup } from "../types";
import { GROUP_COLORS } from "./group-colors";
import { TabItem, type TabHandlers } from "./tab-item";

type ListProps = {
  tabs: Tab[];
  activeId: number;
  audioPlaying: number[];
  /** Guias sem página carregada (hibernadas): aparecem esmaecidas. */
  hibernated?: number[];
  confirmingClose: number | null;
  handlers: TabHandlers;
  onNewTab: () => void;
  onNewPrivateTab: () => void;
  onStripMenu: (event: MouseEvent) => void;
  /** Guia arrastada para `index` da ordem exibida (contada sem ela). */
  onMoveTab: (id: number, index: number) => void;
  /** Grupos de guias (2.0): o chip do grupo aparece antes das guias dele. */
  groups?: TabGroup[];
  /** Guias da tela dividida (marcadas na barra). */
  splitIds?: readonly number[] | null;
  onGroupToggle?: (groupId: number) => void;
  onGroupMenu?: (event: MouseEvent, group: TabGroup) => void;
  /** Botão do workspace, no começo da barra. */
  leading?: ReactNode;
};

const DRAG_THRESHOLD = 6;

type Drop = { id: number; index: number; before: number | null };

/**
 * Arrastar para reordenar (ponteiro, não o drag-and-drop do HTML: sem imagem fantasma e
 * igual no Electron). A guia segue o mouse e uma linha mostra onde ela vai cair; soltar
 * move, Esc cancela. O clique que termina o arraste não ativa a guia.
 */
function useTabDrag(vertical: boolean, onMove: (id: number, index: number) => void) {
  const [drop, setDrop] = useState<Drop | null>(null);
  const suppressClick = useRef(false);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const element = (event.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    // Botões dentro da guia (fechar, fixar) não arrastam.
    if (!element || (event.target as HTMLElement).closest("[data-no-drag], .tab-close, .tab-pin"))
      return;
    const list = event.currentTarget;
    const id = Number(element.dataset["tabId"]);
    const start = vertical ? event.clientY : event.clientX;
    let dragging = false;
    let current: Drop | null = null;

    const targetOf = (position: number): Drop => {
      const others = [...list.querySelectorAll<HTMLElement>('[role="tab"]')].filter(
        (item) => item !== element,
      );
      let index = 0;
      for (const item of others) {
        const rect = item.getBoundingClientRect();
        const middle = vertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
        if (position > middle) index += 1;
      }
      const before = others[index] ? Number(others[index]!.dataset["tabId"]) : null;
      return { id, index, before };
    };

    const finish = (commit: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      element.style.transform = "";
      element.classList.remove("dragging");
      if (dragging) {
        suppressClick.current = true;
        window.setTimeout(() => (suppressClick.current = false), 0);
        if (commit && current) onMoveRef.current(current.id, current.index);
      }
      setDrop(null);
    };
    const move = (moveEvent: PointerEvent) => {
      const position = vertical ? moveEvent.clientY : moveEvent.clientX;
      if (!dragging) {
        if (Math.abs(position - start) < DRAG_THRESHOLD) return;
        dragging = true;
        element.classList.add("dragging");
      }
      const offset = position - start;
      element.style.transform = vertical ? `translateY(${offset}px)` : `translateX(${offset}px)`;
      current = targetOf(position);
      setDrop((previous) =>
        previous?.index === current!.index && previous.before === current!.before
          ? previous
          : current,
      );
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (keyEvent: globalThis.KeyboardEvent) => {
      if (keyEvent.key !== "Escape" || !dragging) return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      finish(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
  };

  const onClickCapture = (event: MouseEvent) => {
    if (!suppressClick.current) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return { drop, dragProps: { onPointerDown, onClickCapture } };
}

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

function renderTabs(
  {
    tabs,
    activeId,
    audioPlaying,
    hibernated = [],
    confirmingClose,
    handlers,
    groups = [],
    splitIds = null,
    onGroupToggle,
    onGroupMenu,
  }: ListProps,
  drop: Drop | null,
) {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const items: ReactNode[] = [];
  let previous: number | undefined;
  for (const tab of tabs) {
    const group = tab.groupId !== undefined ? byId.get(tab.groupId) : undefined;
    if (group && group.id !== previous) {
      items.push(
        <button
          key={`group-${group.id}`}
          type="button"
          className={cn("tab-group-chip", group.collapsed && "collapsed", !group.title && "dot")}
          style={{ "--group-color": GROUP_COLORS[group.color] } as CSSProperties}
          data-group-id={group.id}
          aria-expanded={!group.collapsed}
          aria-label={`Grupo ${group.title || "sem nome"}${group.collapsed ? ", recolhido" : ""}`}
          title={`${group.title || "Grupo"}: clique para ${group.collapsed ? "abrir" : "recolher"}, botão direito para editar`}
          onClick={() => onGroupToggle?.(group.id)}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onGroupMenu?.(event, group);
          }}
        >
          {group.title && <span>{group.title}</span>}
        </button>,
      );
    }
    previous = group?.id;
    // Grupo recolhido: só o chip (a guia ativa continua à vista).
    if (group?.collapsed && tab.id !== activeId) continue;
    items.push(
      <TabItem
        key={tab.id}
        tab={tab}
        active={tab.id === activeId}
        playing={audioPlaying.includes(tab.id)}
        hibernated={hibernated.includes(tab.id)}
        confirmingClose={confirmingClose === tab.id}
        handlers={handlers}
        groupColor={group ? GROUP_COLORS[group.color] : null}
        inSplit={splitIds?.includes(tab.id) ?? false}
        dropMark={
          !drop || drop.id === tab.id
            ? null
            : drop.before === tab.id
              ? "before"
              : drop.before === null && tab === lastOther(tabs, drop.id)
                ? "after"
                : null
        }
      />,
    );
  }
  return items;
}

function lastOther(tabs: Tab[], id: number) {
  const others = tabs.filter((tab) => tab.id !== id);
  return others[others.length - 1];
}

export function TabStrip(props: ListProps) {
  const { drop, dragProps } = useTabDrag(false, props.onMoveTab);
  return (
    <div
      {...dragProps}
      className={cn("tabs", drop && "reordering")}
      role="tablist"
      aria-label="Abas abertas"
      onContextMenu={props.onStripMenu}
      onKeyDown={(event) => tabsKeyDown(event, false, props.handlers.onClose)}
      // Duplo clique no espaço vazio da barra abre uma aba nova.
      onDoubleClick={(event) => {
        if (event.target === event.currentTarget) props.onNewTab();
      }}
    >
      {props.leading}
      {renderTabs(props, drop)}
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
  const { drop, dragProps } = useTabDrag(true, props.onMoveTab);

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
            {props.leading ?? <span className="rail-title">Guias</span>}
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
        {...dragProps}
        className={cn("rail-tabs", drop && "reordering")}
        role="tablist"
        aria-label="Abas verticais"
        aria-orientation="vertical"
        onKeyDown={(event) => tabsKeyDown(event, true, props.handlers.onClose)}
        onDoubleClick={(event) => {
          if (event.target === event.currentTarget) props.onNewTab();
        }}
      >
        {renderTabs(props, drop)}
      </div>
    </aside>
  );
}
