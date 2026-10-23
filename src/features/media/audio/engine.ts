// Motor de reprodução do Música. Vive fora da árvore React: a música continua quando a
// página é trocada (outra guia, outra página da casca). Dois <audio> alternados dão o
// "quase sem pausa" (o próximo já vem carregado) e o crossfade opcional. O visualizador
// analisa uma cópia do áudio (captureStream → AnalyserNode) e não passa a reprodução
// pelo Web Audio: se o AudioContext estiver suspenso, a música não fica muda.

import {
  clearUpcoming,
  currentTrack,
  emptyQueue,
  enqueue as enqueueItems,
  moveTo,
  moveUpcoming,
  nextIndex,
  nextRepeat,
  playNext as queuePlayNext,
  prevIndex,
  removeAt,
  setShuffle as setQueueShuffle,
  startQueue,
  type PlayQueue,
  type Random,
} from "./queue";

export type Track = {
  path: string;
  name: string;
  ext: string;
  size: number;
  /** Título do tag, ou o nome do arquivo sem extensão. */
  title: string;
  artist?: string;
  album?: string;
  /** Duração em segundos, quando já se sabe (tag ou metadados do <audio>). */
  duration?: number;
  /** URL de imagem (blob:) da capa embutida, quando lida. */
  cover?: string;
};

/** Campos de faixa que quem chama pode informar (sem `undefined` explícito). */
export type TrackInfo = Partial<{ [K in keyof Track]: Track[K] | undefined }>;

function definedOnly(info: TrackInfo): Partial<Track> {
  const out: Partial<Track> = {};
  for (const key of Object.keys(info) as (keyof Track)[]) {
    if (info[key] !== undefined) (out as Record<string, unknown>)[key] = info[key];
  }
  return out;
}

export type EngineState = {
  queue: PlayQueue;
  track: Track | null;
  playing: boolean;
  duration: number;
  volume: number;
  muted: boolean;
  /** Segundos de sobreposição no fim de cada faixa (0 = desligado). */
  crossfade: number;
  /** Mensagem curta quando a faixa não toca (arquivo sumiu, formato sem suporte). */
  error: string | null;
};

const SEEK_STEP = 5;
const FADE_TICK_MS = 80;
const MAX_KNOWN = 4000;
/** Abaixo disso, "anterior" volta para a faixa anterior (como nos players comuns). */
const RESTART_BEFORE_SEC = 3;

type Listener = () => void;
type Fade = {
  timer: ReturnType<typeof setInterval>;
  from: 0 | 1;
  to: 0 | 1;
  index: number;
  path: string;
};

function makeDeck(): HTMLAudioElement {
  const el = new Audio();
  el.preload = "auto";
  return el;
}

export class MusicEngine {
  private readonly decks: [HTMLAudioElement, HTMLAudioElement];
  private active: 0 | 1 = 0;
  private known = new Map<string, Track>();
  private state: EngineState = {
    queue: emptyQueue,
    track: null,
    playing: false,
    duration: 0,
    volume: 1,
    muted: false,
    crossfade: 0,
    error: null,
  };
  private listeners = new Set<Listener>();
  private timeListeners = new Set<Listener>();
  private playedListeners = new Set<(track: Track) => void>();
  private urlOf: (path: string) => string | null = (path) => path;
  private random: Random = Math.random;
  /** Caminho já carregado no deck inativo (o próximo). */
  private preloadedPath: string | null = null;
  private fade: Fade | null = null;
  private skipTimer: ReturnType<typeof setTimeout> | null = null;
  private analysis: {
    context: AudioContext;
    analyser: AnalyserNode;
    sources: (MediaStreamAudioSourceNode | null)[];
  } | null = null;

  constructor(decks: [HTMLAudioElement, HTMLAudioElement]) {
    this.decks = decks;
    decks.forEach((deck, index) => {
      deck.addEventListener("ended", () => index === this.active && this.onEnded());
      deck.addEventListener("play", () => index === this.active && this.patch({ playing: true }));
      deck.addEventListener("pause", () => index === this.active && this.onPause());
      deck.addEventListener("timeupdate", () => index === this.active && this.onTime());
      deck.addEventListener("loadedmetadata", () => index === this.active && this.onMeta());
      deck.addEventListener("error", () => index === this.active && this.onError());
    });
  }

  /** Quem resolve o caminho do arquivo em URL (a ponte `agzosMedia.url`). */
  setUrlResolver(resolve: (path: string) => string | null): void {
    this.urlOf = resolve;
  }

  setRandom(random: Random): void {
    this.random = random;
  }

  // ---- assinatura (useSyncExternalStore) -------------------------------------------

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** A posição muda várias vezes por segundo: canal próprio, para não redesenhar a página. */
  subscribeTime = (listener: Listener): (() => void) => {
    this.timeListeners.add(listener);
    return () => {
      this.timeListeners.delete(listener);
    };
  };

  /** Chamado a cada faixa que começa (o histórico de "recentes" usa isto). */
  onPlayed(listener: (track: Track) => void): () => void {
    this.playedListeners.add(listener);
    return () => {
      this.playedListeners.delete(listener);
    };
  }

  getState = (): EngineState => this.state;

  getPosition = (): number => this.decks[this.active].currentTime || 0;

  private patch(change: Partial<EngineState>) {
    this.state = { ...this.state, ...change };
    if (change.track !== undefined || change.playing !== undefined) this.updateSession();
    this.listeners.forEach((listener) => listener());
  }

  private emitTime() {
    this.timeListeners.forEach((listener) => listener());
  }

  // ---- biblioteca conhecida --------------------------------------------------------

  /** Registra ou atualiza o que se sabe de uma faixa (tags, capa, duração). */
  remember(path: string, info: TrackInfo = {}): void {
    const current = this.known.get(path);
    const given = definedOnly(info);
    if (!current) {
      if (this.known.size >= MAX_KNOWN) return;
      const name = given.name ?? path.split(/[\\/]/).pop() ?? path;
      this.known.set(path, {
        ext: "",
        size: 0,
        title: name.replace(/\.[^.]+$/, ""),
        ...given,
        path,
        name,
      });
    } else {
      this.known.set(path, { ...current, ...given, path });
    }
    if (this.state.track?.path === path) {
      this.patch({ track: this.known.get(path)! });
    }
  }

  trackOf(path: string): Track | undefined {
    return this.known.get(path);
  }

  // ---- comandos ---------------------------------------------------------------------

  /** Toca `tracks` a partir de `start`. A fila passa a ser exatamente esta lista. */
  playList(tracks: Track[], start: number, options: { shuffle?: boolean } = {}): void {
    if (!tracks.length) return;
    for (const track of tracks) this.remember(track.path, track);
    const queue = startQueue(
      tracks.map((track) => track.path),
      start,
      {
        shuffle: options.shuffle ?? this.state.queue.shuffle,
        repeat: this.state.queue.repeat,
        random: this.random,
      },
    );
    this.patch({ queue });
    this.playCurrent();
  }

  /** Pula para uma posição da fila que já existe (clique numa linha da fila). */
  jumpTo(index: number): void {
    const queue = moveTo(this.state.queue, index);
    if (queue === this.state.queue) return;
    this.patch({ queue });
    this.playCurrent();
  }

  enqueue(paths: string[]): void {
    for (const path of paths) this.ensureKnown(path);
    this.patch({ queue: enqueueItems(this.state.queue, paths) });
    this.preloadNext();
  }

  playNext(paths: string[]): void {
    for (const path of paths) this.ensureKnown(path);
    this.patch({ queue: queuePlayNext(this.state.queue, paths) });
    this.preloadNext();
  }

  removeFromQueue(index: number): void {
    const removingCurrent = index === this.state.queue.index;
    this.patch({ queue: removeAt(this.state.queue, index) });
    if (!removingCurrent) {
      this.preloadNext();
    } else if (this.state.queue.index >= 0) {
      this.playCurrent();
    } else {
      this.stop();
    }
  }

  moveInQueue(from: number, to: number): void {
    this.patch({ queue: moveUpcoming(this.state.queue, from, to) });
    this.preloadNext();
  }

  clearQueueAfterCurrent(): void {
    this.patch({ queue: clearUpcoming(this.state.queue) });
    this.preloadNext();
  }

  /** Tocar ou pausar. Sem faixa carregada, começa a fila (se houver). */
  toggle(force?: boolean): void {
    const deck = this.decks[this.active];
    const wantPlay = force ?? deck.paused;
    if (!wantPlay) {
      deck.pause();
      return;
    }
    if (!this.state.track) {
      if (this.state.queue.order.length) this.playCurrent();
      return;
    }
    void this.play();
  }

  next(): void {
    this.cancelFade();
    const index = nextIndex(this.state.queue, false);
    if (index === null) {
      this.stop();
      return;
    }
    this.jumpWithin(index);
  }

  prev(): void {
    this.cancelFade();
    const deck = this.decks[this.active];
    if (deck.currentTime > RESTART_BEFORE_SEC) {
      deck.currentTime = 0;
      this.emitTime();
      return;
    }
    const index = prevIndex(this.state.queue);
    if (index === null) return;
    this.jumpWithin(index);
  }

  seek(seconds: number): void {
    if (!this.state.track) return;
    const deck = this.decks[this.active];
    const duration = Number.isFinite(deck.duration) ? deck.duration : this.state.duration;
    const upper = duration > 0 ? duration : Number.POSITIVE_INFINITY;
    const target = Math.min(Math.max(Number.isFinite(seconds) ? seconds : 0, 0), upper);
    deck.currentTime = target;
    this.emitTime();
  }

  seekBy(delta: number): void {
    this.seek(this.getPosition() + delta);
  }

  /** Liga ou desliga a ordem aleatória; a faixa atual continua a primeira. */
  setShuffle(on: boolean): void {
    this.patch({ queue: setQueueShuffle(this.state.queue, on, this.random) });
    this.preloadNext();
  }

  cycleRepeat(): void {
    const queue = { ...this.state.queue, repeat: nextRepeat(this.state.queue.repeat) };
    this.patch({ queue });
    this.preloadNext();
  }

  setVolume(volume: number): void {
    const clamped = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
    this.patch({ volume: clamped, muted: clamped === 0 ? this.state.muted : false });
    this.applyVolume();
  }

  toggleMute(): void {
    this.patch({ muted: !this.state.muted });
    this.applyVolume();
  }

  setCrossfade(seconds: number): void {
    const value = Math.min(12, Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0)));
    this.patch({ crossfade: value });
    this.preloadNext();
  }

  stop(): void {
    this.cancelFade();
    this.clearSkip();
    for (const deck of this.decks) {
      deck.pause();
      deck.removeAttribute("src");
      deck.load();
    }
    this.preloadedPath = null;
    this.patch({
      playing: false,
      track: null,
      duration: 0,
      error: null,
      queue: { ...this.state.queue, index: -1 },
    });
    this.emitTime();
  }

  /** Frequências (0..255) para o visualizador; zeros quando não há análise. */
  frequencies(into: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
    if (this.analysis) this.analysis.analyser.getByteFrequencyData(into);
    else into.fill(0);
    return into;
  }

  hasAnalyser(): boolean {
    return this.analysis !== null;
  }

  // ---- internos ---------------------------------------------------------------------

  /** O deck que não está tocando (o próximo, ou o que entra no crossfade). */
  private inactive(): HTMLAudioElement {
    return this.active === 0 ? this.decks[1] : this.decks[0];
  }

  private ensureKnown(path: string): void {
    if (!this.known.has(path)) this.remember(path);
  }

  private applyVolume(): void {
    if (this.fade) return;
    const { volume, muted } = this.state;
    this.decks[this.active].volume = muted ? 0 : volume;
  }

  /** Cria a análise (uma vez) e liga um deck nela. Nada disso mexe no caminho do áudio. */
  private attachAnalysis(deck: HTMLAudioElement, index: 0 | 1): void {
    try {
      if (!this.analysis) {
        const AudioCtx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const context = new AudioCtx();
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.78;
        this.analysis = { context, analyser, sources: [null, null] };
      }
      const capture = (deck as HTMLMediaElement & { captureStream?: () => MediaStream })
        .captureStream;
      if (typeof capture !== "function") return;
      const { context, analyser, sources } = this.analysis;
      sources[index]?.disconnect();
      sources[index] = context.createMediaStreamSource(capture.call(deck));
      sources[index]!.connect(analyser);
      if (context.state === "suspended") void context.resume().catch(() => undefined);
    } catch {
      // Sem análise nesta plataforma: a música toca do mesmo jeito, o visualizador fica parado.
    }
  }

  /** Vai para `index` da fila (playCurrent troca para o deck preparado, se for o caso). */
  private jumpWithin(index: number): void {
    const queue = moveTo(this.state.queue, index);
    this.patch({ queue });
    this.playCurrent();
  }

  /** Toca a faixa atual. Se o deck inativo já a tem carregada, a troca é quase sem pausa. */
  private playCurrent(): void {
    this.cancelFade();
    this.clearSkip();
    const path = currentTrack(this.state.queue);
    if (path === null) {
      this.stop();
      return;
    }
    const track = this.known.get(path);
    if (!track) return;
    if (this.preloadedPath === path) {
      this.swapTo(this.state.queue.index, path);
      return;
    }
    const url = this.urlOf(path);
    if (!url) {
      // Sem caminho para a faixa: ela vira a atual com erro, e o anterior para.
      this.decks[this.active].pause();
      this.preloadedPath = null;
      this.patch({ track, duration: track.duration ?? 0 });
      this.emitTime();
      this.failCurrent(track);
      return;
    }
    const deck = this.decks[this.active];
    this.preloadedPath = null;
    deck.src = url;
    deck.load();
    this.attachAnalysis(deck, this.active);
    this.patch({ track, error: null, duration: track.duration ?? 0 });
    this.emitTime();
    this.playedListeners.forEach((listener) => listener(track));
    this.applyVolume();
    void this.play();
    this.preloadNext();
  }

  private async play(): Promise<void> {
    if (this.analysis?.context.state === "suspended") {
      void this.analysis.context.resume().catch(() => undefined);
    }
    try {
      await this.decks[this.active].play();
      this.patch({ playing: true });
    } catch {
      // Autoplay bloqueado ou arquivo recusado: o caso de arquivo chega pelo evento `error`.
      this.patch({ playing: false });
    }
  }

  /** Carrega no deck inativo a faixa que vem depois (gapless e crossfade). */
  private preloadNext(): void {
    const queue = this.state.queue;
    if (queue.index < 0) return;
    const index = queue.repeat === "one" ? queue.index : nextIndex(queue, true);
    const path = index === null ? null : (queue.order[index] ?? null);
    const url = path ? this.urlOf(path) : null;
    if (!path || !url) {
      this.preloadedPath = null;
      return;
    }
    if (this.preloadedPath === path) return;
    const idle = this.inactive();
    this.preloadedPath = path;
    idle.src = url;
    idle.load();
  }

  /** Passa a reprodução para o deck inativo (que já está carregado com `path`). */
  private swapTo(index: number, path: string): void {
    const from = this.decks[this.active];
    const nextActive: 0 | 1 = this.active === 0 ? 1 : 0;
    const to = this.decks[nextActive];
    const track = this.known.get(path) ?? null;
    from.pause();
    this.active = nextActive;
    this.preloadedPath = null;
    this.attachAnalysis(to, nextActive);
    this.patch({
      queue: moveTo(this.state.queue, index),
      track,
      duration: track?.duration ?? 0,
      error: null,
    });
    this.emitTime();
    this.applyVolume();
    if (track) this.playedListeners.forEach((listener) => listener(track));
    void this.play().then(() => this.preloadNext());
  }

  private onEnded(): void {
    if (this.fade) {
      // O crossfade ainda não acabou quando a faixa acabou: conclui agora.
      this.finishFade();
      return;
    }
    const queue = this.state.queue;
    if (queue.repeat === "one") {
      this.decks[this.active].currentTime = 0;
      void this.play();
      return;
    }
    const index = nextIndex(queue, true);
    if (index === null) {
      this.patch({ playing: false });
      this.emitTime();
      return;
    }
    this.jumpWithin(index);
  }

  private onPause(): void {
    if (this.fade) return;
    this.patch({ playing: false });
  }

  private onTime(): void {
    this.emitTime();
    this.maybeStartFade();
  }

  private maybeStartFade(): void {
    const { crossfade, queue } = this.state;
    if (!crossfade || this.fade || queue.repeat === "one") return;
    const deck = this.decks[this.active];
    const duration = deck.duration;
    if (!Number.isFinite(duration) || duration <= crossfade * 2) return;
    if (duration - deck.currentTime > crossfade) return;
    const index = nextIndex(queue, true);
    if (index === null) return;
    const path = queue.order[index]!;
    if (this.preloadedPath !== path) return;
    this.startFade(index, path, crossfade);
  }

  /** Sobe o volume do deck que entra e baixa o do que sai, por `seconds`. */
  private startFade(index: number, path: string, seconds: number): void {
    const incoming = this.inactive();
    const target = this.state.muted ? 0 : this.state.volume;
    const started = Date.now();
    incoming.volume = 0;
    void incoming.play().catch(() => undefined);
    const timer = setInterval(() => {
      const t = Math.min(1, (Date.now() - started) / (seconds * 1000));
      this.decks[this.active].volume = (1 - t) * target;
      incoming.volume = t * target;
      if (t >= 1) this.finishFade();
    }, FADE_TICK_MS);
    this.fade = { timer, from: this.active, to: this.active === 0 ? 1 : 0, index, path };
  }

  private finishFade(): void {
    const fade = this.fade;
    if (!fade) return;
    clearInterval(fade.timer);
    this.fade = null;
    this.swapTo(fade.index, fade.path);
  }

  private cancelFade(): void {
    const fade = this.fade;
    if (!fade) return;
    clearInterval(fade.timer);
    this.fade = null;
    const incoming = this.decks[fade.to];
    incoming.pause();
    incoming.volume = 0;
    // Ficou parado no meio: quando a troca vier, a faixa recomeça do início.
    incoming.currentTime = 0;
    this.decks[fade.from].volume = this.state.muted ? 0 : this.state.volume;
    this.preloadedPath = fade.path;
  }

  private onMeta(): void {
    const deck = this.decks[this.active];
    const duration = Number.isFinite(deck.duration) ? deck.duration : 0;
    const track = this.state.track;
    if (track && duration > 0) {
      if (!track.duration) this.remember(track.path, { duration });
      this.patch({ duration });
    }
    this.updateSession();
  }

  private onError(): void {
    const deck = this.decks[this.active];
    if (!deck.getAttribute("src")) return;
    const track = this.state.track;
    if (track) this.failCurrent(track);
  }

  /** A faixa não toca (sem URL ou arquivo recusado): avisa e segue para a próxima depois de um instante. */
  private failCurrent(track: Track): void {
    this.patch({ playing: false, error: `Não foi possível tocar “${track.name}”.` });
    this.clearSkip();
    this.skipTimer = setTimeout(() => {
      this.skipTimer = null;
      if (nextIndex(this.state.queue, true) !== null) this.next();
    }, 1500);
  }

  private clearSkip(): void {
    if (this.skipTimer) clearTimeout(this.skipTimer);
    this.skipTimer = null;
  }

  // ---- Media Session (teclas de mídia e tela de bloqueio) --------------------------

  /** Uma vez, na criação. Sem navigator.mediaSession (web) não faz nada. */
  wireSession(): void {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Ação sem suporte nesta plataforma: segue sem ela.
      }
    };
    set("play", () => this.toggle(true));
    set("pause", () => this.toggle(false));
    set("previoustrack", () => this.prev());
    set("nexttrack", () => this.next());
    set("seekbackward", () => this.seekBy(-SEEK_STEP));
    set("seekforward", () => this.seekBy(SEEK_STEP));
    set("seekto", (details) => {
      if (typeof details.seekTime === "number") this.seek(details.seekTime);
    });
  }

  private updateSession(): void {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const track = this.state.track;
    if (!track || typeof MediaMetadata === "undefined") {
      navigator.mediaSession.metadata = null;
      return;
    }
    navigator.mediaSession.playbackState = this.state.playing ? "playing" : "paused";
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist ?? "",
      album: track.album ?? "",
      artwork: track.cover ? [{ src: track.cover, sizes: "512x512", type: "image/jpeg" }] : [],
    });
  }

  /** Atualiza capa e título no SO quando a faixa atual ganha tags. */
  refreshSession(): void {
    this.updateSession();
  }
}

/** Instância única do app, criada na primeira vez que a página precisa dela. */
let instance: MusicEngine | null = null;

export function musicEngine(): MusicEngine | null {
  if (instance) return instance;
  if (typeof Audio === "undefined") return null;
  instance = new MusicEngine([makeDeck(), makeDeck()]);
  instance.wireSession();
  return instance;
}
