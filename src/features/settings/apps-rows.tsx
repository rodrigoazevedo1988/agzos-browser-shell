import { AppWindow, ExternalLink, Loader2, MonitorDown, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { desktopBridge, type InstalledPwa, type PwaReason } from "@/features/browser/desktop";

/** Por que o site não virou app, em palavras. */
function pwaReasonText(reason: PwaReason) {
  switch (reason) {
    case "manifest":
      return "Este site não publica um manifesto de app, então não dá para instalar.";
    case "insecure":
      return "Só sites em HTTPS podem virar app.";
    case "icon":
      return "O manifesto do site não tem ícone, então não dá para instalar.";
    case "private":
      return "Guias anônimas não instalam apps. Abra o site numa guia normal.";
    case "page":
    case "tab":
      return "Abra o site numa guia normal e tente de novo.";
  }
}

type SiteTab = { id: number; url: string; title: string };

function hostOf(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Tentar instalar este site como app (4.1.3): a mesma ação do ícone da barra de endereço,
 * para quando ele não aparece. Verifica a guia na hora (manifesto lido pelo Chromium).
 */
function TryInstall({ siteTabs }: { siteTabs: SiteTab[] }) {
  const desktop = desktopBridge();
  const [tabId, setTabId] = useState<number | null>(siteTabs[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    if (tabId === null || !siteTabs.some((tab) => tab.id === tabId)) {
      setTabId(siteTabs[0]?.id ?? null);
    }
  }, [siteTabs, tabId]);
  if (!desktop) return null;
  const tab = siteTabs.find((item) => item.id === tabId) ?? null;

  async function tryInstall() {
    if (!desktop || !tab) return;
    setBusy(true);
    setMessage(null);
    const check = await desktop.pwaCheck(tab.id);
    if (!check.ok) {
      setBusy(false);
      setMessage({ ok: false, text: pwaReasonText(check.reason) });
      return;
    }
    if (check.installed) {
      await desktop.pwaOpen(check.id);
      setBusy(false);
      setMessage({ ok: true, text: `${check.name} já está instalado; abri o app.` });
      return;
    }
    const result = await desktop.pwaInstall(tab.id);
    setBusy(false);
    if (result.ok) setMessage({ ok: true, text: `${check.name} instalado como app.` });
    else if (result.error === "cancelled") setMessage(null);
    else
      setMessage({
        ok: false,
        text: result.reason ? pwaReasonText(result.reason) : "Não foi possível instalar.",
      });
  }

  return (
    <div className="pwa-try">
      <strong>Tentar instalar este site como app</strong>
      {siteTabs.length ? (
        <div className="pwa-try-row">
          <select
            aria-label="Site para instalar"
            value={tabId ?? ""}
            onChange={(event) => {
              setTabId(Number(event.target.value));
              setMessage(null);
            }}
          >
            {siteTabs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title ? `${item.title} — ${hostOf(item.url)}` : hostOf(item.url)}
              </option>
            ))}
          </select>
          <Button size="sm" onClick={() => void tryInstall()} disabled={busy || !tab}>
            {busy ? <Loader2 className="spin" /> : <MonitorDown />} Tentar instalar
          </Button>
        </div>
      ) : (
        <p className="settings-note">Abra o site numa guia para instalar.</p>
      )}
      {message && (
        <p className={message.ok ? "settings-note" : "ai-error"} role="status">
          {message.text}
        </p>
      )}
    </div>
  );
}

/**
 * Apps instalados (PWA, 4.1.1): abrir em janela própria ou desinstalar (atalho do
 * sistema e dados do app saem juntos). Instalar é pelo ícone na barra de endereço ou,
 * quando ele não aparece, por "Tentar instalar este site como app".
 */
export function InstalledAppsSetting({ siteTabs = [] }: { siteTabs?: SiteTab[] }) {
  const desktop = desktopBridge();
  const [apps, setApps] = useState<InstalledPwa[] | null>(null);
  const load = useCallback(() => {
    void desktop?.pwaList().then(setApps);
  }, [desktop]);
  useEffect(() => {
    load();
    return desktop?.onPwaChanged(load);
  }, [desktop, load]);

  if (!desktop) return null;
  return (
    <div className="settings-block">
      <p className="settings-note">
        Sites com manifesto de app mostram o ícone de instalar na barra de endereço. O app abre em
        janela própria, sem a barra de guias, com ícone no menu Iniciar, no Dock (pasta Aplicativos
        › Agzos Apps) ou no menu de aplicativos. Login, zoom e permissões dele ficam separados das
        guias do mesmo site.
      </p>
      <TryInstall siteTabs={siteTabs} />
      <ul className="terminal-list pwa-list" aria-label="Apps instalados">
        {apps?.map((app) => (
          <li key={app.id}>
            {app.icon ? (
              <img src={app.icon} alt="" width={20} height={20} />
            ) : (
              <AppWindow className="terminal-list-icon" />
            )}
            <span>
              {app.name}
              <small>{app.origin}</small>
            </span>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Abrir ${app.name}`}
              onClick={() => void desktop.pwaOpen(app.id)}
            >
              <ExternalLink /> Abrir
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Desinstalar ${app.name}`}
              onClick={() => void desktop.pwaUninstall(app.id).then(load)}
            >
              <Trash2 /> Desinstalar
            </Button>
          </li>
        ))}
        {apps !== null && !apps.length && <li className="empty">Nenhum app instalado ainda.</li>}
      </ul>
    </div>
  );
}
