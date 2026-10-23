/**
 * Monaco (5.0.3) carregado só quando o editor abre (o chunk fica fora da casca). Os workers
 * vêm embutidos (`?worker&inline`): a casca roda em file://, então não há como buscar um
 * arquivo do bundle. Temas: "Agzos Dark" (base Dark+, com o vermelho da marca) e
 * "Agzos Light" (segue o tema do app).
 */
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker&inline";
import CssWorker from "monaco-editor/language/css/css.worker.js?worker&inline";
import HtmlWorker from "monaco-editor/language/html/html.worker.js?worker&inline";
import JsonWorker from "monaco-editor/language/json/json.worker.js?worker&inline";
import TsWorker from "monaco-editor/language/typescript/ts.worker.js?worker&inline";

export const DARK_THEME = "agzos-dark";
export const LIGHT_THEME = "agzos-light";

const RED = "#d43420";

let ready: typeof monaco | null = null;

function workerFor(label: string): Worker {
  switch (label) {
    case "json":
      return new JsonWorker();
    case "css":
    case "scss":
    case "less":
      return new CssWorker();
    case "html":
    case "handlebars":
    case "razor":
      return new HtmlWorker();
    case "typescript":
    case "javascript":
      return new TsWorker();
    default:
      return new EditorWorker();
  }
}

function defineThemes(api: typeof monaco) {
  api.editor.defineTheme(DARK_THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "C586C0" },
      { token: "string", foreground: "CE9178" },
      { token: "number", foreground: "B5CEA8" },
      { token: "comment", foreground: "6A9955", fontStyle: "italic" },
      { token: "markup.heading", foreground: "FF6B5B", fontStyle: "bold" },
      { token: "markup.bold", fontStyle: "bold" },
      { token: "markup.italic", fontStyle: "italic" },
      { token: "markup.underline.link", foreground: "4FC1FF" },
    ],
    colors: {
      "editor.background": "#1e1e1e",
      "editorCursor.foreground": "#ff6b5b",
      "editor.lineHighlightBorder": "#2a2a2a",
      "editor.selectionBackground": "#d4332044",
      "editor.findMatchHighlightBackground": "#d4332066",
      "editor.findMatchBackground": "#d43320aa",
      "editorBracketMatch.border": RED,
      "editorBracketHighlight.foreground1": "#ffd700",
      "editorBracketHighlight.foreground2": "#da70d6",
      "editorBracketHighlight.foreground3": "#179fff",
      "editorBracketHighlight.foreground4": "#ff6b5b",
      "editorBracketHighlight.foreground5": "#7fdc7f",
      "editorBracketHighlight.foreground6": "#ff9e4a",
      "editorStickyScroll.background": "#1e1e1e",
      "editorStickyScroll.border": "#333333",
      "editorGutter.background": "#1e1e1e",
      "editorWidget.background": "#252526",
      "editorWidget.border": "#454545",
      focusBorder: RED,
      "minimap.background": "#1e1e1e",
      "scrollbarSlider.activeBackground": "#d4332080",
    },
  });
  api.editor.defineTheme(LIGHT_THEME, {
    base: "vs",
    inherit: true,
    rules: [
      { token: "markup.heading", foreground: RED.slice(1), fontStyle: "bold" },
      { token: "markup.underline.link", foreground: "0451A5" },
    ],
    colors: {
      "editorCursor.foreground": RED,
      "editor.selectionBackground": "#d4332033",
      "editor.findMatchHighlightBackground": "#d4332044",
      "editorBracketMatch.border": RED,
      focusBorder: RED,
      "scrollbarSlider.activeBackground": "#d4332066",
    },
  });
}

/** Carrega o Monaco uma vez (com os temas e os workers). */
export async function loadMonaco(): Promise<typeof monaco> {
  if (ready) return ready;
  // O ambiente é lido na primeira criação de um modelo/editor, então vale antes do import
  // ser usado por qualquer componente.
  (globalThis as { MonacoEnvironment?: unknown }).MonacoEnvironment = {
    getWorker: (_id: string, label: string) => workerFor(label),
  };
  defineThemes(monaco);
  ready = monaco;
  return ready;
}

export function languagesOf(api: typeof monaco) {
  return api.languages
    .getLanguages()
    .map((item) => ({
      id: item.id,
      ...(item.extensions ? { extensions: item.extensions } : {}),
      ...(item.filenames ? { filenames: item.filenames } : {}),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}
