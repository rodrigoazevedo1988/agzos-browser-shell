import { RefreshCw, ShieldCheck, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import type { AdblockStats, BlockedTracker } from "@/features/browser/desktop";
import { Toggle } from "@/features/ui/toggle";

function listsNote(desktop: boolean, stats: AdblockStats | null) {
  if (!desktop) return "O bloqueio real funciona no app Agzos para computador";
  if (stats?.available === false) return "Motor de filtros ausente nesta versão";
  if (!stats?.ready) return "Baixando listas de filtros…";
  const date = stats.updatedAt
    ? new Date(stats.updatedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
    : null;
  return `EasyList, EasyPrivacy e EasyList Brasil${date ? ` · atualizadas em ${date}` : ""}`;
}

export function PrivacyPanel({
  host,
  shield,
  setShield,
  paused,
  onPauseChange,
  count,
  trackers,
  protectedNow,
  desktop,
  stats,
  onUpdateLists,
  onClose,
}: {
  host: string | null;
  shield: boolean;
  setShield: (value: boolean) => void;
  paused: boolean;
  onPauseChange: (pause: boolean) => void;
  /** Requisições bloqueadas na página atual. */
  count: number;
  /** Hosts bloqueados na página atual. */
  trackers: BlockedTracker[];
  protectedNow: boolean;
  desktop: boolean;
  stats: AdblockStats | null;
  onUpdateLists: () => Promise<void>;
  onClose: () => void;
}) {
  const [updating, setUpdating] = useState(false);

  return (
    <aside className="key-panel" aria-label="Rastreadores bloqueados">
      <div className="panel-heading">
        <div className="panel-title">
          <span className="ai-mark">
            <ShieldCheck />
          </span>
          <div>
            <strong>Proteção de privacidade</strong>
            <small>
              {protectedNow
                ? `${count} bloqueados nesta página`
                : paused
                  ? "Proteção pausada neste site"
                  : "Proteção desativada"}
            </small>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar proteção">
          <X />
        </Button>
      </div>
      <Toggle
        label="Bloquear anúncios e rastreadores"
        hint="Em todos os sites"
        checked={shield}
        onChange={setShield}
      />
      {host && (
        <Toggle
          label="Pausar neste site"
          hint={host}
          checked={paused}
          disabled={!shield}
          onChange={onPauseChange}
        />
      )}
      <div className="key-domain">
        <span>Hosts bloqueados nesta página</span>
      </div>
      <div className="credential-list">
        {!protectedNow ? (
          <p className="key-empty">
            {paused ? "Proteção pausada neste site." : "Proteção desativada."}
          </p>
        ) : trackers.length ? (
          trackers.map((tracker) => (
            <div className="credential" key={`${tracker.category}|${tracker.host}`}>
              <div className="credential-copy">
                <strong>{tracker.host}</strong>
                <span>{tracker.category}</span>
              </div>
            </div>
          ))
        ) : (
          <p className="key-empty">Nada bloqueado nesta página até agora.</p>
        )}
      </div>
      <div className="key-footer">
        <ShieldCheck />
        <span>{listsNote(desktop, stats)}</span>
        {desktop && stats?.available !== false && (
          <button
            type="button"
            className="lists-update"
            title="Atualizar listas agora"
            aria-label="Atualizar listas de filtros"
            disabled={updating}
            onClick={() => {
              setUpdating(true);
              void onUpdateLists().finally(() => setUpdating(false));
            }}
          >
            <RefreshCw className={updating ? "spin" : undefined} />
          </button>
        )}
      </div>
    </aside>
  );
}
