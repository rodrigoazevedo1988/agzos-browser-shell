import { afterEach, describe, expect, it, vi } from "vitest";

import { MusicEngine, type Track } from "./engine";

/** Deck falso: o que o motor usa de um <audio>, e o que o teste dispara (ended, timeupdate…). */
class FakeDeck {
  src = "";
  currentTime = 0;
  duration = Number.NaN;
  volume = 1;
  preload = "auto";
  paused = true;
  private handlers = new Map<string, Set<() => void>>();

  addEventListener(type: string, fn: () => void) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
  }
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  getAttribute(name: string) {
    return name === "src" && this.src ? this.src : null;
  }
  load() {
    this.currentTime = 0;
  }
  play() {
    this.paused = false;
    this.emit("play");
    return Promise.resolve();
  }
  pause() {
    if (!this.paused) {
      this.paused = true;
      this.emit("pause");
    }
  }
  emit(type: string) {
    for (const fn of this.handlers.get(type) ?? []) fn();
  }
  finish() {
    this.paused = true;
    this.emit("ended");
  }
}

const track = (path: string): Track => ({
  path,
  name: path.split("/").pop()!,
  ext: "mp3",
  size: 1,
  title: path.split("/").pop()!.replace(".mp3", ""),
});

function make() {
  const decks = [new FakeDeck(), new FakeDeck()];
  const engine = new MusicEngine(decks as unknown as [HTMLAudioElement, HTMLAudioElement]);
  engine.setUrlResolver((path) => `agzos-media://t/${encodeURIComponent(path)}`);
  // Sem aleatoriedade real nos testes.
  engine.setRandom(() => 0.5);
  return { engine, decks };
}

const LIST = ["/m/a.mp3", "/m/b.mp3", "/m/c.mp3"].map(track);

describe("MusicEngine: fila e troca de faixas", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("toca a faixa pedida e já deixa a próxima carregada no outro deck", () => {
    const { engine, decks } = make();
    engine.playList(LIST, 0);
    expect(engine.getState().track?.path).toBe("/m/a.mp3");
    expect(decks[0]!.src).toContain(encodeURIComponent("/m/a.mp3"));
    expect(decks[1]!.src).toContain(encodeURIComponent("/m/b.mp3"));
    expect(engine.getState().playing).toBe(true);
  });

  it("quando a faixa acaba, o deck preparado assume (sem recarregar)", () => {
    const { engine, decks } = make();
    engine.playList(LIST, 0);
    decks[0]!.finish();
    expect(engine.getState().track?.path).toBe("/m/b.mp3");
    expect(engine.getState().queue.index).toBe(1);
    expect(decks[1]!.paused).toBe(false);
    expect(decks[1]!.src).toContain(encodeURIComponent("/m/b.mp3"));
  });

  it("na última faixa, sem repetir, a fila para", () => {
    const { engine, decks } = make();
    engine.playList(LIST, 2);
    decks[0]!.finish();
    expect(engine.getState().playing).toBe(false);
    expect(engine.getState().track?.path).toBe("/m/c.mp3");
  });

  it("repetir tudo volta à primeira faixa no fim", () => {
    const { engine, decks } = make();
    engine.playList(LIST, 2);
    engine.cycleRepeat();
    expect(engine.getState().queue.repeat).toBe("all");
    decks[0]!.finish();
    expect(engine.getState().track?.path).toBe("/m/a.mp3");
  });

  it("repetir uma reinicia a mesma faixa", () => {
    const { engine, decks } = make();
    engine.playList(LIST, 1);
    engine.cycleRepeat();
    engine.cycleRepeat();
    expect(engine.getState().queue.repeat).toBe("one");
    decks[0]!.currentTime = 200;
    decks[0]!.finish();
    expect(engine.getState().track?.path).toBe("/m/b.mp3");
    expect(decks[0]!.currentTime).toBe(0);
  });

  it("próxima avança mesmo com repetir uma; anterior volta ou reinicia", () => {
    const { engine, decks } = make();
    engine.playList(LIST, 1);
    engine.cycleRepeat();
    engine.cycleRepeat();
    engine.next();
    expect(engine.getState().track?.path).toBe("/m/c.mp3");
    decks[1]!.currentTime = 1;
    engine.prev();
    expect(engine.getState().track?.path).toBe("/m/b.mp3");
    const deck = decks.find((item) => item.src.includes(encodeURIComponent("/m/b.mp3")))!;
    deck.currentTime = 30;
    engine.prev();
    expect(deck.currentTime).toBe(0);
    expect(engine.getState().track?.path).toBe("/m/b.mp3");
  });

  it("tocar a seguir e adicionar à fila mexem na ordem", () => {
    const { engine } = make();
    engine.playList(LIST.slice(0, 2), 0);
    engine.playNext(["/m/x.mp3"]);
    expect(engine.getState().queue.order).toEqual(["/m/a.mp3", "/m/x.mp3", "/m/b.mp3"]);
    engine.enqueue(["/m/y.mp3"]);
    expect(engine.getState().queue.order.at(-1)).toBe("/m/y.mp3");
    expect(engine.getState().track?.path).toBe("/m/a.mp3");
  });

  it("embaralhar mantém a faixa atual em primeiro", () => {
    const { engine } = make();
    engine.playList(LIST, 2);
    engine.setShuffle(true);
    expect(engine.getState().queue.shuffle).toBe(true);
    expect(engine.getState().queue.order[0]).toBe("/m/c.mp3");
    expect(engine.getState().track?.path).toBe("/m/c.mp3");
  });

  it("volume e silenciar vão para o deck que toca", () => {
    const { engine, decks } = make();
    engine.playList(LIST, 0);
    engine.setVolume(0.4);
    expect(decks[0]!.volume).toBeCloseTo(0.4);
    engine.toggleMute();
    expect(decks[0]!.volume).toBe(0);
    engine.toggleMute();
    expect(decks[0]!.volume).toBeCloseTo(0.4);
  });

  it("sem análise de áudio, o visualizador recebe zeros", () => {
    const { engine } = make();
    const levels = engine.frequencies(new Uint8Array(8));
    expect(Array.from(levels)).toEqual(new Array(8).fill(0));
    expect(engine.hasAnalyser()).toBe(false);
  });

  it("registra tags conhecidas sem perder o que já havia", () => {
    const { engine } = make();
    engine.remember("/m/a.mp3", { artist: "Dupla", album: "Disco" });
    engine.remember("/m/a.mp3", { title: "Título lido", duration: 200 });
    const got = engine.trackOf("/m/a.mp3")!;
    expect(got).toMatchObject({
      artist: "Dupla",
      album: "Disco",
      title: "Título lido",
      duration: 200,
    });
  });

  it("faixa sem caminho vira a atual com erro, e a fila segue depois de um instante", () => {
    vi.useFakeTimers();
    const { engine } = make();
    engine.setUrlResolver((path) => (path.endsWith("b.mp3") ? null : `u:${path}`));
    engine.playList(LIST, 0);
    engine.next();
    expect(engine.getState().track?.path).toBe("/m/b.mp3");
    expect(engine.getState().error).toContain("b");
    expect(engine.getState().playing).toBe(false);
    vi.advanceTimersByTime(1600);
    expect(engine.getState().track?.path).toBe("/m/c.mp3");
  });

  it("transição: a faixa seguinte entra antes do fim e a troca termina no tempo", () => {
    vi.useFakeTimers();
    const { engine, decks } = make();
    engine.setCrossfade(2);
    engine.playList(LIST, 0);
    const first = decks[0]!;
    first.duration = 10;
    first.currentTime = 9;
    first.emit("timeupdate");
    expect(decks[1]!.volume).toBe(0);
    vi.advanceTimersByTime(2200);
    expect(engine.getState().track?.path).toBe("/m/b.mp3");
    expect(first.paused).toBe(true);
  });

  it("fora do fim, a transição não começa", () => {
    vi.useFakeTimers();
    const { engine, decks } = make();
    engine.setCrossfade(2);
    engine.playList(LIST, 0);
    decks[0]!.duration = 100;
    decks[0]!.currentTime = 10;
    decks[0]!.emit("timeupdate");
    vi.advanceTimersByTime(3000);
    expect(engine.getState().track?.path).toBe("/m/a.mp3");
  });

  it("stop limpa a faixa e a fila fica sem atual", () => {
    const { engine } = make();
    engine.playList(LIST, 0);
    engine.stop();
    expect(engine.getState().track).toBeNull();
    expect(engine.getState().queue.index).toBe(-1);
  });
});

describe("MusicEngine: assinatura", () => {
  it("avisa quem assina a cada mudança de estado", () => {
    const { engine } = make();
    let calls = 0;
    const off = engine.subscribe(() => calls++);
    engine.setVolume(0.2);
    engine.cycleRepeat();
    off();
    engine.setVolume(0.3);
    expect(calls).toBe(2);
  });

  it("avisa a tela de quando uma faixa começa (recentes)", () => {
    const { engine } = make();
    const started: string[] = [];
    engine.onPlayed((t) => started.push(t.path));
    engine.playList(LIST, 0);
    expect(started).toEqual(["/m/a.mp3"]);
  });
});
