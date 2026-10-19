/**
 * Preferências da tradução (em `prefs.features.translate`, salvas pelo BrowserStore como o
 * resto das preferências) e as regras de "sempre/nunca traduzir".
 */
import { baseLang, normalizeLang, sameLanguage } from "./languages";

export type TranslateMode = "replace" | "bilingual" | "hover";
export type TranslateTone = "natural" | "literal" | "formal" | "informal" | "technical";
export type TranslateScope = "page" | "visible" | "main";
export type GlossaryPair = { from: string; to: string };

export type TranslatePrefs = {
  /** Idioma de destino (código da lista). */
  target: string;
  /** "auto" detecta pela página (html lang, texto e a resposta da Groq). */
  source: string;
  mode: TranslateMode;
  tone: TranslateTone;
  scope: TranslateScope;
  /** Traduzir também o que aparece depois (rolagem, SPA). */
  observe: boolean;
  /** Seguir as regras de "sempre traduzir" sozinho, ao abrir a página. */
  autoTranslate: boolean;
  /** Ícone na barra de URL quando a página está em outro idioma. */
  showIcon: boolean;
  /** Reaproveitar traduções já feitas (economiza tokens). */
  cache: boolean;
  /** Termos com tradução obrigatória (nomes de produto, jargão). */
  glossary: GlossaryPair[];
  /** Termos que ficam como estão. */
  keep: string[];
  alwaysLangs: string[];
  neverLangs: string[];
  alwaysSites: string[];
  neverSites: string[];
};

export const TRANSLATE_MODES: { id: TranslateMode; label: string; hint: string }[] = [
  { id: "replace", label: "Substituir", hint: "O texto da página vira a tradução" },
  { id: "bilingual", label: "Bilíngue", hint: "Original e tradução embaixo de cada bloco" },
  { id: "hover", label: "Original no mouse", hint: "Traduz e mostra o original ao passar o mouse" },
];

export const TRANSLATE_TONES: { id: TranslateTone; label: string }[] = [
  { id: "natural", label: "Natural" },
  { id: "literal", label: "Literal" },
  { id: "formal", label: "Formal" },
  { id: "informal", label: "Informal" },
  { id: "technical", label: "Técnico" },
];

export const TRANSLATE_SCOPES: { id: TranslateScope; label: string }[] = [
  { id: "page", label: "Página inteira" },
  { id: "visible", label: "Só a área visível" },
  { id: "main", label: "Só o conteúdo principal" },
];

export const defaultTranslatePrefs: TranslatePrefs = {
  target: "pt-BR",
  source: "auto",
  mode: "replace",
  tone: "natural",
  scope: "page",
  observe: true,
  autoTranslate: true,
  showIcon: true,
  cache: true,
  glossary: [],
  keep: [],
  alwaysLangs: [],
  neverLangs: [],
  alwaysSites: [],
  neverSites: [],
};

const LIMIT = { list: 200, term: 80, sites: 500 };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const pick = <T extends string>(value: unknown, list: { id: T }[], fallback: T): T =>
  list.some((item) => item.id === value) ? (value as T) : fallback;

const term = (value: unknown) =>
  typeof value === "string" ? value.trim().slice(0, LIMIT.term) : "";

const langList = (value: unknown) =>
  [
    ...new Set((Array.isArray(value) ? value : []).map((item) => baseLang(item)).filter(Boolean)),
  ].slice(0, LIMIT.list);

/** "www.Example.com" → "example.com"; vazio se não parece um host. */
export function siteKey(value: unknown): string {
  const host = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  return /^[a-z0-9.-]{1,253}(?::\d{1,5})?$/.test(host) && /[a-z0-9]/.test(host) ? host : "";
}

const siteList = (value: unknown) =>
  [...new Set((Array.isArray(value) ? value : []).map(siteKey).filter(Boolean))].slice(
    0,
    LIMIT.sites,
  );

export function parseTranslatePrefs(value: unknown): TranslatePrefs {
  const raw = isObject(value) ? value : {};
  const d = defaultTranslatePrefs;
  const target = normalizeLang(raw["target"]) || d.target;
  const source = raw["source"] === "auto" ? "auto" : normalizeLang(raw["source"]) || d.source;
  const glossary: GlossaryPair[] = [];
  for (const item of Array.isArray(raw["glossary"]) ? raw["glossary"] : []) {
    if (!isObject(item)) continue;
    const from = term(item["from"]);
    const to = term(item["to"]);
    if (from && to && !glossary.some((pair) => pair.from.toLowerCase() === from.toLowerCase()))
      glossary.push({ from, to });
  }
  const bool = (key: keyof TranslatePrefs, fallback: boolean) =>
    typeof raw[key] === "boolean" ? (raw[key] as boolean) : fallback;
  return {
    target,
    source,
    mode: pick(raw["mode"], TRANSLATE_MODES, d.mode),
    tone: pick(raw["tone"], TRANSLATE_TONES, d.tone),
    scope: pick(raw["scope"], TRANSLATE_SCOPES, d.scope),
    observe: bool("observe", d.observe),
    autoTranslate: bool("autoTranslate", d.autoTranslate),
    showIcon: bool("showIcon", d.showIcon),
    cache: bool("cache", d.cache),
    glossary: glossary.slice(0, LIMIT.list),
    keep: [
      ...new Set((Array.isArray(raw["keep"]) ? raw["keep"] : []).map(term).filter(Boolean)),
    ].slice(0, LIMIT.list),
    alwaysLangs: langList(raw["alwaysLangs"]),
    neverLangs: langList(raw["neverLangs"]),
    alwaysSites: siteList(raw["alwaysSites"]),
    neverSites: siteList(raw["neverSites"]),
  };
}

export type TranslateRule = "alwaysLang" | "neverLang" | "alwaysSite" | "neverSite";

/** Liga/desliga uma regra. "Sempre" e "nunca" do mesmo alvo se excluem. */
export function toggleRule(
  prefs: TranslatePrefs,
  rule: TranslateRule,
  value: string,
  on: boolean,
): TranslatePrefs {
  const isLang = rule === "alwaysLang" || rule === "neverLang";
  const key = isLang ? baseLang(value) : siteKey(value);
  if (!key) return prefs;
  const lists = {
    alwaysLang: "alwaysLangs",
    neverLang: "neverLangs",
    alwaysSite: "alwaysSites",
    neverSite: "neverSites",
  } as const;
  const opposite = {
    alwaysLang: "neverLang",
    neverLang: "alwaysLang",
    alwaysSite: "neverSite",
    neverSite: "alwaysSite",
  } as const;
  const own = lists[rule];
  const other = lists[opposite[rule]];
  const without = (list: string[]) => list.filter((item) => item !== key);
  return {
    ...prefs,
    [own]: on ? [...without(prefs[own]), key] : without(prefs[own]),
    [other]: on ? without(prefs[other]) : prefs[other],
  };
}

export function hasRule(prefs: TranslatePrefs, rule: TranslateRule, value: string): boolean {
  if (rule === "alwaysLang") return prefs.alwaysLangs.includes(baseLang(value));
  if (rule === "neverLang") return prefs.neverLangs.includes(baseLang(value));
  if (rule === "alwaysSite") return prefs.alwaysSites.includes(siteKey(value));
  return prefs.neverSites.includes(siteKey(value));
}

/**
 * O que fazer ao abrir uma página: mostrar o ícone (`offer`) e/ou traduzir sozinho (`auto`).
 * Guia anônima nunca traduz sozinha (o texto iria para a Groq sem perguntar).
 */
export function decideTranslate(
  prefs: TranslatePrefs,
  page: { lang: string; host: string; private: boolean },
): { offer: boolean; auto: boolean } {
  const differs = Boolean(page.lang) && !sameLanguage(page.lang, prefs.target);
  const offer = prefs.showIcon && differs;
  if (!differs || page.private || !prefs.autoTranslate) return { offer, auto: false };
  const host = siteKey(page.host);
  if (host && prefs.neverSites.includes(host)) return { offer, auto: false };
  if (prefs.neverLangs.includes(baseLang(page.lang))) return { offer, auto: false };
  const auto =
    (Boolean(host) && prefs.alwaysSites.includes(host)) ||
    prefs.alwaysLangs.includes(baseLang(page.lang));
  return { offer, auto };
}

/** Opções que vão para o main a cada pedido. */
export function requestOptions(prefs: TranslatePrefs, consent = false) {
  return {
    source: prefs.source,
    target: prefs.target,
    tone: prefs.tone,
    mode: prefs.mode,
    scope: prefs.scope,
    observe: prefs.observe,
    glossary: prefs.glossary,
    keep: prefs.keep,
    cache: prefs.cache,
    consent,
  };
}
