import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { TAB_GROUP_COLORS, type TabGroup, type TabGroupColor } from "../types";
import { GROUP_COLORS } from "./group-colors";

const COLOR_NAMES: Record<TabGroupColor, string> = {
  grey: "Cinza",
  blue: "Azul",
  red: "Vermelho",
  yellow: "Amarelo",
  green: "Verde",
  pink: "Rosa",
  purple: "Roxo",
  cyan: "Ciano",
  orange: "Laranja",
};

/**
 * Edição do grupo de guias (como o balão do Chrome): nome, cor, nova guia no grupo,
 * desagrupar e fechar o grupo. Abre ao lado do chip do grupo (`anchor`, em px da janela).
 */
export function GroupEditor({
  group,
  anchor,
  onRename,
  onColor,
  onNewTab,
  onUngroup,
  onCloseGroup,
  onClose,
}: {
  group: TabGroup;
  anchor: { x: number; y: number };
  onRename: (title: string) => void;
  onColor: (color: TabGroupColor) => void;
  onNewTab: () => void;
  onUngroup: () => void;
  onCloseGroup: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(group.title);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const commit = () => {
    if (title.trim() !== group.title) onRename(title);
  };

  return (
    <aside
      className="key-panel group-editor"
      aria-label="Editar grupo"
      style={{ left: Math.max(8, anchor.x), top: Math.max(8, anchor.y) }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          commit();
          onClose();
        }}
      >
        <input
          ref={inputRef}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commit}
          placeholder="Nome do grupo"
          aria-label="Nome do grupo"
          maxLength={60}
        />
      </form>
      <div className="group-colors" role="radiogroup" aria-label="Cor do grupo">
        {TAB_GROUP_COLORS.map((color) => (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={group.color === color}
            aria-label={COLOR_NAMES[color]}
            title={COLOR_NAMES[color]}
            className={cn(group.color === color && "on")}
            style={{ background: GROUP_COLORS[color] }}
            onClick={() => onColor(color)}
          />
        ))}
      </div>
      <div className="group-actions" role="menu" aria-label="Ações do grupo">
        <button type="button" role="menuitem" onClick={() => (onNewTab(), onClose())}>
          Nova guia no grupo
        </button>
        <button type="button" role="menuitem" onClick={() => (onUngroup(), onClose())}>
          Desagrupar
        </button>
        <button
          type="button"
          role="menuitem"
          className="danger"
          onClick={() => (onCloseGroup(), onClose())}
        >
          Fechar grupo
        </button>
      </div>
    </aside>
  );
}
