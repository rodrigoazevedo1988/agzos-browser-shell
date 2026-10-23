/**
 * yt-dlp na casca (5.0): botão da barra de URL, popup de qualidade, instalação e o item do
 * clique direito (agzos:ytdlp-open). O download em si é do main; a lista mostra em Downloads.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { DesktopBridge } from "@/features/browser/desktop";
import type { PanelSpec } from "@/features/browser/overlay/panels";

import type { YtdlpQuality, YtdlpStatus } from "./bridge";
import { hostOfUrl, isKnownVideoHost } from "./hosts";

type Rect = { x: number; y: number; width: number; height: number };
type Target = { tabId: number; url: string; private: boolean; anchor: Rect | null };
export type YtdlpPanelKind = "ytdlp";

export function ytdlpErrorText(error?: string): string {
  switch (error) {
    case "url":
      return "Este endereço não pode ser baixado (só links http e https).";
    case "missing":
      return "O yt-dlp não está instalado.";
    case "busy":
      return "Já há downloads de vídeo em andamento. Espere um terminar.";
    case "dir":
      return "Não foi possível criar a pasta de destino.";
    case "quality":
      return "Essa qualidade não existe.";
    case "checksum":
      return "O arquivo baixado não bateu com o SHA-256 oficial. Nada foi instalado.";
    case "download":
      return "Não consegui baixar o yt-dlp. Confira a conexão.";
    case "in-use":
      return "O yt-dlp está em uso. Tente de novo quando os downloads terminarem.";
    case "platform":
      return "Não há yt-dlp oficial para este sistema.";
    case "invalid":
      return "Esse arquivo não é um yt-dlp.";
    case "spawn":
      return "Não foi possível abrir o yt-dlp.";
    case "off":
      return "O download com yt-dlp está desligado em Configurações > Recursos.";
    default:
      return "Não foi possível iniciar o download.";
  }
}

export function useYtdlpShell({
  desktop,
  panel,
  setPanel,
  activeUrl,
  activeIsPage,
  activeTabId,
  tabInfo,
  setNotice,
}: {
  desktop: DesktopBridge | null;
  panel: string | null;
  setPanel: (kind: YtdlpPanelKind | null) => void;
  activeUrl: string;
  activeIsPage: boolean;
  activeTabId: number;
  tabInfo: (tabId: number) => { url: string; private: boolean; page: boolean } | null;
  setNotice: (text: string) => void;
}) {
  const [status, setStatus] = useState<YtdlpStatus | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [installing, setInstalling] = useState(false);
  const panelRef = useRef(panel);
  panelRef.current = panel;
  const tabInfoRef = useRef(tabInfo);
  tabInfoRef.current = tabInfo;

  const refresh = useCallback(async () => {
    if (!desktop) return;
    try {
      setStatus(await desktop.ytdlpStatus());
    } catch {
      setStatus(null);
    }
  }, [desktop]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const open = useCallback(
    (next: Target) => {
      setTarget(next);
      setError(null);
      setPanel("ytdlp");
      void refresh();
    },
    [refresh, setPanel],
  );

  /** Comando ui.openYtdlp (menu nativo, paleta) e o botão da barra: a página da guia. */
  const openTab = useCallback(
    (tabId: number, anchor: Rect | null) => {
      if (status && !status.enabled) {
        setNotice(ytdlpErrorText("off"));
        return;
      }
      const info = tabInfoRef.current(tabId);
      if (!info?.page) {
        setNotice("Abra uma página com vídeo para baixar.");
        return;
      }
      open({ tabId, url: info.url, private: info.private, anchor });
    },
    [open, setNotice, status],
  );

  // Clique direito num vídeo ou link (electron/main.cjs, buildPageContextMenu).
  useEffect(
    () =>
      desktop?.onYtdlpOpen((payload) =>
        open({
          tabId: payload.tabId,
          url: payload.url,
          private: payload.private,
          anchor: null,
        }),
      ),
    [desktop, open],
  );

  // Erros de download de qualquer janela (o processo é do main).
  useEffect(
    () =>
      desktop?.onYtdlpError((payload) => {
        setNotice(`Download com yt-dlp falhou: ${payload.message} Copie os detalhes em Downloads.`);
      }),
    [desktop, setNotice],
  );

  const close = useCallback(() => {
    setTarget(null);
    setError(null);
    setPanel(null);
  }, [setPanel]);

  const start = useCallback(
    async (quality: YtdlpQuality) => {
      if (!desktop || !target) return;
      setBusy(true);
      setError(null);
      try {
        const result = await desktop.ytdlpStart({
          url: target.url,
          quality,
          private: target.private,
          tabId: target.tabId,
        });
        if (result.ok) {
          close();
          setNotice("Download com yt-dlp iniciado. Acompanhe em Downloads.");
          return;
        }
        setError(ytdlpErrorText(result.error));
        if (result.error === "missing") void refresh();
      } catch {
        setError(ytdlpErrorText());
      } finally {
        setBusy(false);
      }
    },
    [close, desktop, refresh, setNotice, target],
  );

  /** prefer: "Usar o yt-dlp do Agzos" (grava o gerenciado como o escolhido). */
  const install = useCallback(
    async (prefer = false) => {
      if (!desktop) return;
      setInstalling(true);
      setError(null);
      try {
        const result = await desktop.ytdlpInstall({ prefer });
        if (result.ok)
          setNotice(
            prefer
              ? "Agora o Agzos usa o yt-dlp dele."
              : "yt-dlp instalado. Escolha a qualidade do vídeo.",
          );
        else setError(ytdlpErrorText(result.error));
      } catch {
        setError(ytdlpErrorText("download"));
      } finally {
        setInstalling(false);
        void refresh();
      }
    },
    [desktop, refresh, setNotice],
  );

  const pick = useCallback(async () => {
    if (!desktop) return;
    setError(null);
    try {
      const result = await desktop.ytdlpPick();
      if (result.ok) {
        setNotice("yt-dlp escolhido.");
        void refresh();
      } else if (result.error) {
        setError(ytdlpErrorText(result.error));
      }
    } catch {
      setError(ytdlpErrorText("invalid"));
    }
  }, [desktop, refresh, setNotice]);

  const enabled = Boolean(desktop && status?.enabled);
  const urlButton =
    enabled && activeIsPage
      ? {
          known: isKnownVideoHost(activeUrl),
          open: panel === "ytdlp",
          onToggle: (rect: Rect) => {
            if (panelRef.current === "ytdlp") {
              setPanel(null);
              return;
            }
            openTab(activeTabId, rect);
          },
        }
      : null;

  const spec: PanelSpec | null =
    panel === "ytdlp" && target && desktop && enabled
      ? {
          kind: "ytdlp",
          key: `ytdlp-${target.tabId}`,
          props: {
            right: target.anchor
              ? Math.max(8, Math.round(window.innerWidth - target.anchor.x - target.anchor.width))
              : 12,
            top: target.anchor ? Math.round(target.anchor.y + target.anchor.height + 6) : 52,
            host: hostOfUrl(target.url) || target.url,
            known: isKnownVideoHost(target.url),
            installed: Boolean(status?.binary),
            managed: Boolean(status?.managed),
            version: status?.version ?? null,
            stale: Boolean(status?.stale),
            onUseManaged: () => void install(true),
            ffmpeg: Boolean(status?.ffmpeg),
            installing,
            busy,
            error,
            onStart: (quality: YtdlpQuality) => void start(quality),
            onInstall: () => void install(),
            onPick: () => void pick(),
            onClose: close,
          },
        }
      : null;

  return { urlButton, spec, openTab, status, refresh };
}
