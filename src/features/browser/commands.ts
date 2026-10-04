import type { Dispatch } from "react";

import type { DesktopBridge } from "./desktop";
import type { BrowserAction } from "./store/reducer";
import { activeTabOf, entryOf, splitShown } from "./store/selectors";
import {
  BOOKMARKS_URL,
  DIAL_URL,
  HISTORY_URL,
  SETTINGS_URL,
  type BrowserState,
} from "./store/state";
import { newTabSession } from "./types";

/** Id de uma sessão nova (partição "persist:agzos-session-<id>"). */
function newSessionId() {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return random.toLowerCase();
}

/**
 * Registro único de comandos do navegador. Atalhos de teclado, o menu de contexto da
 * versão web e o menu nativo do Electron (electron/main.cjs) disparam os mesmos IDs.
 */
export type CommandId =
  | "tab.new"
  | "window.new"
  | "tab.move-to-window"
  | "tab.hibernate"
  | "tab.move-left"
  | "tab.move-right"
  | "page.pip"
  | "settings.open"
  | "help.whats-new"
  | "tabs.hibernate-others"
  | "tab.new-private"
  | "tab.new-session"
  | "page.inspect"
  | "page.capture"
  | "page.reader"
  | "notes.toggle"
  | "ports.open"
  | "scratchpad.open"
  | "scratchpad.capture"
  | "extensions.open"
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
  | "omnibox.focus"
  | "palette.open"
  | "group.new"
  | "group.leave"
  | "split.new"
  | "split.with-tab"
  | "split.close"
  | "split.swap"
  | "workspaces.open"
  | "workspace.new"
  | "workspace.next"
  | "workspace.previous"
  | "sidepanels.toggle"
  | "control.open"
  | "ai.toggle"
  | "terminal.toggle"
  | "file.open"
  | "dial.open"
  | "history.open"
  | "bookmarks.manager"
  | "bookmarks.toggle-bar";

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
    /** Favorita a página atual (se ainda não for) e abre a edição do favorito. */
    bookmarkPage: () => void;
    /** Salva as guias abertas numa pasta nova da barra de favoritos. */
    bookmarkAllTabs: () => void;
    /** Liga/desliga o picture-in-picture do vídeo da guia. */
    pictureInPicture: (tabId: number) => void;
    /** Aviso com as novidades da versão atual (sem confetes). */
    showWhatsNew: () => void;
    /** Busca de comandos (Ctrl+K). */
    openPalette: () => void;
    /** Abre a edição do grupo (nome e cor), ao lado do chip dele. */
    editGroup: (groupId: number) => void;
    /** Painel de workspaces; `create` já abre o formulário de um novo. */
    openWorkspaces: (create?: boolean) => void;
    /** Mostra ou esconde a barra lateral dos painéis (WhatsApp, Telegram…). */
    toggleSidebar: () => void;
    /** Abre ou fecha o GX Control (painel de CPU, RAM, rede e limpeza). */
    toggleControl: () => void;
    /** 4.5: painel de portas (processos escutando no PC, matar e expor por túnel). */
    togglePorts: () => void;
    /** 4.5: captura de tela (guia, região ou janela do app). */
    capture: () => void;
    /** 4.5: modo leitura da guia (entra ou sai). */
    toggleReader: (tabId: number) => void;
    /** 4.5: notas da página atual, no painel ao lado. */
    toggleNotes: () => void;
    /** 4.5: API Scratchpad; com `tabId`, já capturando as requisições daquela guia. */
    openScratchpad: (tabId: number | null) => void;
    /** 4.5: liga/desliga a mira na guia (avisa quando a guia não é um site). */
    inspect: (tabId: number) => void;
    /** 4.5: Configurações → Extensões. */
    openExtensions: () => void;
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
    run: ({ dispatch, ui }) => {
      dispatch({ type: "tab/new" });
      setTimeout(ui.focusOmnibox, 50);
    },
  },
  {
    id: "window.new",
    label: "Nova janela",
    shortcuts: [{ key: "n" }],
    // Na web o Ctrl+N fica com o próprio navegador.
    enabled: ({ desktop }) => desktop !== null,
    visible: ({ desktop }) => desktop !== null,
    run: ({ desktop }) => void desktop?.newWindow(),
  },
  {
    id: "tab.move-to-window",
    label: "Mover para nova janela",
    visible: ({ desktop }) => desktop !== null,
    enabled: ({ state }) => state.tabs.length > 1,
    run: ({ state, dispatch, desktop }, tabId) => {
      const tab = state.tabs.find((item) => item.id === tabId);
      if (!desktop || !tab) return;
      // A guia só sai daqui depois que o main levou a página para a outra janela.
      void desktop.moveTabToWindow(tabId, tab).then(({ ok }) => {
        if (ok) dispatch({ type: "tab/detach", id: tabId });
      });
    },
  },
  {
    id: "tab.hibernate",
    label: "Hibernar guia",
    visible: ({ desktop }) => desktop !== null,
    enabled: ({ state }, tabId) => {
      const tab = state.tabs.find((item) => item.id === tabId);
      return (
        tab !== undefined &&
        tabId !== state.activeId &&
        !state.hibernated.includes(tabId) &&
        entryOf(tab).kind === "page"
      );
    },
    run: ({ desktop }, tabId) => void desktop?.hibernateTab(tabId),
  },
  {
    id: "tab.new-private",
    label: "Nova guia anônima",
    shortcuts: [{ key: "n", shift: true }],
    run: ({ dispatch, ui }) => {
      dispatch({ type: "tab/new", private: true });
      setTimeout(ui.focusOmnibox, 50);
    },
  },
  {
    id: "tab.new-session",
    label: "Nova Session Tab (sessão isolada)",
    // 4.5: cookies e storage só desta guia (logins diferentes do mesmo site lado a lado).
    shortcuts: [{ key: "n", alt: true }],
    enabled: ({ desktop }) => desktop !== null,
    visible: ({ desktop }) => desktop !== null,
    run: ({ state, dispatch, ui }) => {
      dispatch({
        type: "tab/new",
        session: newTabSession(state.tabs, newSessionId()),
      });
      setTimeout(ui.focusOmnibox, 50);
    },
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
    run: ({ ui }) => ui.bookmarkAllTabs(),
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
    id: "tab.move-left",
    label: "Mover guia para trás",
    shortcuts: [{ key: "pageup", shift: true }],
    run: ({ dispatch }, tabId) => dispatch({ type: "tab/move-relative", id: tabId, delta: -1 }),
  },
  {
    id: "tab.move-right",
    label: "Mover guia para frente",
    shortcuts: [{ key: "pagedown", shift: true }],
    run: ({ dispatch }, tabId) => dispatch({ type: "tab/move-relative", id: tabId, delta: 1 }),
  },
  {
    id: "page.pip",
    label: "Picture-in-picture",
    shortcuts: [{ key: "p", shift: true }],
    // Vídeo de qualquer player (YouTube ou outro) numa janela flutuante; só no app.
    enabled: onDesktopPage,
    run: ({ ui }, tabId) => ui.pictureInPicture(tabId),
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
    enabled: ({ state }) => {
      const tab = activeTabOf(state);
      return !tab.private && entryOf(tab).kind === "page";
    },
    run: ({ ui }) => ui.bookmarkPage(),
  },
  {
    id: "history.open",
    label: "Histórico",
    // ⌘Y é o do Safari/Chrome no Mac (⌘H esconde o app).
    shortcuts: [{ key: "h" }, { key: "y" }],
    run: ({ dispatch }) =>
      dispatch({
        type: "nav/open-internal",
        entry: { title: "Histórico", url: HISTORY_URL, kind: "internal" },
      }),
  },
  {
    id: "bookmarks.manager",
    label: "Gerenciar favoritos",
    shortcuts: [{ key: "o", shift: true }],
    run: ({ dispatch }) =>
      dispatch({
        type: "nav/open-internal",
        entry: { title: "Favoritos", url: BOOKMARKS_URL, kind: "internal" },
      }),
  },
  {
    id: "settings.open",
    label: "Configurações",
    // ⌘, é o atalho de preferências de todo app do Mac; no Windows/Linux, Ctrl+,.
    shortcuts: [{ key: "," }],
    run: ({ dispatch }) =>
      dispatch({
        type: "nav/open-internal",
        entry: { title: "Configurações", url: SETTINGS_URL, kind: "internal" },
      }),
  },
  {
    id: "help.whats-new",
    label: "Novidades desta versão",
    visible: ({ desktop }) => desktop !== null,
    run: ({ ui }) => ui.showWhatsNew(),
  },
  {
    id: "tabs.hibernate-others",
    label: "Hibernar outras guias",
    visible: ({ desktop }) => desktop !== null,
    enabled: ({ state }) =>
      state.tabs.some(
        (tab) =>
          tab.id !== state.activeId &&
          !state.hibernated.includes(tab.id) &&
          entryOf(tab).kind === "page",
      ),
    run: ({ state, desktop }) => {
      for (const tab of state.tabs) {
        if (tab.id === state.activeId || state.hibernated.includes(tab.id)) continue;
        if (entryOf(tab).kind === "page") void desktop?.hibernateTab(tab.id);
      }
    },
  },
  {
    id: "bookmarks.toggle-bar",
    label: ({ state }) =>
      state.prefs.bookmarksBar ? "Ocultar barra de favoritos" : "Mostrar barra de favoritos",
    shortcuts: [{ key: "b", shift: true }],
    run: ({ state, dispatch }) =>
      dispatch({ type: "prefs/set", patch: { bookmarksBar: !state.prefs.bookmarksBar } }),
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
    shortcuts: [{ key: "l" }],
    run: ({ ui }) => ui.focusOmnibox(),
  },
  {
    id: "palette.open",
    label: "Buscar comandos",
    shortcuts: [{ key: "k" }],
    run: ({ ui }) => ui.openPalette(),
  },
  // --- Grupos de guias (2.0) ---
  {
    id: "group.new",
    label: "Adicionar guia a novo grupo",
    shortcuts: [{ key: "g", shift: true }],
    enabled: (ctx, tabId) => !tabById(ctx, tabId)?.private,
    run: ({ state, dispatch, ui }, tabId) => {
      dispatch({ type: "group/create", ids: [tabId] });
      // O grupo novo recebe o próximo id: a edição abre depois do render.
      ui.editGroup(Math.max(0, ...state.groups.map((group) => group.id)) + 1);
    },
  },
  {
    id: "group.leave",
    label: "Remover do grupo",
    visible: (ctx, tabId) => tabById(ctx, tabId)?.groupId !== undefined,
    run: ({ dispatch }, tabId) => dispatch({ type: "group/leave", id: tabId }),
  },
  // --- Tela dividida (2.0) ---
  {
    id: "split.new",
    label: "Dividir tela (nova guia ao lado)",
    shortcuts: [{ key: "s", shift: true, alt: true }],
    run: ({ dispatch }) => dispatch({ type: "split/open" }),
  },
  {
    id: "split.with-tab",
    label: "Abrir em tela dividida com a guia atual",
    visible: ({ state }, tabId) => tabId !== state.activeId,
    run: ({ dispatch }, tabId) => dispatch({ type: "split/open", id: tabId }),
  },
  {
    id: "split.swap",
    label: "Trocar os lados da tela dividida",
    visible: ({ state }) => splitShown(state) !== null,
    enabled: ({ state }) => splitShown(state) !== null,
    run: ({ dispatch }) => dispatch({ type: "split/swap" }),
  },
  {
    id: "split.close",
    label: "Desfazer tela dividida",
    visible: ({ state }) => splitShown(state) !== null,
    enabled: ({ state }) => splitShown(state) !== null,
    run: ({ dispatch }) => dispatch({ type: "split/close" }),
  },
  // --- Workspaces (2.0) ---
  {
    id: "workspaces.open",
    label: "Workspaces",
    run: ({ ui }) => ui.openWorkspaces(),
  },
  {
    id: "workspace.new",
    label: "Novo workspace…",
    run: ({ ui }) => ui.openWorkspaces(true),
  },
  {
    id: "workspace.next",
    label: "Próximo workspace",
    shortcuts: [{ key: "arrowdown", alt: true }],
    enabled: ({ state }) => state.workspaces.length > 1,
    run: ({ state, dispatch }) =>
      dispatch({ type: "workspace/switch", id: stepWorkspace(state, 1) }),
  },
  {
    id: "sidepanels.toggle",
    label: ({ state }) =>
      state.prefs.sidebar ? "Ocultar painéis laterais" : "Mostrar painéis laterais",
    run: ({ ui }) => ui.toggleSidebar(),
  },
  {
    id: "ports.open",
    label: "Portas em uso (matar processo, expor por túnel)",
    enabled: ({ desktop }) => desktop !== null,
    visible: ({ desktop }) => desktop !== null,
    run: ({ ui }) => ui.togglePorts(),
  },
  {
    id: "scratchpad.open",
    label: "Abrir o API Scratchpad",
    enabled: ({ desktop }) => desktop !== null,
    visible: ({ desktop }) => desktop !== null,
    run: ({ ui }) => ui.openScratchpad(null),
  },
  {
    id: "scratchpad.capture",
    label: "Capturar requisições desta guia no Scratchpad",
    enabled: onDesktopPage,
    visible: ({ desktop }) => desktop !== null,
    run: ({ ui }, tabId) => ui.openScratchpad(tabId),
  },
  {
    id: "page.inspect",
    label: "Mira de elemento (cores, fonte e classes Tailwind)",
    shortcuts: [{ key: "c", shift: true }],
    // Sempre habilitado no app: fora de um site, a casca explica em vez de não fazer nada.
    enabled: ({ desktop }) => desktop !== null,
    visible: ({ desktop }) => desktop !== null,
    run: ({ ui }, tabId) => ui.inspect(tabId),
  },
  {
    id: "extensions.open",
    label: "Extensões",
    enabled: ({ desktop }) => desktop !== null,
    visible: ({ desktop }) => desktop !== null,
    run: ({ ui }) => ui.openExtensions(),
  },
  {
    id: "page.capture",
    label: "Capturar tela (guia, região ou janela)",
    shortcuts: [{ key: "s", shift: true }],
    enabled: ({ desktop }) => desktop !== null,
    visible: ({ desktop }) => desktop !== null,
    run: ({ ui }) => ui.capture(),
  },
  {
    id: "page.reader",
    label: "Modo leitura",
    shortcuts: [{ key: "r", alt: true }],
    enabled: ({ desktop }) => desktop !== null,
    visible: ({ desktop }) => desktop !== null,
    run: ({ ui }, tabId) => ui.toggleReader(tabId),
  },
  {
    id: "notes.toggle",
    label: "Notas desta página",
    shortcuts: [{ key: "m", shift: true }],
    run: ({ ui }) => ui.toggleNotes(),
  },
  {
    id: "control.open",
    label: "GX Control (CPU, RAM, rede e limpeza)",
    run: ({ ui }) => ui.toggleControl(),
  },
  {
    id: "ai.toggle",
    label: ({ state }) => (state.prefs.aiOpen ? "Fechar o Agzos AI" : "Abrir o Agzos AI"),
    shortcuts: [{ key: "a", shift: true }],
    run: ({ state, dispatch }) =>
      dispatch({ type: "prefs/set", patch: { aiOpen: !state.prefs.aiOpen } }),
  },
  {
    id: "terminal.toggle",
    label: ({ state }) => (state.prefs.terminalOpen ? "Fechar o terminal" : "Abrir o terminal"),
    // Ctrl+Alt+T como nos terminais do Linux (o Ctrl+` é tecla morta no ABNT2).
    shortcuts: [{ key: "t", alt: true }],
    // Shell de verdade só no app (node-pty no processo principal).
    enabled: ({ desktop }) => desktop !== null,
    visible: ({ desktop }) => desktop !== null,
    run: ({ state, dispatch }) =>
      dispatch({ type: "prefs/set", patch: { terminalOpen: !state.prefs.terminalOpen } }),
  },
  {
    id: "file.open",
    label: "Abrir arquivo…",
    // 4.1.1: HTML, SVG, PDF, imagens, código ou qualquer outro arquivo numa guia.
    shortcuts: [{ key: "o" }],
    enabled: ({ desktop }) => desktop !== null,
    visible: ({ desktop }) => desktop !== null,
    run: ({ desktop }) => void desktop?.filesPick(),
  },
  {
    id: "dial.open",
    label: "Abrir o Discador",
    run: ({ dispatch }) =>
      dispatch({
        type: "nav/open-internal",
        entry: { title: "Discador", url: DIAL_URL, kind: "internal" },
      }),
  },
  {
    id: "workspace.previous",
    label: "Workspace anterior",
    shortcuts: [{ key: "arrowup", alt: true }],
    enabled: ({ state }) => state.workspaces.length > 1,
    run: ({ state, dispatch }) =>
      dispatch({ type: "workspace/switch", id: stepWorkspace(state, -1) }),
  },
];

/** Workspace vizinho do ativo, dando a volta. */
function stepWorkspace(state: BrowserState, delta: 1 | -1) {
  const list = state.workspaces;
  const index = list.findIndex((item) => item.id === state.activeWorkspaceId);
  return list[(index + delta + list.length) % list.length]!.id;
}

const byId = new Map(commands.map((command) => [command.id, command]));

export function commandById(id: string): Command | undefined {
  return byId.get(id as CommandId);
}

export type KeyInput = {
  key: string;
  /** Tecla física (KeyboardEvent.code), reserva quando `key` não é a letra. */
  code?: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
};

/** Mesma regra do main (shortcutKey em electron/main.cjs). */
export function shortcutKey(input: Pick<KeyInput, "key" | "code">): string {
  const key = input.key ?? "";
  if (key.length > 1 || /^[\x21-\x7e]$/.test(key)) return key.toLowerCase();
  const code = /^(?:Key([A-Z])|Digit(\d))$/.exec(input.code ?? "");
  return code ? (code[1] ?? code[2]!).toLowerCase() : key.toLowerCase();
}

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
    key: shortcutKey(input),
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
  arrowup: "↑",
  arrowdown: "↓",
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
