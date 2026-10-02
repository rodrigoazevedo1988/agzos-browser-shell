import { useEffect, useId, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { domainOf } from "@/features/browser/favicon";
import type { QuickLink } from "@/features/browser/types";
import { SiteIcon } from "@/features/browser/ui/site-icon";
import { KEY_SOUND } from "@/features/sounds/sounds";

import { DIAL_CATEGORIES, dialLinkOf } from "./dial";

/** Espera o usuário parar de digitar antes de buscar o ícone do domínio. */
function useSettled<T>(value: T, delay = 350): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/**
 * Modal de novo site (3.1.1), o mesmo no Discador e no "Adicionar" da home: nome, endereço,
 * categoria e a prévia do card com o favicon do domínio (buscado sozinho).
 */
export function LinkDialog({
  title,
  existing,
  categories,
  onSave,
  onCancel,
}: {
  title: string;
  /** Endereços já salvos no destino (não entram duas vezes). */
  existing: string[];
  /** Categorias já usadas, sugeridas junto com as padrão. */
  categories: string[];
  onSave: (link: QuickLink) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [category, setCategory] = useState("Geral");
  const [error, setError] = useState<string | null>(null);
  const listId = useId();

  const domain = useSettled(domainOf(address.trim()) ?? "");
  const preview = dialLinkOf(name, address, category);
  const shownName = preview?.name ?? (name.trim() || "Nome do site");
  const suggestions = [...new Set([...DIAL_CATEGORIES, ...categories])];

  function submit(event: FormEvent) {
    event.preventDefault();
    const link = dialLinkOf(name, address, category);
    if (!link) {
      setError("Digite um endereço como site.com");
      return;
    }
    if (existing.includes(link.url)) {
      setError("Esse site já está salvo aqui.");
      return;
    }
    onSave(link);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="link-dialog" {...KEY_SOUND}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>O ícone vem sozinho do site, pelo domínio.</DialogDescription>
        </DialogHeader>
        <form className="link-dialog-form" onSubmit={submit} aria-label={title}>
          <label>
            <span>Nome</span>
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ex.: Notícias do dia"
              maxLength={60}
            />
          </label>
          <label>
            <span>URL</span>
            <input
              value={address}
              onChange={(event) => {
                setAddress(event.target.value);
                setError(null);
              }}
              placeholder="site.com"
              inputMode="url"
              aria-invalid={error !== null}
            />
          </label>
          <label>
            <span>Categoria</span>
            <input
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              list={listId}
              maxLength={40}
              placeholder="Geral"
            />
            <datalist id={listId}>
              {suggestions.map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </label>
          {error && (
            <p className="link-dialog-error" role="alert">
              {error}
            </p>
          )}
          <div className="link-dialog-preview" aria-label="Prévia do card">
            <div className="dial-card preview">
              <span className="dial-open">
                {domain ? (
                  <SiteIcon
                    key={domain}
                    url={domain}
                    name={shownName}
                    className="site-icon dial-icon"
                  />
                ) : (
                  <span className="site-icon dial-icon">
                    <span className="site-icon-letter">?</span>
                  </span>
                )}
                <strong>{shownName}</strong>
                <small>{preview?.url ?? (address.trim() || "site.com")}</small>
                {category.trim() && <em className="dial-category">{category.trim()}</em>}
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Cancelar
            </Button>
            <Button type="submit">Salvar</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
