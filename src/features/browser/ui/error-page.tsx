import {
  CircleAlert,
  Clock,
  FileX,
  Globe,
  ShieldAlert,
  ShieldCheck,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import type { LoadFailure } from "../desktop";
import { describeLoadError, hostOfFailure, type LoadErrorKind } from "../load-errors";

const ICONS: Record<LoadErrorKind, LucideIcon> = {
  offline: WifiOff,
  dns: Globe,
  connection: Globe,
  timeout: Clock,
  certificate: ShieldAlert,
  blocked: ShieldCheck,
  redirects: CircleAlert,
  file: FileX,
  generic: CircleAlert,
};

/** Tela da casca no lugar da página que não carregou (a do Chromium fica em branco). */
export function ErrorPage({
  failure,
  canBack,
  onRetry,
  onBack,
  onAllowCertificate,
  onAllowSite,
  onSearch,
}: {
  failure: LoadFailure;
  canBack: boolean;
  onRetry: () => void;
  onBack: () => void;
  onAllowCertificate: () => void;
  /** Escudo: pausa o bloqueio neste site e recarrega. */
  onAllowSite: () => void;
  /** Pesquisa o endereço (quando o domínio não existe). */
  onSearch: (text: string) => void;
}) {
  const info = describeLoadError(failure);
  const Icon = ICONS[info.kind];
  const host = hostOfFailure(failure);
  const [advanced, setAdvanced] = useState(false);

  // Sem internet, endereço não encontrado…: tenta de novo sozinho quando a rede voltar.
  useEffect(() => {
    if (!info.retryWhenOnline) return;
    window.addEventListener("online", onRetry);
    return () => window.removeEventListener("online", onRetry);
  }, [info.retryWhenOnline, onRetry]);

  return (
    <div
      className={`crash-page error-page error-${info.kind}`}
      role="alert"
      aria-label="Erro ao carregar a página"
    >
      <Icon aria-hidden="true" />
      <h1>{info.title}</h1>
      <p>{info.message}</p>
      <code className="error-code">{info.code}</code>
      <div className="fallback-actions">
        {info.kind === "certificate" ? (
          <>
            <Button onClick={canBack ? onBack : onRetry}>
              {canBack ? "Voltar para a segurança" : "Tentar novamente"}
            </Button>
            <Button variant="outline" onClick={() => setAdvanced((open) => !open)}>
              Avançado
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onRetry}>Tentar novamente</Button>
            {info.kind === "blocked" && failure.code === -20 && (
              <Button variant="outline" onClick={onAllowSite}>
                Permitir este site
              </Button>
            )}
            {info.kind === "dns" && (
              <Button variant="outline" onClick={() => onSearch(host)}>
                Pesquisar {host}
              </Button>
            )}
            {canBack && (
              <Button variant="ghost" onClick={onBack}>
                Voltar
              </Button>
            )}
          </>
        )}
      </div>
      {info.kind === "certificate" && advanced && (
        <div className="error-advanced">
          <p>
            O Agzos não conseguiu confirmar que este é mesmo o site {host}. Continue só se souber
            por que o certificado é inválido (ex.: um equipamento da sua rede local).
          </p>
          <Button variant="outline" size="sm" onClick={onAllowCertificate}>
            Continuar para {host} (não seguro)
          </Button>
        </div>
      )}
    </div>
  );
}
