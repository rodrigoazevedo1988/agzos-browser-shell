import { AppWindow, Command, Globe, LayoutGrid, Search, Star, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { cn } from "@/lib/utils";

import { filterPalette, type PaletteGroup, type PaletteItem } from "../palette";

const GROUP_ICONS: Record<PaletteGroup, LucideIcon> = {
  Guias: AppWindow,
  Workspaces: LayoutGrid,
  Comandos: Command,
  Favoritos: Star,
};

function ItemIcon({ item }: { item: PaletteItem }) {
  const [broken, setBroken] = useState(false);
  if (item.icon && !broken) {
    return <img src={item.icon} alt="" onError={() => setBroken(true)} />;
  }
  const Icon = item.group === "Favoritos" && !item.icon ? Globe : GROUP_ICONS[item.group];
  return <Icon aria-hidden="true" />;
}

/**
 * Busca de comandos (Ctrl+K): digite para achar um comando, uma guia aberta, um workspace
 * ou um favorito. Setas escolhem, Enter executa, Esc fecha.
 */
export function CommandPalette({
  items,
  onRun,
  onClose,
}: {
  items: PaletteItem[];
  onRun: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const results = useMemo(() => filterPalette(items, query), [items, query]);
  const current = Math.min(selected, Math.max(0, results.length - 1));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${current}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    onRun(item.id);
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((current + 1) % Math.max(1, results.length));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((current - 1 + results.length) % Math.max(1, results.length));
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(results[current]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  const idle = !query.trim();
  let lastGroup: PaletteGroup | null = null;

  return (
    <div className="command-palette" role="dialog" aria-label="Busca de comandos">
      <div className="command-palette-input">
        <Search aria-hidden="true" />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Buscar comandos, guias, workspaces e favoritos"
          aria-label="Buscar comandos"
          role="combobox"
          aria-expanded="true"
          aria-controls="command-palette-list"
          aria-activedescendant={results.length ? `palette-option-${current}` : undefined}
          autoComplete="off"
          spellCheck={false}
        />
        <kbd>Esc</kbd>
      </div>
      {results.length ? (
        <ul
          id="command-palette-list"
          ref={listRef}
          className="command-palette-list"
          role="listbox"
          aria-label="Resultados"
        >
          {results.map((item, index) => {
            const header = idle && item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <li key={item.id} role="presentation">
                {header && <div className="command-palette-group">{header}</div>}
                <div
                  id={`palette-option-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === current}
                  className={cn("command-palette-option", index === current && "selected")}
                  onMouseMove={() => index !== current && setSelected(index)}
                  onClick={() => run(item)}
                >
                  <ItemIcon item={item} />
                  <span className="command-palette-label">{item.label}</span>
                  {item.detail && <span className="command-palette-detail">{item.detail}</span>}
                  {!idle && <span className="command-palette-tag">{item.group}</span>}
                  {item.shortcut && <kbd>{item.shortcut}</kbd>}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="command-palette-empty">Nada encontrado para “{query.trim()}”.</p>
      )}
    </div>
  );
}
