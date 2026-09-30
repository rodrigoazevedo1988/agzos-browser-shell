import {
  ArrowLeft,
  ArrowRight,
  Download,
  KeyRound,
  Check,
  Link2,
  LockKeyhole,
  Moon,
  PictureInPicture2,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  Sun,
  VenetianMask,
} from "lucide-react";
import {
  forwardRef,
  useEffect,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { OmniboxField, type OmniboxFieldProps } from "./omnibox-field";

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
  /** Botão de picture-in-picture: guia com vídeo tocando (ou já em PiP). null = escondido. */
  pip: { active: boolean; onToggle: () => void } | null;
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
  /** Botão extra no fim da barra (o "⋯" nas guias verticais). */
  trailing?: ReactNode;
  /** Sugestões da omnibox (histórico, favoritos, abas, buscador). */
  omnibox: Omit<OmniboxFieldProps, "value" | "onChange" | "onSubmit" | "privateTab">;
  /** Cadeado: informações e permissões do site. */
  siteInfo: { available: boolean; open: boolean; onToggle: () => void };
  /** Endereço da página para o botão de copiar link (null: nada para copiar). */
  shareUrl: string | null;
  onCopyLink: (url: string) => Promise<void> | void;
  /** Clique direito na barra (fora do campo de texto): o mesmo menu da barra de guias. */
  onBarMenu?: (event: MouseEvent) => void;
  /** Atualização baixada e pronta: botão "Atualizar". */
  updateReady: string | null;
  onInstallUpdate: () => void;
};

export const Toolbar = forwardRef<HTMLInputElement, ToolbarProps>(
  function Toolbar(props, inputRef) {
    const [copied, setCopied] = useState(false);
    useEffect(() => {
      if (!copied) return;
      const timer = window.setTimeout(() => setCopied(false), 1400);
      return () => window.clearTimeout(timer);
    }, [copied]);
    const copyLink = () => {
      if (!props.shareUrl) return;
      void Promise.resolve(props.onCopyLink(props.shareUrl)).then(() => setCopied(true));
    };
    return (
      <div
        className="toolbar"
        onContextMenu={(event) => {
          // No campo de endereço vale o menu de texto (copiar/colar).
          if ((event.target as HTMLElement).closest("input")) return;
          props.onBarMenu?.(event);
        }}
      >
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
          {props.siteInfo.available ? (
            <button
              type="button"
              className={cn("site-button", props.siteInfo.open && "on")}
              onClick={props.siteInfo.onToggle}
              title="Informações e permissões do site"
              aria-label="Informações do site"
              aria-pressed={props.siteInfo.open}
            >
              {props.privateTab ? <VenetianMask /> : <LockKeyhole />}
            </button>
          ) : props.privateTab ? (
            <VenetianMask aria-hidden="true" />
          ) : (
            <LockKeyhole aria-hidden="true" />
          )}
          <OmniboxField
            ref={inputRef}
            {...props.omnibox}
            value={props.address}
            privateTab={props.privateTab}
            onChange={props.onAddressChange}
            onSubmit={props.onSubmit}
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
          {/* Como no Comet: o link fica à mão; o resto aparece ao pausar o mouse na barra. */}
          <div className="omnibox-actions">
            <div className="omnibox-more">
              <button
                type="button"
                className={cn("fav-button", props.favorite && "on")}
                onClick={props.onToggleFavorite}
                title={
                  props.favorite
                    ? "Editar favorito (Ctrl/⌘ D)"
                    : "Adicionar aos favoritos (Ctrl/⌘ D)"
                }
                aria-label="Favoritar página"
                aria-pressed={props.favorite}
              >
                <Star />
              </button>
              {props.siteInfo.available && (
                <button
                  type="button"
                  className={cn("omnibox-action", props.siteInfo.open && "on")}
                  onClick={props.siteInfo.onToggle}
                  title="Configurações do site (permissões, zoom)"
                  aria-label="Configurações do site"
                >
                  <SlidersHorizontal />
                </button>
              )}
              <button
                type="button"
                className="omnibox-action"
                onClick={props.onTogglePrivacy}
                title={`Proteção: ${props.blockedCount} bloqueados nesta página`}
                aria-label="Proteção de privacidade"
              >
                <ShieldCheck />
              </button>
            </div>
            {props.shareUrl && (
              <button
                type="button"
                className={cn("omnibox-action", "copy-link", copied && "on")}
                onClick={copyLink}
                title={copied ? "Link copiado" : "Copiar link"}
                aria-label={copied ? "Link copiado" : "Copiar link"}
              >
                {copied ? <Check /> : <Link2 />}
              </button>
            )}
          </div>
        </form>
        <div className="toolbar-actions">
          {props.updateReady && (
            <button
              type="button"
              className="update-pill"
              onClick={props.onInstallUpdate}
              title={`Versão ${props.updateReady} baixada: reiniciar para atualizar`}
            >
              <RefreshCw />
              <span>Atualizar</span>
            </button>
          )}
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
          {props.pip && (
            <Button
              variant={props.pip.active ? "default" : "ghost"}
              size="icon"
              onClick={props.pip.onToggle}
              title="Picture-in-picture (Ctrl/⌘ Shift P)"
              aria-label={props.pip.active ? "Sair do picture-in-picture" : "Picture-in-picture"}
              aria-pressed={props.pip.active}
            >
              <PictureInPicture2 />
            </Button>
          )}
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
          {props.trailing}
        </div>
      </div>
    );
  },
);
