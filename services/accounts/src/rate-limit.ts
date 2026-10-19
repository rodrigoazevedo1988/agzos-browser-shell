// Limite de tentativas em memória (janela deslizante por chave). Complementa os
// contadores de bloqueio gravados no banco, que sobrevivem a um reinício.

export type Limiter = {
  /** Ainda pode tentar? Não conta a tentativa. */
  allowed(key: string): boolean;
  /** Conta uma tentativa (falha, ou toda chamada, conforme o uso). */
  hit(key: string): void;
  reset(key: string): void;
};

export function createLimiter({
  limit,
  windowMs,
  now = Date.now,
  maxKeys = 50_000,
}: {
  limit: number;
  windowMs: number;
  now?: () => number;
  maxKeys?: number;
}): Limiter {
  const hits = new Map<string, number[]>();

  const recent = (key: string): number[] => {
    const since = now() - windowMs;
    const list = (hits.get(key) ?? []).filter((at) => at > since);
    if (list.length) hits.set(key, list);
    else hits.delete(key);
    return list;
  };

  return {
    allowed(key) {
      return recent(key).length < limit;
    },
    hit(key) {
      const list = recent(key);
      list.push(now());
      hits.set(key, list);
      // Teto de memória: sem isso, um varrimento de IPs/e-mails cresceria sem fim.
      if (hits.size > maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest !== undefined) hits.delete(oldest);
      }
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
