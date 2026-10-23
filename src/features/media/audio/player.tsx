import {
  ChevronDown,
  ListMusic,
  Maximize2,
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
  GripVertical,
  Heart,
} from "lucide-react";
import { useState, type CSSProperties, type DragEvent } from "react";

import type { EngineState, MusicEngine, Track } from "./engine";
import { currentTrack, upcoming } from "./queue";
import { formatDuration, formatDurationOrDash } from "./format";
import { usePosition } from "./hooks";
import { Visualizer } from "./visualizer";

/** Capa (blob:) ou o desenho vermelho padrão quando a faixa não tem arte embutida. */
export function Cover({ track, className }: { track: Track | null; className?: string }) {
  if (track?.cover) {
    return <img className={className ?? "mx-cover"} src={track.cover} alt="" draggable={false} />;
  }
  return (
    <div className={`${className ?? "mx-cover"} mx-cover-empty`} aria-hidden="true">
      <Music2 />
    </div>
  );
}

function trackLine(track: Track | null): { title: string; sub: string } {
  if (!track) return { title: "Nada tocando", sub: "Escolha uma música para começar" };
  return {
    title: track.title,
    sub: [track.artist, track.album].filter(Boolean).join(" · ") || track.name,
  };
}

/** Barra de progresso: a posição vem do canal de tempo, sem redesenhar a página. */
export function SeekBar({ engine, duration }: { engine: MusicEngine | null; duration: number }) {
  const position = usePosition(engine);
  const total = duration > 0 ? duration : 0;
  const shown = total > 0 ? Math.min(position, total) : 0;
  return (
    <div className="mx-seek">
      <span className="mx-time">{formatDuration(shown)}</span>
      <input
        type="range"
        className="mx-range mx-seek-range"
        aria-label="Posição da música"
        min={0}
        max={total || 1}
        step={0.1}
        value={shown}
        disabled={!total || !engine}
        style={{ "--mx-fill": `${total ? (shown / total) * 100 : 0}%` } as CSSProperties}
        onChange={(event) => engine?.seek(Number(event.currentTarget.value))}
      />
      <span className="mx-time">{formatDuration(total)}</span>
    </div>
  );
}

function VolumeIcon({ volume, muted }: { volume: number; muted: boolean }) {
  if (muted || volume === 0) return <VolumeX aria-hidden="true" />;
  return volume < 0.5 ? <Volume1 aria-hidden="true" /> : <Volume2 aria-hidden="true" />;
}

export function NowPlaying({
  engine,
  state,
  liked,
  onLike,
  queueOpen,
  onQueue,
  onExpand,
  expanded,
}: {
  engine: MusicEngine | null;
  state: EngineState;
  liked: boolean;
  onLike: () => void;
  queueOpen: boolean;
  onQueue: () => void;
  onExpand: () => void;
  expanded: boolean;
}) {
  const track = state.track;
  const line = trackLine(track);
  const { queue } = state;
  const hasTrack = track !== null;
  const RepeatIcon = queue.repeat === "one" ? Repeat1 : Repeat;
  return (
    <footer className="mx-bar" aria-label="Tocando agora">
      <div className="mx-bar-track">
        <button
          type="button"
          className="mx-bar-cover"
          onClick={onExpand}
          aria-label="Abrir Tocando agora"
        >
          <Cover track={track} />
        </button>
        <div className="mx-bar-text">
          <strong>{line.title}</strong>
          <span>{line.sub}</span>
        </div>
        <button
          type="button"
          className={`mx-icon-btn ${liked ? "is-on" : ""}`}
          aria-label={liked ? "Tirar dos favoritos" : "Favoritar"}
          aria-pressed={liked}
          disabled={!hasTrack}
          onClick={onLike}
        >
          <Heart aria-hidden="true" fill={liked ? "currentColor" : "none"} />
        </button>
      </div>

      <div className="mx-bar-center">
        <div className="mx-controls">
          <button
            type="button"
            className={`mx-icon-btn mx-hide-compact ${queue.shuffle ? "is-on" : ""}`}
            aria-label="Embaralhar"
            aria-pressed={queue.shuffle}
            onClick={() => engine?.setShuffle(!queue.shuffle)}
          >
            <Shuffle aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mx-icon-btn"
            aria-label="Anterior"
            disabled={!hasTrack}
            onClick={() => engine?.prev()}
          >
            <SkipBack aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mx-play"
            aria-label={state.playing ? "Pausar" : "Tocar"}
            disabled={!engine || (!hasTrack && !queue.order.length)}
            onClick={() => engine?.toggle()}
          >
            {state.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="mx-icon-btn"
            aria-label="Próxima"
            disabled={!hasTrack}
            onClick={() => engine?.next()}
          >
            <SkipForward aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`mx-icon-btn mx-hide-compact ${queue.repeat !== "off" ? "is-on" : ""}`}
            aria-label={
              queue.repeat === "one"
                ? "Repetir uma"
                : queue.repeat === "all"
                  ? "Repetir tudo"
                  : "Repetir desligado"
            }
            aria-pressed={queue.repeat !== "off"}
            onClick={() => engine?.cycleRepeat()}
          >
            <RepeatIcon aria-hidden="true" />
          </button>
        </div>
        <SeekBar engine={engine} duration={state.duration} />
        {state.error ? (
          <p className="mx-bar-error" role="status">
            {state.error}
          </p>
        ) : null}
      </div>

      <div className="mx-bar-end">
        <div className="mx-volume mx-hide-compact">
          <button
            type="button"
            className="mx-icon-btn"
            aria-label={state.muted ? "Ativar som" : "Silenciar"}
            aria-pressed={state.muted}
            onClick={() => engine?.toggleMute()}
          >
            <VolumeIcon volume={state.volume} muted={state.muted} />
          </button>
          <input
            type="range"
            className="mx-range"
            aria-label="Volume"
            min={0}
            max={1}
            step={0.01}
            value={state.muted ? 0 : state.volume}
            style={{ "--mx-fill": `${(state.muted ? 0 : state.volume) * 100}%` } as CSSProperties}
            onChange={(event) => engine?.setVolume(Number(event.currentTarget.value))}
          />
        </div>
        <button
          type="button"
          className={`mx-icon-btn ${queueOpen ? "is-on" : ""}`}
          aria-label="Fila de reprodução"
          aria-pressed={queueOpen}
          onClick={onQueue}
        >
          <ListMusic aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`mx-icon-btn mx-hide-compact ${expanded ? "is-on" : ""}`}
          aria-label="Tocando agora"
          aria-pressed={expanded}
          onClick={onExpand}
        >
          <Maximize2 aria-hidden="true" />
        </button>
      </div>
    </footer>
  );
}

/** Tocando agora: capa grande, fundo desfocado da capa e o visualizador. */
export function ExpandedView({
  engine,
  state,
  onClose,
}: {
  engine: MusicEngine | null;
  state: EngineState;
  onClose: () => void;
}) {
  const track = state.track;
  const line = trackLine(track);
  return (
    <section className="mx-expanded" aria-label="Tocando agora">
      <div className="mx-expanded-backdrop" aria-hidden="true">
        {track?.cover ? <img src={track.cover} alt="" /> : null}
      </div>
      <button
        type="button"
        className="mx-icon-btn mx-expanded-close"
        aria-label="Fechar Tocando agora"
        onClick={onClose}
      >
        <ChevronDown aria-hidden="true" />
      </button>
      <div className="mx-expanded-body">
        <Cover track={track} className="mx-expanded-cover" />
        <div className="mx-expanded-info">
          <p className="mx-kicker">Tocando agora</p>
          <h2>{line.title}</h2>
          <p>{line.sub}</p>
          <Visualizer engine={engine} playing={state.playing} />
          <div className="mx-controls">
            <button
              type="button"
              className="mx-icon-btn"
              aria-label="Anterior"
              disabled={!track}
              onClick={() => engine?.prev()}
            >
              <SkipBack aria-hidden="true" />
            </button>
            <button
              type="button"
              className="mx-play"
              aria-label={state.playing ? "Pausar" : "Tocar"}
              disabled={!engine || (!track && !state.queue.order.length)}
              onClick={() => engine?.toggle()}
            >
              {state.playing ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
            </button>
            <button
              type="button"
              className="mx-icon-btn"
              aria-label="Próxima"
              disabled={!track}
              onClick={() => engine?.next()}
            >
              <SkipForward aria-hidden="true" />
            </button>
          </div>
          <SeekBar engine={engine} duration={state.duration} />
        </div>
      </div>
    </section>
  );
}

/** Fila: o que toca agora, o que vem depois (arrastar para reordenar) e limpar. */
export function QueuePanel({
  engine,
  state,
  trackOf,
  onClose,
}: {
  engine: MusicEngine | null;
  state: EngineState;
  trackOf: (path: string) => Track;
  onClose: () => void;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const { queue } = state;
  const now = currentTrack(queue);
  const after = upcoming(queue);
  const first = queue.index + 1;

  const onDrop = (to: number) => (event: DragEvent) => {
    event.preventDefault();
    if (dragFrom === null || !engine) return;
    engine.moveInQueue(queue.index + 1 + dragFrom, queue.index + 1 + to);
    setDragFrom(null);
  };

  return (
    <aside className="mx-queue" aria-label="Fila de reprodução">
      <header className="mx-queue-head">
        <h2>Fila</h2>
        <button
          type="button"
          className="mx-link-btn"
          disabled={!after.length || !engine}
          onClick={() => engine?.clearQueueAfterCurrent()}
        >
          Limpar
        </button>
        <button
          type="button"
          className="mx-icon-btn mx-queue-close"
          aria-label="Fechar fila"
          onClick={onClose}
        >
          <ChevronDown aria-hidden="true" />
        </button>
      </header>
      {now ? (
        <div className="mx-queue-now">
          <span className="mx-kicker">Tocando</span>
          <QueueRow track={trackOf(now)} active />
        </div>
      ) : null}
      <p className="mx-kicker mx-queue-next">A seguir</p>
      {after.length ? (
        <ol className="mx-queue-list">
          {after.map((path, offset) => (
            <li
              key={`${path}-${first + offset}`}
              draggable
              onDragStart={() => setDragFrom(offset)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={onDrop(offset)}
              className="mx-queue-item"
            >
              <GripVertical className="mx-grip" aria-hidden="true" />
              <button
                type="button"
                className="mx-queue-play"
                aria-label={`Tocar ${trackOf(path).title}`}
                onClick={() => engine?.jumpTo(first + offset)}
              >
                <QueueRow track={trackOf(path)} />
              </button>
              <button
                type="button"
                className="mx-icon-btn"
                aria-label={`Remover ${trackOf(path).title} da fila`}
                onClick={() => engine?.removeFromQueue(first + offset)}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mx-empty-line">
          Nada na fila. Toque uma pasta ou playlist para montar a fila.
        </p>
      )}
    </aside>
  );
}

function QueueRow({ track, active = false }: { track: Track; active?: boolean }) {
  return (
    <span className={`mx-queue-row ${active ? "is-active" : ""}`}>
      <Cover track={track} className="mx-thumb" />
      <span className="mx-queue-text">
        <strong>{track.title}</strong>
        <small>{track.artist ?? track.name}</small>
      </span>
      <small className="mx-dur">{formatDurationOrDash(track.duration)}</small>
    </span>
  );
}
