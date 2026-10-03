import { useEffect, useState } from "react";

import type { DesktopBridge, TerminalRuntimeConfig } from "@/features/browser/desktop";
import { DEFAULT_TERMINAL, parseTerminalSettings } from "./config";
import { TerminalView } from "./view";

const isMac = /mac/i.test(navigator.platform);

/** Terminal flutuante (4.1): janela sempre por cima com as sessões da janela do navegador. */
export function FloatingTerminal({ desktop }: { desktop: DesktopBridge }) {
  const [config, setConfig] = useState<TerminalRuntimeConfig | null>(null);
  useEffect(() => {
    const apply = (value: TerminalRuntimeConfig | null) =>
      setConfig({
        ...parseTerminalSettings(value ?? DEFAULT_TERMINAL),
        shell: typeof value?.shell === "string" ? value.shell : "",
        cwd: typeof value?.cwd === "string" ? value.cwd : "",
      });
    void desktop.terminalConfigGet().then(apply);
    return desktop.onTerminalConfig(apply);
  }, [desktop]);
  useEffect(() => {
    if (config) document.body.style.background = config.theme.background;
  }, [config]);
  if (!config) return null;
  return (
    <div className="terminal-window">
      <TerminalView
        desktop={desktop}
        settings={config}
        defaultShell={config.shell}
        defaultCwd={config.cwd}
        isMac={isMac}
        mode="window"
        onHide={() => void desktop.terminalDock("hide")}
        onDock={(mode) => void desktop.terminalDock(mode === "window" ? "hide" : mode)}
        // Fonte pelo atalho: vale só nesta janela até a casca mandar a configuração de novo.
        onSettings={(patch) =>
          setConfig((current) => (current ? { ...current, ...patch } : current))
        }
      />
    </div>
  );
}
