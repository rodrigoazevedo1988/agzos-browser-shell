import type { TextElement } from "./model";

/**
 * Texto: fontes (as de sistema que o computador tem, mais as genéricas de reserva), quebra
 * de linha e altura da caixa. A medida vem de fora (`measure`, o canvas no app e uma conta
 * fixa nos testes), então o módulo continua puro.
 */

export type FontChoice = { family: string; stack: string };

/** Lista da casa: famílias comuns com reserva genérica, sempre oferecidas. */
export const FONT_CHOICES: FontChoice[] = [
  { family: "Sans", stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { family: "Serif", stack: 'Georgia, "Times New Roman", serif' },
  { family: "Mono", stack: 'Consolas, "Courier New", monospace' },
  { family: "Arial", stack: "Arial, Helvetica, sans-serif" },
  { family: "Verdana", stack: "Verdana, Geneva, sans-serif" },
  { family: "Trebuchet MS", stack: '"Trebuchet MS", Helvetica, sans-serif' },
  { family: "Impact", stack: 'Impact, "Arial Black", sans-serif' },
  { family: "Georgia", stack: "Georgia, serif" },
  { family: "Times New Roman", stack: '"Times New Roman", Times, serif' },
  { family: "Courier New", stack: '"Courier New", Courier, monospace' },
  { family: "Palatino", stack: '"Palatino Linotype", Palatino, serif' },
  { family: "Garamond", stack: 'Garamond, "Times New Roman", serif' },
  { family: "Futura", stack: 'Futura, "Century Gothic", sans-serif' },
  { family: "Comic Sans MS", stack: '"Comic Sans MS", "Chalkboard SE", cursive' },
];

export const FONT_WEIGHTS = [400, 500, 600, 700, 800] as const;

export function stackOf(family: string): string {
  const known = FONT_CHOICES.find((choice) => choice.family === family);
  if (known) return known.stack;
  // Família do sistema que não está na lista: cita o nome e cai no sans-serif.
  return `"${family.replace(/"/g, "")}", sans-serif`;
}

export function fontCss(family: string, weight: number, size: number): string {
  return `${weight} ${size}px ${stackOf(family)}`;
}

/**
 * Famílias instaladas: uma família existe se medir diferente de uma reserva (o teste é a
 * largura de um texto de letras largas e estreitas, comparada à da fonte monoespaçada).
 */
export function detectInstalled(
  families: string[],
  measure: (font: string, text: string) => number,
): string[] {
  const sample = "mmmmmmmmmmlliWWW";
  const fallback = measure("64px monospace", sample);
  const fallbackSans = measure("64px sans-serif", sample);
  return families.filter((family) => {
    if (FONT_CHOICES.some((choice) => choice.family === family)) return false;
    const width = measure(`64px "${family}", monospace`, sample);
    const widthSans = measure(`64px "${family}", sans-serif`, sample);
    return width !== fallback || widthSans !== fallbackSans;
  });
}

/** Quebra um parágrafo em linhas que cabem em `maxWidth`; palavras longas são cortadas. */
export function wrapParagraph(
  paragraph: string,
  maxWidth: number,
  measure: (line: string) => number,
): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of paragraph.split(" ")) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = "";
    if (measure(word) <= maxWidth) {
      line = word;
      continue;
    }
    // Palavra maior que a caixa: corta por caractere.
    let piece = "";
    for (const char of word) {
      if (piece && measure(piece + char) > maxWidth) {
        lines.push(piece);
        piece = char;
      } else piece += char;
    }
    line = piece;
  }
  lines.push(line);
  return lines;
}

/** Linhas do texto de um elemento (quebras explícitas e quebra automática pela largura). */
export function layoutLines(
  text: string,
  width: number,
  measure: (line: string) => number,
): string[] {
  return text.split("\n").flatMap((paragraph) => wrapParagraph(paragraph, width, measure));
}

/** Altura da caixa do texto: linhas × entrelinha (mais o respiro da cor de fundo). */
export function textHeight(
  element: Pick<TextElement, "size" | "lineHeight" | "background">,
  lines: number,
): number {
  const pad = element.background ? element.background.padding * 2 : 0;
  return Math.max(element.size, Math.ceil(lines * element.size * element.lineHeight) + pad);
}

/** Fontes comuns de sistema que podem estar instaladas (a lista só mostra as que existem). */
export const SYSTEM_FONT_CANDIDATES = [
  "Segoe UI",
  "Helvetica Neue",
  "Calibri",
  "Cambria",
  "Tahoma",
  "Gill Sans",
  "Franklin Gothic",
  "Baskerville",
  "Century Gothic",
  "Optima",
  "Avenir",
  "Ubuntu",
  "DejaVu Sans",
  "Liberation Sans",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Poppins",
  "Noto Sans",
];

let cachedFamilies: string[] | null = null;

/**
 * Famílias para escolher: a lista da casa mais as fontes de sistema detectadas (medidas no
 * canvas uma vez, na primeira abertura do editor).
 */
export function fontFamilies(): string[] {
  if (cachedFamilies) return cachedFamilies;
  const families = FONT_CHOICES.map((choice) => choice.family);
  if (typeof document === "undefined") return families;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return families;
  const installed = detectInstalled(SYSTEM_FONT_CANDIDATES, (font, text) => {
    context.font = font;
    return context.measureText(text).width;
  });
  cachedFamilies = [...families, ...installed];
  return cachedFamilies;
}
