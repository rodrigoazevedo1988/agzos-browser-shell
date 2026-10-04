/**
 * 4.7 na casca: tema da página por domínio (botão na barra de URL), ColorTools (conta-
 * gotas, painel e menu de contexto), PDF Tools (ícone na barra, pedidos de abrir) e os
 * atalhos configuráveis desses recursos. Fica fora de chrome.tsx só pelo tamanho.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from "react";

import {
  addToHistory,
  defaultGradient,
  exportColorLibrary,
  formatColor,
  hexOfRgb,
  importColorLibrary,
  type ColorLibrary,
  type Gradient,
} from "@/features/colors/color";
import type { ColorTab } from "@/features/colors/panel";

import type { DesktopBridge } from "./desktop";
import type { PageColor, PageThemeInfo, PageThemeMode } from "./desktop-v47";
import {
  FEATURE_SHORTCUTS,
  comboLabel,
  featureOfCombo,
  themeIsDark,
  type FeaturePrefs,
  type FeatureShortcutId,
} from "./feature-prefs";
import type { PanelSpec } from "./overlay/panels";
import type { BrowserAction } from "./store/reducer";
import type { Prefs } from "./store/state";

type Rect = { x: number; y: number; width: number; height: number };

export type PdfRequest = { url?: string; path?: string; at: number };

export function useV47Shell({
  desktop,
  dispatch,
  prefs,
  colors,
  activeTabId,
  activeUrl,
  activeIsPage,
  activePrivate,
  isMac,
  colorsOpen,
  setColorsOpen,
  setNotice,
  openPdfPage,
  openSettings,
}: {
  desktop: DesktopBridge | null;
  dispatch: Dispatch<BrowserAction>;
  prefs: Prefs;
  colors: ColorLibrary;
  activeTabId: number;
  activeUrl: string;
  activeIsPage: boolean;
  activePrivate: boolean;
  isMac: boolean;
  /** O painel do ColorTools está aberto (panel === "colors" na casca). */
  colorsOpen: boolean;
  setColorsOpen: (open: boolean) => void;
  setNotice: (text: string) => void;
  /** Abre agzos://pdf (com um arquivo ou URL para carregar). */
  openPdfPage: (request: PdfRequest | null) => void;
  openSettings: () => void;
}) {
  const features = prefs.features;
  const setFeatures = useCallback(
    (patch: Partial<FeaturePrefs>) =>
      dispatch({ type: "prefs/set", patch: { features: { ...features, ...patch } } }),
    [dispatch, features],
  );

  // --- Tema da página (por guia, o main avisa a cada navegação e mudança) ---
  const [themes, setThemes] = useState<Record<number, PageThemeInfo>>({});
  // --- PDF na guia (ícone na barra de URL) ---
  const [pdfTabs, setPdfTabs] = useState<Record<number, string>>({});
  useEffect(() => {
    if (!desktop) return;
    return desktop.onTabEvent((event) => {
      if (event.type === "page-theme") {
        setThemes((current) => ({ ...current, [event.id]: event.theme }));
      } else if (event.type === "page-theme-reverted") {
        setNotice(
          event.count === 1
            ? "Um trecho ficou como no original para o texto continuar legível."
            : `${event.count} trechos ficaram como no original para o texto continuar legível.`,
        );
      } else if (event.type === "pdf") {
        setPdfTabs((current) => {
          if (event.pdf === (current[event.id] === event.url)) return current;
          const next = { ...current };
          if (event.pdf) next[event.id] = event.url;
          else delete next[event.id];
          return next;
        });
      }
    });
  }, [desktop, setNotice]);

  const activeTheme = themes[activeTabId];
  const togglePageTheme = useCallback(
    (tabId: number) => {
      if (!desktop) return;
      const info = themes[tabId];
      if (!info?.domain) {
        setNotice("O tema Dark vale para sites (http e https).");
        return;
      }
      const next: PageThemeMode = info.dark ? "lightning" : "dark";
      void desktop
        .pageThemeSet(tabId, next)
        .then((theme) => setThemes((current) => ({ ...current, [tabId]: theme })));
    },
    [desktop, themes, setNotice],
  );
  const pageThemeButton =
    desktop && activeIsPage && activeTheme?.domain
      ? {
          dark: activeTheme.dark,
          mode: activeTheme.mode,
          domain: activeTheme.domain,
          shortcut: features.shortcuts["page-theme.toggle"]
            ? comboLabel(features.shortcuts["page-theme.toggle"], isMac)
            : "",
          onToggle: () => togglePageTheme(activeTabId),
        }
      : null;

  // --- ColorTools ---
  const [colorTab, setColorTab] = useState<ColorTab>("picker");
  const [current, setCurrent] = useState<string | null>(null);
  const [pageColors, setPageColors] = useState<{
    url: string;
    list: PageColor[];
    scanned: number;
  } | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [gradient, setGradient] = useState<Gradient>(defaultGradient);
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const colorsRef = useRef(colors);
  colorsRef.current = colors;

  const remember = useCallback(
    (hex: string, source?: string) => {
      dispatch({
        type: "colors/set",
        library: addToHistory(
          colorsRef.current,
          hex,
          Date.now(),
          features.colors.historyLimit,
          source,
        ),
      });
    },
    [dispatch, features.colors.historyLimit],
  );

  const copy = useCallback(
    (text: string) => {
      if (!desktop) return;
      void desktop.clipboardWrite(text).then(() => setNotice(`Copiado: ${text}`));
    },
    [desktop, setNotice],
  );

  /** Cor escolhida (conta-gotas, menu de contexto): histórico e cópia no formato. */
  const choose = useCallback(
    (hex: string, source?: string) => {
      setCurrent(hex);
      remember(hex, source);
      if (features.colors.autoCopy !== "off") copy(formatColor(hex, features.colors.autoCopy));
    },
    [remember, copy, features.colors.autoCopy],
  );

  const sourceOf = (url: string) => {
    if (activePrivate) return undefined;
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return undefined;
    }
  };

  const eyedropper = useCallback(
    (tabId: number) => {
      if (!desktop) return;
      if (!activeIsPage) {
        setNotice("Abra um site primeiro: o conta-gotas pega a cor de um ponto da página.");
        return;
      }
      const reopen = colorsOpen;
      setColorsOpen(false);
      void desktop
        .colorPick(tabId, { dark: themeIsDark(features.colors.theme, prefs.dark) })
        .then((rgb) => {
          if (rgb) {
            choose(hexOfRgb(rgb), sourceOf(activeUrl));
            setColorTab("picker");
          }
          if (reopen || rgb) setColorsOpen(true);
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [desktop, activeIsPage, colorsOpen, features.colors.theme, prefs.dark, choose, activeUrl],
  );

  const analyze = useCallback(() => {
    if (!desktop || !activeIsPage) return;
    setAnalyzing(true);
    void desktop
      .colorAnalyze(activeTabId)
      .then((result) => {
        if (result.ok)
          setPageColors({ url: activeUrl, list: result.colors, scanned: result.scanned });
        else setNotice("Não foi possível ler as cores desta página.");
      })
      .finally(() => setAnalyzing(false));
  }, [desktop, activeIsPage, activeTabId, activeUrl, setNotice]);

  const toggleColors = useCallback(
    (from?: Rect | null) => {
      if (from !== undefined) setAnchor(from);
      setColorsOpen(!colorsOpen);
    },
    [colorsOpen, setColorsOpen],
  );

  // Menu de contexto da página (main): cor do pixel, analisar, gradiente.
  const handlers = useRef({ choose, analyze, setColorsOpen, setColorTab });
  handlers.current = { choose, analyze, setColorsOpen, setColorTab };
  useEffect(() => {
    if (!desktop) return;
    return desktop.onColorAction((payload) => {
      const h = handlers.current;
      if (payload.action === "copied" && payload.hex) {
        h.choose(payload.hex);
        return;
      }
      h.setColorTab(payload.action === "analyze" ? "page" : "gradient");
      h.setColorsOpen(true);
      if (payload.action === "analyze") window.setTimeout(() => handlers.current.analyze(), 50);
    });
  }, [desktop]);

  // Cores analisadas de outra página não valem para esta.
  const shownColors = pageColors && pageColors.url === activeUrl ? pageColors : null;

  const colorsSpec: PanelSpec | null =
    colorsOpen && desktop
      ? {
          kind: "colors",
          props: {
            tab: colorTab,
            current,
            autoCopy: features.colors.autoCopy,
            dark: themeIsDark(features.colors.theme, prefs.dark),
            pickShortcut: features.shortcuts["colors.eyedropper"]
              ? comboLabel(features.shortcuts["colors.eyedropper"], isMac)
              : "",
            canPick: activeIsPage,
            pageColors: shownColors?.list ?? null,
            scanned: shownColors?.scanned ?? 0,
            analyzing,
            library: colors,
            gradient,
            right: anchor
              ? Math.max(8, Math.round(window.innerWidth - anchor.x - anchor.width))
              : 12,
            top: anchor ? Math.round(anchor.y + anchor.height + 6) : 52,
            onTab: setColorTab,
            onPick: () => eyedropper(activeTabId),
            onAnalyze: analyze,
            onSelect: (hex) => {
              setCurrent(hex);
              copy(
                formatColor(
                  hex,
                  features.colors.autoCopy === "off" ? "hex" : features.colors.autoCopy,
                ),
              );
            },
            onCopy: copy,
            onGradient: setGradient,
            onLibrary: (library) => dispatch({ type: "colors/set", library }),
            onAutoCopy: (autoCopy) => setFeatures({ colors: { ...features.colors, autoCopy } }),
            onExport: () => {
              if (!desktop) return;
              void desktop
                .saveFile({
                  name: "agzos-colortools.json",
                  data: exportColorLibrary(colorsRef.current),
                  filters: [{ name: "JSON", extensions: ["json"] }],
                })
                .then((result) => result.ok && setNotice(`Exportado: ${result.path}`));
            },
            onImport: (text) => {
              const next = importColorLibrary(colorsRef.current, text);
              if (!next) {
                setNotice("Esse arquivo não é uma exportação do ColorTools.");
                return;
              }
              dispatch({ type: "colors/set", library: next });
              setNotice("Histórico e paletas importados.");
            },
            onSettings: () => {
              setColorsOpen(false);
              openSettings();
            },
            onClose: () => setColorsOpen(false),
          },
        }
      : null;

  // --- PDF Tools ---
  useEffect(() => {
    if (!desktop) return;
    return desktop.onPdfOpen((payload) =>
      openPdfPage({
        ...(payload.url ? { url: payload.url } : {}),
        ...(payload.path ? { path: payload.path } : {}),
        at: Date.now(),
      }),
    );
  }, [desktop, openPdfPage]);
  const activePdf = pdfTabs[activeTabId] === activeUrl ? activeUrl : null;
  const pdfButton =
    activePdf !== null ? { onOpen: () => openPdfPage({ url: activePdf, at: Date.now() }) } : null;

  // --- Atalhos configuráveis: o main repassa os combos com o foco na página ---
  const combos = useMemo(
    () => FEATURE_SHORTCUTS.map((item) => features.shortcuts[item.id]).filter(Boolean),
    [features.shortcuts],
  );
  useEffect(() => {
    void desktop?.setExtraShortcuts(combos);
  }, [desktop, combos]);

  /** Combo apertado (casca ou página): o recurso dele, se houver. */
  const featureForCombo = useCallback(
    (combo: string): FeatureShortcutId | null => featureOfCombo(features.shortcuts, combo),
    [features.shortcuts],
  );

  return {
    setFeatures,
    pageThemeButton,
    togglePageTheme,
    colorsSpec,
    eyedropper,
    toggleColors,
    pdfButton,
    featureForCombo,
  };
}
