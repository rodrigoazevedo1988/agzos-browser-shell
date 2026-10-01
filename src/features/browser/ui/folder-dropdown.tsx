import { useState } from "react";
import { Folder } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuSeparator,
  DropdownMenuPortal,
} from "@/components/ui/dropdown-menu";
import { BookmarkIcon } from "./bookmark-icon";
import { childrenOf } from "../bookmarks";
import type { BookmarkNode } from "../types";

function RecursiveFolderItems({
  nodes,
  folderId,
  depth,
  onOpen,
}: {
  nodes: BookmarkNode[];
  folderId: string;
  depth: number;
  onOpen: (node: BookmarkNode, newTab: boolean) => void;
}) {
  const items = childrenOf(nodes, folderId);
  const urls = items.filter((node) => node.kind === "url");

  if (items.length === 0) {
    return (
      <DropdownMenuItem disabled className="text-muted-foreground italic">
        (vazia)
      </DropdownMenuItem>
    );
  }

  return (
    <>
      {items.map((node) => {
        if (node.kind === "folder" && depth < 8) {
          return (
            <DropdownMenuSub key={node.id}>
              <DropdownMenuSubTrigger className="flex items-center gap-2 rounded-md">
                <Folder className="w-4 h-4 text-primary" />
                <span className="flex-1 truncate">{node.title}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="glass-panel min-w-[200px] border-border/60 shadow-xl rounded-xl p-1 animate-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:zoom-out-95 duration-200">
                  <RecursiveFolderItems
                    nodes={nodes}
                    folderId={node.id}
                    depth={depth + 1}
                    onOpen={onOpen}
                  />
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          );
        }

        return (
          <DropdownMenuItem
            key={node.id}
            onClick={(e) => onOpen(node, e.ctrlKey || e.metaKey)}
            onAuxClick={(e) => {
              if (e.button === 1) onOpen(node, true);
            }}
            className="flex items-center gap-2 rounded-md hover:bg-accent cursor-pointer group"
          >
            <BookmarkIcon node={node} />
            <span className="flex-1 truncate group-hover:font-medium transition-all">
              {node.title || node.url || "Favorito"}
            </span>
          </DropdownMenuItem>
        );
      })}

      {urls.length > 1 && (
        <>
          <DropdownMenuSeparator className="bg-border/50" />
          <DropdownMenuItem
            className="font-medium text-primary hover:bg-primary/10 rounded-md"
            onClick={() => urls.forEach((node) => onOpen(node, true))}
          >
            Abrir todos ({urls.length})
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}

const CONTENT_CLASS =
  "glass-panel min-w-[220px] max-h-[70vh] overflow-y-auto border-border/60 shadow-2xl rounded-xl p-1 animate-in fade-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 duration-200";

/**
 * Menu da pasta no app: o mesmo dropdown (vidro, subpastas, teclado), desenhado na camada
 * transparente acima da página (overlay), ancorado no retângulo do chip da pasta (`anchor`,
 * em px da janela). Na casca ele ficaria atrás do WebContentsView da página.
 */
export function FolderMenu({
  folderId,
  nodes,
  anchor,
  onOpen,
  onClose,
}: {
  folderId: string;
  nodes: BookmarkNode[];
  anchor: { x: number; y: number; width: number; height: number };
  onOpen: (node: BookmarkNode, newTab: boolean) => void;
  onClose: () => void;
}) {
  return (
    <DropdownMenu open modal={false} onOpenChange={(open) => !open && onClose()}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          style={{
            position: "fixed",
            left: anchor.x,
            top: anchor.y,
            width: anchor.width,
            height: anchor.height,
            pointerEvents: "none",
          }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        aria-label="Pasta de favoritos"
        className={CONTENT_CLASS}
        // Clique fora: quem fecha é a camada, que repassa o clique para o que está embaixo.
        onPointerDownOutside={(event) => event.preventDefault()}
        onFocusOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <RecursiveFolderItems nodes={nodes} folderId={folderId} depth={0} onOpen={onOpen} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FolderDropdown({
  folderId,
  nodes,
  children,
  onOpen,
}: {
  folderId: string;
  nodes: BookmarkNode[];
  children: React.ReactNode;
  onOpen: (node: BookmarkNode, newTab: boolean) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {/* O menu de contexto (botão direito) do próprio favorito deve passar reto: fechamos
          o dropdown e deixamos o onContextMenu do botão abrir o menu de edição. */}
      <DropdownMenuTrigger asChild onContextMenu={() => setOpen(false)}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={CONTENT_CLASS}>
        <RecursiveFolderItems nodes={nodes} folderId={folderId} depth={0} onOpen={onOpen} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
