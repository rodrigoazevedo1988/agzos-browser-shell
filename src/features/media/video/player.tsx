// Player de agzos://videos: <video> com controles próprios sobre a tela inteira do player
// (tela cheia, PiP, -10/+10s, volume, velocidade, legendas .srt/.vtt, faixas de áudio,
// próximo arquivo da pasta, retomar de onde parou e teclado).

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  AudioLines,
  Check,
  FolderOpen,
  Gauge,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Star,
  Subtitles,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

import type { MediaBridge, MediaItem } from "../bridge";
import { formatTime, mediaErrorMessage, nextIndex, srtToVtt, titleOf } from "./model";

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
/** Quanto antes do fim aparece o cartão do próximo arquivo. */
const NEXT_AT_SECONDS = 12;
const AUTO_SECONDS = 5;
const SAVE_EVERY_MS = 5000;
const IDLE_MS = 2500;

type SubtitleTrack = { label: string; url: string };
type Menu = "speed" | "subs" | "audio" | null;
type AudioTrackLike = { id: string; label: string; language: string; enabled: boolean };

export type PlayerProps = {
  bridge: MediaBridge;
  item: MediaItem;
  /** Arquivos da mesma pasta, na ordem da lista (para "próximo"). */
  queue: MediaItem[];
  resumeFrom: number;
  favorite: boolean;
  onFavorite: () => void;
  onProgress: (position: number, duration: number) => void;
  onPlay: (item: MediaItem) => void;
  onClose: () => void;
};

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");
const percent = (value: number, total: number) =>
  total > 0 ? `${Math.min(100, Math.max(0, (value / total) * 100))}%` : "0%";

export function Player(props: PlayerProps) {
  const { bridge, item, queue, resumeFrom, favorite, onFavorite, onProgress, onPlay, onClose } =
    props;
  const src = useMemo(() => bridge.url(item.path) ?? "", [bridge, item.path]);
  const title = titleOf(item.name);
  const nextAt = nextIndex(
    queue.map((entry) => entry.path),
    item.path,
  );
  const next = nextAt === null ? null : (queue[nextAt] ?? null);

  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef(0);
  const durationRef = useRef(0);
  const nextRef = useRef<MediaItem | null>(next);
  nextRef.current = next;
  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  const resumedRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [pip, setPip] = useState(false);
  const [idle, setIdle] = useState(false);
  const [menu, setMenu] = useState<Menu>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [subs, setSubs] = useState<SubtitleTrack[]>([]);
  const [tracks, setTracks] = useState<string[]>([]);
  const [chosen, setChosen] = useState("");
  const [audio, setAudio] = useState<AudioTrackLike[]>([]);
  const [dismissedNext, setDismissedNext] = useState(false);
  const [autoLeft, setAutoLeft] = useState<number | null>(null);

  // Progresso: a cada 5s enquanto toca, e no pause/saída (onProgress grava a biblioteca).
  const save = useCallback(() => {
    if (timeRef.current > 0) onProgressRef.current(timeRef.current, durationRef.current);
  }, []);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(save, SAVE_EVERY_MS);
    return () => window.clearInterval(id);
  }, [playing, save]);
  useEffect(() => () => save(), [save]);

  // Legenda de mesmo nome (automática) e legendas do usuário (arquivo escolhido).
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    void bridge.subtitle(item.path).then((found) => {
      if (cancelled || !found) return;
      const url = URL.createObjectURL(
        new Blob([found.ext === "srt" ? srtToVtt(found.text) : found.text], { type: "text/vtt" }),
      );
      urls.push(url);
      setSubs((list) => [...list, { label: found.name, url }]);
      setChosen(found.name);
    });
    return () => {
      cancelled = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [bridge, item.path]);

  // Faixas de legenda do <video> (as nossas e as embutidas no arquivo).
  const refreshTracks = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const labels = Array.from(video.textTracks)
      .filter((track) => track.kind === "subtitles" || track.kind === "captions")
      .map((track, index) => track.label || track.language || `Legenda ${index + 1}`);
    setTracks([...new Set(labels)]);
  }, []);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    refreshTracks();
    const list = video.textTracks;
    list.addEventListener("addtrack", refreshTracks);
    return () => list.removeEventListener("addtrack", refreshTracks);
  }, [refreshTracks, subs]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    for (const track of Array.from(video.textTracks)) {
      track.mode = track.label === chosen ? "showing" : "disabled";
    }
  }, [chosen, subs, tracks]);

  const refreshAudio = useCallback(() => {
    const list = (videoRef.current as unknown as { audioTracks?: ArrayLike<AudioTrackLike> })
      ?.audioTracks;
    setAudio(list ? Array.from(list) : []);
  }, []);

  // Controles somem depois de um tempo sem mexer (enquanto toca e sem menu aberto).
  const touch = useCallback(() => {
    setIdle(false);
  }, []);
  useEffect(() => {
    if (!playing || menu) return;
    const id = window.setTimeout(() => setIdle(true), IDLE_MS);
    return () => window.clearTimeout(id);
  }, [playing, menu, time, idle]);

  // Mensagem curta (retomada, erro de comando).
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(id);
  }, [toast]);

  // PiP: eventos nativos (o JSX do React não os tem).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const on = () => setPip(true);
    const off = () => setPip(false);
    video.addEventListener("enterpictureinpicture", on);
    video.addEventListener("leavepictureinpicture", off);
    return () => {
      video.removeEventListener("enterpictureinpicture", on);
      video.removeEventListener("leavepictureinpicture", off);
    };
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || error) return;
    if (video.paused) void video.play().catch(() => setError(mediaErrorMessage(4)));
    else video.pause();
  }, [error]);

  const seekBy = useCallback(
    (delta: number) => {
      const video = videoRef.current;
      if (!video) return;
      const end = Number.isFinite(video.duration) ? video.duration : 0;
      video.currentTime = Math.min(Math.max(0, video.currentTime + delta), end || Infinity);
      touch();
    },
    [touch],
  );

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.().catch(() => {});
  }, []);

  const togglePip = useCallback(() => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture();
    else
      void video
        .requestPictureInPicture()
        .catch(() => setToast("Picture-in-picture indisponível."));
  }, []);

  const setVolumeTo = useCallback((value: number) => {
    const video = videoRef.current;
    const next = Math.min(1, Math.max(0, value));
    if (video) {
      video.volume = next;
      video.muted = next === 0;
    }
    setVolume(next);
    setMuted(next === 0);
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }, []);

  // Teclado: Espaço/K, J/L (10s), ←/→ (5s), ↑/↓ (volume), F, M, N (próximo), Esc.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) &&
        target.getAttribute("type") !== "range"
      ) {
        return;
      }
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const handled = (() => {
        switch (key) {
          case " ":
          case "k":
            togglePlay();
            return true;
          case "j":
            seekBy(-10);
            return true;
          case "l":
            seekBy(10);
            return true;
          case "ArrowLeft":
            seekBy(-5);
            return true;
          case "ArrowRight":
            seekBy(5);
            return true;
          case "ArrowUp":
            setVolumeTo((videoRef.current?.volume ?? volume) + 0.05);
            return true;
          case "ArrowDown":
            setVolumeTo((videoRef.current?.volume ?? volume) - 0.05);
            return true;
          case "f":
            toggleFullscreen();
            return true;
          case "m":
            toggleMute();
            return true;
          case "n":
            if (nextRef.current) onPlay(nextRef.current);
            return true;
          case "Escape":
            if (document.fullscreenElement || menu) {
              setMenu(null);
              return false;
            }
            onClose();
            return true;
          default:
            return false;
        }
      })();
      if (handled) {
        event.preventDefault();
        touch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    menu,
    onClose,
    onPlay,
    seekBy,
    setVolumeTo,
    toggleFullscreen,
    toggleMute,
    togglePlay,
    touch,
    volume,
  ]);

  // Pré-visualização na barra: um segundo <video> vai ao ponto e é desenhado no canvas.
  const previewPending = useRef<number | null>(null);
  const seekPreview = useCallback((seconds: number) => {
    const preview = previewRef.current;
    if (!preview) return;
    if (preview.seeking) previewPending.current = seconds;
    else preview.currentTime = seconds;
  }, []);
  useEffect(() => {
    const preview = previewRef.current;
    const canvas = previewCanvasRef.current;
    if (!preview || !canvas) return;
    const draw = () => {
      if (previewPending.current !== null) {
        const pending = previewPending.current;
        previewPending.current = null;
        preview.currentTime = pending;
        return;
      }
      const context = canvas.getContext("2d");
      if (context && preview.videoWidth) {
        canvas.width = 160;
        canvas.height = Math.round((160 * preview.videoHeight) / preview.videoWidth) || 90;
        context.drawImage(preview, 0, 0, canvas.width, canvas.height);
      }
    };
    preview.addEventListener("seeked", draw);
    return () => preview.removeEventListener("seeked", draw);
  }, []);

  const ratioOf = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };
  const seekTo = (ratio: number) => {
    const video = videoRef.current;
    if (!video || !durationRef.current) return;
    video.currentTime = ratio * durationRef.current;
    setTime(video.currentTime);
  };
  const onBarDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    seekTo(ratioOf(event.clientX));
    touch();
  };
  const onBarMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const ratio = ratioOf(event.clientX);
    setHover(ratio);
    seekPreview(ratio * durationRef.current);
    if (event.buttons & 1) seekTo(ratio);
  };

  const applyRate = (value: number) => {
    setRate(value);
    if (videoRef.current) videoRef.current.playbackRate = value;
    setMenu(null);
  };

  const pickAudio = (id: string) => {
    const list = (
      videoRef.current as unknown as { audioTracks?: ArrayLike<{ id: string; enabled: boolean }> }
    )?.audioTracks;
    if (list) for (const track of Array.from(list)) track.enabled = track.id === id;
    refreshAudio();
    setMenu(null);
  };

  const loadSubtitleFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    const isSrt = /\.srt$/i.test(file.name);
    const url = URL.createObjectURL(
      new Blob([isSrt ? srtToVtt(text) : text], { type: "text/vtt" }),
    );
    setSubs((list) => [...list, { label: file.name, url }]);
    setChosen(file.name);
    setMenu(null);
  };

  const remaining = duration - time;
  const showNext = Boolean(next) && duration > 0 && remaining <= NEXT_AT_SECONDS && !dismissedNext;

  // Contagem do próximo ao terminar (cancelável).
  useEffect(() => {
    if (autoLeft === null) return;
    const id = window.setTimeout(() => {
      if (autoLeft <= 1) {
        setAutoLeft(null);
        if (nextRef.current) onPlay(nextRef.current);
      } else {
        setAutoLeft(autoLeft - 1);
      }
    }, 1000);
    return () => window.clearTimeout(id);
  }, [autoLeft, onPlay]);

  const bufferedEnd = (video: HTMLVideoElement) => {
    for (let i = 0; i < video.buffered.length; i += 1) {
      if (
        video.buffered.start(i) <= video.currentTime &&
        video.buffered.end(i) >= video.currentTime
      ) {
        return video.buffered.end(i);
      }
    }
    return video.currentTime;
  };

  return (
    <div
      ref={rootRef}
      className={cx("vp-player", idle && playing && "is-idle", fullscreen && "is-full")}
      onMouseMove={touch}
      onPointerDown={touch}
      tabIndex={-1}
    >
      <video
        ref={videoRef}
        className="vp-video"
        src={src}
        playsInline
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          save();
        }}
        onTimeUpdate={(event) => {
          const video = event.currentTarget;
          timeRef.current = video.currentTime;
          setTime(video.currentTime);
          setBuffered(bufferedEnd(video));
        }}
        onDurationChange={(event) => {
          const value = Number.isFinite(event.currentTarget.duration)
            ? event.currentTarget.duration
            : 0;
          durationRef.current = value;
          setDuration(value);
        }}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          const value = Number.isFinite(video.duration) ? video.duration : 0;
          durationRef.current = value;
          setDuration(value);
          refreshAudio();
          refreshTracks();
          if (!resumedRef.current && resumeFrom > 0 && resumeFrom < value - 3) {
            resumedRef.current = true;
            video.currentTime = resumeFrom;
            setToast(`Continuando de ${formatTime(resumeFrom)}`);
          }
          void video.play().catch(() => {});
        }}
        onEnded={() => {
          save();
          if (nextRef.current && !dismissedNext) setAutoLeft(AUTO_SECONDS);
          else setPlaying(false);
        }}
        onError={(event) => setError(mediaErrorMessage(event.currentTarget.error?.code))}
      >
        {subs.map((sub) => (
          <track key={sub.url} kind="subtitles" src={sub.url} label={sub.label} srcLang="pt" />
        ))}
      </video>
      <video
        ref={previewRef}
        className="vp-preview-video"
        src={src}
        preload="auto"
        muted
        tabIndex={-1}
        aria-hidden="true"
      />

      {error ? (
        <div className="vp-error" role="alert">
          <p>{error}</p>
          <button type="button" className="vp-pill" onClick={onClose}>
            Voltar à biblioteca
          </button>
        </div>
      ) : null}

      {toast ? (
        <div className="vp-toast" role="status">
          {toast}
        </div>
      ) : null}

      <header className="vp-top">
        <button
          type="button"
          className="vp-icon"
          onClick={onClose}
          aria-label="Fechar player (Esc)"
          title="Fechar (Esc)"
        >
          <X size={20} aria-hidden="true" />
        </button>
        <h2 title={item.path}>{title}</h2>
        <button
          type="button"
          className={cx("vp-icon", favorite && "is-on")}
          onClick={onFavorite}
          aria-pressed={favorite}
          aria-label={favorite ? "Tirar dos favoritos" : "Favoritar"}
          title={favorite ? "Tirar dos favoritos" : "Favoritar"}
        >
          <Star size={18} aria-hidden="true" fill={favorite ? "currentColor" : "none"} />
        </button>
      </header>

      {showNext && next ? (
        <div className="vp-next" role="region" aria-label="Próximo arquivo">
          <span>Próximo</span>
          <strong>{titleOf(next.name)}</strong>
          <div>
            <button type="button" className="vp-pill is-solid" onClick={() => onPlay(next)}>
              Assistir agora
            </button>
            <button type="button" className="vp-pill" onClick={() => setDismissedNext(true)}>
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {autoLeft !== null && next ? (
        <div className="vp-next" role="status">
          <span>Próximo em {autoLeft}s</span>
          <strong>{titleOf(next.name)}</strong>
          <div>
            <button type="button" className="vp-pill is-solid" onClick={() => onPlay(next)}>
              Assistir agora
            </button>
            <button
              type="button"
              className="vp-pill"
              onClick={() => {
                setAutoLeft(null);
                setDismissedNext(true);
              }}
            >
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      <div className="vp-controls">
        <div
          ref={barRef}
          className="vp-bar"
          role="slider"
          tabIndex={0}
          aria-label="Posição do vídeo"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={`${formatTime(time)} de ${formatTime(duration)}`}
          onPointerDown={onBarDown}
          onPointerMove={onBarMove}
          onPointerLeave={() => setHover(null)}
        >
          <div className="vp-buffered" style={{ width: percent(buffered, duration) }} />
          <div className="vp-played" style={{ width: percent(time, duration) }} />
          <div className="vp-knob" style={{ left: percent(time, duration) }} />
          {hover !== null ? (
            <div className="vp-hover" style={{ left: `${hover * 100}%` }}>
              <canvas ref={previewCanvasRef} width={160} height={90} aria-hidden="true" />
              <span>{formatTime(hover * duration)}</span>
            </div>
          ) : null}
        </div>

        <div className="vp-row">
          <button
            type="button"
            className="vp-icon is-big"
            onClick={togglePlay}
            aria-label={playing ? "Pausar (Espaço)" : "Tocar (Espaço)"}
          >
            {playing ? (
              <Pause size={24} aria-hidden="true" />
            ) : (
              <Play size={24} aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            className="vp-icon"
            onClick={() => seekBy(-10)}
            aria-label="Voltar 10 segundos (J)"
          >
            <RotateCcw size={18} aria-hidden="true" />
            <small>10</small>
          </button>
          <button
            type="button"
            className="vp-icon"
            onClick={() => seekBy(10)}
            aria-label="Avançar 10 segundos (L)"
          >
            <RotateCw size={18} aria-hidden="true" />
            <small>10</small>
          </button>
          <span className="vp-time">
            {formatTime(time)} <span>/ {formatTime(duration)}</span>
          </span>
          <div className="vp-volume">
            <button
              type="button"
              className="vp-icon"
              onClick={toggleMute}
              aria-label={muted ? "Ativar som (M)" : "Silenciar (M)"}
            >
              {muted || volume === 0 ? (
                <VolumeX size={18} aria-hidden="true" />
              ) : (
                <Volume2 size={18} aria-hidden="true" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(event) => setVolumeTo(Number(event.currentTarget.value))}
              aria-label="Volume"
            />
          </div>
          <span className="vp-spacer" />
          <button
            type="button"
            className={cx("vp-icon", menu === "subs" && "is-on")}
            onClick={() => setMenu(menu === "subs" ? null : "subs")}
            aria-label="Legendas"
            aria-expanded={menu === "subs"}
          >
            <Subtitles size={18} aria-hidden="true" />
          </button>
          {audio.length > 1 ? (
            <button
              type="button"
              className={cx("vp-icon", menu === "audio" && "is-on")}
              onClick={() => setMenu(menu === "audio" ? null : "audio")}
              aria-label="Faixa de áudio"
              aria-expanded={menu === "audio"}
            >
              <AudioLines size={18} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className={cx("vp-icon", menu === "speed" && "is-on")}
            onClick={() => setMenu(menu === "speed" ? null : "speed")}
            aria-label={`Velocidade ${rate}x`}
            aria-expanded={menu === "speed"}
          >
            <Gauge size={18} aria-hidden="true" />
            <small>{rate}x</small>
          </button>
          {document.pictureInPictureEnabled ? (
            <button
              type="button"
              className={cx("vp-icon", pip && "is-on")}
              onClick={togglePip}
              aria-label="Picture-in-picture"
            >
              <PictureInPicture2 size={18} aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            className="vp-icon"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? "Sair da tela cheia (F)" : "Tela cheia (F)"}
          >
            {fullscreen ? (
              <Minimize size={18} aria-hidden="true" />
            ) : (
              <Maximize size={18} aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {menu ? (
        <div
          className="vp-menu"
          role="menu"
          aria-label={menu === "speed" ? "Velocidade" : menu === "subs" ? "Legendas" : "Áudio"}
        >
          {menu === "speed"
            ? RATES.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={rate === value}
                  onClick={() => applyRate(value)}
                >
                  {rate === value ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <span className="vp-gap" />
                  )}
                  {value === 1 ? "Normal" : `${value}x`}
                </button>
              ))
            : null}
          {menu === "subs" ? (
            <>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={chosen === ""}
                onClick={() => {
                  setChosen("");
                  setMenu(null);
                }}
              >
                {chosen === "" ? (
                  <Check size={14} aria-hidden="true" />
                ) : (
                  <span className="vp-gap" />
                )}
                Desativadas
              </button>
              {tracks.map((label) => (
                <button
                  key={label}
                  type="button"
                  role="menuitemradio"
                  aria-checked={chosen === label}
                  onClick={() => {
                    setChosen(label);
                    setMenu(null);
                  }}
                >
                  {chosen === label ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <span className="vp-gap" />
                  )}
                  {label}
                </button>
              ))}
              <label className="vp-file">
                <FolderOpen size={14} aria-hidden="true" />
                Carregar legenda (.srt, .vtt)
                <input
                  type="file"
                  accept=".srt,.vtt,text/vtt"
                  onChange={(event) => void loadSubtitleFile(event.currentTarget.files?.[0])}
                />
              </label>
            </>
          ) : null}
          {menu === "audio"
            ? audio.map((track) => (
                <button
                  key={track.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={track.enabled}
                  onClick={() => pickAudio(track.id)}
                >
                  {track.enabled ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <span className="vp-gap" />
                  )}
                  {track.label || track.language || "Faixa"}
                </button>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}
