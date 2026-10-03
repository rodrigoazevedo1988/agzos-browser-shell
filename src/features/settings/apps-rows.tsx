import { AppWindow, ExternalLink, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { desktopBridge, type InstalledPwa } from "@/features/browser/desktop";

/**
 * Apps instalados (PWA, 4.1.1): abrir em janela própria ou desinstalar (atalho do
 * sistema e dados do app saem juntos). Instalar é pelo ícone na barra de endereço.
 */
export function InstalledAppsSetting() {
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
        Sites com manifesto e service worker mostram o ícone de instalar na barra de endereço. O app
        abre em janela própria, sem a barra de guias, com ícone no menu Iniciar, no Dock (pasta
        Aplicativos › Agzos Apps) ou no menu de aplicativos. Login, zoom e permissões dele ficam
        separados das guias do mesmo site.
      </p>
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
