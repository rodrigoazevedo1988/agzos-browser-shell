import { FolderOpen, Puzzle, RefreshCw, ShieldCheck, Store, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  desktopBridge,
  type ExtensionInfo,
  type ExtensionResult,
  type WidevineStatus,
} from "@/features/browser/desktop";
import { cn } from "@/lib/utils";

function extensionErrorText(error: string | undefined) {
  switch (error) {
    case "manifest":
      return "A pasta não tem um manifest.json válido.";
    case "mv2":
      return "Essa extensão usa um Manifest que o Chromium não carrega mais.";
    case "notfound":
      return "A Chrome Web Store não tem uma extensão com esse id (ou ela saiu da loja).";
    case "proof":
      return "O pacote veio sem a assinatura do autor (CRX_REQUIRED_PROOF_MISSING). Não instalado.";
    case "exists":
      return "Essa extensão já está na lista.";
    case "limit":
      return "Limite de extensões atingido.";
    case "id":
      return "Cole o link da extensão na Chrome Web Store (ou o id de 32 letras).";
    case "download":
      return "Não foi possível baixar da Chrome Web Store (sem conexão ou loja fora do ar).";
    case "package":
      return "O pacote baixado não abriu.";
    case "write":
      return "Não foi possível gravar a extensão neste computador.";
    case "unsupported":
      return "Extensões funcionam no app Agzos para computador.";
    default:
      return error ? `O Chromium recusou a extensão: ${error}` : "Não foi possível carregar.";
  }
}

/**
 * Extensões (4.5): Manifest V3 (e V2, 4.6.1) descompactadas e da Chrome Web Store (quando o Chromium do
 * Electron dá conta da extensão). Ligar, desligar, recarregar e remover. Elas rodam só nas
 * guias normais; o storage delas fica separado do dos sites.
 */
export function ExtensionsSetting({ onOpenUrl }: { onOpenUrl: (url: string) => void }) {
  const desktop = desktopBridge();
  const [list, setList] = useState<ExtensionInfo[] | null>(null);
  const [store, setStore] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error" } | null>(null);

  const refresh = useCallback(async () => {
    if (!desktop) return;
    const result = await desktop.extensionsList();
    setList(result.list);
  }, [desktop]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const report = (result: ExtensionResult, done: string) => {
    if (result.canceled) return;
    setMessage(
      result.ok
        ? { tone: "ok", text: done }
        : { tone: "error", text: extensionErrorText(result.error) },
    );
  };

  if (!desktop) {
    return (
      <div className="settings-block">
        <span>Extensões funcionam no app Agzos para computador.</span>
      </div>
    );
  }

  return (
    <div className="settings-block flex-col items-stretch gap-3 extensions-setting">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            report(await desktop.extensionsAddUnpacked(), "Extensão carregada.");
            setBusy(false);
            void refresh();
          }}
        >
          <FolderOpen /> Carregar descompactada…
        </Button>
      </div>
      <form
        className="extensions-store"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!store.trim()) return;
          setBusy(true);
          setMessage({ tone: "ok", text: "Baixando da Chrome Web Store…" });
          report(await desktop.extensionsInstallStore(store), "Extensão da Web Store instalada.");
          setBusy(false);
          setStore("");
          void refresh();
        }}
      >
        <input
          aria-label="Link ou id da extensão na Chrome Web Store"
          placeholder="https://chromewebstore.google.com/detail/…"
          value={store}
          onChange={(event) => setStore(event.target.value)}
        />
        <Button type="submit" disabled={busy || !store.trim()}>
          <Store /> Instalar da Web Store
        </Button>
      </form>
      {message && (
        <p className={`extensions-message ${message.tone}`} role="status">
          {message.text}
        </p>
      )}
      {list && list.length === 0 && <small>Nenhuma extensão ainda.</small>}
      {list && list.length > 0 && (
        <ul className="extensions-list" aria-label="Extensões">
          {list.map((item) => (
            <li key={item.dir} data-extension={item.id ?? ""}>
              <Puzzle aria-hidden="true" />
              <div className="extensions-info">
                <strong>
                  {item.name} <small>{item.version}</small>
                </strong>
                <span title={item.dir}>
                  {item.source === "store" ? "Chrome Web Store" : item.dir}
                </span>
                {item.update && (
                  <span className="extensions-update">
                    Versão {item.update} disponível.{" "}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        report(
                          await desktop.extensionsUpdate(item.dir),
                          `${item.name} atualizada para ${item.update}.`,
                        );
                        setBusy(false);
                        void refresh();
                      }}
                    >
                      Atualizar
                    </button>
                  </span>
                )}
                {item.error && (
                  <span className="extensions-error">{extensionErrorText(item.error)}</span>
                )}
                {(item.popup || item.options || item.sidePanel) && (
                  <span className="extensions-links">
                    {(item.popup ?? item.sidePanel) && (
                      <button
                        type="button"
                        onClick={() => onOpenUrl((item.popup ?? item.sidePanel)!)}
                      >
                        Abrir
                      </button>
                    )}
                    {item.options && (
                      <button type="button" onClick={() => onOpenUrl(item.options!)}>
                        Opções
                      </button>
                    )}
                  </span>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={item.enabled}
                aria-label={`${item.name} ligada`}
                className={cn("switch", item.enabled && "on")}
                onClick={async () => {
                  await desktop.extensionsSetEnabled(item.dir, !item.enabled);
                  void refresh();
                }}
              >
                <i />
              </button>
              {item.source === "unpacked" && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Recarregar ${item.name}`}
                  title="Recarregar (depois de editar a pasta)"
                  onClick={async () => {
                    await desktop.extensionsReload(item.dir);
                    void refresh();
                  }}
                >
                  <RefreshCw />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remover ${item.name}`}
                onClick={async () => {
                  await desktop.extensionsRemove(item.dir);
                  void refresh();
                }}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <small>
        Rodam só nas guias normais (não nas anônimas nem nas Session Tabs). O Electron não tem todas
        as APIs do Chrome: algumas extensões da loja podem não funcionar.
      </small>
    </div>
  );
}

function widevineText(status: WidevineStatus | null) {
  if (!status) return "Verificando…";
  switch (status.state) {
    case "ready":
      return `Ativo${status.version ? ` (CDM ${status.version})` : ""}: Netflix, Spotify e afins tocam aqui.`;
    case "loading":
      return "Baixando o módulo oficial do Google (primeira vez)…";
    case "error":
      return `O módulo não carregou${status.detail ? `: ${status.detail}` : "."}`;
    default:
      return "Este build não traz o Widevine. Conteúdo protegido (Netflix, Spotify) não toca.";
  }
}

/** Conteúdo protegido (4.5): só o estado do CDM Widevine. Só reprodução, nada é gravado. */
export function WidevineSetting() {
  const desktop = desktopBridge();
  const [status, setStatus] = useState<WidevineStatus | null>(null);
  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    const read = () =>
      void desktop.widevineStatus().then((value) => {
        if (!alive) return;
        setStatus(value);
        if (value.state === "loading") window.setTimeout(read, 3000);
      });
    read();
    return () => {
      alive = false;
    };
  }, [desktop]);
  return (
    <div className="settings-block">
      <div className="flex flex-col gap-1">
        <strong className="inline-flex items-center gap-1.5">
          <ShieldCheck aria-hidden="true" className="inline h-4 w-4" /> Conteúdo protegido
          (Widevine)
        </strong>
        <small role="status">{desktop ? widevineText(status) : "Só no app para computador."}</small>
      </div>
    </div>
  );
}
