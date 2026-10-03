import { Download, Loader2, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { DesktopBridge } from "@/features/browser/desktop";
import { CLI_SETUP } from "./config";

/**
 * Preparação das CLIs de IA (4.1.1): na primeira vez que o terminal abre (e pelo
 * lançador), mostra quais já estão no PATH e instala as escolhidas numa aba visível.
 */
export function CliSetup({
  desktop,
  first,
  onInstall,
  onClose,
}: {
  desktop: DesktopBridge;
  /** Primeira abertura do terminal (texto de boas-vindas). */
  first: boolean;
  onInstall: (ids: string[]) => void;
  onClose: () => void;
}) {
  const [found, setFound] = useState<Record<string, boolean> | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  useEffect(() => {
    void desktop.terminalTools(CLI_SETUP.map((tool) => tool.command)).then((result) => {
      setFound(result);
      setChosen(
        new Set(
          CLI_SETUP.filter((tool) => !result[tool.command] && tool.id !== "agy").map(
            (tool) => tool.id,
          ),
        ),
      );
    });
  }, [desktop]);

  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="terminal-setup" role="dialog" aria-label="Preparar as CLIs de IA">
      <header>
        <strong>{first ? "Preparar o terminal" : "CLIs de IA"}</strong>
        <button type="button" aria-label="Fechar" onClick={onClose}>
          <X />
        </button>
      </header>
      <p>
        {first
          ? "As CLIs de IA ficam disponíveis em qualquer sessão. Escolha as que quer instalar: "
          : "Instale as que faltam: "}
        a instalação roda numa aba do terminal, à vista, e as pastas delas entram no PATH.
      </p>
      {found === null ? (
        <p className="terminal-setup-loading">
          <Loader2 className="spin" /> Procurando no PATH…
        </p>
      ) : (
        <ul>
          {CLI_SETUP.map((tool) => {
            const installed = found[tool.command] === true;
            return (
              <li key={tool.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={!installed && chosen.has(tool.id)}
                    disabled={installed}
                    onChange={() => toggle(tool.id)}
                  />
                  <span>
                    {tool.name} <code>{tool.command}</code>
                  </span>
                  <small className={installed ? "found" : "missing"}>
                    {installed ? "instalado" : (tool.note ?? "não encontrado")}
                  </small>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <footer>
        <button type="button" className="terminal-setup-skip" onClick={onClose}>
          {first ? "Agora não" : "Fechar"}
        </button>
        <button
          type="button"
          className="terminal-setup-install"
          disabled={!chosen.size || found === null}
          onClick={() => onInstall([...chosen])}
        >
          <Download /> Instalar {chosen.size ? `(${chosen.size})` : ""}
        </button>
      </footer>
    </div>
  );
}
