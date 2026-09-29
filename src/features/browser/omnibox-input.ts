import { engineOf } from "./engines";
import type { EngineId, Entry } from "./types";

const URL_WITH_SCHEME = /^https?:\/\//i;
const BARE_DOMAIN = /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$|\?|#)/;
const LOCALHOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$|\?|#)/i;

/** Converte o texto digitado na omnibox em página: URL direta ou busca no motor escolhido. */
export const INTERNAL_PAGES: Record<string, string> = {
  "agzos://historico": "Histórico",
  "agzos://favoritos": "Favoritos",
};

export function resolveInput(raw: string, engine: EngineId): Entry | null {
  const input = raw.trim();
  if (!input) return null;
  const internal = INTERNAL_PAGES[input.toLowerCase().replace(/\/+$/, "")];
  if (internal)
    return { title: internal, url: input.toLowerCase().replace(/\/+$/, ""), kind: "internal" };
  if (URL_WITH_SCHEME.test(input)) {
    const title = input.replace(URL_WITH_SCHEME, "").split(/[/?#]/)[0] || input;
    return { title, url: input, kind: "page" };
  }
  if (!/\s/.test(input) && (BARE_DOMAIN.test(input) || LOCALHOST.test(input))) {
    const scheme = LOCALHOST.test(input) ? "http" : "https";
    const title = input.split(/[/?#]/)[0] ?? input;
    return { title, url: `${scheme}://${input}`, kind: "page" };
  }
  return { title: input, url: engineOf(engine).search(input), kind: "page" };
}
