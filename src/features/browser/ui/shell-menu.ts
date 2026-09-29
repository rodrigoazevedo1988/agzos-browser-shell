import { childrenOf } from "../bookmarks";
import type { NativeMenuItem } from "../desktop";
import type { ContextMenuGroup } from "../tab-menu";
import type { BookmarkNode } from "../types";

/** Conteúdo de uma pasta de favoritos como menu (subpastas viram submenus). */
export function folderMenu(nodes: BookmarkNode[], folderId: string, depth = 0): NativeMenuItem[] {
  const items: NativeMenuItem[] = childrenOf(nodes, folderId).map((node) =>
    node.kind === "folder" && depth < 8
      ? { label: node.title, children: folderMenu(nodes, node.id, depth + 1) }
      : { id: `open:${node.id}`, label: node.title || node.url || "Favorito" },
  );
  const urls = childrenOf(nodes, folderId).filter((node) => node.kind === "url");
  if (urls.length > 1) {
    items.push(
      { separator: true },
      { id: `open-all:${folderId}`, label: `Abrir todos (${urls.length})` },
    );
  }
  if (!items.length) items.push({ id: "empty", label: "(vazia)", enabled: false });
  return items;
}

/**
 * Menu da versão web (sem menu nativo): submenus não existem no ContextMenu da casca,
 * então a pasta vira um item que reabre o menu com o conteúdo dela.
 */
export function webMenuGroups(
  items: NativeMenuItem[],
  pick: (id: string) => void,
  openSubmenu: (items: NativeMenuItem[]) => void,
): ContextMenuGroup[] {
  const groups: ContextMenuGroup[] = [];
  let current: Exclude<ContextMenuGroup, "separator"> = [];
  items.forEach((item, index) => {
    if ("separator" in item) {
      if (current.length) groups.push(current, "separator");
      current = [];
      return;
    }
    if ("children" in item) {
      current.push({
        id: `submenu-${index}`,
        label: `${item.label} ›`,
        onSelect: () => openSubmenu(item.children),
      });
      return;
    }
    current.push({
      id: item.id,
      label: item.label,
      disabled: item.enabled === false,
      onSelect: () => pick(item.id),
    });
  });
  if (current.length) groups.push(current);
  while (groups[groups.length - 1] === "separator") groups.pop();
  return groups;
}
