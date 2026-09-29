import type { Dispatch } from "react";

import type { DesktopBridge } from "./desktop";
import type { BrowserAction } from "./store/reducer";
import { activeTabOf, entryOf } from "./store/selectors";
import type { BrowserState } from "./store/state";

/**
 * Registro único de comandos do navegador. Atalhos de teclado, o menu de contexto da
 * versão web e o menu nativo do Electron (electron/main.cjs) disparam os mesmos IDs.
 */
export type CommandId =
  | "tab.new"
  | "tab.new-private"
  | "tab.new-right"
  | "tab.reopen-closed"
  | "tab.duplicate"
  | "tab.toggle-pin"
  | "tab.toggle-mute"
  | "tab.reload"
  | "tab.copy-url"
  | "tab.close"
  | "tab.close-others"
  | "tab.close-right"
  | "tab.close-left"
  | "tabs.bookmark-all"
  | "tabs.vertical"
  | "tabs.horizontal"
  | "omnibox.focus";

export type Shortcut = { key: string; shift?: boolean };
/** De onde veio o comando: atalho de teclado ou menu/botão. */
export type CommandSource = "keyboard" | "menu";

export type CommandContext = {
  state: BrowserState;
  dispatch: Dispatch<BrowserAction>;
  desktop: DesktopBridge | null;
  ui: {
    focusOmnibox: () => void;
    reload: (tabId: number) => void;
    requestClose: (tabId: number) => void;
    copy: (id: string, value: string) => void;
  };
};

export type Command = {
  id: CommandId;
  label: string | ((ctx: CommandContext, tabId: number) => string);
  shortcuts?: Shortcut[];
  enabled?: (ctx: CommandContext, tabId: number) => boolean;
  visible?: (ctx: CommandContext, tabId: number) => boolean;
  run: (ctx: CommandContext, tabId: number, source: CommandSource) => void;
};

const tabById = (ctx: CommandContext, tabId: number) =>
  ctx.state.tabs.find((tab) => tab.id === tabId);

export const commands: Command[] = [
  {
    id: "tab.new",
    label: "Nova guia",
    shortcuts: [{ key: "t" }],
    run: ({ dispatch }) => dispatch({ type: "tab/new" }),
  },
  {
    id: "tab.new-private",
    label: "Nova guia anônima",
    shortcuts: [{ key: "n", shift: true }],
    run: ({ dispatch }) => dispatch({ type: "tab/new", private: true }),
  },
  {
    id: "tab.new-right",
    label: "Nova guia à direita",
    run: ({ dispatch }, tabId) => dispatch({ type: "tab/new", rightOf: tabId }),
  },
  {
    id: "tab.reopen-closed",
    label: "Reabrir guia fechada",
    shortcuts: [{ key: "t", shift: true }],
    enabled: ({ state }) => state.closedTabs.length > 0,
    run: ({ dispatch }) => dispatch({ type: "tab/reopen-closed" }),
  },
  {
    id: "tab.duplicate",
    label: "Duplicar",
    run: ({ dispatch }, tabId) => dispatch({ type: "tab/duplicate", id: tabId }),
  },
  {
    id: "tab.toggle-pin",
    label: (ctx, tabId) => (tabById(ctx, tabId)?.pinned ? "Desfixar" : "Fixar"),
    run: ({ dispatch }, tabId) => dispatch({ type: "tab/toggle-pin", id: tabId }),
  },
  {
    id: "tab.toggle-mute",
    label: (ctx, tabId) =>
      tabById(ctx, tabId)?.muted ? "Ativar som do site" : "Desativar som do site",
    visible: (ctx, tabId) =>
      ctx.desktop !== null &&
      (ctx.state.audioPlaying.includes(tabId) || Boolean(tabById(ctx, tabId)?.muted)),
    run: ({ dispatch }, tabId) => dispatch({ type: "tab/toggle-mute", id: tabId }),
  },
  {
    id: "tab.reload",
    label: "Recarregar",
    shortcuts: [{ key: "r" }],
    run: ({ ui }, tabId) => ui.reload(tabId),
  },
  {
    id: "tab.copy-url",
    label: "Copiar endereço",
    run: (ctx, tabId) => {
      const tab = tabById(ctx, tabId);
      if (tab) ctx.ui.copy("copy-url", entryOf(tab).url);
    },
  },
  {
    id: "tab.close",
    label: "Fechar",
    shortcuts: [{ key: "w" }],
    // Como na 1.3: Ctrl+W fecha direto; pelo menu, aba fixada pede um segundo clique.
    run: ({ dispatch, ui }, tabId, source) =>
      source === "keyboard" ? dispatch({ type: "tab/close", id: tabId }) : ui.requestClose(tabId),
  },
  {
    id: "tab.close-others",
    label: "Fechar outras guias",
    run: ({ dispatch }, tabId) => dispatch({ type: "tab/close-others", id: tabId }),
  },
  {
    id: "tab.close-right",
    label: "Fechar guias à direita",
    run: ({ dispatch }, tabId) => dispatch({ type: "tab/close-side", id: tabId, direction: 1 }),
  },
  {
    id: "tab.close-left",
    label: "Fechar guias à esquerda",
    run: ({ dispatch }, tabId) => dispatch({ type: "tab/close-side", id: tabId, direction: -1 }),
  },
  {
    id: "tabs.bookmark-all",
    label: "Adicionar todas as guias aos favoritos…",
    shortcuts: [{ key: "d", shift: true }],
    run: ({ dispatch }) => dispatch({ type: "links/bookmark-all" }),
  },
  {
    id: "tabs.vertical",
    label: "Mostrar guias verticalmente",
    visible: ({ state }) => state.prefs.orientation === "horizontal",
    run: ({ dispatch }) => dispatch({ type: "prefs/set", patch: { orientation: "vertical" } }),
  },
  {
    id: "tabs.horizontal",
    label: "Mostrar guias horizontalmente",
    visible: ({ state }) => state.prefs.orientation === "vertical",
    run: ({ dispatch }) => dispatch({ type: "prefs/set", patch: { orientation: "horizontal" } }),
  },
  {
    id: "omnibox.focus",
    label: "Ir para a barra de endereço",
    shortcuts: [{ key: "l" }, { key: "k" }],
    run: ({ ui }) => ui.focusOmnibox(),
  },
];

const byId = new Map(commands.map((command) => [command.id, command]));

export function commandById(id: string): Command | undefined {
  return byId.get(id as CommandId);
}

/** Resolve Ctrl/⌘ + tecla (com ou sem Shift) para um comando. Alt nunca é atalho. */
export function commandForKey(input: {
  key: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}): Command | undefined {
  if (input.alt || !(input.ctrl || input.meta)) return undefined;
  const key = input.key.toLowerCase();
  return commands.find((command) =>
    command.shortcuts?.some(
      (shortcut) => shortcut.key === key && Boolean(shortcut.shift) === input.shift,
    ),
  );
}

export function shortcutLabel(command: Command, mac: boolean): string | undefined {
  const shortcut = command.shortcuts?.[0];
  if (!shortcut) return undefined;
  const parts = [mac ? "⌘" : "Ctrl", shortcut.shift ? "Shift" : null, shortcut.key.toUpperCase()];
  return parts.filter(Boolean).join(mac ? " " : "+");
}

export function runCommand(
  ctx: CommandContext,
  id: string,
  tabId?: number | null,
  source: CommandSource = "menu",
) {
  const command = commandById(id);
  if (!command) return false;
  const target = tabId ?? activeTabOf(ctx.state).id;
  if (command.enabled && !command.enabled(ctx, target)) return false;
  command.run(ctx, target, source);
  return true;
}

export function labelOf(command: Command, ctx: CommandContext, tabId: number) {
  return typeof command.label === "function" ? command.label(ctx, tabId) : command.label;
}
