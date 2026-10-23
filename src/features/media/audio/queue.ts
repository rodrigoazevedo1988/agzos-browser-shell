// Fila de reprodução: ordem, embaralhar, repetir e os passos (próxima/anterior).
// Puro: cada operação devolve uma fila nova. Os itens são caminhos de arquivo.

export type Repeat = "off" | "all" | "one";
export const REPEAT_ORDER: Repeat[] = ["off", "all", "one"];

export type PlayQueue = {
  /** Ordem natural (como foram adicionadas). */
  source: string[];
  /** Ordem de reprodução (embaralhada quando `shuffle`). */
  order: string[];
  /** Posição atual em `order`; -1 = nada tocando. */
  index: number;
  shuffle: boolean;
  repeat: Repeat;
};

export const QUEUE_LIMIT = 2000;

export const emptyQueue: PlayQueue = {
  source: [],
  order: [],
  index: -1,
  shuffle: false,
  repeat: "off",
};

/** Gerador aleatório injetável (testes passam um determinístico). */
export type Random = () => number;

/** Fisher-Yates sobre uma cópia. */
export function shuffled<T>(items: readonly T[], random: Random = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Nova fila com `items`, começando em `start` (índice em `items`). */
export function startQueue(
  items: readonly string[],
  start: number,
  options: { shuffle?: boolean; repeat?: Repeat; random?: Random } = {},
): PlayQueue {
  const source = items.slice(0, QUEUE_LIMIT);
  const shuffle = options.shuffle ?? false;
  const repeat = options.repeat ?? "off";
  if (!source.length) return { ...emptyQueue, shuffle, repeat };
  const first = Math.min(Math.max(start, 0), source.length - 1);
  if (!shuffle) return { source, order: source, index: first, shuffle, repeat };
  // Embaralhando: a faixa escolhida toca primeiro e o resto vem em ordem aleatória.
  const rest = source.filter((_, i) => i !== first);
  const order = [source[first]!, ...shuffled(rest, options.random)];
  return { source, order, index: 0, shuffle, repeat };
}

export function currentTrack(queue: PlayQueue): string | null {
  return queue.index >= 0 ? (queue.order[queue.index] ?? null) : null;
}

export function upcoming(queue: PlayQueue): string[] {
  return queue.index >= 0 ? queue.order.slice(queue.index + 1) : queue.order.slice();
}

/**
 * Próxima faixa. `auto` = a faixa acabou sozinha (repetir uma faixa vale só aí; o botão
 * "próxima" sempre avança). Null quando a fila acabou sem repetir.
 */
export function nextIndex(queue: PlayQueue, auto = false): number | null {
  if (!queue.order.length) return null;
  if (queue.index < 0) return 0;
  if (auto && queue.repeat === "one") return queue.index;
  if (queue.index + 1 < queue.order.length) return queue.index + 1;
  return queue.repeat === "all" ? 0 : null;
}

/** Faixa anterior: volta uma; no começo da fila, dá a volta só com repetir tudo. */
export function prevIndex(queue: PlayQueue): number | null {
  if (!queue.order.length) return null;
  if (queue.index > 0) return queue.index - 1;
  return queue.repeat === "all" ? queue.order.length - 1 : 0;
}

export function moveTo(queue: PlayQueue, index: number): PlayQueue {
  if (index < 0 || index >= queue.order.length) return queue;
  return { ...queue, index };
}

/** Liga/desliga o embaralhar. Ligar mantém a faixa atual em primeiro; desligar volta à ordem natural. */
export function setShuffle(queue: PlayQueue, on: boolean, random: Random = Math.random): PlayQueue {
  if (on === queue.shuffle) return queue;
  const current = currentTrack(queue);
  if (!on) {
    const index = current === null ? -1 : Math.max(queue.source.indexOf(current), 0);
    return {
      ...queue,
      shuffle: false,
      order: queue.source.slice(),
      index: queue.source.length ? index : -1,
    };
  }
  if (!queue.source.length) return { ...queue, shuffle: true };
  const rest = queue.source.filter((item) => item !== current);
  const order = current === null ? shuffled(rest, random) : [current, ...shuffled(rest, random)];
  return { ...queue, shuffle: true, order, index: current === null ? -1 : 0 };
}

export function nextRepeat(repeat: Repeat): Repeat {
  return REPEAT_ORDER[(REPEAT_ORDER.indexOf(repeat) + 1) % REPEAT_ORDER.length]!;
}

/** Adiciona ao fim (ordem natural e de reprodução). Duplicadas entram de novo. */
export function enqueue(queue: PlayQueue, items: readonly string[]): PlayQueue {
  const room = Math.max(0, QUEUE_LIMIT - queue.order.length);
  const added = items.slice(0, room);
  if (!added.length) return queue;
  const order = queue.order.concat(added);
  // Só cresce a fila: a faixa atual não muda.
  return { ...queue, source: queue.source.concat(added), order };
}

/** Tocar a seguir: insere logo depois da faixa atual. */
export function playNext(queue: PlayQueue, items: readonly string[]): PlayQueue {
  const room = Math.max(0, QUEUE_LIMIT - queue.order.length);
  const added = items.slice(0, room);
  if (!added.length) return queue;
  const at = queue.index < 0 ? 0 : queue.index + 1;
  const order = [...queue.order.slice(0, at), ...added, ...queue.order.slice(at)];
  const source = queue.source.concat(added);
  return { ...queue, source, order };
}

/** Remove a posição `index` da ordem de reprodução (e da natural, se estiver lá). */
export function removeAt(queue: PlayQueue, index: number): PlayQueue {
  if (index < 0 || index >= queue.order.length) return queue;
  const removed = queue.order[index]!;
  const order = queue.order.filter((_, i) => i !== index);
  let current = queue.index;
  if (index < current) current -= 1;
  // Tirou a faixa que toca: a próxima ocupa o lugar; se não há mais nenhuma, fila sem atual.
  else if (index === current) current = index < order.length ? index : -1;
  const sourceAt = queue.source.indexOf(removed);
  const source = sourceAt < 0 ? queue.source : queue.source.filter((_, i) => i !== sourceAt);
  return { ...queue, source, order, index: order.length ? current : -1 };
}

/** Move um item da fila de reprodução (arrastar na fila). Acompanha a faixa atual. */
export function moveUpcoming(queue: PlayQueue, from: number, to: number): PlayQueue {
  if (from === to || from < 0 || to < 0 || from >= queue.order.length || to >= queue.order.length) {
    return queue;
  }
  const order = queue.order.slice();
  const [item] = order.splice(from, 1);
  order.splice(to, 0, item!);
  let index = queue.index;
  if (queue.index === from) index = to;
  else if (from < queue.index && to >= queue.index) index -= 1;
  else if (from > queue.index && to <= queue.index) index += 1;
  return { ...queue, order, index };
}

/** Limpa tudo que vem depois da faixa atual (a atual continua tocando). */
export function clearUpcoming(queue: PlayQueue): PlayQueue {
  if (queue.index < 0) return queue;
  const dropped = queue.order.slice(queue.index + 1);
  const source = queue.source.slice();
  for (const item of dropped) {
    const at = source.indexOf(item);
    if (at >= 0) source.splice(at, 1);
  }
  return { ...queue, order: queue.order.slice(0, queue.index + 1), source };
}
