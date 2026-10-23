import { describe, expect, it } from "vitest";

import {
  clearUpcoming,
  currentTrack,
  emptyQueue,
  enqueue,
  moveTo,
  moveUpcoming,
  nextIndex,
  nextRepeat,
  playNext,
  prevIndex,
  removeAt,
  setShuffle,
  shuffled,
  startQueue,
  upcoming,
} from "./queue";

const songs = ["a", "b", "c", "d"];
/** Gerador determinístico: 0, 0.25, 0.5… (o Fisher-Yates vira permutação previsível). */
const seq = () => {
  let i = 0;
  return () => (i++ * 0.37) % 1;
};

describe("startQueue e a faixa atual", () => {
  it("começa na faixa pedida, na ordem natural", () => {
    const q = startQueue(songs, 2);
    expect(currentTrack(q)).toBe("c");
    expect(upcoming(q)).toEqual(["d"]);
    expect(q.order).toEqual(songs);
  });

  it("fora da faixa, cai nos limites", () => {
    expect(currentTrack(startQueue(songs, 99))).toBe("d");
    expect(currentTrack(startQueue(songs, -5))).toBe("a");
  });

  it("lista vazia não tem atual", () => {
    expect(currentTrack(startQueue([], 0))).toBeNull();
    expect(currentTrack(emptyQueue)).toBeNull();
  });

  it("embaralhando, a faixa escolhida toca primeiro e a fila tem as mesmas faixas", () => {
    const q = startQueue(songs, 1, { shuffle: true, random: seq() });
    expect(currentTrack(q)).toBe("b");
    expect([...q.order].sort()).toEqual([...songs].sort());
    expect(q.source).toEqual(songs);
  });
});

describe("próxima e anterior", () => {
  it("anda em ordem e para no fim sem repetir", () => {
    let q = startQueue(songs, 0);
    const seen = [currentTrack(q)];
    for (let n = nextIndex(q); n !== null; n = nextIndex(q)) {
      q = moveTo(q, n);
      seen.push(currentTrack(q));
    }
    expect(seen).toEqual(songs);
  });

  it("repetir tudo volta ao início no fim", () => {
    const q = { ...startQueue(songs, 3), repeat: "all" as const };
    expect(nextIndex(q)).toBe(0);
    expect(nextIndex(q, true)).toBe(0);
  });

  it("repetir uma só repete no fim automático, mas o botão avança", () => {
    const q = { ...startQueue(songs, 1), repeat: "one" as const };
    expect(nextIndex(q, true)).toBe(1);
    expect(nextIndex(q, false)).toBe(2);
  });

  it("anterior volta uma; no começo, dá a volta só com repetir tudo", () => {
    const q = startQueue(songs, 2);
    expect(prevIndex(q)).toBe(1);
    expect(prevIndex(startQueue(songs, 0))).toBe(0);
    expect(prevIndex({ ...startQueue(songs, 0), repeat: "all" })).toBe(3);
  });

  it("fila vazia não tem próxima nem anterior", () => {
    expect(nextIndex(emptyQueue)).toBeNull();
    expect(prevIndex(emptyQueue)).toBeNull();
  });
});

describe("embaralhar e repetir", () => {
  it("ligar o embaralhar mantém a faixa atual em primeiro", () => {
    const q = setShuffle(startQueue(songs, 2), true, seq());
    expect(q.shuffle).toBe(true);
    expect(currentTrack(q)).toBe("c");
    expect(q.order[0]).toBe("c");
    expect([...q.order].sort()).toEqual([...songs].sort());
  });

  it("desligar o embaralhar volta à ordem natural e segue na mesma faixa", () => {
    const shuffledQ = setShuffle(startQueue(songs, 1), true, seq());
    const back = setShuffle(shuffledQ, false);
    expect(back.order).toEqual(songs);
    expect(currentTrack(back)).toBe(currentTrack(shuffledQ));
  });

  it("ciclo de repetir: desligado, tudo, uma", () => {
    expect(nextRepeat("off")).toBe("all");
    expect(nextRepeat("all")).toBe("one");
    expect(nextRepeat("one")).toBe("off");
  });

  it("shuffled não muda a lista original", () => {
    const original = [...songs];
    const out = shuffled(original, seq());
    expect(original).toEqual(songs);
    expect([...out].sort()).toEqual([...songs].sort());
  });
});

describe("fila: adicionar, tocar a seguir, remover e reordenar", () => {
  it("enqueue põe no fim sem mudar a atual", () => {
    const q = enqueue(startQueue(songs, 0), ["x", "y"]);
    expect(currentTrack(q)).toBe("a");
    expect(q.order.slice(-2)).toEqual(["x", "y"]);
  });

  it("tocar a seguir insere logo depois da atual", () => {
    const q = playNext(startQueue(songs, 1), ["x"]);
    expect(q.order).toEqual(["a", "b", "x", "c", "d"]);
    expect(currentTrack(q)).toBe("b");
  });

  it("remover a faixa atual deixa a próxima no lugar; a última remove a atual", () => {
    const mid = removeAt(startQueue(songs, 1), 1);
    expect(currentTrack(mid)).toBe("c");
    const last = removeAt(startQueue(songs, 3), 3);
    expect(currentTrack(last)).toBeNull();
    expect(last.index).toBe(-1);
  });

  it("remover antes da atual desloca o índice", () => {
    const q = removeAt(startQueue(songs, 2), 0);
    expect(currentTrack(q)).toBe("c");
    expect(q.index).toBe(1);
  });

  it("mover faixa seguinte não mexe na atual", () => {
    const q = moveUpcoming(startQueue(songs, 0), 3, 1);
    expect(q.order).toEqual(["a", "d", "b", "c"]);
    expect(currentTrack(q)).toBe("a");
  });

  it("mover uma faixa por cima da atual mantém a atual tocando", () => {
    const q = moveUpcoming(startQueue(songs, 1), 2, 0);
    expect(q.order).toEqual(["c", "a", "b", "d"]);
    expect(currentTrack(q)).toBe("b");
  });

  it("limpar mantém a atual e tira o resto da fila", () => {
    const q = clearUpcoming(startQueue(songs, 1));
    expect(q.order).toEqual(["a", "b"]);
    expect(currentTrack(q)).toBe("b");
    expect(q.source).toEqual(["a", "b"]);
  });

  it("a fila tem limite de tamanho", () => {
    const many = Array.from({ length: 2005 }, (_, i) => `t${i}`);
    expect(startQueue(many, 0).order.length).toBe(2000);
    expect(enqueue(startQueue(["x"], 0), many).order.length).toBe(2000);
  });

  it("moveTo fora dos limites não muda nada", () => {
    const q = startQueue(songs, 0);
    expect(moveTo(q, 9)).toBe(q);
    expect(moveTo(q, -1)).toBe(q);
  });
});
