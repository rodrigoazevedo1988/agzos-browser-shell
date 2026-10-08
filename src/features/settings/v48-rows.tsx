import { useEffect, useState } from "react";

import type { DesktopBridge } from "@/features/browser/desktop";
import type { FeatureFlags } from "@/features/browser/desktop-v48";
import { Toggle } from "@/features/ui/toggle";

/** 4.8 (Fase 1): liga/desliga o DevTools do Chromium (flag devtools). */
export function DevtoolsSettings({
  desktop,
  isMac,
}: {
  desktop: DesktopBridge | null;
  isMac: boolean;
}) {
  const [flags, setFlags] = useState<FeatureFlags | null>(null);
  useEffect(() => {
    if (!desktop) return;
    void desktop.featureFlags().then(setFlags);
    return desktop.onFeatureFlags(setFlags);
  }, [desktop]);
  if (!desktop) return <p className="sf-note">O DevTools funciona no app para computador.</p>;
  const mod = isMac ? "⌘" : "Ctrl";
  return (
    <div className="sf-body">
      <Toggle
        label="DevTools do Chromium"
        hint={`F12 ou ${mod}+Shift+I abre encaixado na janela; ${mod}+Shift+J vai direto ao Console.`}
        checked={flags?.devtools ?? true}
        disabled={flags === null}
        onChange={(value) => void desktop.setFeatureFlag("devtools", value).then(setFlags)}
      />
      <p className="sf-note">
        O lado (direita, embaixo ou janela) e o tamanho ficam gravados por workspace. Com o DevTools
        aberto, {mod}+Shift+C seleciona o elemento nele; fechado, continua sendo a mira de cores e
        Tailwind. A aba Terminal do dock usa o mesmo terminal da janela.
      </p>
    </div>
  );
}
