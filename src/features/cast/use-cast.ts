/**
 * Transmissão na casca (6.0): guarda o resumo das sessões de cada guia (vem do main) e monta
 * o botão da barra e o painel de controle da guia ativa.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { DesktopBridge } from "@/features/browser/desktop";
import type { PanelSpec } from "@/features/browser/overlay/panels";

import type { CastAction, CastSessionInfo } from "./bridge";

type Rect = { x: number; y: number; width: number; height: number };
export type CastPanelKind = "cast";

export function useCastShell({
  desktop,
  panel,
  setPanel,
  activeTabId,
  openTabIds,
}: {
  desktop: DesktopBridge | null;
  panel: string | null;
  setPanel: (kind: CastPanelKind | null) => void;
  activeTabId: number;
  /** Guias que existem: sessões de guias fechadas somem. */
  openTabIds: number[];
}) {
  const [byTab, setByTab] = useState<Record<number, CastSessionInfo[]>>({});
  const [anchor, setAnchor] = useState<Rect | null>(null);
  const panelRef = useRef(panel);
  panelRef.current = panel;

  useEffect(() => {
    if (!desktop?.onCastSessions) return;
    let alive = true;
    void desktop
      .castSessions()
      .then((all) => {
        if (!alive) return;
        setByTab(Object.fromEntries(all.map((item) => [item.tabId, item.sessions])));
      })
      .catch(() => {});
    const off = desktop.onCastSessions((payload) => {
      setByTab((current) => {
        const next = { ...current };
        if (payload.sessions.length) next[payload.tabId] = payload.sessions;
        else delete next[payload.tabId];
        return next;
      });
    });
    return () => {
      alive = false;
      off();
    };
  }, [desktop]);

  const open = new Set(openTabIds);
  const sessions = (byTab[activeTabId] ?? []).filter(() => open.has(activeTabId));
  const active = sessions.some((item) => item.state !== "idle" && item.state !== "ended");

  // Sem sessão na guia ativa o painel não fica aberto sozinho.
  useEffect(() => {
    if (panelRef.current === "cast" && sessions.length === 0) setPanel(null);
  }, [sessions.length, setPanel]);

  const control = useCallback(
    (sessionId: string, action: CastAction, value?: number) => {
      void desktop?.castControl(sessionId, action, value);
    },
    [desktop],
  );

  const urlButton =
    desktop?.onCastSessions && sessions.length > 0
      ? {
          active,
          open: panel === "cast",
          onToggle: (rect: Rect) => {
            if (panelRef.current === "cast") {
              setPanel(null);
              return;
            }
            setAnchor(rect);
            setPanel("cast");
          },
        }
      : null;

  const spec: PanelSpec | null =
    panel === "cast" && desktop && sessions.length > 0
      ? {
          kind: "cast",
          key: "cast",
          props: {
            right: anchor
              ? Math.max(8, Math.round(window.innerWidth - anchor.x - anchor.width))
              : 12,
            top: anchor ? Math.round(anchor.y + anchor.height + 6) : 52,
            sessions,
            onControl: control,
            onClose: () => setPanel(null),
          },
        }
      : null;

  return { urlButton, spec };
}
