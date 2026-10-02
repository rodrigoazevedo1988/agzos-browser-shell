import { Folder, FolderOpen } from "lucide-react";
import { useState, type DragEvent, type MouseEvent } from "react";

import { cn } from "@/lib/utils";

import { childrenOf } from "../bookmarks";
import { BOOKMARK_BAR, BOOKMARK_OTHER, type BookmarkNode } from "../types";
import { BookmarkIcon } from "./bookmark-icon";
import { FolderDropdown } from "./folder-dropdown";

const DRAG_TYPE = "application/x-agzos-bookmark";

export function BookmarksBar({
  nodes,
  onOpen,
  onFolder,
  onContextMenu,
  onMove,
  folderPanel = false,
  openFolderId = null,
}: {
  nodes: BookmarkNode[];
  /** Favoritos da barra sempre abrem numa guia nova (a página atual fica). */
  onOpen: (node: BookmarkNode) => void;
  /** Clique na pasta com `folderPanel` (app): a casca abre o menu da pasta na camada. */
  onFolder: (event: MouseEvent<HTMLElement>, folderId: string) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>, node: BookmarkNode | null) => void;
  onMove: (id: string, parentId: string, index?: number) => void;
  /**
   * App: a pasta abre o menu na camada acima da página (onFolder). Um dropdown desenhado
   * na casca ficaria atrás dela (o WebContentsView cobre o que flutua sobre a página).
   */
  folderPanel?: boolean;
  /** Pasta com o menu aberto na camada (app): o chip fica marcado. */
  openFolderId?: string | null;
}) {
  const items = childrenOf(nodes, BOOKMARK_BAR);
  const others = childrenOf(nodes, BOOKMARK_OTHER);
  const [dropAt, setDropAt] = useState<string | null>(null);
  // Web: pasta aberta na casca. Com uma aberta, passar o mouse em outra troca o menu
  // (como numa barra de menus); no app quem faz isso é o menu na camada.
  const [webOpen, setWebOpen] = useState<string | null>(null);
  const openId = folderPanel ? openFolderId : webOpen;
  const hoverFolder = (folderId: string) => {
    if (!folderPanel && webOpen && webOpen !== folderId) setWebOpen(folderId);
  };

  const dragStart = (event: DragEvent, node: BookmarkNode) => {
    event.dataTransfer.setData(DRAG_TYPE, node.id);
    event.dataTransfer.effectAllowed = "move";
  };
  const allowDrop = (event: DragEvent, key: string) => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    setDropAt(key);
  };
  const drop = (event: DragEvent, parentId: string, index?: number) => {
    const id = event.dataTransfer.getData(DRAG_TYPE);
    setDropAt(null);
    if (!id || id === parentId) return;
    event.preventDefault();
    // A posição conta sem o próprio item: vindo de antes na barra, desconta um.
    const from = items.findIndex((item) => item.id === id);
    const at = index !== undefined && from >= 0 && from < index ? index - 1 : index;
    onMove(id, parentId, at);
  };

  return (
    <nav
      className="bookmarks-bar"
      aria-label="Barra de favoritos"
      onContextMenu={(event) => {
        if (event.target === event.currentTarget) onContextMenu(event, null);
      }}
      onDragOver={(event) => allowDrop(event, "end")}
      onDragLeave={() => setDropAt(null)}
      onDrop={(event) => drop(event, BOOKMARK_BAR)}
    >
      {items.length === 0 && (
        <span className="bookmarks-empty">
          Para ver seus favoritos aqui, clique na estrela da barra de endereço.
        </span>
      )}
      {items.map((node, index) => {
        const folder = node.kind === "folder";
        const button = (
          <button
            key={node.id}
            type="button"
            className={cn(
              "bookmark-chip",
              dropAt === node.id && "drop-target",
              folder && openId === node.id && "open",
            )}
            data-folder-id={folder ? node.id : undefined}
            title={folder ? node.title : `${node.title}\n${node.url}`}
            draggable
            onDragStart={(event) => dragStart(event, node)}
            onDragOver={(event) => {
              event.stopPropagation();
              allowDrop(event, node.id);
            }}
            onDrop={(event) => {
              event.stopPropagation();
              drop(event, folder ? node.id : BOOKMARK_BAR, folder ? undefined : index);
            }}
            onClick={(event) => {
              if (!folder) onOpen(node);
              else if (folderPanel) onFolder(event, node.id);
            }}
            onPointerEnter={() => folder && hoverFolder(node.id)}
            onMouseDown={(event) => {
              if (event.button === 1) event.preventDefault();
            }}
            onAuxClick={(event) => {
              if (event.button === 1 && !folder) onOpen(node);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onContextMenu(event, node);
            }}
          >
            {folder ? <Folder aria-hidden="true" /> : <BookmarkIcon node={node} />}
            <span>{node.title || node.url}</span>
          </button>
        );

        return folder && !folderPanel ? (
          <FolderDropdown
            key={node.id}
            folderId={node.id}
            nodes={nodes}
            onOpen={onOpen}
            open={webOpen === node.id}
            onOpenChange={(open) =>
              setWebOpen((current) => (open ? node.id : current === node.id ? null : current))
            }
          >
            {button}
          </FolderDropdown>
        ) : (
          button
        );
      })}
      {others.length > 0 &&
        (() => {
          const othersButton = (
            <button
              type="button"
              className={cn("bookmark-chip bookmark-others", openId === BOOKMARK_OTHER && "open")}
              data-folder-id={BOOKMARK_OTHER}
              onClick={(event) => folderPanel && onFolder(event, BOOKMARK_OTHER)}
              onPointerEnter={() => hoverFolder(BOOKMARK_OTHER)}
              onDragOver={(event) => {
                event.stopPropagation();
                allowDrop(event, BOOKMARK_OTHER);
              }}
              onDrop={(event) => {
                event.stopPropagation();
                drop(event, BOOKMARK_OTHER);
              }}
            >
              <FolderOpen aria-hidden="true" />
              <span>Outros favoritos</span>
            </button>
          );
          return folderPanel ? (
            othersButton
          ) : (
            <FolderDropdown
              folderId={BOOKMARK_OTHER}
              nodes={nodes}
              onOpen={onOpen}
              open={webOpen === BOOKMARK_OTHER}
              onOpenChange={(open) =>
                setWebOpen((current) =>
                  open ? BOOKMARK_OTHER : current === BOOKMARK_OTHER ? null : current,
                )
              }
            >
              {othersButton}
            </FolderDropdown>
          );
        })()}
    </nav>
  );
}
