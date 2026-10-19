/**
 * Idiomas da tradução. Os códigos são os mesmos de LANGUAGE_NAMES em electron/translate.cjs
 * (lá ficam os nomes em inglês que vão no prompt); o teste confere que as duas listas batem.
 */
export type Language = { code: string; label: string };

export const LANGUAGES: Language[] = [
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "pt-PT", label: "Português (Portugal)" },
  { code: "en", label: "Inglês" },
  { code: "es", label: "Espanhol" },
  { code: "fr", label: "Francês" },
  { code: "de", label: "Alemão" },
  { code: "it", label: "Italiano" },
  { code: "nl", label: "Holandês" },
  { code: "ru", label: "Russo" },
  { code: "uk", label: "Ucraniano" },
  { code: "pl", label: "Polonês" },
  { code: "tr", label: "Turco" },
  { code: "ar", label: "Árabe" },
  { code: "he", label: "Hebraico" },
  { code: "fa", label: "Persa" },
  { code: "hi", label: "Hindi" },
  { code: "bn", label: "Bengali" },
  { code: "zh-CN", label: "Chinês (simplificado)" },
  { code: "zh-TW", label: "Chinês (tradicional)" },
  { code: "ja", label: "Japonês" },
  { code: "ko", label: "Coreano" },
  { code: "vi", label: "Vietnamita" },
  { code: "th", label: "Tailandês" },
  { code: "id", label: "Indonésio" },
  { code: "ms", label: "Malaio" },
  { code: "fil", label: "Filipino" },
  { code: "sv", label: "Sueco" },
  { code: "no", label: "Norueguês" },
  { code: "da", label: "Dinamarquês" },
  { code: "fi", label: "Finlandês" },
  { code: "el", label: "Grego" },
  { code: "cs", label: "Tcheco" },
  { code: "ro", label: "Romeno" },
  { code: "hu", label: "Húngaro" },
];

const ALIASES: Record<string, string> = {
  iw: "he",
  in: "id",
  nb: "no",
  nn: "no",
  tl: "fil",
  jw: "jv",
};

/** Mesma regra de normalizeLang em electron/translate.cjs. */
export function normalizeLang(value: unknown): string {
  const raw = String(value ?? "")
    .trim()
    .replace(/_/g, "-");
  if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(raw)) return "";
  const [base = "", ...rest] = raw.toLowerCase().split("-");
  const region = rest.find((part) => part.length === 2 || part.length === 4) ?? "";
  if (base === "zh") {
    return /^(tw|hk|mo|hant)$/.test(region) || rest.includes("hant") ? "zh-TW" : "zh-CN";
  }
  if (base === "pt") return region === "pt" ? "pt-PT" : "pt-BR";
  return ALIASES[base] ?? base;
}

/** Idioma base: "pt-BR" e "pt-PT" são o mesmo; o chinês separa a escrita. */
export function baseLang(value: unknown): string {
  const code = normalizeLang(value);
  if (!code) return "";
  if (code.startsWith("zh")) return code;
  return code.split("-")[0]!;
}

export function sameLanguage(a: unknown, b: unknown): boolean {
  const left = baseLang(a);
  return Boolean(left) && left === baseLang(b);
}

/** Nome em português ("Inglês"); o código quando não está na lista. */
export function languageLabel(code: string): string {
  const normalized = normalizeLang(code);
  const exact = LANGUAGES.find((item) => item.code === normalized);
  if (exact) return exact.label;
  const base = LANGUAGES.find((item) => baseLang(item.code) === baseLang(normalized));
  return base ? base.label.replace(/ \(.*\)$/, "") : code;
}

/** Nome curto para frases ("Traduzir para Português"). */
export function shortLanguageLabel(code: string): string {
  const label = languageLabel(code);
  return code.startsWith("zh") ? label : label.replace(/ \(.*\)$/, "");
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Busca por nome (sem acento) ou código. */
export function searchLanguages(query: string, list: Language[] = LANGUAGES): Language[] {
  const wanted = fold(query.trim());
  if (!wanted) return list;
  return list.filter(
    (item) => fold(item.label).includes(wanted) || item.code.toLowerCase().startsWith(wanted),
  );
}
