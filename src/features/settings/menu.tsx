import {
  Download,
  History,
  LogOut,
  Maximize2,
  Minus,
  PartyPopper,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SquarePlus,
  Star,
  VenetianMask,
  AppWindow,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, type KeyboardEvent } from "react";

import symbolUrl from "@/assets/agzos-symbol-red.svg";
import { cn } from "@/lib/utils";

export type AppMenuAction =
  | "tab.new"
  | "window.new"
  | "tab.new-private"
  | "history.open"
  | "downloads.toggle"
  | "bookmarks.manager"
  | "page.find"
  | "settings.open"
  | "whats-new"
  | "update.install"
  | "app.quit";

type Item = {
  action: AppMenuAction;
  label: string;
  icon: LucideIcon;
  shortcut?: string | undefined;
  hidden?: boolean;
  disabled?: boolean;
  accent?: boolean;
};

/**
 * Menu do "⋯" (como o do Comet/Chrome): o essencial à mão e "Configurações", que abre a
 * página completa (agzos://configuracoes). Setas navegam, Esc fecha.
 */
export function AppMenu({
  desktop,
  isMac,
  appVersion,
  updateReady,
  zoom,
  canZoom,
  canFind,
  dark,
  onAction,
  onZoom,
  onFullscreen,
  onToggleDark,
  onClose,
}: {
  desktop: boolean;
  isMac: boolean;
  appVersion: string | null;
  /** Versão baixada esperando reiniciar. */
  updateReady: string | null;
  zoom: number;
  canZoom: boolean;
  canFind: boolean;
  dark: boolean;
  onAction: (action: AppMenuAction) => void;
  onZoom: (direction: -1 | 0 | 1) => void;
  onFullscreen: () => void;
  onToggleDark: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const mod = isMac ? "⌘" : "Ctrl+";
  const shift = isMac ? "⇧" : "Shift+";

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, []);

  const groups: Item[][] = [
    [
      { action: "tab.new", label: "Nova guia", icon: SquarePlus, shortcut: `${mod}T` },
      {
        action: "window.new",
        label: "Nova janela",
        icon: AppWindow,
        shortcut: `${mod}N`,
        hidden: !desktop,
      },
      {
        action: "tab.new-private",
        label: "Nova guia anônima",
        icon: VenetianMask,
        shortcut: `${mod}${shift}N`,
      },
    ],
    [
      { action: "history.open", label: "Histórico", icon: History, shortcut: `${mod}H` },
      {
        action: "downloads.toggle",
        label: "Downloads",
        icon: Download,
        shortcut: `${mod}J`,
        hidden: !desktop,
      },
      {
        action: "bookmarks.manager",
        label: "Favoritos",
        icon: Star,
        shortcut: `${mod}${shift}O`,
      },
      {
        action: "page.find",
        label: "Buscar na página",
        icon: Search,
        shortcut: `${mod}F`,
        hidden: !desktop,
        disabled: !canFind,
      },
    ],
  ];
  const footer: Item[] = [
    {
      action: "update.install",
      label: `Reiniciar para atualizar (${updateReady ?? ""})`,
      icon: RefreshCw,
      hidden: !updateReady,
      accent: true,
    },
    {
      action: "whats-new",
      label: "Novidades desta versão",
      icon: PartyPopper,
      hidden: !desktop || !appVersion,
    },
    { action: "settings.open", label: "Configurações", icon: Settings, shortcut: `${mod},` },
    {
      action: "app.quit",
      label: "Sair",
      icon: LogOut,
      hidden: !desktop,
      shortcut: isMac ? "⌘Q" : undefined,
    },
  ];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [
      ...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? []),
    ];
    const index = items.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "ArrowDown" ? index + 1 : index - 1;
    items[(next + items.length) % items.length]?.focus();
  };

  const renderItem = (item: Item) =>
    item.hidden ? null : (
      <button
        key={item.action}
        type="button"
        role="menuitem"
        className={cn("app-menu-item", item.accent && "accent")}
        disabled={item.disabled}
        onClick={() => {
          onAction(item.action);
          onClose();
        }}
      >
        <item.icon aria-hidden="true" />
        <span>{item.label}</span>
        {item.shortcut && <kbd>{item.shortcut}</kbd>}
      </button>
    );

  return (
    <div
      ref={ref}
      className="app-menu"
      role="menu"
      aria-label="Menu do Agzos"
      onKeyDown={onKeyDown}
    >
      <div className="app-menu-head">
        <img src={symbolUrl} alt="" />
        <span>
          <strong>Agzos Browser</strong>
          {appVersion && <small>Versão {appVersion}</small>}
        </span>
      </div>
      {groups.map((group, index) => (
        <div key={index} className="app-menu-group">
          {group.map(renderItem)}
        </div>
      ))}
      <div className="app-menu-group">
        <div className="app-menu-row">
          <span>Zoom</span>
          <div className="app-menu-zoom">
            <button
              type="button"
              aria-label="Diminuir zoom"
              disabled={!canZoom}
              onClick={() => onZoom(-1)}
            >
              <Minus />
            </button>
            <button
              type="button"
              className="app-menu-zoom-value"
              aria-label="Zoom padrão"
              disabled={!canZoom}
              onClick={() => onZoom(0)}
            >
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              aria-label="Aumentar zoom"
              disabled={!canZoom}
              onClick={() => onZoom(1)}
            >
              <Plus />
            </button>
            {desktop && (
              <button type="button" aria-label="Tela cheia" onClick={onFullscreen}>
                <Maximize2 />
              </button>
            )}
          </div>
        </div>
        <label className="app-menu-row">
          <span>Tema escuro</span>
          <button
            type="button"
            role="switch"
            aria-checked={dark}
            aria-label="Tema escuro"
            className={cn("switch", dark && "on")}
            onClick={onToggleDark}
          >
            <i />
          </button>
        </label>
      </div>
      <div className="app-menu-group">{footer.map(renderItem)}</div>
    </div>
  );
}
