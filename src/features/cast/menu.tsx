import { Cast, Pause, Play, RotateCcw, RotateCw, Square, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import { castStateText, formatCastTime, type CastAction, type CastSessionInfo } from "./bridge";
import "./cast.css";

export type CastMenuProps = {
  right: number;
  top: number;
  sessions: CastSessionInfo[];
  onControl: (sessionId: string, action: CastAction, value?: number) => void;
  onClose: () => void;
};

/** Slider que só envia o valor ao soltar (ou ao mexer pelo teclado), sem inundar o aparelho. */
function CommitRange({
  label,
  value,
  max,
  step,
  onCommit,
}: {
  label: string;
  value: number;
  max: number;
  step: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  useEffect(() => setDraft(null), [value]);
  return (
    <input
      type="range"
      aria-label={label}
      min={0}
      max={max}
      step={step}
      value={draft ?? value}
      onChange={(event) => setDraft(Number(event.target.value))}
      onPointerUp={() => draft !== null && onCommit(draft)}
      onKeyUp={() => draft !== null && onCommit(draft)}
    />
  );
}

function SessionCard({
  session,
  onControl,
}: {
  session: CastSessionInfo;
  onControl: CastMenuProps["onControl"];
}) {
  const playing = session.state === "playing" || session.state === "buffering";
  const duration = session.duration && session.duration > 0 ? session.duration : 0;
  return (
    <section className="cast-card" aria-label={`Transmitindo para ${session.deviceName}`}>
      <div className="cast-head">
        <span className="ai-mark">
          <Cast />
        </span>
        <div>
          <strong title={session.title}>{session.title || "Mídia"}</strong>
          <small title={session.deviceName}>
            {session.deviceName} · {castStateText(session.state)}
          </small>
        </div>
      </div>
      {session.error && (
        <p className="cast-error" role="alert">
          {session.error}
        </p>
      )}
      <div className="cast-time">
        <span>{formatCastTime(session.currentTime)}</span>
        {duration > 0 ? (
          <CommitRange
            label="Posição"
            value={Math.min(session.currentTime, duration)}
            max={duration}
            step={1}
            onCommit={(value) => onControl(session.sessionId, "seek", value)}
          />
        ) : (
          <span className="cast-spacer" />
        )}
        <span>{duration > 0 ? formatCastTime(duration) : "—"}</span>
      </div>
      <div className="cast-buttons">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Voltar 10 segundos"
          title="Voltar 10 segundos"
          disabled={duration === 0}
          onClick={() =>
            onControl(session.sessionId, "seek", Math.max(0, session.currentTime - 10))
          }
        >
          <RotateCcw />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={playing ? "Pausar" : "Tocar"}
          title={playing ? "Pausar" : "Tocar"}
          onClick={() => onControl(session.sessionId, playing ? "pause" : "play")}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Avançar 10 segundos"
          title="Avançar 10 segundos"
          disabled={duration === 0}
          onClick={() =>
            onControl(session.sessionId, "seek", Math.min(duration, session.currentTime + 10))
          }
        >
          <RotateCw />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Parar transmissão"
          title="Parar transmissão"
          onClick={() => onControl(session.sessionId, "stop")}
        >
          <Square />
        </Button>
      </div>
      {session.volume !== undefined && (
        <label className="cast-volume">
          <Volume2 aria-hidden="true" />
          <CommitRange
            label="Volume do aparelho"
            value={session.volume}
            max={1}
            step={0.05}
            onCommit={(value) => onControl(session.sessionId, "volume", value)}
          />
        </label>
      )}
    </section>
  );
}

/** Controle da transmissão da guia (painel da barra, na camada acima da página). */
export function CastMenu(props: CastMenuProps) {
  return (
    <aside
      className="key-panel cast-panel"
      aria-label="Transmissão para a TV"
      style={{ right: props.right, top: props.top }}
    >
      {props.sessions.length === 0 ? (
        <p className="cast-note">Nenhuma transmissão nesta guia.</p>
      ) : (
        props.sessions.map((session) => (
          <SessionCard key={session.sessionId} session={session} onControl={props.onControl} />
        ))
      )}
      <div className="settings-actions">
        <Button variant="ghost" size="sm" onClick={props.onClose}>
          Fechar
        </Button>
      </div>
    </aside>
  );
}
