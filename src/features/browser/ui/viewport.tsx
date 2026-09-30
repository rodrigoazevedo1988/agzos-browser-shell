import { ShieldCheck } from "lucide-react";
import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { DesktopBridge } from "../desktop";
import { engineOf } from "../engines";
import { describeCrash } from "../load-errors";
import { StartPage } from "../start-page";
import { entryOf, splitShown } from "../store/selectors";
import type { BrowserState } from "../store/state";
import type { QuickLink, Tab } from "../types";
import { WebFrame } from "../web-frame";
import { ErrorPage } from "./error-page";

/** Ações das telas de erro e da página sem resposta (guia ativa). */
export type ErrorActions = {
  canBack: boolean;
  onRetry: (id: number) => void;
  onBack: (id: number) => void;
  onAllowCertificate: (id: number) => void;
  onAllowSite: (id: number) => void;
  onSearch: (text: string) => void;
};

export function Viewport({
  state,
  tab,
  loading,
  blockedToday,
  snapshot,
  desktop,
  onOpen,
  onAddLink,
  onRemoveLink,
  onRecover,
  errors,
  internal,
  onSplitRatio,
  onActivatePane,
  onCloseSplit,
}: {
  errors: ErrorActions;
  /** Página da casca (histórico, favoritos, configurações) para o endereço dado. */
  internal: (url: string) => ReactNode;
  state: BrowserState;
  tab: Tab;
  loading: boolean;
  blockedToday: number | null;
  /** Foto da página enquanto o WebContentsView está escondido (painel aberto). */
  snapshot: string | null;
  desktop: DesktopBridge | null;
  onOpen: (value: string) => void;
  onAddLink: (link: QuickLink) => void;
  onRemoveLink: (url: string) => void;
  onRecover: (id: number) => void;
  /** Tela dividida (2.0): arrastar a divisória, clicar num pane, desfazer. */
  onSplitRatio?: (ratio: number) => void;
  onActivatePane?: (id: number) => void;
  onCloseSplit?: () => void;
}) {
  const splitRef = useRef<HTMLDivElement | null>(null);

  const contentOf = (paneTab: Tab, active: boolean, pane: boolean) => {
    const current = entryOf(paneTab);
    const rejectedUrl = state.loginRejected[paneTab.id];
    const failure = state.failed[paneTab.id];
    if (rejectedUrl) {
      return (
        <div className="crash-page">
          <ShieldCheck aria-hidden="true" />
          <h1>O Google recusou o login nesta guia</h1>
          <p>
            O Google bloqueia alguns logins feitos em navegadores que ele não reconhece. Você pode
            continuar pelo navegador padrão do sistema ou voltar e tentar de novo.
          </p>
          <div className="fallback-actions">
            <Button onClick={() => void desktop?.openExternal(rejectedUrl)}>
              Entrar pelo navegador do sistema
            </Button>
            <Button variant="outline" onClick={() => void desktop?.goBack(paneTab.id)}>
              Voltar
            </Button>
          </div>
        </div>
      );
    }
    if (state.crashed.includes(paneTab.id)) {
      const crash = describeCrash(state.crashReasons[paneTab.id]);
      return (
        <div className="crash-page" role="alert" aria-label="Guia travada">
          <ShieldCheck aria-hidden="true" />
          <h1>{crash.title}</h1>
          <p>{crash.message}</p>
          <Button onClick={() => onRecover(paneTab.id)}>Recarregar</Button>
        </div>
      );
    }
    if (failure && current.kind === "page") {
      return (
        <ErrorPage
          key={`${paneTab.id}-${failure.url}-${failure.code}`}
          failure={failure}
          canBack={active ? errors.canBack : false}
          onRetry={() => errors.onRetry(paneTab.id)}
          onBack={() => errors.onBack(paneTab.id)}
          onAllowCertificate={() => errors.onAllowCertificate(paneTab.id)}
          onAllowSite={() => errors.onAllowSite(paneTab.id)}
          onSearch={errors.onSearch}
        />
      );
    }
    if (current.kind === "internal") return internal(current.url);
    if (current.kind === "home") {
      return (
        <StartPage
          links={state.links}
          engine={engineOf(state.prefs.engine)}
          blocked={blockedToday}
          onOpen={onOpen}
          onAdd={onAddLink}
          onRemove={onRemoveLink}
        />
      );
    }
    return (
      <WebFrame
        key={paneTab.id}
        tabId={paneTab.id}
        title={current.title}
        url={current.url}
        requestedUrl={state.requestedUrl?.id === paneTab.id ? state.requestedUrl.url : undefined}
        dark={state.prefs.dark}
        privateTab={Boolean(paneTab.private)}
        muted={Boolean(paneTab.muted)}
        active={active}
        pane={pane}
      />
    );
  };

  const split = splitShown(state);
  const paneTabs = split
    ? split.ids.map((id) => state.tabs.find((item) => item.id === id)).filter((item) => !!item)
    : [];

  if (!split || paneTabs.length !== 2) {
    return (
      <section className={cn("viewport", tab.private && "private")}>
        {loading && <div className="loading-line" />}
        {contentOf(tab, true, false)}
        {snapshot && <img className="view-snapshot" src={snapshot} alt="" aria-hidden="true" />}
      </section>
    );
  }

  // Arrastar a divisória muda a largura dos dois lados (20 %–80 %).
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    const box = splitRef.current?.getBoundingClientRect();
    if (!box || !onSplitRatio) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: globalThis.PointerEvent) =>
      onSplitRatio((moveEvent.clientX - box.left) / box.width);
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  return (
    <section
      className="viewport split"
      style={{ "--split-ratio": String(split.ratio) } as CSSProperties}
      aria-label="Tela dividida"
    >
      {loading && <div className="loading-line" />}
      <div className="split-view" ref={splitRef}>
        {paneTabs.map((paneTab, index) => {
          const active = paneTab.id === state.activeId;
          return [
            index === 1 && (
              <div
                key="divider"
                className="split-divider"
                role="separator"
                aria-orientation="vertical"
                aria-label="Divisória da tela dividida (arraste; duplo clique desfaz)"
                aria-valuenow={Math.round(split.ratio * 100)}
                onPointerDown={startDrag}
                onDoubleClick={onCloseSplit}
              />
            ),
            <div
              key={paneTab.id}
              className={cn("split-pane", active && "active", paneTab.private && "private")}
              style={{ flexGrow: index === 0 ? split.ratio : 1 - split.ratio }}
              data-pane-id={paneTab.id}
              onPointerDown={() => !active && onActivatePane?.(paneTab.id)}
            >
              {contentOf(paneTab, active, true)}
            </div>,
          ];
        })}
      </div>
      {snapshot && <img className="view-snapshot" src={snapshot} alt="" aria-hidden="true" />}
    </section>
  );
}
