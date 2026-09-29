import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { DesktopBridge } from "../desktop";
import { engineOf } from "../engines";
import { StartPage } from "../start-page";
import { entryOf } from "../store/selectors";
import type { BrowserState } from "../store/state";
import type { QuickLink, Tab } from "../types";
import { WebFrame } from "../web-frame";

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
}: {
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
}) {
  const current = entryOf(tab);
  const rejectedUrl = state.loginRejected[tab.id];

  let content;
  if (rejectedUrl) {
    content = (
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
          <Button variant="outline" onClick={() => void desktop?.goBack(tab.id)}>
            Voltar
          </Button>
        </div>
      </div>
    );
  } else if (state.crashed.includes(tab.id)) {
    content = (
      <div className="crash-page">
        <ShieldCheck aria-hidden="true" />
        <h1>Esta guia travou</h1>
        <p>O processo desta página parou de responder.</p>
        <Button onClick={() => onRecover(tab.id)}>Recarregar</Button>
      </div>
    );
  } else if (current.kind === "home") {
    content = (
      <StartPage
        links={state.links}
        engine={engineOf(state.prefs.engine)}
        blocked={blockedToday}
        onOpen={onOpen}
        onAdd={onAddLink}
        onRemove={onRemoveLink}
      />
    );
  } else {
    content = (
      <WebFrame
        key={tab.id}
        tabId={tab.id}
        title={current.title}
        url={current.url}
        requestedUrl={state.requestedUrl?.id === tab.id ? state.requestedUrl.url : undefined}
        dark={state.prefs.dark}
        privateTab={Boolean(tab.private)}
        muted={Boolean(tab.muted)}
      />
    );
  }

  return (
    <section className={cn("viewport", tab.private && "private")}>
      {loading && <div className="loading-line" />}
      {content}
      {snapshot && <img className="view-snapshot" src={snapshot} alt="" aria-hidden="true" />}
    </section>
  );
}
