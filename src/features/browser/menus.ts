import {
  commandById,
  labelOf,
  shortcutLabel,
  type CommandContext,
  type CommandId,
} from "./commands";
import type { ContextMenuGroup } from "./tab-menu";

type MenuLayout = (CommandId[] | "separator")[];

export const TAB_MENU: MenuLayout = [
  ["tab.new-right", "tab.reopen-closed", "tab.duplicate"],
  "separator",
  ["tab.toggle-pin", "tab.toggle-mute"],
  "separator",
  ["tab.reload", "tab.copy-url"],
  "separator",
  ["tab.close", "tab.close-others", "tab.close-right", "tab.close-left"],
  "separator",
  ["tabs.bookmark-all"],
  "separator",
  ["tabs.vertical", "tabs.horizontal"],
];

export const STRIP_MENU: MenuLayout = [
  ["tab.new", "tab.reopen-closed"],
  "separator",
  ["tabs.vertical", "tabs.horizontal"],
];

/** Monta o menu de contexto da versão web a partir do registro de comandos. */
export function buildMenu(
  layout: MenuLayout,
  ctx: CommandContext,
  tabId: number,
  mac: boolean,
): ContextMenuGroup[] {
  const groups: ContextMenuGroup[] = [];
  for (const group of layout) {
    if (group === "separator") {
      if (groups.length && groups[groups.length - 1] !== "separator") groups.push("separator");
      continue;
    }
    const items = group.flatMap((id) => {
      const command = commandById(id);
      if (!command || (command.visible && !command.visible(ctx, tabId))) return [];
      const shortcut = shortcutLabel(command, mac);
      return [
        {
          id,
          label: labelOf(command, ctx, tabId),
          ...(shortcut ? { shortcut } : {}),
          disabled: command.enabled ? !command.enabled(ctx, tabId) : false,
          onSelect: () => command.run(ctx, tabId, "menu"),
        },
      ];
    });
    if (items.length) groups.push(items);
  }
  while (groups[groups.length - 1] === "separator") groups.pop();
  return groups;
}
