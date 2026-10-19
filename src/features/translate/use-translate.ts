/**
 * Tradução na casca: ícone da barra de URL, popup da página, bolha do trecho selecionado,
 * "Traduzir o que escrevi", regras de sempre/nunca e o comando page.translate.
 *
 * Guia anônima (escolha segura): nada vai para a Groq sem o usuário aceitar ali na hora
 * ("só desta vez") ou para a sessão inteira ("até fechar o navegador", só na memória); nunca
 * traduz sozinha e nada entra no cache gravado (o main confere de novo pelo `consent`).
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { setAiDraft } from "@/features/ai/draft";
import { aiErrorText } from "@/features/ai/model";
import type { DesktopBridge } from "@/features/browser/desktop";
import type { PanelSpec } from "@/features/browser/overlay/panels";

import type { TranslateError, TranslateStatus, TranslateTask } from "./bridge";
import { shortLanguageLabel } from "./languages";
import type { TranslateBlocker } from "./page-panel";
import {
  decideTranslate,
  requestOptions,
  siteKey,
  toggleRule,
  type TranslatePrefs,
  type TranslateRule,
} from "./prefs";

type Rect = { x: number; y: number; width: number; height: number };
export type TranslatePanelKind = "translate" | "translation";
type TabInfo = { url: string; private: boolean; page: boolean };

type Blocker = { kind: Exclude<TranslateBlocker, null>; retry: (consent: boolean) => void };

type Bubble = {
  tabId: number;
  text: string;
  x: number;
  y: number;
  editable: boolean;
  target: string;
  source: string;
  consent: boolean;
  loading: TranslateTask | null;
  translation: string | null;
  explanation: string | null;
  alternatives: { text: string; note: string }[] | null;
  error: string | null;
  blocker: Blocker | null;
};

const IDLE: TranslateStatus = { state: "idle", done: 0, total: 0 };

export function translateErrorText(error: TranslateError, retryAfter?: number | null) {
  if (error === "page") return "Não foi possível ler esta página para traduzir.";
  if (error === "field") return "Clique num campo de texto com algo escrito e tente de novo.";
  if (error === "private") return "Guia anônima: aceite enviar o texto para traduzir.";
  return aiErrorText(error, retryAfter);
}

const hostOf = (url: string) => {
  try {
    return siteKey(new URL(url).hostname);
  } catch {
    return "";
  }
};

export function useTranslateShell({
  desktop,
  prefs,
  setPrefs,
  dark,
  shortcut,
  activeTabId,
  activeUrl,
  activeIsPage,
  tabInfo,
  panel,
  setPanel,
  setNotice,
  openSettings,
  openAi,
}: {
  desktop: DesktopBridge | null;
  prefs: TranslatePrefs;
  setPrefs: (next: TranslatePrefs) => void;
  dark: boolean;
  /** Atalho pronto para mostrar ("Alt+Shift+T") ou vazio. */
  shortcut: string;
  activeTabId: number;
  activeUrl: string;
  activeIsPage: boolean;
  tabInfo: (tabId: number) => TabInfo | null;
  panel: string | null;
  setPanel: (kind: TranslatePanelKind | null) => void;
  setNotice: (text: string) => void;
  openSettings: () => void;
  /** Abre o Agzos AI (a chave é configurada no próprio painel). */
  openAi: () => void;
}) {
  const [langs, setLangs] = useState<Record<number, string>>({});
  const [statuses, setStatuses] = useState<Record<number, TranslateStatus>>({});
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const [panelTab, setPanelTab] = useState<number | null>(null);
  const [blocker, setBlocker] = useState<Blocker | null>(null);
  const [bubble, setBubble] = useState<Bubble | null>(null);
  // "Permitir até fechar o navegador" nas guias anônimas: só na memória desta janela.
  const privateSession = useRef(false);
  const autoDone = useRef(new Set<string>());

  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const tabInfoRef = useRef(tabInfo);
  tabInfoRef.current = tabInfo;
  const statusesRef = useRef(statuses);
  statusesRef.current = statuses;
  const bubbleRef = useRef(bubble);
  bubbleRef.current = bubble;
  const panelRef = useRef(panel);
  panelRef.current = panel;

  // Idioma de destino do menu de contexto do main ("Traduzir … para Português").
  useEffect(() => {
    void desktop?.translateMenuTarget(prefs.target, shortLanguageLabel(prefs.target));
  }, [desktop, prefs.target]);

  const hasKey = useCallback(async () => {
    if (!desktop) return false;
    try {
      return (await desktop.aiState()).hasKey;
    } catch {
      return false;
    }
  }, [desktop]);

  const openPagePanel = useCallback(
    (tabId: number, next: Blocker | null) => {
      setPanelTab(tabId);
      setBlocker(next);
      setPanel("translate");
    },
    [setPanel],
  );

  /** Traduz a página da guia (com as preferências dadas ou as atuais). */
  const translatePage = useCallback(
    async (
      tabId: number,
      options: { prefs?: TranslatePrefs; consent?: boolean; auto?: boolean } = {},
    ) => {
      if (!desktop) return;
      const info = tabInfoRef.current(tabId);
      if (!info?.page) {
        if (!options.auto)
          setNotice("A tradução funciona em sites: abra uma página e tente de novo.");
        return;
      }
      const retry = (consent: boolean) =>
        void translatePage(tabId, { ...options, consent: consent || options.consent === true });
      if (!(await hasKey())) {
        if (!options.auto) openPagePanel(tabId, { kind: "no-key", retry });
        return;
      }
      const consent = info.private && (privateSession.current || options.consent === true);
      if (info.private && !consent) {
        if (!options.auto) openPagePanel(tabId, { kind: "private", retry });
        return;
      }
      if (panelRef.current === "translate") setBlocker(null);
      const result = await desktop.translatePage(
        tabId,
        requestOptions(options.prefs ?? prefsRef.current, consent),
      );
      if (result.ok || options.auto) return;
      if (result.error === "no-key") openPagePanel(tabId, { kind: "no-key", retry });
      else if (result.error === "private") openPagePanel(tabId, { kind: "private", retry });
      else setNotice(translateErrorText(result.error ?? "request"));
    },
    [desktop, hasKey, openPagePanel, setNotice],
  );

  const restore = useCallback((tabId: number) => void desktop?.translateRestore(tabId), [desktop]);

  /** Comando page.translate (atalho, menu nativo, Ferramentas): traduz ou volta ao original. */
  const togglePage = useCallback(
    (tabId: number) => {
      const state = statusesRef.current[tabId]?.state;
      if (state === "running" || state === "done") restore(tabId);
      else void translatePage(tabId);
    },
    [restore, translatePage],
  );

  // --- Bolha do trecho selecionado ---
  const runTask = useCallback(
    async (task: TranslateTask, patch: Partial<Bubble> = {}) => {
      const current = bubbleRef.current;
      if (!desktop || !current) return;
      const next = { ...current, ...patch };
      const info = tabInfoRef.current(next.tabId);
      const retry = (consent: boolean) => {
        const value = bubbleRef.current;
        if (!value) return;
        bubbleRef.current = { ...value, consent, blocker: null };
        setBubble(bubbleRef.current);
        void runTask(task);
      };
      if (!(await hasKey())) {
        bubbleRef.current = { ...next, blocker: { kind: "no-key", retry } };
        setBubble(bubbleRef.current);
        return;
      }
      const consent = Boolean(info?.private) && (privateSession.current || next.consent);
      if (info?.private && !consent) {
        bubbleRef.current = { ...next, blocker: { kind: "private", retry } };
        setBubble(bubbleRef.current);
        return;
      }
      bubbleRef.current = {
        ...next,
        blocker: null,
        loading: task,
        error: null,
        ...(task === "translate"
          ? { translation: null, explanation: null, alternatives: null }
          : {}),
      };
      setBubble(bubbleRef.current);
      const result = await desktop.translateText(
        next.tabId,
        next.text,
        task,
        requestOptions({ ...prefsRef.current, target: next.target }, consent),
      );
      const latest = bubbleRef.current;
      // Fechou ou trocou de trecho enquanto a Groq respondia.
      if (!latest || latest.text !== next.text || latest.target !== next.target) return;
      bubbleRef.current = result.ok
        ? {
            ...latest,
            loading: null,
            source: result.source || latest.source,
            ...(result.translation !== undefined ? { translation: result.translation } : {}),
            ...(result.explanation !== undefined ? { explanation: result.explanation } : {}),
            ...(result.alternatives !== undefined ? { alternatives: result.alternatives } : {}),
          }
        : {
            ...latest,
            loading: null,
            error: translateErrorText(result.error, result.retryAfter),
          };
      setBubble(bubbleRef.current);
    },
    [desktop, hasKey],
  );

  /** "Traduzir o que escrevi": o campo vira a tradução (Ctrl+Z desfaz). */
  const translateField = useCallback(
    async (tabId: number, consentOnce = false) => {
      if (!desktop) return;
      const info = tabInfoRef.current(tabId);
      const retry = (consent: boolean) => void translateField(tabId, consent);
      if (!(await hasKey())) {
        openPagePanel(tabId, { kind: "no-key", retry });
        return;
      }
      const consent = Boolean(info?.private) && (privateSession.current || consentOnce);
      if (info?.private && !consent) {
        openPagePanel(tabId, { kind: "private", retry });
        return;
      }
      if (panelRef.current === "translate") setPanel(null);
      setNotice(`Traduzindo o texto do campo para ${shortLanguageLabel(prefsRef.current.target)}…`);
      const result = await desktop.translateField(tabId, requestOptions(prefsRef.current, consent));
      setNotice(
        result.ok
          ? "Texto traduzido no campo. Ctrl+Z desfaz."
          : translateErrorText(result.error ?? "request", result.retryAfter),
      );
    },
    [desktop, hasKey, openPagePanel, setNotice, setPanel],
  );

  // --- Eventos do main ---
  useEffect(() => {
    if (!desktop) return;
    return desktop.onTabEvent((event) => {
      if (event.type === "translate-lang") {
        setLangs((current) =>
          current[event.id] === event.lang ? current : { ...current, [event.id]: event.lang },
        );
        const info = tabInfoRef.current(event.id);
        if (!info) return;
        const decision = decideTranslate(prefsRef.current, {
          lang: event.lang,
          host: hostOf(event.url),
          private: info.private,
        });
        const key = `${event.id}|${event.url}`;
        const state = statusesRef.current[event.id]?.state;
        if (
          decision.auto &&
          !autoDone.current.has(key) &&
          state !== "running" &&
          state !== "done"
        ) {
          autoDone.current.add(key);
          void translatePage(event.id, { auto: true });
        }
      } else if (event.type === "translate") {
        const { type: _type, id, url: _url, ...status } = event;
        setStatuses((current) => ({ ...current, [id]: status }));
        if (status.state === "error" && status.error && panelRef.current !== "translate") {
          setNotice(translateErrorText(status.error, status.retryAfter));
        }
      }
    });
  }, [desktop, setNotice, translatePage]);

  useEffect(() => {
    if (!desktop) return;
    return desktop.onTranslateAction((payload) => {
      if (payload.action === "selection") {
        bubbleRef.current = {
          tabId: payload.tabId,
          text: payload.text,
          x: payload.x,
          y: payload.y + 14,
          editable: payload.editable,
          target: prefsRef.current.target,
          source: "",
          consent: false,
          loading: null,
          translation: null,
          explanation: null,
          alternatives: null,
          error: null,
          blocker: null,
        };
        setBubble(bubbleRef.current);
        setPanel("translation");
        void runTask("translate");
      } else if (payload.action === "field") {
        void translateField(payload.tabId);
      } else {
        void translatePage(payload.tabId);
      }
    });
  }, [desktop, runTask, setPanel, translateField, translatePage]);

  // --- Popup da barra de URL ---
  const tabId = panelTab ?? activeTabId;
  const status = statuses[tabId] ?? IDLE;
  const active = status.state === "running" || status.state === "done";
  const activeStatus = statuses[activeTabId] ?? IDLE;
  const activeLang = langs[activeTabId] ?? "";
  const activeHost = hostOf(activeUrl);
  const activeInfo = tabInfo(activeTabId);
  const decision = decideTranslate(prefs, {
    lang: activeLang,
    host: activeHost,
    private: Boolean(activeInfo?.private),
  });

  const changePrefs = (patch: Partial<TranslatePrefs>) => {
    const next = { ...prefsRef.current, ...patch };
    setPrefs(next);
    if (!desktop || !active) return;
    const retranslate = (["source", "target", "tone", "scope", "observe"] as const).some(
      (key) => key in patch && patch[key] !== prefsRef.current[key],
    );
    if (retranslate) void translatePage(tabId, { prefs: next });
    else if (patch.mode && patch.mode !== prefsRef.current.mode)
      void desktop.translateMode(tabId, patch.mode);
  };

  const changeRule = (rule: TranslateRule, value: string, on: boolean) => {
    setPrefs(toggleRule(prefsRef.current, rule, value, on));
    if (!on) return;
    if ((rule === "neverLang" || rule === "neverSite") && active) restore(tabId);
    if ((rule === "alwaysLang" || rule === "alwaysSite") && !active) void translatePage(tabId);
  };

  const urlButton =
    desktop && activeIsPage && (decision.offer || activeStatus.state !== "idle")
      ? {
          active: activeStatus.state === "running" || activeStatus.state === "done",
          busy: activeStatus.state === "running",
          open: panel === "translate",
          label: shortLanguageLabel(prefs.target),
          onToggle: (rect: Rect) => {
            if (panelRef.current === "translate") {
              setPanel(null);
              return;
            }
            setAnchor(rect);
            openPagePanel(activeTabId, null);
          },
        }
      : null;

  const panelInfo = tabInfo(tabId);
  const pageSpec: PanelSpec | null =
    panel === "translate" && desktop
      ? {
          kind: "translate",
          key: `translate-${tabId}`,
          props: {
            dark,
            right: anchor
              ? Math.max(8, Math.round(window.innerWidth - anchor.x - anchor.width))
              : 12,
            top: anchor ? Math.round(anchor.y + anchor.height + 6) : 52,
            host: panelInfo?.page ? hostOf(panelInfo.url) : "",
            pageLang: langs[tabId] ?? "",
            status,
            prefs,
            blocker: blocker?.kind ?? null,
            errorText:
              status.state === "error" && status.error
                ? translateErrorText(status.error, status.retryAfter)
                : null,
            shortcut,
            onTranslate: () => void translatePage(tabId),
            onRestore: () => restore(tabId),
            onCancel: () => void desktop.translateCancel(tabId),
            onPrefs: changePrefs,
            onRule: changeRule,
            onSetupKey: () => {
              setPanel(null);
              openAi();
            },
            onAllowPrivate: (session) => {
              if (session) privateSession.current = true;
              const retry = blocker?.retry;
              setBlocker(null);
              retry?.(true);
            },
            onSettings: () => {
              setPanel(null);
              openSettings();
            },
            onClose: () => setPanel(null),
          },
        }
      : null;

  const canSpeak = typeof window !== "undefined" && "speechSynthesis" in window;
  const bubbleSpec: PanelSpec | null =
    panel === "translation" && bubble && desktop
      ? {
          kind: "translation",
          key: `translation-${bubble.tabId}`,
          props: {
            dark,
            left: bubble.x,
            top: bubble.y,
            text: bubble.text,
            target: bubble.target,
            source: bubble.source,
            loading: bubble.loading,
            translation: bubble.translation,
            explanation: bubble.explanation,
            alternatives: bubble.alternatives,
            errorText: bubble.error,
            blocker: bubble.blocker?.kind ?? null,
            editable: bubble.editable,
            canSpeak,
            onTarget: (target) => void runTask("translate", { target }),
            onTask: (task) => void runTask(task),
            onCopy: (text) =>
              void desktop.clipboardWrite(text).then(() => setNotice("Tradução copiada.")),
            onSpeak: (text) => {
              if (!canSpeak) return;
              window.speechSynthesis.cancel();
              const utterance = new SpeechSynthesisUtterance(text);
              utterance.lang = bubble.target;
              window.speechSynthesis.speak(utterance);
            },
            onReplace: (text) => {
              void desktop.translateReplace(bubble.tabId, text).then((result) => {
                setNotice(
                  result.ok
                    ? "Trecho substituído no campo. Ctrl+Z desfaz."
                    : translateErrorText("field"),
                );
              });
              setPanel(null);
            },
            onOpenAi: () => {
              setAiDraft(
                `Traduza para ${shortLanguageLabel(bubble.target)} e explique o sentido deste trecho:\n\n"${bubble.text}"`,
              );
              setPanel(null);
              openAi();
            },
            onSetupKey: () => {
              setPanel(null);
              openAi();
            },
            onAllowPrivate: (session) => {
              if (session) privateSession.current = true;
              bubble.blocker?.retry(true);
            },
            onClose: () => setPanel(null),
          },
        }
      : null;

  return {
    urlButton,
    spec: pageSpec ?? bubbleSpec,
    togglePage,
    translatePage,
  };
}
