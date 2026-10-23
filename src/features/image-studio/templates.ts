import {
  emptyDoc,
  newShape,
  newSticker,
  newText,
  transformAt,
  type Doc,
  type Element,
} from "./model";

/**
 * Tamanhos prontos, marca do Agzos e modelos iniciais (a tela "Criar um design"). Os modelos
 * são documentos montados aqui, sem fotos: o usuário troca textos e imagens.
 */

export type Preset = { id: string; label: string; width: number; height: number };

export const PRESETS: Preset[] = [
  { id: "instagram-post", label: "Post do Instagram", width: 1080, height: 1080 },
  { id: "instagram-story", label: "Story do Instagram", width: 1080, height: 1920 },
  { id: "youtube-thumb", label: "Miniatura do YouTube", width: 1280, height: 720 },
  { id: "a4", label: "A4 (300 dpi)", width: 2480, height: 3508 },
  { id: "facebook-cover", label: "Capa do Facebook", width: 1640, height: 624 },
  { id: "presentation", label: "Apresentação 16:9", width: 1920, height: 1080 },
];

/** Cores da marca (tokens do app: vermelho primário, carvão e os neutros do tema). */
export const BRAND_COLORS: { name: string; hex: string }[] = [
  { name: "Vermelho Agzos", hex: "#D10A11" },
  { name: "Carvão", hex: "#0E0E0E" },
  { name: "Grafite", hex: "#1F1F1F" },
  { name: "Cinza", hex: "#6B6B6B" },
  { name: "Areia", hex: "#F4F2EF" },
  { name: "Branco", hex: "#FFFFFF" },
];

export const STICKERS: string[] = [
  "⭐",
  "🔥",
  "❤️",
  "✅",
  "🚀",
  "💡",
  "🎉",
  "📌",
  "👉",
  "💬",
  "📷",
  "🎯",
  "⚡",
  "🌟",
  "🏆",
  "🎨",
  "📢",
  "🙌",
  "👍",
  "😀",
  "😎",
  "🤩",
  "🥳",
  "💯",
  "🧡",
  "💜",
  "💙",
  "💚",
  "🖤",
  "🌈",
  "☀️",
  "🌙",
  "🍕",
  "☕",
  "🎵",
  "📚",
  "💻",
  "📱",
  "🛒",
  "💰",
];

export const TEMPLATES: { id: string; label: string; hint: string }[] = [
  { id: "post-titulo", label: "Post com título", hint: "Quadrado, faixa vermelha e chamada" },
  {
    id: "story-destaque",
    label: "Story de destaque",
    hint: "Vertical, com círculo e texto grande",
  },
  { id: "miniatura", label: "Miniatura com destaque", hint: "Para vídeo, com figurinha e título" },
];

/** Monta um modelo com ids novos (`nextId`) no tamanho da escolha. */
export function buildTemplate(id: string, nextId: () => string): Doc | null {
  const red = "#D10A11";
  const ink = "#0E0E0E";
  const paper = "#F4F2EF";
  if (id === "post-titulo") {
    const doc = emptyDoc(1080, 1080, paper);
    return {
      ...doc,
      elements: [
        newShape(nextId(), "rect", transformAt(0, 760, 1080, 320), { fill: red, stroke: null }),
        newText(nextId(), transformAt(80, 180, 920, 380), "Seu título aqui", 120, ink),
        newText(nextId(), transformAt(80, 800, 920, 200), "Subtítulo ou chamada", 56, "#FFFFFF"),
      ] as Element[],
    };
  }
  if (id === "story-destaque") {
    const doc = emptyDoc(1080, 1920, ink);
    return {
      ...doc,
      elements: [
        newShape(nextId(), "ellipse", transformAt(140, 520, 800, 800), { fill: red, stroke: null }),
        newText(nextId(), transformAt(90, 1380, 900, 300), "Novidade", 140, "#FFFFFF"),
        newText(nextId(), transformAt(90, 240, 900, 200), "Agzos", 96, red),
      ] as Element[],
    };
  }
  if (id === "miniatura") {
    const doc = emptyDoc(1280, 720, ink);
    return {
      ...doc,
      elements: [
        newShape(nextId(), "rect", transformAt(0, 0, 1280, 16), { fill: red, stroke: null }),
        newText(
          nextId(),
          transformAt(70, 200, 780, 340),
          "Título que chama atenção",
          96,
          "#FFFFFF",
        ),
        newSticker(nextId(), transformAt(930, 220, 240, 240), "🔥", "Figurinha"),
      ] as Element[],
    };
  }
  return null;
}

/** Texto novo com um estilo de título, subtítulo ou corpo, no meio da tela. */
export function textPreset(
  id: string,
  doc: Pick<Doc, "width" | "height">,
  kind: "title" | "subtitle" | "body",
): Element {
  const size = kind === "title" ? 144 : kind === "subtitle" ? 72 : 40;
  const weight = kind === "body" ? 400 : 700;
  const width = Math.round(doc.width * (kind === "title" ? 0.8 : 0.6));
  const label = kind === "title" ? "Título" : kind === "subtitle" ? "Subtítulo" : "Texto";
  const element = newText(
    id,
    transformAt(
      Math.round((doc.width - width) / 2),
      Math.round(doc.height / 2 - size / 2),
      width,
      size * 1.2,
    ),
    label,
    size,
    "#0E0E0E",
  );
  element.weight = weight;
  element.transform.height = Math.ceil(size * 1.2);
  return element;
}
