import { Globe, Plus, Search, X } from "lucide-react";
import { useState, type DragEvent, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import type { QuickLink } from "@/features/browser/types";
import { HomeNav } from "@/features/browser/ui/home-nav";
import { SiteIcon } from "@/features/browser/ui/site-icon";
import { HOVER_SOUND, KEY_SOUND } from "@/features/sounds/sounds";
import { cn } from "@/lib/utils";

import { categoriesOf, dialHref, filterDial, type DialScope } from "./dial";

const DRAG_TYPE = "application/x-agzos-dial";

/**
 * agzos://discador (3.0): grade de sites como o Speed Dial do Opera. A busca do topo filtra
 * os cards ("Geral") ou pesquisa na web; clicar num card abre o site nesta guia.
 */
export function DialPage({
  links,
  engineName,
  onOpen,
  onSearchWeb,
  onRequestAdd,
  onRemove,
  onMove,
  onHome,
}: {
  links: QuickLink[];
  engineName: string;
  /** Endereço ou texto: abre na guia atual (como a barra de endereço). */
  onOpen: (value: string) => void;
  onSearchWeb: (text: string) => void;
  /** "+": abre o modal de novo site (nome, URL, categoria, prévia). */
  onRequestAdd: () => void;
  onRemove: (url: string) => void;
  onMove: (url: string, index: number) => void;
  onHome: () => void;
}) {
  const [scope, setScope] = useState<DialScope>("general");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const categories = categoriesOf(links);
  const shownCategory = category && categories.includes(category) ? category : null;
  const inCategory = shownCategory
    ? links.filter((link) => link.category === shownCategory)
    : links;
  const visible = scope === "general" ? filterDial(inCategory, query) : inCategory;
  const searching = scope === "general" && query.trim() !== "";
  // Com filtro (texto ou categoria) os índices não são os da grade inteira: sem arrastar.
  const filtering = searching || shownCategory !== null;

  function search(event: FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (!text) return;
    if (scope === "web") onSearchWeb(text);
    else if (visible[0]) onOpen(dialHref(visible[0]));
    else onOpen(text);
    setQuery("");
  }

  const dragStart = (event: DragEvent, link: QuickLink) => {
    event.dataTransfer.setData(DRAG_TYPE, link.url);
    event.dataTransfer.effectAllowed = "move";
  };
  const dragOver = (event: DragEvent, index: number) => {
    if (filtering || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    setDropAt(index);
  };
  const drop = (event: DragEvent, index: number) => {
    const url = event.dataTransfer.getData(DRAG_TYPE);
    setDropAt(null);
    if (!url) return;
    event.preventDefault();
    onMove(url, index);
  };
  // Teclado: Ctrl+Shift+← / → muda o card de lugar.
  const keyMove = (event: KeyboardEvent, link: QuickLink, index: number) => {
    if (filtering || !(event.ctrlKey || event.metaKey) || !event.shiftKey) return;
    const delta = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!delta) return;
    event.preventDefault();
    onMove(link.url, index + delta);
  };

  return (
    <div className="dial-page">
      <HomeNav current="dial" onHome={onHome} onDial={() => {}} />
      <form className="dial-search" onSubmit={search} role="search" {...KEY_SOUND}>
        <div className="dial-scope" role="radiogroup" aria-label="Onde pesquisar">
          {(
            [
              ["general", "Geral"],
              ["web", "Web"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={scope === value}
              className={cn(scope === value && "on")}
              onClick={() => setScope(value)}
            >
              {value === "web" ? <Globe aria-hidden="true" /> : <Search aria-hidden="true" />}
              {label}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            scope === "web"
              ? `Pesquisar na web com ${engineName}`
              : "Filtrar sites do Discador ou digitar endereço"
          }
          aria-label={scope === "web" ? "Pesquisar na web" : "Pesquisar no Discador"}
        />
        <Button size="sm" type="submit">
          {scope === "web" ? "Pesquisar" : "Abrir"}
        </Button>
      </form>

      {categories.length > 0 && (
        <div className="dial-categories" role="radiogroup" aria-label="Categoria">
          {[null, ...categories].map((item) => (
            <button
              key={item ?? "*"}
              type="button"
              role="radio"
              aria-checked={shownCategory === item}
              className={cn(shownCategory === item && "on")}
              onClick={() => setCategory(item)}
            >
              {item ?? "Todas"}
            </button>
          ))}
        </div>
      )}

      <ul className="dial-grid" aria-label="Sites do Discador">
        {visible.map((link) => {
          const index = links.indexOf(link);
          return (
            <li
              key={link.url}
              className={cn("dial-card", dropAt === index && "drop-target")}
              draggable={!filtering}
              onDragStart={(event) => dragStart(event, link)}
              onDragOver={(event) => dragOver(event, index)}
              onDragLeave={() => setDropAt((at) => (at === index ? null : at))}
              onDrop={(event) => drop(event, index)}
              onDragEnd={() => setDropAt(null)}
              {...HOVER_SOUND}
            >
              <button
                type="button"
                className="dial-open"
                title={link.url}
                onClick={() => onOpen(dialHref(link))}
                onKeyDown={(event) => keyMove(event, link, index)}
              >
                <SiteIcon url={link.url} name={link.name} className="site-icon dial-icon" />
                <strong>{link.name}</strong>
                <small>{link.url}</small>
                {link.category && <em className="dial-category">{link.category}</em>}
              </button>
              <button
                type="button"
                className="dial-remove"
                aria-label={`Remover ${link.name} do Discador`}
                title="Remover"
                onClick={() => onRemove(link.url)}
              >
                <X />
              </button>
            </li>
          );
        })}
        {!searching && (
          <li
            className={cn("dial-card add", dropAt === links.length && "drop-target")}
            onDragOver={(event) => dragOver(event, links.length)}
            onDrop={(event) => drop(event, links.length)}
            {...HOVER_SOUND}
          >
            <button
              type="button"
              className="dial-open"
              aria-label="Adicionar site ao Discador"
              onClick={onRequestAdd}
            >
              <span className="site-icon dial-icon">
                <Plus aria-hidden="true" />
              </span>
              <strong>Adicionar</strong>
            </button>
          </li>
        )}
      </ul>
      {filtering && visible.length === 0 && (
        <p className="dial-empty">
          {query.trim()
            ? `Nenhum site do Discador com “${query.trim()}”. Enter abre como endereço ou busca.`
            : "Nenhum site nesta categoria."}
        </p>
      )}
    </div>
  );
}
