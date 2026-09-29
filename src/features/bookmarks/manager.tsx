import {
  Download,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useMemo, useRef, useState, type DragEvent, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  BOOKMARK_ROOTS,
  ROOT_TITLES,
  childrenOf,
  exportNetscapeBookmarks,
  folderPath,
  isRoot,
  newBookmarkId,
  normalizeBookmarkUrl,
  parseNetscapeBookmarks,
} from "@/features/browser/bookmarks";
import { hostOf } from "@/features/browser/store/selectors";
import { BOOKMARK_BAR, type BookmarkNode } from "@/features/browser/types";
import { BookmarkIcon } from "@/features/browser/ui/bookmark-icon";
import { cn } from "@/lib/utils";

const DRAG_TYPE = "application/x-agzos-bookmark";

export type BookmarkActions = {
  add: (nodes: BookmarkNode[], index?: number) => void;
  update: (id: string, changes: { title?: string; url?: string }) => void;
  move: (id: string, parentId: string, index?: number) => void;
  remove: (id: string) => void;
};

type Draft = { id: string | null; kind: "url" | "folder"; title: string; url: string };

export function BookmarksManager({
  nodes,
  actions,
  onOpen,
}: {
  nodes: BookmarkNode[];
  actions: BookmarkActions;
  onOpen: (url: string, newTab: boolean) => void;
}) {
  const [folderId, setFolderId] = useState<string>(BOOKMARK_BAR);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // A pasta aberta pode ter sido apagada.
  const current =
    isRoot(folderId) || nodes.some((node) => node.id === folderId) ? folderId : BOOKMARK_BAR;
  const query = text.trim().toLowerCase();
  const rows = useMemo(
    () =>
      query
        ? nodes.filter(
            (node) =>
              node.title.toLowerCase().includes(query) ||
              (node.url ?? "").toLowerCase().includes(query),
          )
        : childrenOf(nodes, current),
    [nodes, current, query],
  );

  function flash(text: string) {
    setMessage(text);
    window.setTimeout(() => setMessage((value) => (value === text ? null : value)), 3500);
  }

  function saveDraft(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    if (draft.kind === "url") {
      const url = normalizeBookmarkUrl(draft.url);
      if (!url) {
        flash("Endereço inválido");
        return;
      }
      if (draft.id) actions.update(draft.id, { title: draft.title || url, url });
      else
        actions.add([
          {
            id: newBookmarkId(),
            parentId: current,
            kind: "url",
            title: draft.title.trim() || hostOf(url) || url,
            url,
            createdAt: Date.now(),
          },
        ]);
    } else if (draft.id) {
      actions.update(draft.id, { title: draft.title });
    } else {
      actions.add([
        {
          id: newBookmarkId(),
          parentId: current,
          kind: "folder",
          title: draft.title.trim() || "Nova pasta",
          createdAt: Date.now(),
        },
      ]);
    }
    setDraft(null);
  }

  async function importFile(file: File) {
    const html = await file.text();
    const imported = parseNetscapeBookmarks(html, BOOKMARK_BAR);
    if (!imported.length) {
      flash("Nenhum favorito encontrado no arquivo");
      return;
    }
    // Tudo numa pasta própria, para não misturar com os favoritos que já existem.
    const folder: BookmarkNode = {
      id: newBookmarkId(),
      parentId: BOOKMARK_BAR,
      kind: "folder",
      title: `Importados ${new Date().toLocaleDateString("pt-BR")}`,
      createdAt: Date.now(),
    };
    actions.add([
      folder,
      ...imported.map((node) =>
        node.parentId === BOOKMARK_BAR ? { ...node, parentId: folder.id } : node,
      ),
    ]);
    setFolderId(folder.id);
    flash(`${imported.filter((node) => node.kind === "url").length} favoritos importados`);
  }

  function exportFile() {
    const blob = new Blob([exportNetscapeBookmarks(nodes)], { type: "text/html" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `favoritos-agzos-${new Date().toISOString().slice(0, 10)}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  }

  const dragStart = (event: DragEvent, node: BookmarkNode) => {
    event.dataTransfer.setData(DRAG_TYPE, node.id);
    event.dataTransfer.effectAllowed = "move";
  };
  const over = (event: DragEvent, key: string) => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    setDropAt(key);
  };
  const dropInto = (event: DragEvent, parentId: string, index?: number) => {
    event.preventDefault();
    event.stopPropagation();
    setDropAt(null);
    const id = event.dataTransfer.getData(DRAG_TYPE);
    if (!id || id === parentId) return;
    const siblings = childrenOf(nodes, parentId);
    const from = siblings.findIndex((node) => node.id === id);
    actions.move(
      id,
      parentId,
      index !== undefined && from >= 0 && from < index ? index - 1 : index,
    );
  };

  const renderTree = (parentId: string, depth: number) =>
    childrenOf(nodes, parentId)
      .filter((node) => node.kind === "folder")
      .map((node) => (
        <li key={node.id}>
          {treeButton(node.id, node.title, depth)}
          <ul>{renderTree(node.id, depth + 1)}</ul>
        </li>
      ));

  const treeButton = (id: string, title: string, depth: number) => (
    <button
      type="button"
      className={cn(
        "library-folder",
        current === id && !query && "selected",
        dropAt === `tree-${id}` && "drop-target",
      )}
      style={{ paddingLeft: 10 + depth * 14 }}
      onClick={() => {
        setFolderId(id);
        setText("");
      }}
      onDragOver={(event) => over(event, `tree-${id}`)}
      onDragLeave={() => setDropAt(null)}
      onDrop={(event) => dropInto(event, id)}
    >
      {current === id ? <FolderOpen aria-hidden="true" /> : <Folder aria-hidden="true" />}
      <span>{title}</span>
    </button>
  );

  return (
    <div className="library-page bookmarks-manager" aria-label="Favoritos">
      <header className="library-head">
        <div className="library-title">
          <Star aria-hidden="true" />
          <div>
            <h1>Favoritos</h1>
            <p>Organize em pastas, arraste para reordenar e importe do Chrome, Firefox ou Edge.</p>
          </div>
        </div>
        <label className="library-search">
          <Search aria-hidden="true" />
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Pesquisar favoritos"
            aria-label="Pesquisar favoritos"
          />
          {text && (
            <button type="button" aria-label="Limpar pesquisa" onClick={() => setText("")}>
              <X />
            </button>
          )}
        </label>
        <div className="library-clear">
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload /> Importar
          </Button>
          <Button variant="outline" size="sm" onClick={exportFile} disabled={!nodes.length}>
            <Download /> Exportar
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".html,.htm,text/html"
            hidden
            aria-label="Arquivo de favoritos"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importFile(file);
            }}
          />
        </div>
      </header>
      {message && (
        <p className="library-message" role="status">
          {message}
        </p>
      )}

      <div className="bookmarks-layout">
        <nav className="library-tree" aria-label="Pastas">
          <ul>
            {BOOKMARK_ROOTS.map((root) => (
              <li key={root}>
                {treeButton(root, ROOT_TITLES[root]!, 0)}
                <ul>{renderTree(root, 1)}</ul>
              </li>
            ))}
          </ul>
        </nav>

        <section
          className="library-folder-view"
          onDragOver={(event) => !query && over(event, "list")}
          onDragLeave={() => setDropAt(null)}
          onDrop={(event) => !query && dropInto(event, current)}
        >
          <div className="library-folder-head">
            <h2>
              {query ? `Resultados para "${text.trim()}"` : folderPath(nodes, current).join(" › ")}
            </h2>
            {!query && (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraft({ id: null, kind: "url", title: "", url: "" })}
                >
                  <Plus /> Favorito
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDraft({ id: null, kind: "folder", title: "", url: "" })}
                >
                  <FolderPlus /> Pasta
                </Button>
              </div>
            )}
          </div>

          {draft && (
            <form className="library-draft" onSubmit={saveDraft}>
              <input
                value={draft.title}
                onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                placeholder={draft.kind === "folder" ? "Nome da pasta" : "Nome"}
                aria-label={draft.kind === "folder" ? "Nome da pasta" : "Nome do favorito"}
                autoFocus
              />
              {draft.kind === "url" && (
                <input
                  value={draft.url}
                  onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                  placeholder="site.com"
                  aria-label="Endereço do favorito"
                />
              )}
              <Button size="sm" type="submit">
                Salvar
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => setDraft(null)}>
                Cancelar
              </Button>
            </form>
          )}

          {rows.length === 0 && !draft && (
            <p className="library-empty">
              {query ? "Nenhum favorito encontrado." : "Pasta vazia. Arraste favoritos para cá."}
            </p>
          )}
          <ul>
            {rows.map((node, index) => {
              const folder = node.kind === "folder";
              return (
                <li
                  key={node.id}
                  className={cn("library-row", dropAt === node.id && "drop-target")}
                  draggable
                  onDragStart={(event) => dragStart(event, node)}
                  onDragOver={(event) => over(event, node.id)}
                  onDrop={(event) =>
                    folder ? dropInto(event, node.id) : dropInto(event, node.parentId, index)
                  }
                >
                  {folder ? (
                    <Folder className="library-row-folder" aria-hidden="true" />
                  ) : (
                    <BookmarkIcon node={node} />
                  )}
                  <button
                    type="button"
                    className="library-link"
                    title={node.url ?? node.title}
                    onClick={(event) =>
                      folder
                        ? (setFolderId(node.id), setText(""))
                        : onOpen(node.url!, event.ctrlKey || event.metaKey)
                    }
                    onAuxClick={(event) => {
                      if (event.button === 1 && !folder) onOpen(node.url!, true);
                    }}
                  >
                    <strong>{node.title || node.url}</strong>
                    <span>
                      {folder
                        ? `${childrenOf(nodes, node.id).length} itens`
                        : query
                          ? folderPath(nodes, node.parentId).join(" › ")
                          : (hostOf(node.url ?? "") ?? node.url)}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Editar ${node.title}`}
                    title="Editar"
                    onClick={() =>
                      setDraft({
                        id: node.id,
                        kind: node.kind,
                        title: node.title,
                        url: node.url ?? "",
                      })
                    }
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Excluir ${node.title}`}
                    title={folder ? "Excluir pasta e o que está dentro" : "Excluir"}
                    onClick={() => actions.remove(node.id)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
