import {
  ArrowLeft,
  ArrowRight,
  KeyRound,
  LockKeyhole,
  Moon,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  VenetianMask,
} from "lucide-react";
import { forwardRef } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ToolbarProps = {
  address: string;
  privateTab: boolean;
  canBack: boolean;
  canForward: boolean;
  loading: boolean;
  favorite: boolean;
  blockedCount: number;
  keyOpen: boolean;
  dark: boolean;
  aiOpen: boolean;
  isMac: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onAddressChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onToggleFavorite: () => void;
  onTogglePrivacy: () => void;
  onToggleKey: () => void;
  onToggleDark: () => void;
  onToggleAi: () => void;
};

export const Toolbar = forwardRef<HTMLInputElement, ToolbarProps>(
  function Toolbar(props, inputRef) {
    return (
      <div className="toolbar">
        <div className="nav-actions">
          <Button
            variant="ghost"
            size="icon"
            title="Voltar"
            aria-label="Voltar"
            disabled={!props.canBack}
            onClick={props.onBack}
          >
            <ArrowLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Avançar"
            aria-label="Avançar"
            disabled={!props.canForward}
            onClick={props.onForward}
          >
            <ArrowRight />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title="Recarregar (Ctrl/⌘ R)"
            aria-label="Recarregar"
            onClick={props.onReload}
          >
            <RefreshCw className={cn(props.loading && "spin")} />
          </Button>
        </div>
        <form
          className="omnibox"
          onSubmit={(event) => {
            event.preventDefault();
            props.onSubmit(props.address);
          }}
        >
          {props.privateTab ? (
            <VenetianMask aria-hidden="true" />
          ) : (
            <LockKeyhole aria-hidden="true" />
          )}
          <input
            ref={inputRef}
            value={props.address}
            onChange={(event) => props.onAddressChange(event.target.value)}
            aria-label="Pesquisar ou digitar endereço"
            placeholder="Pesquisar ou digitar endereço"
          />
          <button
            type="button"
            className={cn("fav-button", props.favorite && "on")}
            onClick={props.onToggleFavorite}
            title={props.favorite ? "Remover dos favoritos" : "Adicionar aos favoritos"}
            aria-label="Favoritar página"
            aria-pressed={props.favorite}
          >
            <Star />
          </button>
          <kbd>{props.isMac ? "⌘ K" : "Ctrl K"}</kbd>
        </form>
        <div className="toolbar-actions">
          <button
            type="button"
            className="privacy-pill"
            onClick={props.onTogglePrivacy}
            title="Rastreadores bloqueados"
          >
            <ShieldCheck />
            <strong>{props.blockedCount}</strong>
            <span>bloqueados</span>
          </button>
          <Button
            variant={props.keyOpen ? "default" : "ghost"}
            size="icon"
            onClick={props.onToggleKey}
            title="Abrir Agzos Key"
            aria-label="Abrir Agzos Key"
          >
            <KeyRound />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={props.onToggleDark}
            title={props.dark ? "Usar tema claro" : "Usar tema escuro"}
            aria-label={props.dark ? "Usar tema claro" : "Usar tema escuro"}
          >
            {props.dark ? <Sun /> : <Moon />}
          </Button>
          <Button
            variant={props.aiOpen ? "default" : "ghost"}
            size="icon"
            onClick={props.onToggleAi}
            title="Alternar Agzos AI"
            aria-label="Alternar Agzos AI"
          >
            <Sparkles />
          </Button>
        </div>
      </div>
    );
  },
);
