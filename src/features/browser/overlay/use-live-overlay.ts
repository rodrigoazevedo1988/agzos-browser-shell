import { useEffect, useRef, useState } from "react";

import type { DesktopBridge } from "../desktop";
import { cloneableResult, splitProps, type OverlayPayload } from "./bridge";
import type { PanelSpec } from "./panels";

/**
 * - `inline`: o painel é desenhado na casca (web, ou plano B do app com a foto da página);
 * - `opening`/`live`: o painel está na camada acima da página, que segue pintando.
 */
export type OverlayStatus = "inline" | "opening" | "live";

/**
 * Leva o painel aberto para a camada do main (chrome-overlay.cjs). Se ela não abrir,
 * devolve `inline` e a casca usa o caminho antigo (foto da página no lugar).
 */
export function useLiveOverlay(
  desktop: DesktopBridge | null,
  spec: PanelSpec | null,
  classes: string[],
  onDismiss: () => void,
): OverlayStatus {
  const handlers = useRef<Record<string, (...args: unknown[]) => unknown>>({});
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [liveKey, setLiveKey] = useState<string | null>(null);

  const openKey = spec ? `${spec.kind}:${spec.key ?? ""}` : null;
  let payload: OverlayPayload | null = null;
  if (spec) {
    const { data, fns } = splitProps(spec.props);
    handlers.current = fns;
    payload = { kind: spec.kind, key: spec.key ?? spec.kind, data, fns: Object.keys(fns), classes };
  }
  const payloadJson = payload ? JSON.stringify(payload) : null;
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const failed = openKey !== null && failedKey === openKey;

  // Abre, troca ou atualiza (mesmo canal: o main reusa a camada aberta).
  useEffect(() => {
    const current = payloadRef.current;
    if (!desktop || !openKey || !current || failed) return;
    let cancelled = false;
    void desktop
      .overlayOpen(current)
      .catch(() => ({ ok: false }))
      .then(({ ok }) => {
        if (cancelled) return;
        if (ok) setLiveKey(openKey);
        else setFailedKey(openKey);
      });
    return () => {
      cancelled = true;
    };
  }, [desktop, openKey, payloadJson, failed]);

  // Painel fechado: a próxima abertura tenta a camada de novo.
  useEffect(() => {
    if (openKey !== null) return;
    setFailedKey(null);
    setLiveKey(null);
  }, [openKey]);

  // Fechou (ou virou plano B): a camada some.
  const layerWanted = openKey !== null && !failed;
  useEffect(() => {
    if (!desktop || !layerWanted) return;
    return () => {
      void desktop.overlayClose();
    };
  }, [desktop, layerWanted, openKey]);

  useEffect(() => {
    if (!desktop) return;
    const offCall = desktop.onOverlayCall(({ id, name, args }) => {
      const handler = handlers.current[name];
      void Promise.resolve()
        .then(() => handler?.(...args))
        .catch(() => undefined)
        .then((result) => desktop.overlayReply(id, cloneableResult(result)));
    });
    const offDismiss = desktop.onOverlayDismissed(() => dismissRef.current());
    return () => {
      offCall();
      offDismiss();
    };
  }, [desktop]);

  if (!desktop || !openKey || failed) return "inline";
  return liveKey === openKey ? "live" : "opening";
}
