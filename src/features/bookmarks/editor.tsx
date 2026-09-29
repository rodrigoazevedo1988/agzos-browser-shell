import { Star, Trash2, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { folderOptions, normalizeBookmarkUrl } from "@/features/browser/bookmarks";
import type { BookmarkNode } from "@/features/browser/types";

/**
 * Edição de um favorito ou pasta: nome, endereço e pasta. É o popover da estrela
 * ("Favorito adicionado") e o "Editar…" da barra e do gerenciador.
 */
export function BookmarkEditor({
  node,
  nodes,
  added,
  onSave,
  onRemove,
  onClose,
}: {
  node: BookmarkNode;
  nodes: BookmarkNode[];
  /** Acabou de ser criado pela estrela. */
  added: boolean;
  onSave: (changes: { title: string; url?: string; parentId: string }) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(node.title);
  const [url, setUrl] = useState(node.url ?? "");
  const [parentId, setParentId] = useState(node.parentId);
  const [invalid, setInvalid] = useState(false);
  const folder = node.kind === "folder";
  // Pasta não pode ir para dentro dela mesma.
  const options = folderOptions(nodes).filter((option) => option.id !== node.id);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (folder) {
      onSave({ title: title.trim() || node.title, parentId });
      return;
    }
    const clean = normalizeBookmarkUrl(url);
    if (!clean) {
      setInvalid(true);
      return;
    }
    onSave({ title: title.trim() || clean, url: clean, parentId });
  }

  const heading = folder ? "Editar pasta" : added ? "Favorito adicionado" : "Editar favorito";

  return (
    <aside className="key-panel bookmark-editor" aria-label={heading}>
      <div className="panel-heading">
        <div className="panel-title">
          <span className="key-mark">
            <Star />
          </span>
          <div>
            <strong>{heading}</strong>
            <small>{folder ? "Nome e local da pasta" : "Nome, endereço e pasta"}</small>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar favorito">
          <X />
        </Button>
      </div>
      <form className="bookmark-form" onSubmit={submit}>
        <label>
          <span>Nome</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-label="Nome do favorito"
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        {!folder && (
          <label>
            <span>Endereço</span>
            <input
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setInvalid(false);
              }}
              aria-label="Endereço do favorito"
              aria-invalid={invalid}
            />
            {invalid && <small className="form-error">Endereço inválido</small>}
          </label>
        )}
        <label>
          <span>Pasta</span>
          <select
            value={parentId}
            onChange={(event) => setParentId(event.target.value)}
            aria-label="Pasta do favorito"
          >
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {`${"  ".repeat(option.depth)}${option.title}`}
              </option>
            ))}
          </select>
        </label>
        <div className="bookmark-form-actions">
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            <Trash2 /> Remover
          </Button>
          <Button type="submit" size="sm">
            Concluído
          </Button>
        </div>
      </form>
    </aside>
  );
}
