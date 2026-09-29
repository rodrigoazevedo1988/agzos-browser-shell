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
  | "tab.next"
  | "tab.previous"
  | "tab.switch-recent"
  | "tab.switch-recent-back"
  | `tab.select-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}`
  | "tab.select-last"
  | "nav.back"
  | "nav.forward"
  | "tab.reload-hard"
  | "window.fullscreen"
  | "page.favorite"
  | "page.find"
  | "downloads.toggle"
  | "zoom.in"
  | "zoom.out"
  | "zoom.reset"
  | "omnibox.focus";

/**
 * `key` é o `KeyboardEvent.key` em minúsculas. `mod` (Ctrl ou ⌘) vale true quando omitido.
 * O main (electron/main.cjs, FORWARDED_SHORTCUTS) repassa exatamente estes atalhos.
 */
export type Shortcut = { key: string; shift?: boolean; alt?: boolean; mod?: boolean };
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
    /** delta -1 volta, 1 avança (histórico da aba ativa). */
    step: (delta: -1 | 1) => void;
    openFind: () => void;
    toggleDownloads: () => void;
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

/** Recursos que só existem com um WebContentsView de verdade (app desktop, aba com página). */
const onDesktopPage = (ctx: CommandContext, tabId: number) => {
  const tab = tabById(ctx, tabId);
  return ctx.desktop !== null && tab !== undefined && entryOf(tab).kind === "page";
};

const selectCommands: Command[] = ([1, 2, 3, 4, 5, 6, 7, 8] as const).map((n) => ({
  id: `tab.select-${n}` as const,
  label: `Ir para a guia ${n}`,
  shortcuts: [{ key: String(n) }],
  run: ({ dispatch }) => dispatch({ type: "tab/activate-index", index: n - 1 }),
}));

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
    shortcuts: [{ key: "r" }, { key: "f5", mod: false }],
    run: ({ ui }, tabId) => ui.reload(tabId),
  },
  {
    id: "tab.reload-hard",
    label: "Recarregar sem cache",
    shortcuts: [
      { key: "r", shift: true },
      { key: "f5", shift: true, mod: false },
    ],
    run: ({ desktop, ui }, tabId) =>
      desktop ? void desktop.reload(tabId, true) : ui.reload(tabId),
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
    // Como no Opera/Vivaldi: ordem de uso. Toque rápido volta para a última aba; segurando
    // o Ctrl abre o seletor com miniaturas, e soltar confirma (switcher/commit).
    id: "tab.switch-recent",
    label: "Alternar para a última guia usada",
    shortcuts: [{ key: "tab" }],
    run: ({ dispatch }) => dispatch({ type: "switcher/step", delta: 1 }),
  },
  {
    id: "tab.switch-recent-back",
    label: "Voltar no seletor de guias",
    shortcuts: [{ key: "tab", shift: true }],
    run: ({ dispatch }) => dispatch({ type: "switcher/step", delta: -1 }),
  },
  {
    id: "tab.next",
    label: "Próxima guia",
    shortcuts: [{ key: "pagedown" }],
    run: ({ dispatch }) => dispatch({ type: "tab/activate-relative", delta: 1 }),
  },
  {
    id: "tab.previous",
    label: "Guia anterior",
    shortcuts: [{ key: "pageup" }],
    run: ({ dispatch }) => dispatch({ type: "tab/activate-relative", delta: -1 }),
  },
  ...selectCommands,
  {
    id: "tab.select-last",
    label: "Ir para a última guia",
    shortcuts: [{ key: "9" }],
    run: ({ dispatch }) => dispatch({ type: "tab/activate-index", index: -1 }),
  },
  {
    id: "nav.back",
    label: "Voltar",
    shortcuts: [{ key: "arrowleft", alt: true, mod: false }, { key: "[" }],
    run: ({ ui }) => ui.step(-1),
  },
  {
    id: "nav.forward",
    label: "Avançar",
    shortcuts: [{ key: "arrowright", alt: true, mod: false }, { key: "]" }],
    run: ({ ui }) => ui.step(1),
  },
  {
    id: "window.fullscreen",
    label: "Tela cheia",
    shortcuts: [{ key: "f11", mod: false }],
    // Na web o F11 fica com o próprio navegador.
    enabled: ({ desktop }) => desktop !== null,
    run: ({ desktop }) => void desktop?.toggleFullscreen(),
  },
  {
    id: "page.favorite",
    label: "Adicionar aos favoritos",
    shortcuts: [{ key: "d" }],
    run: ({ dispatch }) => dispatch({ type: "links/toggle-current" }),
  },
  {
    id: "page.find",
    label: "Buscar na página",
    shortcuts: [{ key: "f" }],
    // Na web o Ctrl+F fica com o próprio navegador (o iframe não deixa buscar dentro).
    enabled: onDesktopPage,
    run: ({ ui }) => ui.openFind(),
  },
  {
    id: "downloads.toggle",
    label: "Downloads",
    shortcuts: [{ key: "j" }],
    run: ({ ui }) => ui.toggleDownloads(),
  },
  {
    id: "zoom.in",
    label: "Aumentar zoom",
    shortcuts: [{ key: "=" }, { key: "+" }, { key: "=", shift: true }, { key: "+", shift: true }],
    enabled: onDesktopPage,
    run: ({ desktop }, tabId) => void desktop?.zoom(tabId, 1),
  },
  {
    id: "zoom.out",
    label: "Diminuir zoom",
    shortcuts: [{ key: "-" }],
    enabled: onDesktopPage,
    run: ({ desktop }, tabId) => void desktop?.zoom(tabId, -1),
  },
  {
    id: "zoom.reset",
    label: "Tamanho padrão",
    shortcuts: [{ key: "0" }],
    enabled: onDesktopPage,
    run: ({ desktop }, tabId) => void desktop?.zoom(tabId, 0),
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

export type KeyInput = { key: string; ctrl: boolean; meta: boolean; shift: boolean; alt: boolean };

/** Forma canônica do atalho ("mod+shift+t"), a mesma de FORWARDED_SHORTCUTS no main. */
export function shortcutCombo(shortcut: Shortcut): string {
  const parts = [];
  if (shortcut.mod !== false) parts.push("mod");
  if (shortcut.alt) parts.push("alt");
  if (shortcut.shift) parts.push("shift");
  parts.push(shortcut.key);
  return parts.join("+");
}

/** Resolve a tecla pressionada para um comando, com os modificadores exatos. */
export function commandForKey(input: KeyInput): Command | undefined {
  const combo = shortcutCombo({
    key: input.key.toLowerCase(),
    shift: input.shift,
    alt: input.alt,
    mod: input.ctrl || input.meta,
  });
  return commands.find((command) =>
    command.shortcuts?.some((shortcut) => shortcutCombo(shortcut) === combo),
  );
}

const KEY_LABELS: Record<string, string> = {
  tab: "Tab",
  pagedown: "PgDn",
  pageup: "PgUp",
  arrowleft: "←",
  arrowright: "→",
};

export function shortcutLabel(command: Command, mac: boolean): string | undefined {
  const shortcut = command.shortcuts?.[0];
  if (!shortcut) return undefined;
  const parts = [
    shortcut.mod === false ? null : mac ? "⌘" : "Ctrl",
    shortcut.alt ? (mac ? "⌥" : "Alt") : null,
    shortcut.shift ? "Shift" : null,
    KEY_LABELS[shortcut.key] ?? shortcut.key.toUpperCase(),
  ];
  return parts.filter(Boolean).join(mac ? " " : "+");
}

/** Comando habilitado para o alvo (atalho desabilitado não deve engolir a tecla). */
export function isEnabled(ctx: CommandContext, command: Command, tabId?: number | null) {
  const target = tabId ?? activeTabOf(ctx.state).id;
  return !command.enabled || command.enabled(ctx, target);
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
