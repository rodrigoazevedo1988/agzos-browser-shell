import { Check, MoreHorizontal, Search, ShieldCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { engines } from "@/features/browser/engines";
import type { EngineId } from "@/features/browser/types";
import { Toggle } from "@/features/ui/toggle";
import { cn } from "@/lib/utils";

export function SettingsPanel({
  dark,
  setDark,
  aiOpen,
  setAiOpen,
  shield,
  setShield,
  engine,
  setEngine,
  onReset,
  onClose,
}: {
  dark: boolean;
  setDark: (value: boolean) => void;
  aiOpen: boolean;
  setAiOpen: (value: boolean) => void;
  shield: boolean;
  setShield: (value: boolean) => void;
  engine: EngineId;
  setEngine: (value: EngineId) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <aside className="key-panel" aria-label="Configurações">
      <div className="panel-heading">
        <div className="panel-title">
          <span className="key-mark">
            <MoreHorizontal />
          </span>
          <div>
            <strong>Configurações</strong>
            <small>Preferências do navegador</small>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar configurações">
          <X />
        </Button>
      </div>
      <div className="key-domain">
        <span>Motor de busca</span>
      </div>
      <div className="engine-choice">
        {engines.map((item) => (
          <button
            key={item.id}
            type="button"
            className={cn("engine-option", engine === item.id && "selected")}
            aria-pressed={engine === item.id}
            onClick={() => setEngine(item.id)}
          >
            <Search />
            <span>
              <strong>{item.name}</strong>
              <small>{item.hint}</small>
            </span>
            {engine === item.id && <Check />}
          </button>
        ))}
      </div>
      <Toggle label="Tema escuro" checked={dark} onChange={setDark} />
      <Toggle
        label="Agzos AI visível"
        hint="Barra lateral de IA"
        checked={aiOpen}
        onChange={setAiOpen}
      />
      <Toggle
        label="Bloquear rastreadores"
        hint="Em todos os sites"
        checked={shield}
        onChange={setShield}
      />
      <div className="settings-shortcuts">
        <strong>Atalhos</strong>
        <ul>
          <li>
            <kbd>⌘/Ctrl K</kbd> Barra de endereços
          </li>
          <li>
            <kbd>⌘/Ctrl T</kbd> Nova aba
          </li>
          <li>
            <kbd>⌘/Ctrl W</kbd> Fechar aba
          </li>
          <li>
            <kbd>⌘/Ctrl R</kbd> Recarregar
          </li>
        </ul>
      </div>
      <div className="settings-actions">
        <Button variant="outline" size="sm" className="text-xs" onClick={onReset}>
          Restaurar abas iniciais
        </Button>
      </div>
      <div className="key-footer">
        <ShieldCheck />
        <span>Preferências salvas neste dispositivo</span>
      </div>
    </aside>
  );
}
