import { Globe, LockKeyhole, LockKeyholeOpen, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { PermissionType, PermissionValue, SitePermission } from "@/features/browser/desktop";

import { PERMISSION_LABELS, PERMISSION_TYPES, originOf } from "./permissions";

export function PermissionSelect({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: PermissionValue | null;
  disabled?: boolean;
  onChange: (value: PermissionValue | null) => void;
}) {
  return (
    <select
      className="permission-select"
      disabled={disabled}
      value={value ?? "ask"}
      aria-label={label}
      onChange={(event) => {
        const next = event.target.value;
        onChange(next === "allow" || next === "block" ? next : null);
      }}
    >
      <option value="ask">Perguntar</option>
      <option value="allow">Permitir</option>
      <option value="block">Bloquear</option>
    </select>
  );
}

/** Cadeado da omnibox: conexão, permissões e zoom do site aberto. */
export function SitePanel({
  url,
  privateTab,
  permissions,
  zoom,
  onChange,
  onReset,
  onResetZoom,
  onClose,
}: {
  url: string;
  privateTab: boolean;
  permissions: SitePermission[];
  zoom: number;
  onChange: (type: PermissionType, value: PermissionValue | null) => void;
  onReset: () => void;
  onResetZoom: () => void;
  onClose: () => void;
}) {
  const origin = originOf(url);
  const secure = origin?.startsWith("https:") ?? false;
  const host = origin ? new URL(origin).host : url;
  const valueOf = (type: PermissionType) =>
    permissions.find((item) => item.origin === origin && item.type === type)?.value ?? null;
  const saved = permissions.filter((item) => item.origin === origin);

  return (
    <aside className="key-panel site-panel" aria-label="Informações do site">
      <div className="panel-heading">
        <div className="panel-title">
          <span className="key-mark">{secure ? <LockKeyhole /> : <LockKeyholeOpen />}</span>
          <div>
            <strong>{host}</strong>
            <small>
              {secure ? "Conexão segura (HTTPS)" : "Conexão não segura: evite dados pessoais"}
            </small>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Fechar informações do site"
        >
          <X />
        </Button>
      </div>
      <div className="key-domain">
        <span>Permissões deste site</span>
        {saved.length > 0 && (
          <button type="button" className="link-button" onClick={onReset}>
            Redefinir
          </button>
        )}
      </div>
      {privateTab && (
        <p className="site-note">
          Guia anônima: o que você permitir aqui vale só até fechar o app. As permissões salvas se
          ajustam numa guia normal.
        </p>
      )}
      <ul className="permission-list">
        {PERMISSION_TYPES.map((type) => (
          <li key={type}>
            <Globe aria-hidden="true" />
            <span>{PERMISSION_LABELS[type]}</span>
            <PermissionSelect
              label={`${PERMISSION_LABELS[type]} em ${host}`}
              value={valueOf(type)}
              disabled={privateTab}
              onChange={(value) => onChange(type, value)}
            />
          </li>
        ))}
      </ul>
      {Math.abs(zoom - 1) > 0.001 && (
        <div className="site-zoom">
          <span>Zoom deste site: {Math.round(zoom * 100)}%</span>
          <button type="button" className="link-button" onClick={onResetZoom}>
            Voltar a 100%
          </button>
        </div>
      )}
    </aside>
  );
}
