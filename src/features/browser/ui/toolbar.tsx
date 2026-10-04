import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Download,
  KeyRound,
  Check,
  Link2,
  LockKeyhole,
  Moon,
  PictureInPicture2,
  Pipette,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Star,
  AppWindow,
  MonitorDown,
  Sun,
  Puzzle,
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

import { type BarTooltips, useBarTooltips } from "./bar-tooltip";
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
  /**
   * Chave do Agzos Key na barra de endereço (como nos Chromium): aparece em páginas com
   * login salvo (`saved`) ou com formulário de login; abre o popup do site. null = some.
   */
  siteKey: { saved: boolean; open: boolean; onToggle: () => void } | null;
  /** 4.6: modo leitura (caderno na barra de URL): só quando a página tem artigo legível. */
  reader?: { active: boolean; onToggle: () => void } | null;
  /**
   * 4.7: tema da página (por domínio): lua quando está em Lightning (Dark disponível), sol
   * quando está em Dark (voltar ao Lightning).
   */
  pageTheme?: { dark: boolean; domain: string; shortcut: string; onToggle: () => void } | null;
  /** 4.7: a guia mostra um PDF: abrir no PDF Tools. */
  pdf?: { onOpen: () => void } | null;
  /** 4.7: ColorTools (conta-gotas na barra). */
  colors?: { open: boolean; onToggle: (anchor: DOMRect) => void } | null;
  /** 4.1.1: site com manifesto e service worker: instalar como app (ou abrir o instalado). */
  pwa?: { name: string; installed: boolean; onClick: () => void } | null;
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
  /** 4.5: menu das extensões (como o quebra-cabeça do Chrome). */
  onExtensionsMenu?: ((anchor: DOMRect) => void) | undefined;
  /** 4.6: extensões fixadas (alfinete): ícone na barra, clique abre o pop-up dela. */
  pinnedExtensions?: { dir: string; name: string; icon: string | null }[];
  onExtensionClick?: (dir: string, anchor: DOMRect) => void;
  /** 4.6.1: dicas pelo app (desktop) e atalhos no jeito do sistema. */
  tooltips?: BarTooltips | null;
  mac?: boolean;
  /** 4.6.1: extensões com versão nova na loja (badge no quebra-cabeça). */
  extensionUpdates?: number;
  onExtensionContextMenu?: (dir: string, anchor: DOMRect) => void;
  extensionsOpen?: boolean;
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
    const tips = useBarTooltips(props.tooltips ?? null);
    // Atalho no jeito do sistema: "Ctrl+J" (Windows/Linux) ou "⌘J" (Mac).
    const keys = (combo: string) =>
      props.mac
        ? combo
            .replace(/Ctrl\+/g, "⌘")
            .replace(/Alt\+/g, "⌥")
            .replace(/Shift\+/g, "⇧")
        : combo;
    const copyLink = () => {
      if (!props.shareUrl) return;
      void Promise.resolve(props.onCopyLink(props.shareUrl)).then(() => setCopied(true));
    };
    return (
      <div
        className="toolbar"
        {...tips}
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
            title={`Recarregar (${keys("Ctrl+R")})`}
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
              title={`Voltar ao tamanho padrão (${keys("Ctrl+0")})`}
              aria-label={`Zoom ${Math.round(props.zoom * 100)} %, voltar para 100 %`}
            >
              {Math.round(props.zoom * 100)}%
            </button>
          )}
          {/* Como nos Chromium: chave do Agzos Key, estrela e link ficam juntos na ponta
              direita; ajustes do site e proteção aparecem ao pausar o mouse, à esquerda deles
              (escondidos não abrem buraco entre a chave e a estrela). */}
          <div className="omnibox-actions">
            <div className="omnibox-more">
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
            {props.reader && (
              <button
                type="button"
                className={cn("omnibox-action", "reader-button", props.reader.active && "on")}
                onClick={props.reader.onToggle}
                title={
                  props.reader.active
                    ? `Sair do modo leitura (${keys("Ctrl+Alt+R")})`
                    : `Modo leitura (${keys("Ctrl+Alt+R")})`
                }
                aria-label="Modo leitura"
                aria-pressed={props.reader.active}
              >
                <BookOpenText />
              </button>
            )}
            {props.pdf && (
              <button
                type="button"
                className="omnibox-action pdf-button"
                onClick={props.pdf.onOpen}
                title="Abrir no PDF Tools (editar, comprimir, OCR)"
                aria-label="Abrir no PDF Tools"
              >
                PDF
              </button>
            )}
            {props.pageTheme && (
              <button
                type="button"
                className={cn("omnibox-action", "page-theme-button", props.pageTheme.dark && "on")}
                onClick={props.pageTheme.onToggle}
                title={`${
                  props.pageTheme.dark
                    ? `Voltar ${props.pageTheme.domain} ao Lightning`
                    : `Dark em ${props.pageTheme.domain}`
                }${props.pageTheme.shortcut ? ` (${props.pageTheme.shortcut})` : ""}`}
                aria-label={
                  props.pageTheme.dark
                    ? "Tema Dark desta página ligado: voltar ao Lightning"
                    : "Ligar o tema Dark nesta página"
                }
                aria-pressed={props.pageTheme.dark}
              >
                {props.pageTheme.dark ? <Sun /> : <Moon />}
              </button>
            )}
            {props.pwa && (
              <button
                type="button"
                className={cn("omnibox-action", "pwa-button", props.pwa.installed && "on")}
                onClick={props.pwa.onClick}
                title={
                  props.pwa.installed
                    ? `Abrir o app ${props.pwa.name}`
                    : `Instalar ${props.pwa.name} como app`
                }
                aria-label={props.pwa.installed ? "Abrir o app instalado" : "Instalar o app"}
              >
                {props.pwa.installed ? <AppWindow /> : <MonitorDown />}
              </button>
            )}
            {props.siteKey && (
              <button
                type="button"
                className={cn(
                  "omnibox-action",
                  "site-key",
                  props.siteKey.saved && "saved",
                  props.siteKey.open && "on",
                )}
                onClick={props.siteKey.onToggle}
                title={
                  props.siteKey.saved
                    ? "Logins do Agzos Key para este site"
                    : "Salvar login deste site no Agzos Key"
                }
                aria-label="Agzos Key deste site"
                aria-pressed={props.siteKey.open}
              >
                <KeyRound />
              </button>
            )}
            <button
              type="button"
              className={cn("omnibox-action", "fav-button", props.favorite && "on")}
              onClick={props.onToggleFavorite}
              title={
                props.favorite
                  ? `Editar favorito (${keys("Ctrl+D")})`
                  : `Adicionar aos favoritos (${keys("Ctrl+D")})`
              }
              aria-label="Favoritar página"
              aria-pressed={props.favorite}
            >
              <Star />
            </button>
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
              title={`Picture-in-picture (${keys("Ctrl+Shift+P")})`}
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
              title={`Downloads (${keys("Ctrl+J")})`}
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
          {props.colors && (
            <Button
              variant={props.colors.open ? "default" : "ghost"}
              size="icon"
              className="colors-button"
              onClick={(event) =>
                props.colors?.onToggle(event.currentTarget.getBoundingClientRect())
              }
              title="ColorTools"
              aria-label="ColorTools"
              aria-pressed={props.colors.open}
            >
              <Pipette />
            </Button>
          )}
          {props.pinnedExtensions?.map((item) => (
            <Button
              key={item.dir}
              variant="ghost"
              size="icon"
              className="pinned-extension"
              title={item.name}
              aria-label={item.name}
              onClick={(event) =>
                props.onExtensionClick?.(item.dir, event.currentTarget.getBoundingClientRect())
              }
              onContextMenu={(event) => {
                event.preventDefault();
                props.onExtensionContextMenu?.(
                  item.dir,
                  event.currentTarget.getBoundingClientRect(),
                );
              }}
            >
              {item.icon ? <img src={item.icon} alt="" /> : <Puzzle />}
            </Button>
          ))}
          {props.onExtensionsMenu && (
            <Button
              variant={props.extensionsOpen ? "default" : "ghost"}
              size="icon"
              onClick={(event) =>
                props.onExtensionsMenu?.(event.currentTarget.getBoundingClientRect())
              }
              title={
                props.extensionUpdates
                  ? `Extensões: ${props.extensionUpdates === 1 ? "1 atualização disponível" : `${props.extensionUpdates} atualizações disponíveis`}`
                  : "Extensões"
              }
              aria-label="Extensões"
              className={props.extensionUpdates ? "has-badge" : undefined}
            >
              <Puzzle />
              {props.extensionUpdates ? (
                <span className="toolbar-badge" aria-hidden="true">
                  {props.extensionUpdates}
                </span>
              ) : null}
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
