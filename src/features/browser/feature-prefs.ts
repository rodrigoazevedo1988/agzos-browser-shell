/**
 * 4.7: preferências de Configurações > Recursos (downloads, tema da página, ColorTools e
 * PDF Tools) e os atalhos configuráveis delas. Ficam em `prefs.features`.
 */

/** Claro, escuro ou o mesmo tema do navegador. */
export type UiTheme = "light" | "dark" | "browser";
export type AutoCopy = "hex" | "rgb" | "hsl" | "off";

export type FeatureShortcutId =
  "colors.eyedropper" | "colors.panel" | "pdf.open" | "page-theme.toggle";

export const FEATURE_SHORTCUTS: { id: FeatureShortcutId; label: string; fallback: string }[] = [
  { id: "colors.eyedropper", label: "ColorTools: conta-gotas", fallback: "alt+shift+c" },
  { id: "colors.panel", label: "ColorTools: abrir o painel", fallback: "" },
  // Ctrl+Shift+P já é o picture-in-picture: o PDF Tools nasce em Ctrl+Alt+P.
  { id: "pdf.open", label: "PDF Tools: abrir", fallback: "mod+alt+p" },
  { id: "page-theme.toggle", label: "Tema da página: Dark/Lightning", fallback: "alt+shift+d" },
];

export type FeaturePrefs = {
  downloadsTheme: UiTheme;
  colors: { autoCopy: AutoCopy; theme: UiTheme; historyLimit: number };
  pdf: {
    /** Limite de tamanho para abrir/processar offline (MB). */
    maxMb: number;
    /** Salvar na nuvem (pastas do Google Drive, Dropbox e OneDrive do computador). */
    cloud: boolean;
    /** Resumo com o Agzos AI (o texto do PDF vai para a Groq, com confirmação). */
    ai: boolean;
    /** Painel lateral ou janela por cima da página. */
    dock: "side" | "modal";
    /** Idiomas do OCR, na ordem ("por+eng"). */
    ocrLangs: string[];
  };
  /** Combos no formato do main ("mod+alt+p"); "" desliga. */
  shortcuts: Record<FeatureShortcutId, string>;
};

export const PDF_MAX_MB = { min: 5, max: 500, initial: 50 } as const;

export const defaultFeaturePrefs: FeaturePrefs = {
  downloadsTheme: "browser",
  colors: { autoCopy: "hex", theme: "browser", historyLimit: 60 },
  pdf: {
    maxMb: PDF_MAX_MB.initial,
    cloud: false,
    ai: false,
    dock: "side",
    ocrLangs: ["por", "eng"],
  },
  shortcuts: Object.fromEntries(
    FEATURE_SHORTCUTS.map((item) => [item.id, item.fallback]),
  ) as Record<FeatureShortcutId, string>,
};

const MODIFIERS = ["mod", "alt", "shift"] as const;
const COMBO = /^(?:(?:mod|alt|shift)\+){1,3}(?:[a-z0-9]|f(?:[1-9]|1[0-2])|[[\];',./`=-])$/;

/** Combo válido: ao menos um modificador e uma tecla, na ordem mod+alt+shift+tecla. */
export function cleanCombo(value: unknown): string | null {
  if (value === "") return "";
  if (typeof value !== "string") return null;
  const parts = value.toLowerCase().split("+").filter(Boolean);
  const key = parts.pop();
  if (!key) return null;
  const mods = MODIFIERS.filter((mod) => parts.includes(mod));
  // Só modificadores conhecidos, cada um uma vez.
  if (!mods.length || parts.length !== mods.length) return null;
  const combo = [...mods, key].join("+");
  // Só Shift + letra digitaria uma maiúscula.
  if (mods.length === 1 && mods[0] === "shift") return null;
  return COMBO.test(combo) ? combo : null;
}

/** Combo de um KeyboardEvent (para gravar o atalho na tela de Configurações). */
export function comboOfEvent(event: {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): string | null {
  if (["Control", "Meta", "Alt", "Shift"].includes(event.key)) return null;
  const code = /^(?:Key([A-Z])|Digit(\d))$/.exec(event.code ?? "");
  const key = code ? (code[1] ?? code[2])!.toLowerCase() : event.key.toLowerCase();
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("mod");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  parts.push(key);
  return cleanCombo(parts.join("+"));
}

/** "mod+alt+p" → "Ctrl+Alt+P" (ou "⌘⌥P" no Mac). */
export function comboLabel(combo: string, mac: boolean): string {
  if (!combo) return "Desligado";
  const parts = combo.split("+");
  const key = parts.pop()!.toUpperCase();
  const names = mac
    ? { mod: "⌘", alt: "⌥", shift: "⇧" }
    : { mod: "Ctrl+", alt: "Alt+", shift: "Shift+" };
  return parts.map((part) => names[part as keyof typeof names]).join("") + key;
}

/** Atalho do evento de tecla do main (agzos:hotkey) no mesmo formato. */
export function comboOfHotkey(payload: {
  key: string;
  shift: boolean;
  alt: boolean;
  meta: boolean;
  ctrl: boolean;
}): string {
  const parts: string[] = [];
  if (payload.ctrl || payload.meta) parts.push("mod");
  if (payload.alt) parts.push("alt");
  if (payload.shift) parts.push("shift");
  parts.push(payload.key.toLowerCase());
  return parts.join("+");
}

/** Qual recurso tem este combo (null: nenhum). */
export function featureOfCombo(
  shortcuts: FeaturePrefs["shortcuts"],
  combo: string,
): FeatureShortcutId | null {
  const found = FEATURE_SHORTCUTS.find(
    (item) => shortcuts[item.id] && shortcuts[item.id] === combo,
  );
  return found?.id ?? null;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const theme = (value: unknown, fallback: UiTheme): UiTheme =>
  value === "light" || value === "dark" || value === "browser" ? value : fallback;

const OCR_LANG = /^[a-z]{3}(?:_[a-z]{3,4})?$/;

export function parseFeaturePrefs(value: unknown): FeaturePrefs {
  const raw = isObject(value) ? value : {};
  const colors = isObject(raw["colors"]) ? raw["colors"] : {};
  const pdf = isObject(raw["pdf"]) ? raw["pdf"] : {};
  const shortcuts = isObject(raw["shortcuts"]) ? raw["shortcuts"] : {};
  const autoCopy = colors["autoCopy"];
  const maxMb = pdf["maxMb"];
  const limit = colors["historyLimit"];
  const langs = Array.isArray(pdf["ocrLangs"])
    ? [
        ...new Set(
          pdf["ocrLangs"].filter(
            (item): item is string => typeof item === "string" && OCR_LANG.test(item),
          ),
        ),
      ].slice(0, 4)
    : [];
  const parsedShortcuts = {} as Record<FeatureShortcutId, string>;
  const used = new Set<string>();
  for (const item of FEATURE_SHORTCUTS) {
    const combo = item.id in shortcuts ? cleanCombo(shortcuts[item.id]) : item.fallback;
    const next = combo ?? item.fallback;
    // Dois recursos no mesmo combo: o segundo fica sem atalho.
    parsedShortcuts[item.id] = next && used.has(next) ? "" : next;
    if (next) used.add(next);
  }
  return {
    downloadsTheme: theme(raw["downloadsTheme"], defaultFeaturePrefs.downloadsTheme),
    colors: {
      autoCopy:
        autoCopy === "hex" || autoCopy === "rgb" || autoCopy === "hsl" || autoCopy === "off"
          ? autoCopy
          : defaultFeaturePrefs.colors.autoCopy,
      theme: theme(colors["theme"], defaultFeaturePrefs.colors.theme),
      historyLimit:
        typeof limit === "number" && Number.isFinite(limit)
          ? Math.round(Math.min(500, Math.max(10, limit)))
          : defaultFeaturePrefs.colors.historyLimit,
    },
    pdf: {
      maxMb:
        typeof maxMb === "number" && Number.isFinite(maxMb)
          ? Math.round(Math.min(PDF_MAX_MB.max, Math.max(PDF_MAX_MB.min, maxMb)))
          : PDF_MAX_MB.initial,
      cloud: pdf["cloud"] === true,
      ai: pdf["ai"] === true,
      dock: pdf["dock"] === "modal" ? "modal" : "side",
      ocrLangs: langs.length ? langs : defaultFeaturePrefs.pdf.ocrLangs,
    },
    shortcuts: parsedShortcuts,
  };
}

/** Escuro de verdade para um tema "segue o navegador". */
export function themeIsDark(value: UiTheme, browserDark: boolean): boolean {
  return value === "browser" ? browserDark : value === "dark";
}
