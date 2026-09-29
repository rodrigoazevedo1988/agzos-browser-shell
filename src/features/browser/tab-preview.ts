import { useCallback, useEffect, useRef, useState } from "react";

import type { DesktopBridge } from "./desktop";
import { entryOf, hostOf } from "./store/selectors";
import type { BrowserState } from "./store/state";
import type { Tab } from "./types";

/** Conteúdo do cartão de prévia (o main acrescenta memória, CPU e processo). */
export type TabCard = {
  title: string;
  host: string;
  image?: string;
  placeholder?: string;
  stats: [string, string][];
  chips: { label: string; muted?: boolean }[];
  dark: boolean;
};

export type PreviewSide = "below" | "right";
export type PreviewRect = { x: number; y: number; width: number; height: number };

/** O que dá para saber da guia na casca: estado, bloqueios, zoom, miniatura. */
export function tabCardOf(
  state: BrowserState,
  tab: Tab,
  { desktop }: { desktop: boolean },
): TabCard {
  const entry = entryOf(tab);
  const hibernated = state.hibernated.includes(tab.id);
  const page = entry.kind === "page";
  const chips: TabCard["chips"] = [];
  if (tab.id === state.activeId) chips.push({ label: "Guia atual", muted: true });
  if (state.pip.includes(tab.id)) chips.push({ label: "Picture-in-picture" });
  if (state.audioPlaying.includes(tab.id) && !tab.muted) chips.push({ label: "Tocando áudio" });
  if (tab.muted) chips.push({ label: "Sem som", muted: true });
  if (hibernated) chips.push({ label: "Hibernada", muted: true });
  if (state.crashed.includes(tab.id)) chips.push({ label: "Travou" });
  if (state.failed[tab.id]) chips.push({ label: "Não carregou" });
  if (tab.pinned) chips.push({ label: "Fixada", muted: true });
  if (tab.private) chips.push({ label: "Anônima", muted: true });

  const stats: TabCard["stats"] = [];
  if (hibernated && page && desktop) stats.push(["Memória (RAM)", "liberada"]);
  const blocked = state.blocked[tab.id]?.count ?? 0;
  if (blocked > 0) stats.push(["Bloqueados", String(blocked)]);
  const zoom = state.zoom[tab.id] ?? 1;
  if (Math.abs(zoom - 1) > 0.001) stats.push(["Zoom", `${Math.round(zoom * 100)}%`]);

  const image = page ? state.thumbnails[tab.id] : undefined;
  return {
    title: entry.title || "Sem título",
    host: page ? (hostOf(entry.url) ?? entry.url) : "Página do Agzos",
    ...(image ? { image } : {}),
    ...(!image && page && desktop
      ? {
          placeholder: hibernated
            ? "Hibernada: abre ao clicar"
            : "Prévia aparece depois de ver a guia",
        }
      : {}),
    stats,
    chips,
    dark: state.prefs.dark,
  };
}

const SHOW_DELAY_MS = 500;
const HIDE_DELAY_MS = 120;

/**
 * Cartão ao pausar o mouse numa guia: aparece depois de meio segundo; com um cartão já
 * aberto, passar para outra guia troca na hora (como no Chrome e na barra do Windows).
 * No desktop quem desenha é o main (camada acima da página nativa); na web, a casca.
 */
export function useTabPreview({
  desktop,
  cardOf,
  side,
  disabled,
}: {
  desktop: DesktopBridge | null;
  cardOf: (tabId: number) => TabCard | null;
  side: PreviewSide;
  disabled: boolean;
}) {
  const [webCard, setWebCard] = useState<{
    card: TabCard;
    rect: PreviewRect;
    side: PreviewSide;
  } | null>(null);
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  const visible = useRef(false);
  const cardOfRef = useRef(cardOf);
  cardOfRef.current = cardOf;

  const clear = () => {
    if (showTimer.current !== null) window.clearTimeout(showTimer.current);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    showTimer.current = hideTimer.current = null;
  };

  const hideNow = useCallback(() => {
    clear();
    if (!visible.current) return;
    visible.current = false;
    if (desktop) void desktop.hideTabPreview();
    else setWebCard(null);
  }, [desktop]);

  const show = useCallback(
    (tabId: number, element: HTMLElement) => {
      const card = cardOfRef.current(tabId);
      if (!card || !element.isConnected) return;
      const box = element.getBoundingClientRect();
      const rect = { x: box.left, y: box.top, width: box.width, height: box.height };
      visible.current = true;
      if (desktop) void desktop.showTabPreview({ id: tabId, rect, side, card });
      else setWebCard({ card, rect, side });
    },
    [desktop, side],
  );

  const onHoverStart = useCallback(
    (tabId: number, element: HTMLElement) => {
      if (disabled) return;
      clear();
      if (visible.current) {
        show(tabId, element);
        return;
      }
      showTimer.current = window.setTimeout(() => show(tabId, element), SHOW_DELAY_MS);
    },
    [disabled, show],
  );

  const onHoverEnd = useCallback(
    (immediate = false) => {
      if (immediate) {
        hideNow();
        return;
      }
      if (showTimer.current !== null) window.clearTimeout(showTimer.current);
      showTimer.current = null;
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(hideNow, HIDE_DELAY_MS);
    },
    [hideNow],
  );

  // Painel, seletor ou arraste aberto: o cartão sai.
  useEffect(() => {
    if (disabled) hideNow();
  }, [disabled, hideNow]);
  useEffect(() => hideNow, [hideNow]);

  return { webCard, onHoverStart, onHoverEnd };
}
