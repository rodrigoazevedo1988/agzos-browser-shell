import { Folder } from "lucide-react";
import { useEffect, useRef } from "react";
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
  onOpen: (node: BookmarkNode) => void;
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
            onClick={() => onOpen(node)}
            onAuxClick={(e) => {
              if (e.button === 1) onOpen(node);
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
            onClick={() => urls.forEach((node) => onOpen(node))}
          >
            Abrir todos ({urls.length})
          </DropdownMenuItem>
        </>
      )}
    </>
  );
}

const CONTENT_CLASS =
  "folder-menu glass-panel min-w-[220px] max-h-[70vh] overflow-y-auto border-border/60 shadow-2xl rounded-xl p-1 animate-in fade-in zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:zoom-out-95 duration-200";

export type FolderAnchor = { x: number; y: number; width: number; height: number };

/**
 * Menu da pasta no app: o mesmo dropdown (vidro, subpastas, teclado), desenhado na camada
 * transparente acima da página (overlay), ancorado no retângulo do chip da pasta (`anchor`,
 * em px da janela). Na casca ele ficaria atrás do WebContentsView da página.
 */
export function FolderMenu({
  folderId,
  nodes,
  anchor,
  siblings = [],
  enterFrom = null,
  onOpen,
  onSwitch,
  onClose,
}: {
  folderId: string;
  nodes: BookmarkNode[];
  anchor: FolderAnchor;
  /**
   * As outras pastas da barra (chips da casca, por baixo da camada). Com o menu aberto,
   * passar o mouse numa delas troca o menu para ela, como numa barra de menus.
   */
  siblings?: { folderId: string; anchor: FolderAnchor }[];
  /** De que lado veio a troca: o menu novo desliza a partir dele. */
  enterFrom?: "left" | "right" | null;
  onOpen: (node: BookmarkNode) => void;
  onSwitch?: (folderId: string, anchor: FolderAnchor) => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* Zonas sobre os chips das pastas: a camada cobre a barra, então o hover é aqui. */}
      {siblings.map((sibling) => (
        <FolderHoverZone
          key={sibling.folderId}
          sibling={sibling}
          current={sibling.folderId === folderId}
          onSwitch={() => onSwitch?.(sibling.folderId, sibling.anchor)}
          onClose={onClose}
        />
      ))}
      <FolderMenuContent
        folderId={folderId}
        nodes={nodes}
        anchor={anchor}
        enterFrom={enterFrom}
        onOpen={onOpen}
        onClose={onClose}
      />
    </>
  );
}

/**
 * Zona sobre o chip de uma pasta da barra (na camada, por cima da casca). Troca o menu
 * pelo hover da camada ou pelo cursor que o main acompanha ("agzos-pointer", ver
 * followFolderPointer em electron/main.cjs): vale o que chegar primeiro.
 */
function FolderHoverZone({
  sibling,
  current,
  onSwitch,
  onClose,
}: {
  sibling: { folderId: string; anchor: FolderAnchor };
  current: boolean;
  onSwitch: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const switchRef = useRef(onSwitch);
  switchRef.current = onSwitch;
  useEffect(() => {
    const zone = ref.current;
    if (!zone || current) return;
    const onPointer = () => switchRef.current();
    zone.addEventListener("agzos-pointer", onPointer);
    return () => zone.removeEventListener("agzos-pointer", onPointer);
  }, [current]);

  return (
    <span
      ref={ref}
      className="folder-hover-zone"
      data-folder-zone={sibling.folderId}
      aria-hidden="true"
      style={{
        left: sibling.anchor.x,
        top: sibling.anchor.y,
        width: sibling.anchor.width,
        height: sibling.anchor.height,
      }}
      onPointerEnter={() => {
        if (!current) onSwitch();
      }}
      onPointerDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        // Clique na própria pasta fecha; em outra, abre a outra (o hover já trocou).
        if (current) onClose();
        else onSwitch();
      }}
    />
  );
}

function FolderMenuContent({
  folderId,
  nodes,
  anchor,
  enterFrom,
  onOpen,
  onClose,
}: {
  folderId: string;
  nodes: BookmarkNode[];
  anchor: FolderAnchor;
  enterFrom: "left" | "right" | null;
  onOpen: (node: BookmarkNode) => void;
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
        data-enter-from={enterFrom ?? undefined}
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
  open,
  onOpenChange,
}: {
  folderId: string;
  nodes: BookmarkNode[];
  children: React.ReactNode;
  onOpen: (node: BookmarkNode) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const setOpen = onOpenChange;

  // Sem modal: com uma pasta aberta, o hover nos outros chips continua chegando à barra.
  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
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
