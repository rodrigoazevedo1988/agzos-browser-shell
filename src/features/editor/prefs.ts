/**
 * Preferências do editor (5.0.3): fonte, zoom, quebra automática, minimapa, barra de status,
 * visualização do Markdown e arquivos recentes. Ficam neste navegador (localStorage).
 */
export type EditorView = "split" | "editor" | "preview";

export type EditorPrefs = {
  fontFamily: string;
  fontSize: number;
  wrap: boolean;
  minimap: boolean;
  statusBar: boolean;
  view: EditorView;
  recent: string[];
};

export const FONTS = [
  { label: "Consolas", value: 'Consolas, "Cascadia Mono", Menlo, monospace' },
  { label: "Cascadia Mono", value: '"Cascadia Mono", Consolas, Menlo, monospace' },
  { label: "Courier New", value: '"Courier New", Courier, monospace' },
  { label: "Menlo", value: 'Menlo, Monaco, "DejaVu Sans Mono", monospace' },
];

export const DEFAULT_PREFS: EditorPrefs = {
  fontFamily: FONTS[0]!.value,
  fontSize: 14,
  wrap: false,
  minimap: true,
  statusBar: true,
  view: "split",
  recent: [],
};

const RECENT_LIMIT = 10;

/** Lê as preferências guardadas; o que estiver errado volta ao padrão. */
export function parsePrefs(raw: string | null | undefined): EditorPrefs {
  if (!raw) return { ...DEFAULT_PREFS };
  let value: Partial<EditorPrefs>;
  try {
    value = JSON.parse(raw) as Partial<EditorPrefs>;
  } catch {
    return { ...DEFAULT_PREFS };
  }
  if (typeof value !== "object" || value === null) return { ...DEFAULT_PREFS };
  const fontSize =
    typeof value.fontSize === "number" && value.fontSize >= 8 && value.fontSize <= 40
      ? Math.round(value.fontSize)
      : DEFAULT_PREFS.fontSize;
  const fontFamily = FONTS.some((font) => font.value === value.fontFamily)
    ? (value.fontFamily as string)
    : DEFAULT_PREFS.fontFamily;
  const view: EditorView =
    value.view === "editor" || value.view === "preview" ? value.view : "split";
  return {
    fontFamily,
    fontSize,
    wrap: value.wrap === true,
    minimap: value.minimap !== false,
    statusBar: value.statusBar !== false,
    view,
    recent: Array.isArray(value.recent)
      ? value.recent
          .filter((item): item is string => typeof item === "string")
          .slice(0, RECENT_LIMIT)
      : [],
  };
}

export function readPrefs(): EditorPrefs {
  try {
    return parsePrefs(globalThis.localStorage?.getItem("agzos-editor"));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function writePrefs(prefs: EditorPrefs) {
  try {
    globalThis.localStorage?.setItem("agzos-editor", JSON.stringify(prefs));
  } catch {
    // Armazenamento bloqueado: as preferências valem só nesta sessão.
  }
}

/** Arquivo para o topo da lista de recentes (sem repetir, no máximo dez). */
export function addRecent(recent: string[], file: string): string[] {
  return [file, ...recent.filter((item) => item !== file)].slice(0, RECENT_LIMIT);
}
