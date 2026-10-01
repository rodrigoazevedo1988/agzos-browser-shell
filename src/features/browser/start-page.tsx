import { Search, ShieldCheck, X } from "lucide-react";
import { FormEvent, useState } from "react";

import logoUrl from "@/assets/agzos-logo.svg";
import { Button } from "@/components/ui/button";
import { engines } from "./engines";
import type { QuickLink } from "./types";
import type { Prefs } from "./store/state";

function shortOf(name: string) {
  return name.trim().charAt(0).toUpperCase() || "?";
}

export function StartPage({
  links,
  engine,
  blocked,
  prefs,
  onOpen,
  onAdd,
  onRemove,
}: {
  links: QuickLink[];
  engine: (typeof engines)[number];
  /** Bloqueios reais de hoje; null com o escudo desligado. */
  blocked: number | null;
  prefs: Prefs;
  onOpen: (value: string) => void;
  onAdd: (link: QuickLink) => void;
  onRemove: (url: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [query, setQuery] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    const clean = url.trim().replace(/^https?:\/\//, "");
    if (!clean) return;
    onAdd({ name: name.trim() || clean, url: clean });
    setName("");
    setUrl("");
    setAdding(false);
  }

  function search(event: FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    onOpen(query);
    setQuery("");
  }

  return (
    <div
      className={`start-page ${prefs.backgroundImage ? "has-bg" : ""}`}
      style={
        prefs.backgroundImage
          ? {
              backgroundImage: `url(${prefs.backgroundImage})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : undefined
      }
    >
      {prefs.backgroundImage && (
        <div
          className="start-bg-overlay"
          style={{
            position: "absolute",
            inset: 0,
            backdropFilter: `blur(${prefs.backgroundBlur}px)`,
            backgroundColor: prefs.dark
              ? `rgba(0, 0, 0, ${1 - prefs.backgroundOpacity / 100})`
              : `rgba(255, 255, 255, ${1 - prefs.backgroundOpacity / 100})`,
            zIndex: 0,
          }}
        />
      )}
      <div
        className={`start-content ${prefs.uiBlur ? "glass-panel" : ""}`}
        style={{ position: "relative", zIndex: 1 }}
      >
        <img className="brand-logo" src={logoUrl} alt="Agzos" />
        <p className="brand-tagline">Navegue com clareza. Decida com controle.</p>
        <form className="start-search" onSubmit={search}>
          <Search aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`Pesquisar no ${engine.name} ou digitar endereço`}
            aria-label="Pesquisar na web"
          />
          <Button size="sm" type="submit">
            Pesquisar
          </Button>
        </form>
        <p className="engine-note">
          Motor de busca: <strong>{engine.name}</strong> · {engine.hint}
        </p>
        <div className="quick-links">
          {links.map((link) => (
            <div className="quick-link" key={link.url}>
              <button type="button" onClick={() => onOpen(link.url)} title={link.url}>
                <span>{shortOf(link.name)}</span>
                <small>{link.name}</small>
              </button>
              <button
                type="button"
                className="quick-remove"
                onClick={() => onRemove(link.url)}
                aria-label={`Remover ${link.name}`}
              >
                <X />
              </button>
            </div>
          ))}
          <div className="quick-link">
            <button type="button" onClick={() => setAdding(true)} aria-label="Adicionar atalho">
              <span>+</span>
              <small>Adicionar</small>
            </button>
          </div>
        </div>
        {adding && (
          <form className="quick-form" onSubmit={submit}>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Nome"
              aria-label="Nome do atalho"
            />
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="site.com"
              aria-label="Endereço do atalho"
            />
            <Button size="sm" type="submit">
              Salvar
            </Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setAdding(false)}>
              Cancelar
            </Button>
          </form>
        )}
      </div>
      <div className="privacy-note">
        <ShieldCheck />
        <span>
          <strong>{blocked === null ? "Proteção desativada" : "Proteção ativa"}</strong>
          <small>
            {blocked === null
              ? "Ative o escudo para bloquear anúncios e rastreadores"
              : `${blocked} ${blocked === 1 ? "anúncio ou rastreador bloqueado" : "anúncios e rastreadores bloqueados"} hoje`}
          </small>
        </span>
      </div>
    </div>
  );
}
