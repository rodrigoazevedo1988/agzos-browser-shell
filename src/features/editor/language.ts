/**
 * Pura (sem Monaco): idioma pelo nome do arquivo, modo do editor e rótulos de codificação e
 * fim de linha. O Monaco entrega a lista de idiomas (`monaco.languages.getLanguages()`).
 */
export type LanguageInfo = { id: string; extensions?: string[]; filenames?: string[] };

export type Encoding = "utf-8" | "utf-8-bom" | "utf-16le" | "utf-16be" | "latin1";
export type Eol = "lf" | "crlf";

/** Lista embutida: a usada antes do Monaco carregar e nos testes. */
export const BUILTIN_LANGUAGES: LanguageInfo[] = [
  { id: "typescript", extensions: [".ts", ".mts", ".cts"] },
  { id: "javascript", extensions: [".js", ".mjs", ".cjs"] },
  { id: "typescriptreact", extensions: [".tsx"] },
  { id: "javascriptreact", extensions: [".jsx"] },
  { id: "json", extensions: [".json", ".jsonc", ".json5"] },
  { id: "markdown", extensions: [".md", ".markdown", ".mdx"] },
  { id: "css", extensions: [".css"] },
  { id: "scss", extensions: [".scss"] },
  { id: "html", extensions: [".html", ".htm"] },
  { id: "xml", extensions: [".xml", ".svg"] },
  { id: "python", extensions: [".py", ".pyw"] },
  { id: "ini", extensions: [".ini", ".cfg", ".conf"] },
  { id: "yaml", extensions: [".yml", ".yaml"] },
  { id: "shell", extensions: [".sh", ".bash"] },
  { id: "dockerfile", filenames: ["Dockerfile"] },
  { id: "plaintext" },
];

/** Idioma do arquivo: nome exato primeiro (Dockerfile), depois a extensão; senão texto puro. */
export function languageForFile(name: string, languages: LanguageInfo[] = BUILTIN_LANGUAGES) {
  const base = (name.split(/[\\/]/).pop() ?? name).toLowerCase();
  const byName = languages.find((item) =>
    item.filenames?.some((file) => file.toLowerCase() === base),
  );
  if (byName) return byName.id;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "plaintext";
  const ext = base.slice(dot);
  const byExt = languages.find((item) =>
    item.extensions?.some((value) => value.toLowerCase() === ext),
  );
  return byExt?.id ?? "plaintext";
}

/** Idiomas de texto simples abrem no modo "bloco de notas"; o resto no modo código. */
const NOTEPAD_LANGUAGES = new Set(["plaintext", "ini"]);

export function modeOf(language: string): "notepad" | "code" {
  return NOTEPAD_LANGUAGES.has(language) ? "notepad" : "code";
}

export const ENCODING_LABELS: Record<Encoding, string> = {
  "utf-8": "UTF-8",
  "utf-8-bom": "UTF-8 com BOM",
  "utf-16le": "UTF-16 LE",
  "utf-16be": "UTF-16 BE",
  latin1: "Latin-1 (Windows-1252)",
};

export const EOL_LABELS: Record<Eol, string> = { lf: "LF", crlf: "CRLF" };

/** Nome do arquivo sem caminho, para título e diálogos. */
export function baseNameOf(path: string | null | undefined): string {
  if (!path) return "Sem título";
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Zoom do editor em porcentagem (100% = 14 px). */
export const BASE_FONT_SIZE = 14;
export function zoomPercent(fontSize: number): number {
  return Math.round((fontSize / BASE_FONT_SIZE) * 100);
}
export function clampFontSize(size: number): number {
  return Math.min(40, Math.max(8, Math.round(size)));
}

/** Data e hora do F5, como no Bloco de Notas: "14:05 23/10/2026". */
export function stampOf(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())} ${pad(date.getDate())}/${pad(
    date.getMonth() + 1,
  )}/${date.getFullYear()}`;
}

/** Idiomas que o Monaco formata sozinho (Formatar documento). */
export const FORMATTABLE = new Set([
  "json",
  "css",
  "scss",
  "less",
  "html",
  "typescript",
  "javascript",
]);

/** Nomes de texto e código que o editor abre (os downloads ganham o botão "no editor"). */
export const EDITOR_NAME =
  /\.(txt|log|md|markdown|csv|tsv|ini|cfg|conf|json|jsonc|xml|ya?ml|toml|env|ts|tsx|jsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cpp|cs|php|sh|ps1|bat|sql|css|scss|less|vue|svelte)$/i;
