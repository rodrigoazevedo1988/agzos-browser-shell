import { EllipsisVertical, Pin, PinOff, Puzzle, Settings2, ShoppingBag } from "lucide-react";
import type { MouseEvent } from "react";

import { cn } from "@/lib/utils";

/** O que o pop-up mostra de cada extensão (dados simples: o painel roda na camada). */
export type ExtensionRow = {
  dir: string;
  name: string;
  icon: string | null;
  summary: string;
  pinned: boolean;
  enabled: boolean;
  hasPopup: boolean;
};

type Rect = { x: number; y: number; width: number; height: number };

const rectOf = (element: Element): Rect => {
  const box = element.getBoundingClientRect();
  return { x: box.left, y: box.top, width: box.width, height: box.height };
};

/**
 * Pop-up de extensões (4.6), como o quebra-cabeça do Chrome e do Edge: lista as
 * instaladas com ícone, nome e acesso resumido. Clique abre o pop-up da extensão; o
 * alfinete fixa o ícone na barra; "…" (ou clique direito) abre o menu dela.
 */
export function ExtensionsPanel({
  extensions,
  right,
  onOpen,
  onPin,
  onMore,
  onManage,
  onGetMore,
  onAdd,
  onClose,
}: {
  extensions: ExtensionRow[];
  /** Distância da borda direita da janela até o botão (o pop-up alinha com ele). */
  right: number;
  onOpen: (dir: string) => void;
  onPin: (dir: string, pinned: boolean) => void;
  onMore: (dir: string, anchor: Rect) => void;
  onManage: () => void;
  onGetMore: () => void;
  onAdd: () => void;
  onClose: () => void;
}) {
  const more = (event: MouseEvent<HTMLElement>, dir: string, anchor: Rect) => {
    event.preventDefault();
    event.stopPropagation();
    onMore(dir, anchor);
  };
  return (
    <aside
      className="app-menu extensions-panel"
      style={{ right }}
      aria-label="Extensões"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="extensions-panel-head">
        <strong>Extensões</strong>
      </div>
      {extensions.length === 0 ? (
        <div className="extensions-panel-empty">
          <Puzzle aria-hidden="true" />
          <p>Nenhuma extensão instalada.</p>
          <button type="button" onClick={onAdd}>
            Carregar extensão descompactada…
          </button>
        </div>
      ) : (
        <ul className="extensions-panel-list" aria-label="Extensões instaladas">
          {extensions.map((item) => (
            <li
              key={item.dir}
              className={cn(!item.enabled && "off")}
              onContextMenu={(event) =>
                more(event, item.dir, { x: event.clientX, y: event.clientY, width: 1, height: 1 })
              }
            >
              <button
                type="button"
                className="extensions-panel-open"
                disabled={!item.enabled}
                title={
                  item.enabled
                    ? item.hasPopup
                      ? `Abrir ${item.name}`
                      : `${item.name} não tem pop-up`
                    : `${item.name} está desligada`
                }
                onClick={() => onOpen(item.dir)}
              >
                {item.icon ? (
                  <img src={item.icon} alt="" />
                ) : (
                  <span className="extensions-panel-icon">
                    <Puzzle aria-hidden="true" />
                  </span>
                )}
                <span className="extensions-panel-text">
                  <strong>{item.name}</strong>
                  <small>{item.enabled ? item.summary : "Desligada"}</small>
                </span>
              </button>
              <button
                type="button"
                className={cn("extensions-panel-pin", item.pinned && "on")}
                aria-label={item.pinned ? `Desafixar ${item.name}` : `Fixar ${item.name}`}
                aria-pressed={item.pinned}
                title={item.pinned ? "Desafixar da barra" : "Fixar na barra"}
                onClick={() => onPin(item.dir, !item.pinned)}
              >
                {item.pinned ? <PinOff /> : <Pin />}
              </button>
              <button
                type="button"
                className="extensions-panel-more"
                aria-label={`Mais ações de ${item.name}`}
                title="Mais ações"
                onClick={(event) => more(event, item.dir, rectOf(event.currentTarget))}
              >
                <EllipsisVertical />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="extensions-panel-foot">
        <button type="button" onClick={onManage}>
          <Settings2 aria-hidden="true" /> Gerenciar extensões
        </button>
        <button type="button" onClick={onGetMore}>
          <ShoppingBag aria-hidden="true" /> Obter extensões
        </button>
      </div>
    </aside>
  );
}
