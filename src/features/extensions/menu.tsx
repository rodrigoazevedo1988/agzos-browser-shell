import {
  ArrowUpCircle,
  Bug,
  Check,
  Eye,
  PanelRight,
  Pin,
  PinOff,
  Settings,
  Settings2,
  ShieldOff,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

/** Dados do menu de uma extensão (simples: roda na camada dos painéis). */
export type ExtensionMenuData = {
  dir: string;
  name: string;
  icon: string | null;
  summary: string;
  hosts: string[];
  permissions: string[];
  pinned: boolean;
  hasPopup: boolean;
  hasOptions: boolean;
  /** 4.6.1: tem side_panel no manifest. */
  hasSidePanel: boolean;
  /** 4.6.1: versão nova na loja. */
  update: string | null;
  /**
   * 4.6.1: o clique no ícone abriu este menu porque a extensão não tem janela (só roda
   * em segundo plano): o menu avisa que ela está ativa.
   */
  activeOnly: boolean;
  /** Host da guia ativa (null: não é um site). */
  host: string | null;
  /** A extensão está sem acesso a esse host. */
  blockedHere: boolean;
  blocked: string[];
};

export type ExtensionMenuAction =
  | "allow"
  | "block"
  | "options"
  | "sidepanel"
  | "update"
  | "pin"
  | "unpin"
  | "manage"
  | "inspect"
  | "remove";

/**
 * Menu de uma extensão (4.6): clique direito no ícone fixado ou "…" na lista. Mesmo
 * visual do menu "⋯" (vidro, tema e acento). Remover pede confirmação aqui mesmo.
 */
export function ExtensionMenu({
  data,
  left,
  top,
  onAction,
  onClose,
}: {
  data: ExtensionMenuData;
  left: number;
  top: number;
  onAction: (action: ExtensionMenuAction) => void;
  onClose: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [showPermissions, setShowPermissions] = useState(false);
  const run = (action: ExtensionMenuAction) => {
    onAction(action);
    onClose();
  };
  return (
    <div
      className="app-menu extension-menu"
      role="menu"
      aria-label={`Menu de ${data.name}`}
      style={{ left, top, right: "auto" }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="app-menu-head">
        {data.icon ? <img src={data.icon} alt="" /> : null}
        <span>
          <strong>{data.name}</strong>
          <small>{data.summary}</small>
        </span>
      </div>
      {data.activeOnly && (
        <p className="extension-menu-note" role="status">
          <strong>{data.name} está ativa.</strong> Ela não tem janela própria: roda sozinha nas
          páginas. Os ajustes dela ficam neste menu.
        </p>
      )}
      <div className="app-menu-group" role="group" aria-label="Acesso ao site">
        <p className="extension-menu-label">
          {data.host ? `Acesso a ${data.host}` : "Acesso ao site: abra um site"}
        </p>
        <button
          type="button"
          role="menuitemradio"
          aria-checked={Boolean(data.host) && !data.blockedHere}
          className="app-menu-item"
          disabled={!data.host}
          onClick={() => run("allow")}
        >
          <ShieldCheck aria-hidden="true" />
          <span>Pode ler e alterar este site</span>
          {data.host && !data.blockedHere && <Check className="extension-menu-check" />}
        </button>
        <button
          type="button"
          role="menuitemradio"
          aria-checked={data.blockedHere}
          className="app-menu-item"
          disabled={!data.host}
          onClick={() => run("block")}
        >
          <ShieldOff aria-hidden="true" />
          <span>Nenhum acesso a este site</span>
          {data.blockedHere && <Check className="extension-menu-check" />}
        </button>
      </div>
      <div className="app-menu-group">
        {data.update && (
          <button
            type="button"
            role="menuitem"
            className="app-menu-item"
            onClick={() => run("update")}
          >
            <ArrowUpCircle aria-hidden="true" />
            <span>Atualizar para {data.update}</span>
          </button>
        )}
        {data.hasSidePanel && (
          <button
            type="button"
            role="menuitem"
            className="app-menu-item"
            onClick={() => run("sidepanel")}
          >
            <PanelRight aria-hidden="true" />
            <span>Abrir no painel lateral</span>
          </button>
        )}
        {data.hasOptions && (
          <button
            type="button"
            role="menuitem"
            className="app-menu-item"
            onClick={() => run("options")}
          >
            <Settings aria-hidden="true" />
            <span>Opções</span>
          </button>
        )}
        <button
          type="button"
          role="menuitem"
          className="app-menu-item"
          onClick={() => run(data.pinned ? "unpin" : "pin")}
        >
          {data.pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
          <span>{data.pinned ? "Desafixar da barra" : "Fixar na barra"}</span>
        </button>
        <button
          type="button"
          role="menuitem"
          className="app-menu-item"
          aria-expanded={showPermissions}
          onClick={() => setShowPermissions((value) => !value)}
        >
          <Eye aria-hidden="true" />
          <span>Exibir permissões</span>
        </button>
        {showPermissions && (
          <div className="extension-menu-permissions" role="note">
            <p>{data.summary}</p>
            {data.hosts.length > 0 && (
              <p>
                <strong>Sites:</strong> {data.hosts.slice(0, 12).join(", ")}
              </p>
            )}
            {data.permissions.length > 0 && (
              <p>
                <strong>Permissões:</strong> {data.permissions.join(", ")}
              </p>
            )}
            {data.blocked.length > 0 && (
              <p>
                <strong>Sem acesso em:</strong> {data.blocked.join(", ")}
              </p>
            )}
          </div>
        )}
        <button
          type="button"
          role="menuitem"
          className="app-menu-item"
          onClick={() => run("manage")}
        >
          <Settings2 aria-hidden="true" />
          <span>Gerenciar extensão</span>
        </button>
        {data.hasPopup && (
          <button
            type="button"
            role="menuitem"
            className="app-menu-item"
            onClick={() => run("inspect")}
          >
            <Bug aria-hidden="true" />
            <span>Inspecionar pop-up</span>
          </button>
        )}
      </div>
      <div className="app-menu-group">
        {confirming ? (
          <div className="extension-menu-confirm" role="alertdialog" aria-label="Confirmar remover">
            <span>
              Remover <strong>{data.name}</strong>? A pasta no seu computador não é apagada.
            </span>
            <div>
              <button type="button" onClick={() => setConfirming(false)}>
                Cancelar
              </button>
              <button type="button" className="danger" onClick={() => run("remove")}>
                Remover
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            role="menuitem"
            className={cn("app-menu-item", "danger")}
            onClick={() => setConfirming(true)}
          >
            <Trash2 aria-hidden="true" />
            <span>Remover…</span>
          </button>
        )}
      </div>
    </div>
  );
}
