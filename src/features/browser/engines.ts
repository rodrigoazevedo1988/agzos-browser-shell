import type { EngineId } from "./types";

export const engines: {
  id: EngineId;
  name: string;
  hint: string;
  search: (query: string) => string;
}[] = [
  {
    id: "duckduckgo",
    name: "DuckDuckGo",
    hint: "Busca sem rastreamento",
    search: (query) => `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
  },
  {
    id: "yandex",
    name: "Yandex",
    hint: "Busca alternativa",
    search: (query) => `https://yandex.com/search/?text=${encodeURIComponent(query)}`,
  },
];

export function engineOf(id: EngineId) {
  return engines.find((item) => item.id === id) ?? engines[0]!;
}
