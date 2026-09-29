import {
  ArrowLeft,
  ArrowRight,
  Download,
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
import { forwardRef, type CSSProperties } from "react";

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
  /** Zoom da aba ativa (1 = 100 %). */
  zoom: number;
  /** Botão de downloads: só aparece quando há algum na lista. */
  downloads: { visible: boolean; open: boolean; active: number; fraction: number | null };
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
  onResetZoom: () => void;
  onToggleDownloads: () => void;
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
          {Math.abs(props.zoom - 1) > 0.001 && (
            <button
              type="button"
              className="zoom-pill"
              onClick={props.onResetZoom}
              title="Voltar ao tamanho padrão (Ctrl/⌘ 0)"
              aria-label={`Zoom ${Math.round(props.zoom * 100)} %, voltar para 100 %`}
            >
              {Math.round(props.zoom * 100)}%
            </button>
          )}
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
          {props.downloads.visible && (
            <Button
              variant={props.downloads.open ? "default" : "ghost"}
              size="icon"
              className={cn("downloads-button", props.downloads.active > 0 && "active")}
              onClick={props.onToggleDownloads}
              title="Downloads (Ctrl/⌘ J)"
              aria-label="Downloads"
              style={
                props.downloads.fraction !== null
                  ? ({
                      "--download-progress": `${Math.round(props.downloads.fraction * 360)}deg`,
                    } as CSSProperties)
                  : undefined
              }
            >
              <Download />
            </Button>
          )}
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
