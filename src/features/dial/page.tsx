import { Globe, Plus, Search, X } from "lucide-react";
import { useState, type DragEvent, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import type { QuickLink } from "@/features/browser/types";
import { HomeNav } from "@/features/browser/ui/home-nav";
import { SiteIcon } from "@/features/browser/ui/site-icon";
import { cn } from "@/lib/utils";

import { dialHref, dialLinkOf, filterDial, type DialScope } from "./dial";

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
  onAdd,
  onRemove,
  onMove,
  onHome,
}: {
  links: QuickLink[];
  engineName: string;
  /** Endereço ou texto: abre na guia atual (como a barra de endereço). */
  onOpen: (value: string) => void;
  onSearchWeb: (text: string) => void;
  onAdd: (link: QuickLink) => void;
  onRemove: (url: string) => void;
  onMove: (url: string, index: number) => void;
  onHome: () => void;
}) {
  const [scope, setScope] = useState<DialScope>("general");
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [dropAt, setDropAt] = useState<number | null>(null);

  const visible = scope === "general" ? filterDial(links, query) : links;
  const filtering = scope === "general" && query.trim() !== "";

  function search(event: FormEvent) {
    event.preventDefault();
    const text = query.trim();
    if (!text) return;
    if (scope === "web") onSearchWeb(text);
    else if (visible[0]) onOpen(dialHref(visible[0]));
    else onOpen(text);
    setQuery("");
  }

  function add(event: FormEvent) {
    event.preventDefault();
    const link = dialLinkOf(name, address);
    if (!link) {
      setInvalid(true);
      return;
    }
    onAdd(link);
    setName("");
    setAddress("");
    setInvalid(false);
    setAdding(false);
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
      <form className="dial-search" onSubmit={search} role="search">
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
        {!filtering && (
          <li
            className={cn("dial-card add", dropAt === links.length && "drop-target")}
            onDragOver={(event) => dragOver(event, links.length)}
            onDrop={(event) => drop(event, links.length)}
          >
            <button
              type="button"
              className="dial-open"
              aria-label="Adicionar site ao Discador"
              onClick={() => setAdding(true)}
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
          Nenhum site do Discador com “{query.trim()}”. Enter abre como endereço ou busca.
        </p>
      )}

      {adding && (
        <form className="dial-form" onSubmit={add} aria-label="Novo site do Discador">
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nome"
            aria-label="Nome do site"
          />
          <input
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
              setInvalid(false);
            }}
            placeholder="site.com"
            aria-label="Endereço do site"
            aria-invalid={invalid}
          />
          <Button size="sm" type="submit">
            Salvar
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setAdding(false)}>
            Cancelar
          </Button>
          {invalid && <span className="dial-error">Digite um endereço como site.com</span>}
        </form>
      )}
    </div>
  );
}
