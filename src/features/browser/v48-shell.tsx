/**
 * 4.8 na casca: flags por bloco e o DevTools encaixado (Fase 1). Guarda quais guias têm
 * o DevTools aberto (o main avisa), o lado e o tamanho do dock por workspace e os
 * pedidos que chegam do main (menu "Inspecionar", tecla no próprio DevTools). Fica fora
 * de chrome.tsx só pelo tamanho.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DEVTOOLS_HEIGHT, DEVTOOLS_WIDTH, type DevtoolsTab } from "@/features/dev/devtools-limits";

import type { DesktopBridge } from "./desktop";
import type { DevtoolsAction, DevtoolsDock, DevtoolsSide, FeatureFlags } from "./desktop-v48";

export const DEFAULT_DEVTOOLS_DOCK: DevtoolsDock = { side: "right", width: 520, height: 320 };

const SIDES: DevtoolsSide[] = ["right", "bottom", "window"];

const clamp = (value: unknown, { min, max }: { min: number; max: number }, fallback: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.round(Math.min(max, Math.max(min, value)))
    : fallback;

/** Mesma regra de cleanDock em electron/devtools-dock.cjs. */
export function cleanDevtoolsDock(value: unknown): DevtoolsDock {
  const source = (typeof value === "object" && value !== null ? value : {}) as Partial<
    Record<keyof DevtoolsDock, unknown>
  >;
  return {
    side: SIDES.includes(source.side as DevtoolsSide)
      ? (source.side as DevtoolsSide)
      : DEFAULT_DEVTOOLS_DOCK.side,
    width: clamp(source.width, DEVTOOLS_WIDTH, DEFAULT_DEVTOOLS_DOCK.width),
    height: clamp(source.height, DEVTOOLS_HEIGHT, DEFAULT_DEVTOOLS_DOCK.height),
  };
}

export function devtoolsDockKey(workspace: number | null | undefined): string {
  return typeof workspace === "number" && Number.isSafeInteger(workspace) && workspace >= 0
    ? String(workspace)
    : "default";
}

export function useV48Shell({
  desktop,
  activeTabId,
  workspaceId,
  setNotice,
}: {
  desktop: DesktopBridge | null;
  activeTabId: number;
  workspaceId: number | null;
  setNotice: (text: string) => void;
}) {
  const [flags, setFlags] = useState<FeatureFlags | null>(null);
  useEffect(() => {
    if (!desktop) return;
    void desktop.featureFlags().then(setFlags);
    return desktop.onFeatureFlags(setFlags);
  }, [desktop]);
  const devtoolsEnabled = Boolean(desktop && flags?.devtools);

  // Guias com o DevTools aberto e onde (o main avisa ao abrir, fechar ou trocar de lado).
  const [open, setOpen] = useState<Record<number, DevtoolsSide>>({});
  useEffect(() => {
    if (!desktop) return;
    return desktop.onDevtools(({ id, open: isOpen, side }) =>
      setOpen((map) => {
        if (!isOpen) {
          if (!(id in map)) return map;
          const next = { ...map };
          delete next[id];
          return next;
        }
        return map[id] === side ? map : { ...map, [id]: side };
      }),
    );
  }, [desktop]);

  const [docks, setDocks] = useState<Record<string, DevtoolsDock>>({});
  useEffect(() => {
    if (desktop) void desktop.devtoolsDocks().then(setDocks);
  }, [desktop]);
  const key = devtoolsDockKey(workspaceId);
  const dock = useMemo(() => cleanDevtoolsDock(docks[key]), [docks, key]);
  const [tab, setTab] = useState<DevtoolsTab>("devtools");

  const run = useCallback(
    async (tabId: number, action: DevtoolsAction, extra: { x?: number; y?: number } = {}) => {
      if (!desktop) return;
      if (!devtoolsEnabled) {
        setNotice("O DevTools está desligado em Configurações → Recursos → DevTools.");
        return;
      }
      if (action !== "close") setTab("devtools");
      const result = await desktop.devtools(tabId, action, { side: dock.side, ...extra });
      if (result.reason === "tab") {
        setNotice("O DevTools funciona em sites: abra uma página primeiro.");
      } else if (!result.ok && action === "device") {
        setNotice("Não foi possível ligar o modo dispositivo agora. Tente pelo próprio DevTools.");
      }
    },
    [desktop, devtoolsEnabled, dock.side, setNotice],
  );
  const runRef = useRef(run);
  runRef.current = run;

  // Pedidos do main: "Inspecionar" do menu, a mira e as teclas no próprio DevTools.
  useEffect(() => {
    if (!desktop) return;
    return desktop.onDevtoolsRequest(({ id, action, x, y }) => {
      void runRef.current(id, action, {
        ...(typeof x === "number" ? { x } : {}),
        ...(typeof y === "number" ? { y } : {}),
      });
    });
  }, [desktop]);

  const setDock = useCallback(
    (patch: Partial<DevtoolsDock>) => {
      if (!desktop) return;
      const next = cleanDevtoolsDock({ ...dock, ...patch });
      setDocks((map) => ({ ...map, [key]: next }));
      void desktop.setDevtoolsDock(workspaceId, next).then(setDocks);
    },
    [desktop, dock, key, workspaceId],
  );

  /** Troca o lado: grava no workspace e move o DevTools da guia ativa, se aberto. */
  const setSide = useCallback(
    (side: DevtoolsSide) => {
      setDock({ side });
      if (desktop && open[activeTabId]) {
        if (side !== "window") setTab("devtools");
        void desktop.devtools(activeTabId, "open", { side });
      }
    },
    [desktop, open, activeTabId, setDock],
  );

  const activeSide = open[activeTabId] ?? null;
  return {
    flags,
    devtoolsEnabled,
    /** O DevTools da guia está aberto (encaixado ou em janela). */
    isDevtoolsOpen: (tabId: number) => tabId in open,
    /** Lado do dock na guia ativa, só quando encaixado. */
    dockedSide: activeSide && activeSide !== "window" ? activeSide : null,
    dock,
    setDock,
    setSide,
    tab,
    setTab,
    run,
  };
}
