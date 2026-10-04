import { useEffect, useRef, type Dispatch, type MutableRefObject } from "react";

import type { DesktopBridge, DesktopPermissionRequest } from "./desktop";
import type { BrowserAction } from "./store/reducer";
import { hostOf, splitShown } from "./store/selectors";
import type { BrowserState } from "./store/state";

type Options = {
  desktop: DesktopBridge | null;
  state: BrowserState;
  dispatch: Dispatch<BrowserAction>;
  panelOpen: boolean;
  /** Comandos vindos do main (menu nativo, atalhos com foco na página). */
  runCommandRef: MutableRefObject<(id: string, tabId: number | null) => void>;
  runHotkeyRef: MutableRefObject<
    (input: {
      key: string;
      shift: boolean;
      alt: boolean;
      meta: boolean;
      ctrl: boolean;
      /** Ctrl+Tab com o foco na página: o seletor vai para a camada acima dela. */
      layer?: boolean;
    }) => void
  >;
  onPermission: (request: DesktopPermissionRequest) => void;
  /** Login enviado numa página: a casca oferece salvar no Agzos Key. */
  onLoginDetected: (payload: {
    id: number;
    url: string;
    username: string;
    password: string;
  }) => void;
  /** Formulário de login na página (à vista ou com um campo em foco): sugerir o cofre. */
  onLoginForm: (payload: {
    id: number;
    url: string;
    focused: boolean;
    field: "password" | "username" | "otp";
  }) => void;
};

/**
 * Único ponto de contato entre o estado da casca e os WebContentsView do main process:
 * eventos do main viram actions, e o estado é refletido no main (abas fechadas, aba ativa,
 * painel aberto). Os componentes não chamam o bridge para isso.
 */
export function useDesktopSync({
  desktop,
  state,
  dispatch,
  panelOpen,
  runCommandRef,
  runHotkeyRef,
  onPermission,
  onLoginDetected,
  onLoginForm,
}: Options) {
  const permissionRef = useRef(onPermission);
  permissionRef.current = onPermission;
  const loginRef = useRef(onLoginDetected);
  loginRef.current = onLoginDetected;
  const loginFormRef = useRef(onLoginForm);
  loginFormRef.current = onLoginForm;

  useEffect(() => {
    if (!desktop) return;
    const offs = [
      desktop.onTabEvent((event) => {
        switch (event.type) {
          case "tab-updated":
            dispatch({
              type: "view/updated",
              id: event.id,
              url: event.url,
              title: event.title,
              canBack: event.canBack,
              canForward: event.canForward,
            });
            return;
          case "favicon":
            dispatch({ type: "view/favicon", id: event.id, icon: event.icon });
            return;
          case "audio":
            dispatch({ type: "view/audio", id: event.id, playing: event.playing });
            return;
          case "muted":
            dispatch({ type: "view/muted", id: event.id, muted: event.muted });
            return;
          case "crashed":
            dispatch({ type: "view/crashed", id: event.id, reason: event.reason ?? "crashed" });
            return;
          case "load-failed":
            dispatch({ type: "view/load-failed", id: event.id, failure: event.failure });
            return;
          case "hibernated":
            dispatch({ type: "view/hibernated", id: event.id });
            return;
          case "pip":
            dispatch({ type: "view/pip", id: event.id, active: event.active });
            return;
          case "unresponsive":
            dispatch({ type: "view/unresponsive", id: event.id, value: event.value });
            return;
          case "blocked":
            dispatch({
              type: "view/blocked",
              id: event.id,
              count: event.count,
              trackers: event.trackers,
            });
            return;
          case "zoom":
            dispatch({ type: "view/zoom", id: event.id, factor: event.factor });
            return;
          case "find":
            dispatch({ type: "view/find", id: event.id, active: event.active, total: event.total });
            return;
          case "thumbnail":
            dispatch({ type: "view/thumbnail", id: event.id, dataUrl: event.dataUrl });
            return;
          case "focused":
            dispatch({ type: "tab/activate", id: event.id });
            return;
          case "download-navigation":
            dispatch({ type: "view/download-navigation", id: event.id, urls: event.urls });
            return;
          case "login-rejected":
            dispatch({
              type: "view/login-rejected",
              id: event.id,
              continueUrl: event.rejected ? event.continueUrl : null,
            });
            return;
          case "login-detected":
            loginRef.current({
              id: event.id,
              url: event.url,
              username: event.username,
              password: event.password,
            });
            return;
          case "login-form":
            loginFormRef.current({
              id: event.id,
              url: event.url,
              focused: event.focused,
              field: event.field,
            });
            return;
        }
      }),
      desktop.onOpenRequest(({ url, from }) =>
        dispatch({
          type: "tab/open-page",
          entry: { title: hostOf(url) ?? url, url, kind: "page" },
          from,
        }),
      ),
      desktop.onFullscreen(({ active }) => dispatch({ type: "fullscreen/set", active })),
      desktop.onHotkey((input) => runHotkeyRef.current(input)),
      desktop.onTabMenuAction(({ action, tabId }) => runCommandRef.current(action, tabId)),
      desktop.onRequestPermission((request) => permissionRef.current(request)),
      desktop.onDownload((record) => dispatch({ type: "downloads/upsert", record })),
      desktop.onModifierUp(() => dispatch({ type: "switcher/commit" })),
      desktop.onAdblockStats((stats) => dispatch({ type: "adblock/stats", stats })),
    ];
    // Estado inicial do que vive no main (downloads salvos, estatística do dia).
    void desktop.downloadsList().then((list) => dispatch({ type: "downloads/set", list }));
    void desktop.adblockStats().then((stats) => dispatch({ type: "adblock/stats", stats }));
    return () => offs.forEach((off) => off());
  }, [desktop, dispatch, runCommandRef, runHotkeyRef]);

  // Seletor do Ctrl+Tab abriu: miniatura fresca da aba atual antes de a esconder.
  const switcherOpen = state.switcher !== null;
  const activeRef = useRef(state.activeId);
  activeRef.current = state.activeId;
  useEffect(() => {
    if (desktop && switcherOpen) void desktop.captureTab(activeRef.current);
  }, [desktop, switcherOpen]);

  const { shield, pausedHosts } = state.prefs;
  useEffect(() => {
    if (desktop && state.hydrated) void desktop.adblockConfig({ shield, pausedHosts });
  }, [desktop, state.hydrated, shield, pausedHosts]);

  // Barra de busca fechada (Esc, ✕ ou troca de aba) → limpa os destaques daquela aba.
  const findTab = state.find?.id ?? null;
  const lastFindTab = useRef<number | null>(null);
  useEffect(() => {
    const previous = lastFindTab.current;
    lastFindTab.current = findTab;
    if (desktop && previous !== null && previous !== findTab) void desktop.findStop(previous);
  }, [desktop, findTab]);

  // Casca carregada (ou recarregada depois de cair): o main fecha as páginas de guias que
  // esta janela não tem mais.
  const hydrated = state.hydrated;
  const tabsRef = useRef(state.tabs);
  tabsRef.current = state.tabs;
  useEffect(() => {
    if (desktop && hydrated) void desktop.syncTabs(tabsRef.current.map((tab) => tab.id));
  }, [desktop, hydrated]);

  // Aba que saiu do estado → fecha o WebContentsView correspondente.
  const knownIds = useRef<Set<number>>(new Set(state.tabs.map((tab) => tab.id)));
  useEffect(() => {
    const current = new Set(state.tabs.map((tab) => tab.id));
    if (desktop) {
      for (const id of knownIds.current) if (!current.has(id)) void desktop.closeTab(id);
    }
    knownIds.current = current;
  }, [desktop, state.tabs]);

  useEffect(() => {
    if (desktop) void desktop.activateTab(state.activeId);
  }, [desktop, state.activeId]);

  // Tela dividida à vista (2.0): o main mostra as duas guias.
  const split = splitShown(state);
  const splitKey = split ? split.ids.join(",") : "";
  useEffect(() => {
    if (!desktop) return;
    const ids = splitKey ? (splitKey.split(",").map(Number) as [number, number]) : null;
    void desktop.setSplit(ids);
  }, [desktop, splitKey]);

  useEffect(() => {
    if (desktop) void desktop.setPanelOpen(panelOpen);
  }, [desktop, panelOpen]);
}
