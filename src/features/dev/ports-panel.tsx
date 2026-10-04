import {
  Copy,
  ExternalLink,
  FolderGit2,
  Globe,
  Network,
  RefreshCw,
  Search,
  Skull,
  Square,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import type { DesktopBridge, PortInfo, TunnelStatus } from "@/features/browser/desktop";
import { cn } from "@/lib/utils";

import { filterPorts, killErrorText, tunnelErrorText } from "./ports";

const POLL_MS = 4000;
export const CLOUDFLARED_DOWNLOAD_URL =
  "https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/";

type Tunnel = { port: number; url: string | null; starting?: boolean };

/**
 * Painel de portas (4.5): o que escuta TCP no PC, de qual processo e projeto. "Matar"
 * pede confirmação; "Expor" sobe um túnel HTTPS (cloudflared) e copia a URL pública.
 * Fechar o painel fecha os túneis desta janela.
 */
export function PortsPanel({
  desktop,
  onClose,
  onOpenUrl,
}: {
  desktop: DesktopBridge | null;
  onClose: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const [ports, setPorts] = useState<PortInfo[] | null>(null);
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<PortInfo | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [binary, setBinary] = useState<string | null | undefined>(undefined);
  const [copied, setCopied] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!desktop) return;
    const result = await desktop.portsList().catch(() => ({ ok: false, ports: [] }));
    setPorts(result.ports);
  }, [desktop]);

  useEffect(() => {
    if (!desktop) return;
    void refresh();
    void desktop
      .tunnelStatus()
      .then((status: TunnelStatus) => {
        setBinary(status.binary);
        setTunnels(status.tunnels);
      })
      .catch(() => setBinary(null));
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    const off = desktop.onTunnel((event) => {
      setTunnels((list) =>
        event.state === "closed"
          ? list.filter((item) => item.port !== event.port)
          : [
              ...list.filter((item) => item.port !== event.port),
              { port: event.port, url: event.url },
            ],
      );
    });
    return () => {
      window.clearInterval(timer);
      off();
      // Fechar o painel encerra os túneis desta janela.
      void desktop.tunnelStop();
    };
  }, [desktop, refresh]);

  const shown = useMemo(() => filterPorts(ports ?? [], query), [ports, query]);

  const kill = async (item: PortInfo) => {
    setConfirm(null);
    if (!desktop || item.pid === null) return;
    const result = await desktop.portsKill(item.pid);
    setMessage(
      result.ok
        ? {
            tone: "ok",
            text: `${item.name || "Processo"} (PID ${item.pid}) encerrado${result.forced ? " à força" : ""}; a porta ${item.port} ficou livre.`,
          }
        : { tone: "error", text: killErrorText(result.error) },
    );
    void refresh();
  };

  const expose = async (port: number) => {
    if (!desktop) return;
    setTunnels((list) => [
      ...list.filter((item) => item.port !== port),
      { port, url: null, starting: true },
    ]);
    const result = await desktop.tunnelStart(port);
    if (result.ok && result.url) {
      setTunnels((list) => [
        ...list.filter((item) => item.port !== port),
        { port, url: result.url ?? null },
      ]);
      setCopied(port);
      setMessage({ tone: "ok", text: `URL pública copiada: ${result.url}` });
      return;
    }
    setTunnels((list) => list.filter((item) => item.port !== port));
    if (result.error === "missing") setBinary(null);
    setMessage({ tone: "error", text: tunnelErrorText(result.error) });
  };

  const stopTunnel = (port: number) => {
    void desktop?.tunnelStop(port);
    setTunnels((list) => list.filter((item) => item.port !== port));
  };

  const pickBinary = async () => {
    const result = await desktop?.tunnelPickBinary();
    if (result?.ok) {
      setBinary(result.binary ?? null);
      setMessage({ tone: "ok", text: "cloudflared encontrado. Já dá para expor uma porta." });
    } else if (result?.error === "invalid") {
      setMessage({
        tone: "error",
        text: "Esse arquivo não é o cloudflared (ou não é executável).",
      });
    }
  };

  const tunnelOf = (port: number) => tunnels.find((item) => item.port === port);

  return (
    <aside className="gx-panel ports-panel" aria-label="Portas em uso" data-ports-panel>
      <header className="gx-head">
        <Network aria-hidden="true" />
        <strong>Portas em uso</strong>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Atualizar portas"
          title="Atualizar"
          onClick={() => void refresh()}
        >
          <RefreshCw />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Fechar portas" onClick={onClose}>
          <X />
        </Button>
      </header>

      <div className="gx-body ports-body">
        {!desktop ? (
          <p className="ports-empty">O painel de portas funciona no app Agzos para computador.</p>
        ) : (
          <>
            <label className="ports-search">
              <Search aria-hidden="true" />
              <input
                type="search"
                placeholder="Filtrar por porta, processo ou projeto"
                aria-label="Filtrar portas"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            {message && (
              <p className={cn("ports-message", message.tone)} role="status">
                {message.text}
              </p>
            )}

            {binary === null && (
              <div className="ports-missing" role="note">
                <strong>Túnel HTTPS precisa do cloudflared</strong>
                <span>
                  Instale o cloudflared (gratuito, da Cloudflare) ou aponte onde ele está. O Agzos
                  não baixa nem embute outro programa.
                </span>
                <div>
                  <Button size="sm" variant="outline" onClick={() => void pickBinary()}>
                    Escolher o binário…
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onOpenUrl(CLOUDFLARED_DOWNLOAD_URL)}
                  >
                    <ExternalLink /> Como instalar
                  </Button>
                </div>
              </div>
            )}

            {ports === null ? (
              <p className="ports-empty">Lendo as portas…</p>
            ) : shown.length === 0 ? (
              <p className="ports-empty">
                {query ? "Nada com esse filtro." : "Nenhum processo escutando TCP agora."}
              </p>
            ) : (
              <ul className="ports-list" aria-label="Portas">
                {shown.map((item) => {
                  const tunnel = tunnelOf(item.port);
                  const key = `${item.port}-${item.pid ?? "x"}`;
                  return (
                    <li key={key} className="ports-item" data-port={item.port}>
                      <div className="ports-row">
                        <span className="ports-number">:{item.port}</span>
                        <span className="ports-proc" title={item.addresses.join(", ")}>
                          <strong>{item.name || "processo desconhecido"}</strong>
                          <small>
                            {item.pid !== null
                              ? `PID ${item.pid}${item.pids.length > 1 ? ` +${item.pids.length - 1}` : ""}`
                              : "sem permissão para ver o PID"}
                            {item.local ? " · só nesta máquina" : " · visível na rede"}
                          </small>
                        </span>
                        {!item.self && item.pid !== null && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="ports-kill"
                            aria-label={`Matar ${item.name || "processo"} na porta ${item.port}`}
                            title="Matar processo"
                            onClick={() => setConfirm(item)}
                          >
                            <Skull />
                          </Button>
                        )}
                      </div>
                      {item.project && (
                        <p className="ports-project" title={item.project.dir}>
                          <FolderGit2 aria-hidden="true" /> {item.project.name}
                        </p>
                      )}
                      {confirm === item && (
                        <div
                          className="ports-confirm"
                          role="alertdialog"
                          aria-label="Confirmar encerrar processo"
                        >
                          <span>
                            Encerrar <strong>{item.name || "o processo"}</strong> (PID {item.pid})
                            na porta {item.port}? O que não foi salvo nele se perde.
                          </span>
                          <div>
                            <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                              Cancelar
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => void kill(item)}>
                              Encerrar
                            </Button>
                          </div>
                        </div>
                      )}
                      <div className="ports-tunnel">
                        {tunnel?.url ? (
                          <>
                            <a
                              href={tunnel.url}
                              onClick={(event) => {
                                event.preventDefault();
                                onOpenUrl(tunnel.url!);
                              }}
                            >
                              <Globe aria-hidden="true" /> {tunnel.url.replace(/^https:\/\//, "")}
                            </a>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label="Copiar URL pública"
                              title={copied === item.port ? "Copiada" : "Copiar"}
                              onClick={() => {
                                void navigator.clipboard?.writeText(tunnel.url!);
                                setCopied(item.port);
                              }}
                            >
                              <Copy />
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={`Encerrar túnel da porta ${item.port}`}
                              onClick={() => stopTunnel(item.port)}
                            >
                              <Square /> Encerrar túnel
                            </Button>
                          </>
                        ) : tunnel?.starting ? (
                          <span className="ports-starting" role="status">
                            Abrindo túnel…
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={binary === null}
                            aria-label={`Expor porta ${item.port}`}
                            onClick={() => void expose(item.port)}
                          >
                            <Globe /> Expor porta
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="ports-note">
              Túnel: URL pública temporária do Cloudflare (trycloudflare.com). Fica aberto enquanto
              este painel estiver aberto.
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
