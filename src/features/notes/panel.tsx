import { Eye, NotebookPen, Pencil, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Markdown } from "@/features/ai/markdown-view";
import type { PageNote } from "@/features/browser/types";
import { cn } from "@/lib/utils";

import { otherNotes } from "./model";

/**
 * Notas (4.5): uma nota por página (pela URL), guardada só neste computador. Markdown
 * simples: escreve no editor, vê formatado em "Ver".
 */
export function NotesPanel({
  pageKey,
  pageTitle,
  pageUrl,
  notes,
  onChange,
  onDelete,
  onOpen,
  onClose,
}: {
  /** null: a página atual não aceita nota (ex.: nova aba). */
  pageKey: string | null;
  pageTitle: string;
  pageUrl: string;
  notes: Record<string, PageNote>;
  /** Grava a nota de `key` (texto vazio apaga). */
  onChange: (change: { key: string; url: string; title: string; text: string }) => void;
  onDelete: (key: string) => void;
  onOpen: (url: string) => void;
  onClose: () => void;
}) {
  const note = pageKey ? notes[pageKey] : undefined;
  const [mode, setMode] = useState<"edit" | "view">(note?.text ? "view" : "edit");
  const [draft, setDraft] = useState(note?.text ?? "");
  const [query, setQuery] = useState("");
  const editorRef = useRef<HTMLTextAreaElement | null>(null);

  // O rascunho pendente leva a página dele: trocar de guia ou fechar o painel no meio da
  // digitação grava na nota certa.
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const pendingRef = useRef({ key: pageKey, url: pageUrl, title: pageTitle, draft, saved: "" });
  // Atualizado depois de cada render: na limpeza da troca de página ainda vale a anterior.
  useEffect(() => {
    pendingRef.current = {
      key: pageKey,
      url: pageUrl,
      title: pageTitle,
      draft,
      saved: note?.text ?? "",
    };
  });
  const flush = () => {
    const pending = pendingRef.current;
    if (pending.key && pending.draft !== pending.saved) {
      changeRef.current({
        key: pending.key,
        url: pending.url,
        title: pending.title,
        text: pending.draft,
      });
      pendingRef.current = { ...pending, saved: pending.draft };
    }
  };
  const save = (text: string) => {
    pendingRef.current = { ...pendingRef.current, draft: text };
    flush();
  };

  // Trocou de página: o rascunho passa a ser a nota dela.
  useEffect(() => {
    setDraft(note?.text ?? "");
    setMode(note?.text ? "view" : "edit");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageKey]);

  // Gravação com um respiro (cada tecla não vira uma gravação); a pendente sai ao trocar de
  // página ou fechar.
  useEffect(() => {
    if (!pageKey || draft === (note?.text ?? "")) return;
    const timer = window.setTimeout(flush, 400);
    return () => window.clearTimeout(timer);
  }, [draft, pageKey, note?.text]);
  useEffect(() => () => flush(), [pageKey]);

  const others = useMemo(() => otherNotes(notes, pageKey, query), [notes, pageKey, query]);

  return (
    <aside className="notes-panel" aria-label="Notas" data-notes-panel>
      <header className="notes-head">
        <NotebookPen aria-hidden="true" />
        <strong>Notas</strong>
        {pageKey && (
          <div className="notes-mode" role="radiogroup" aria-label="Modo da nota">
            <button
              type="button"
              role="radio"
              aria-checked={mode === "edit"}
              onClick={() => {
                setMode("edit");
                setTimeout(() => editorRef.current?.focus(), 0);
              }}
            >
              <Pencil aria-hidden="true" /> Editar
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === "view"}
              onClick={() => {
                // Sai do editor já gravando o que foi digitado.
                save(draft);
                setMode("view");
              }}
            >
              <Eye aria-hidden="true" /> Ver
            </button>
          </div>
        )}
        <Button variant="ghost" size="icon" aria-label="Fechar notas" onClick={onClose}>
          <X />
        </Button>
      </header>

      <div className="notes-body">
        {pageKey ? (
          <section className="notes-current" aria-label="Nota desta página">
            <p className="notes-page" title={pageUrl}>
              {pageTitle || pageUrl}
            </p>
            {mode === "edit" ? (
              <textarea
                ref={editorRef}
                className="notes-editor"
                aria-label="Nota desta página"
                placeholder={
                  "Escreva aqui (markdown simples: # título, **negrito**, - lista, [link](https://…))"
                }
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => save(draft)}
              />
            ) : draft.trim() ? (
              <div className="notes-view">
                <Markdown
                  text={draft}
                  artifactPrefix={null}
                  onLink={onOpen}
                  onArtifact={() => {}}
                />
              </div>
            ) : (
              <p className="notes-empty">Sem nota nesta página ainda.</p>
            )}
            <div className="notes-actions">
              <small>
                {note
                  ? `Salva neste computador · ${new Date(note.updatedAt).toLocaleString("pt-BR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}`
                  : "A nota é salva neste computador, só para esta página."}
              </small>
              {note && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDraft("");
                    onDelete(pageKey);
                  }}
                >
                  <Trash2 /> Apagar
                </Button>
              )}
            </div>
          </section>
        ) : (
          <p className="notes-empty">Abra um site para escrever uma nota sobre ele.</p>
        )}

        <section className="notes-others" aria-label="Outras notas">
          <h3>Outras notas</h3>
          <label className="notes-search">
            <Search aria-hidden="true" />
            <input
              type="search"
              aria-label="Buscar notas"
              placeholder="Buscar notas"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {others.length === 0 ? (
            <p className="notes-empty">{query ? "Nada encontrado." : "Nenhuma outra nota."}</p>
          ) : (
            <ul>
              {others.map(([key, item]) => (
                <li key={key}>
                  <button
                    type="button"
                    className={cn("notes-link")}
                    title={item.url}
                    onClick={() => onOpen(item.url)}
                  >
                    <strong>{item.title || item.url}</strong>
                    <span>{item.text.replace(/\s+/g, " ").slice(0, 90)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </aside>
  );
}
