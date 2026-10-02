import { engineOf } from "./engines";
import type { EngineId, Entry } from "./types";

const URL_WITH_SCHEME = /^https?:\/\//i;
const BARE_DOMAIN = /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$|\?|#)/;
const LOCALHOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$|\?|#)/i;

/** Converte o texto digitado na omnibox em página: URL direta ou busca no motor escolhido. */
export const INTERNAL_PAGES: Record<string, string> = {
  "agzos://historico": "Histórico",
  "agzos://favoritos": "Favoritos",
  "agzos://configuracoes": "Configurações",
  "agzos://discador": "Discador",
};

/** Outros nomes que levam às mesmas páginas (como o chrome://settings). */
const INTERNAL_ALIASES: Record<string, string> = {
  "agzos://settings": "agzos://configuracoes",
  "agzos-settings": "agzos://configuracoes",
  "agzos://history": "agzos://historico",
  "agzos://bookmarks": "agzos://favoritos",
  "agzos://speed-dial": "agzos://discador",
  "agzos://speeddial": "agzos://discador",
};

export function resolveInput(raw: string, engine: EngineId): Entry | null {
  const input = raw.trim();
  if (!input) return null;
  const typed = input.toLowerCase().replace(/\/+$/, "");
  const url = INTERNAL_ALIASES[typed] ?? typed;
  const internal = INTERNAL_PAGES[url];
  if (internal) return { title: internal, url, kind: "internal" };
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
