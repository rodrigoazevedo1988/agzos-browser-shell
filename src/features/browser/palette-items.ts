import { commands, isEnabled, labelOf, shortcutLabel, type CommandContext } from "./commands";
import type { PaletteItem } from "./palette";
import { activeTabOf, entryOf, hostOf, orderTabs } from "./store/selectors";

/** Comandos que não fazem sentido na busca (atalhos de posição, o próprio Ctrl+K). */
const HIDDEN = new Set<string>([
  "palette.open",
  "tab.switch-recent",
  "tab.switch-recent-back",
  "tab.select-last",
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `tab.select-${n}`),
]);

/** Tudo o que a busca de comandos oferece, na ordem dos grupos. */
export function paletteItems(ctx: CommandContext, { mac }: { mac: boolean }): PaletteItem[] {
  const { state } = ctx;
  const active = activeTabOf(state);
  const items: PaletteItem[] = [];

  for (const tab of orderTabs(state.tabs)) {
    const entry = entryOf(tab);
    const title = entry.kind === "home" ? "Nova aba" : entry.title;
    items.push({
      id: `tab:${tab.id}`,
      group: "Guias",
      label: title,
      detail: tab.id === active.id ? "Guia atual" : (hostOf(entry.url) ?? undefined),
      icon: tab.favicon,
      keywords: entry.url,
    });
  }

  if (state.workspaces.length > 1) {
    for (const workspace of state.workspaces) {
      items.push({
        id: `ws:${workspace.id}`,
        group: "Workspaces",
        label: `${workspace.icon} ${workspace.name}`,
        detail: workspace.id === state.activeWorkspaceId ? "Workspace atual" : undefined,
        keywords: "workspace espaço",
      });
    }
  }

  for (const command of commands) {
    if (HIDDEN.has(command.id)) continue;
    if (command.visible && !command.visible(ctx, active.id)) continue;
    if (!isEnabled(ctx, command, active.id)) continue;
    items.push({
      id: `cmd:${command.id}`,
      group: "Comandos",
      label: labelOf(command, ctx, active.id),
      shortcut: shortcutLabel(command, mac),
      keywords: command.id.replace(/[.-]/g, " "),
    });
  }

  for (const node of state.bookmarks) {
    if (node.kind !== "url" || !node.url) continue;
    items.push({
      id: `url:${node.url}`,
      group: "Favoritos",
      label: node.title,
      detail: hostOf(node.url) ?? undefined,
      icon: node.icon,
      keywords: node.url,
    });
  }

  return items;
}
