import { useCallback, useEffect, useRef, useState } from "react";

import type { DesktopBridge } from "@/features/browser/desktop";

import { EMPTY_AUTOFILL, siteKeyOf, type AutofillState, type FormFillTabEvent } from "./form-fill";

export type FormOffer = Extract<FormFillTabEvent, { type: "form-field" }>;
export type FormLearn = Extract<FormFillTabEvent, { type: "form-learn" }>;

/**
 * Autofill de formulários na casca: guarda o estado dos perfis (do main, cifrado lá),
 * a oferta de preencher o formulário clicado na guia ativa e a pergunta "lembrar este
 * campo?" quando o usuário corrige um valor preenchido.
 */
export function useFormFill({
  desktop,
  activeTabId,
  currentUrl,
}: {
  desktop: DesktopBridge | null;
  activeTabId: number;
  currentUrl: string;
}) {
  const [state, setState] = useState<AutofillState>(EMPTY_AUTOFILL);
  const [offer, setOffer] = useState<FormOffer | null>(null);
  const [learn, setLearn] = useState<FormLearn | null>(null);
  const [missed, setMissed] = useState(false);
  const activeRef = useRef(activeTabId);
  activeRef.current = activeTabId;
  const filledAtRef = useRef(0);

  useEffect(() => {
    if (!desktop) return;
    void desktop
      .autofillState()
      .then(setState)
      .catch(() => {});
    const offChanged = desktop.onAutofillChanged(setState);
    const offTab = desktop.onTabEvent((event) => {
      if (event.type === "form-field") {
        if (event.id !== activeRef.current) return;
        // O próprio preenchimento foca os campos: não reabre logo depois.
        if (Date.now() - filledAtRef.current < 2000) return;
        setMissed(false);
        setOffer(event);
      } else if (event.type === "form-learn") {
        if (event.id === activeRef.current) setLearn(event);
      }
    });
    return () => {
      offChanged();
      offTab();
    };
  }, [desktop]);

  // Outra página ou outra guia: a oferta e a pergunta somem.
  useEffect(() => {
    setOffer(null);
    setLearn(null);
  }, [currentUrl, activeTabId]);

  const fill = useCallback(
    (profileId: string) => {
      if (!desktop) return;
      const tabId = activeRef.current;
      filledAtRef.current = Date.now();
      void desktop.fillProfile(tabId, profileId).then((result) => {
        filledAtRef.current = Date.now();
        if (result.ok && result.filled) {
          setOffer(null);
          setMissed(false);
        } else setMissed(true);
      });
    },
    [desktop],
  );

  const never = useCallback(() => {
    const site = siteKeyOf(offer?.url);
    setOffer(null);
    if (desktop && site) void desktop.autofillSetNever(site, true);
  }, [desktop, offer]);

  const remember = useCallback(() => {
    if (desktop && learn) {
      void desktop.autofillSetMapping(learn.site, learn.signature, learn.to, learn.label);
    }
    setLearn(null);
  }, [desktop, learn]);

  return {
    state,
    offer,
    missed,
    learn,
    fill,
    never,
    remember,
    dismiss: useCallback(() => setOffer(null), []),
    dismissLearn: useCallback(() => setLearn(null), []),
  };
}
