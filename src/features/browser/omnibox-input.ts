import { engineOf } from "./engines";
import type { EngineId, Entry } from "./types";

const URL_WITH_SCHEME = /^https?:\/\//i;
/** 4.1.1: arquivo local digitado (file://, /caminho ou C:\caminho). */
const FILE_URL = /^file:\/\//i;
const POSIX_PATH = /^\/[^\s/]/;
const WINDOWS_PATH = /^[a-z]:[\\/]/i;

/** Caminho absoluto → file:// (sem resolver ~: a casca não sabe a pasta pessoal). */
export function fileUrlOfPath(input: string): string | null {
  if (FILE_URL.test(input)) return input;
  if (WINDOWS_PATH.test(input)) {
    const path = input.replace(/\\/g, "/");
    return `file:///${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")
      .replace(/^([a-z])%3A/i, "$1:")}`;
  }
  if (POSIX_PATH.test(input) && !input.startsWith("//")) {
    return `file://${input.split("/").map(encodeURIComponent).join("/")}`;
  }
  return null;
}
const BARE_DOMAIN = /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$|\?|#)/;
const LOCALHOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$|\?|#)/i;

/** Converte o texto digitado na omnibox em página: URL direta ou busca no motor escolhido. */
export const INTERNAL_PAGES: Record<string, string> = {
  "agzos://historico": "Histórico",
  "agzos://favoritos": "Favoritos",
  "agzos://configuracoes": "Configurações",
  "agzos://discador": "Discador",
  "agzos://scratchpad": "API Scratchpad",
  "agzos://downloads": "Downloads",
  "agzos://pdf": "PDF Tools",
  "agzos://ajuda/pdf-tools": "Ajuda do PDF Tools",
};

/** Outros nomes que levam às mesmas páginas (como o chrome://settings). */
const INTERNAL_ALIASES: Record<string, string> = {
  "agzos://settings": "agzos://configuracoes",
  "agzos-settings": "agzos://configuracoes",
  "agzos://history": "agzos://historico",
  "agzos://bookmarks": "agzos://favoritos",
  "agzos://speed-dial": "agzos://discador",
  "agzos://speeddial": "agzos://discador",
  "agzos://pdf-tools": "agzos://pdf",
  "agzos://help/pdf-tools": "agzos://ajuda/pdf-tools",
};

export function resolveInput(raw: string, engine: EngineId): Entry | null {
  const input = raw.trim();
  if (!input) return null;
  const typed = input.toLowerCase().replace(/\/+$/, "");
  const url = INTERNAL_ALIASES[typed] ?? typed;
  const internal = INTERNAL_PAGES[url];
  if (internal) return { title: internal, url, kind: "internal" };
  const file = fileUrlOfPath(input);
  if (file) {
    const name = decodeURIComponent(file.split("/").filter(Boolean).pop() ?? file);
    return { title: name || file, url: file, kind: "page" };
  }
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
