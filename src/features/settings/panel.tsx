import {
  Check,
  History,
  MoreHorizontal,
  PartyPopper,
  Search,
  ShieldCheck,
  Star,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import type {
  PermissionType,
  PermissionValue,
  SitePermission,
  UpdateState,
} from "@/features/browser/desktop";
import { engines } from "@/features/browser/engines";
import { HIBERNATE_MINUTES } from "@/features/browser/store/state";
import type { EngineId } from "@/features/browser/types";
import { PermissionSelect } from "@/features/site/panel";
import { PERMISSION_LABELS } from "@/features/site/permissions";
import { Toggle } from "@/features/ui/toggle";
import { cn } from "@/lib/utils";

function updateText(update: UpdateState): string {
  switch (update.status) {
    case "checking":
      return "Procurando atualizações…";
    case "up-to-date":
      return "Você está na versão mais recente.";
    case "downloading":
      return `Baixando a versão ${update.version}… ${Math.round((update.progress ?? 0) * 100)}%`;
    case "ready":
      return `Versão ${update.version} pronta. Entra ao reiniciar (ou quando você fechar o app).`;
    case "unsupported":
    case "error":
      return update.error ?? "Não foi possível verificar.";
    default:
      return update.error ?? "Atualizações automáticas ligadas.";
  }
}

export function SettingsPanel({
  dark,
  setDark,
  aiOpen,
  setAiOpen,
  shield,
  setShield,
  engine,
  setEngine,
  bookmarksBar,
  setBookmarksBar,
  searchSuggestions,
  setSearchSuggestions,
  permissions,
  onPermissionChange,
  hibernation,
  update,
  onCheckUpdate,
  onInstallUpdate,
  onShowWhatsNew,
  onOpenHistory,
  onOpenBookmarks,
  onReset,
  onClose,
}: {
  dark: boolean;
  setDark: (value: boolean) => void;
  aiOpen: boolean;
  setAiOpen: (value: boolean) => void;
  shield: boolean;
  setShield: (value: boolean) => void;
  engine: EngineId;
  setEngine: (value: EngineId) => void;
  bookmarksBar: boolean;
  setBookmarksBar: (value: boolean) => void;
  searchSuggestions: boolean;
  setSearchSuggestions: (value: boolean) => void;
  /** null na web (permissões só existem no app). */
  permissions: SitePermission[] | null;
  onPermissionChange: (origin: string, type: PermissionType, value: PermissionValue | null) => void;
  /** null na web (lá não há páginas nativas para hibernar). */
  hibernation: {
    enabled: boolean;
    minutes: number;
    onChange: (patch: { hibernate?: boolean; hibernateMinutes?: number }) => void;
  } | null;
  /** null quando o app não se atualiza sozinho (web, dev). */
  update: UpdateState | null;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
  /** Abre as novidades da versão atual (null na web). */
  onShowWhatsNew: (() => void) | null;
  onOpenHistory: () => void;
  onOpenBookmarks: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <aside className="key-panel" aria-label="Configurações">
      <div className="panel-heading">
        <div className="panel-title">
          <span className="key-mark">
            <MoreHorizontal />
          </span>
          <div>
            <strong>Configurações</strong>
            <small>Preferências do navegador</small>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar configurações">
          <X />
        </Button>
      </div>
      <div className="key-domain">
        <span>Motor de busca</span>
      </div>
      <div className="engine-choice">
        {engines.map((item) => (
          <button
            key={item.id}
            type="button"
            className={cn("engine-option", engine === item.id && "selected")}
            aria-pressed={engine === item.id}
            onClick={() => setEngine(item.id)}
          >
            <Search />
            <span>
              <strong>{item.name}</strong>
              <small>{item.hint}</small>
            </span>
            {engine === item.id && <Check />}
          </button>
        ))}
      </div>
      <Toggle label="Tema escuro" checked={dark} onChange={setDark} />
      <Toggle
        label="Agzos AI visível"
        hint="Barra lateral de IA"
        checked={aiOpen}
        onChange={setAiOpen}
      />
      <Toggle
        label="Bloquear anúncios e rastreadores"
        hint="Em todos os sites"
        checked={shield}
        onChange={setShield}
      />
      <Toggle
        label="Barra de favoritos"
        hint="Abaixo da barra de endereço (Ctrl/⌘ Shift B)"
        checked={bookmarksBar}
        onChange={setBookmarksBar}
      />
      <Toggle
        label="Sugestões do buscador"
        hint="O que você digita na barra vai para o motor de busca"
        checked={searchSuggestions}
        onChange={setSearchSuggestions}
      />
      {hibernation && (
        <>
          <Toggle
            label="Hibernar guias sem uso"
            hint="Libera a memória das guias paradas; elas recarregam ao voltar"
            checked={hibernation.enabled}
            onChange={(hibernate) => hibernation.onChange({ hibernate })}
          />
          {hibernation.enabled && (
            <label className="settings-select">
              <span>Hibernar depois de</span>
              <select
                value={hibernation.minutes}
                onChange={(event) =>
                  hibernation.onChange({ hibernateMinutes: Number(event.target.value) })
                }
              >
                {[...HIBERNATE_MINUTES]
                  .sort((a, b) => a - b)
                  .map((minutes) => (
                    <option key={minutes} value={minutes}>
                      {minutes < 60 ? `${minutes} minutos` : `${minutes / 60} h`}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </>
      )}
      <div className="settings-links">
        <Button variant="outline" size="sm" onClick={onOpenHistory}>
          <History /> Histórico
        </Button>
        <Button variant="outline" size="sm" onClick={onOpenBookmarks}>
          <Star /> Favoritos
        </Button>
        {onShowWhatsNew && (
          <Button variant="outline" size="sm" onClick={onShowWhatsNew}>
            <PartyPopper /> Novidades desta versão
          </Button>
        )}
      </div>
      {permissions && (
        <div className="settings-section">
          <div className="key-domain">
            <span>Permissões dos sites</span>
          </div>
          {permissions.length === 0 ? (
            <p className="key-empty">
              Quando você permitir ou bloquear algo com "Lembrar", o site aparece aqui.
            </p>
          ) : (
            <ul className="permission-list">
              {permissions.map((item) => {
                const host = new URL(item.origin).host;
                return (
                  <li key={`${item.origin}-${item.type}`}>
                    <span>
                      <strong>{host}</strong>
                      <small>{PERMISSION_LABELS[item.type]}</small>
                    </span>
                    <PermissionSelect
                      label={`${PERMISSION_LABELS[item.type]} em ${host}`}
                      value={item.value}
                      onChange={(value) => onPermissionChange(item.origin, item.type, value)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {update && (
        <div className="settings-section settings-update">
          <div className="key-domain">
            <span>Atualizações · versão {update.currentVersion}</span>
          </div>
          {update.installError && (
            <p className="update-error" role="alert">
              {update.installError} Detalhes em <code>{update.logFile}</code>
            </p>
          )}
          <p role="status">{updateText(update)}</p>
          {update.status === "downloading" && (
            <div className="download-progress" role="progressbar" aria-label="Baixando atualização">
              <i style={{ width: `${Math.round((update.progress ?? 0) * 100)}%` }} />
            </div>
          )}
          <div className="settings-actions">
            {update.status === "ready" ? (
              <Button size="sm" onClick={onInstallUpdate}>
                Reiniciar e atualizar
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                disabled={update.status === "checking" || update.status === "downloading"}
                onClick={onCheckUpdate}
              >
                Verificar agora
              </Button>
            )}
          </div>
        </div>
      )}
      <div className="settings-shortcuts">
        <strong>Atalhos</strong>
        <ul>
          <li>
            <kbd>⌘/Ctrl K</kbd> Barra de endereços
          </li>
          <li>
            <kbd>⌘/Ctrl T</kbd> Nova aba
          </li>
          <li>
            <kbd>⌘/Ctrl N</kbd> Nova janela
          </li>
          <li>
            <kbd>⌘/Ctrl W</kbd> Fechar aba
          </li>
          <li>
            <kbd>⌘/Ctrl R</kbd> Recarregar
          </li>
          <li>
            <kbd>Ctrl Tab</kbd> Próxima aba
          </li>
          <li>
            <kbd>⌘/Ctrl F</kbd> Buscar na página
          </li>
          <li>
            <kbd>⌘/Ctrl J</kbd> Downloads
          </li>
          <li>
            <kbd>⌘/Ctrl + −</kbd> Zoom
          </li>
          <li>
            <kbd>⌘/Ctrl D</kbd> Favoritar
          </li>
          <li>
            <kbd>⌘/Ctrl H</kbd> Histórico
          </li>
          <li>
            <kbd>⌘/Ctrl Shift O</kbd> Favoritos
          </li>
          <li>
            <kbd>⌘/Ctrl Shift P</kbd> Picture-in-picture
          </li>
          <li>
            <kbd>⌘/Ctrl Shift PgUp/PgDn</kbd> Mover guia
          </li>
        </ul>
      </div>
      <div className="settings-actions">
        <Button variant="outline" size="sm" className="text-xs" onClick={onReset}>
          Restaurar abas iniciais
        </Button>
      </div>
      <div className="key-footer">
        <ShieldCheck />
        <span>Preferências salvas neste dispositivo</span>
      </div>
    </aside>
  );
}
