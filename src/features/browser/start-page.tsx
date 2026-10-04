import { Plus, Search, ShieldCheck, X } from "lucide-react";
import { FormEvent, useState } from "react";

import logoUrl from "@/assets/agzos-logo.svg";
import { Button } from "@/components/ui/button";
import { KEY_SOUND } from "@/features/sounds/sounds";
import { engines } from "./engines";
import type { QuickLink } from "./types";
import type { Prefs } from "./store/state";
import { ToolsGrid } from "@/features/tools/tools-grid";
import type { ToolId } from "@/features/tools/tools";
import { HomeNav } from "./ui/home-nav";
import { SiteIcon } from "./ui/site-icon";

export function StartPage({
  links,
  engine,
  blocked,
  prefs,
  onOpen,
  onRequestAdd,
  onRemove,
  onOpenDial,
  onTool,
  mac = false,
}: {
  links: QuickLink[];
  engine: (typeof engines)[number];
  /** Bloqueios reais de hoje; null com o escudo desligado. */
  blocked: number | null;
  prefs: Prefs;
  onOpen: (value: string) => void;
  /** "Adicionar": o mesmo modal do Discador (nome, URL, categoria, prévia). */
  onRequestAdd: () => void;
  onRemove: (url: string) => void;
  /** "Discador" no topo: a grade de sites na mesma guia (3.0). */
  onOpenDial: () => void;
  /** 4.5: ferramentas (Session Tab, portas, Scratchpad, mira…); só no app. */
  onTool?: ((id: ToolId) => void) | undefined;
  mac?: boolean;
}) {
  const [query, setQuery] = useState("");

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
      <HomeNav current="home" onHome={() => {}} onDial={onOpenDial} />
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
        <form className="start-search" onSubmit={search} {...KEY_SOUND}>
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
                <SiteIcon url={link.url} name={link.name} />
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
            <button type="button" onClick={onRequestAdd} aria-label="Adicionar atalho">
              <span>
                <Plus aria-hidden="true" />
              </span>
              <small>Adicionar</small>
            </button>
          </div>
        </div>
        {onTool && <ToolsGrid onTool={onTool} mac={mac} />}
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
