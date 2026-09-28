import { ShieldCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { BlockedTracker } from "@/features/browser/privacy";
import { Toggle } from "@/features/ui/toggle";

export function PrivacyPanel({
  host,
  shield,
  setShield,
  paused,
  onPauseChange,
  trackers,
  protectedNow,
  onClose,
}: {
  host: string | null;
  shield: boolean;
  setShield: (value: boolean) => void;
  paused: boolean;
  onPauseChange: (pause: boolean) => void;
  trackers: BlockedTracker[];
  protectedNow: boolean;
  onClose: () => void;
}) {
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
                ? `${trackers.length} bloqueados nesta página`
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
        label="Bloquear rastreadores"
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
        {protectedNow ? (
          trackers.map((tracker) => (
            <div className="credential" key={tracker.host}>
              <div className="credential-copy">
                <strong>{tracker.host}</strong>
                <span>{tracker.category}</span>
              </div>
            </div>
          ))
        ) : (
          <p className="key-empty">
            {paused ? "Proteção pausada neste site." : "Proteção desativada."}
          </p>
        )}
      </div>
      <div className="key-footer">
        <ShieldCheck />
        <span>Números simulados nesta demonstração</span>
      </div>
    </aside>
  );
}
