/**
 * Modelo do Agzos Imagem: um documento (tamanho, fundo e elementos em ordem de empilhamento,
 * o primeiro embaixo) e as operações puras sobre ele (camadas, seleção, alinhamento). As
 * fotos ficam em `assets` (data URLs), fora do documento, e os elementos as referenciam.
 */

export const BLENDS = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
] as const;
export type Blend = (typeof BLENDS)[number];

export type Transform = {
  /** Canto superior esquerdo da caixa sem girar, em pixels do documento. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Graus, sentido horário, em torno do centro da caixa. */
  rotation: number;
  flipX: boolean;
  flipY: boolean;
};

export type Common = {
  id: string;
  name: string;
  transform: Transform;
  /** 0 a 1. */
  opacity: number;
  blend: Blend;
  hidden: boolean;
  locked: boolean;
};

/** Ajustes de cor e efeitos, não destrutivos (o original fica intacto). */
export type Adjust = {
  /** −100 a 100. */
  brightness: number;
  contrast: number;
  saturation: number;
  /** −180 a 180 graus. */
  hue: number;
  /** 0 a 40 px. */
  blur: number;
  /** 0 a 100. */
  sharpen: number;
  grayscale: number;
  sepia: number;
  vignette: number;
};

export type Crop = { x: number; y: number; width: number; height: number };
export type KeyColor = { color: string; tolerance: number };

export type ImageElement = Common & {
  kind: "image";
  asset: string;
  /** Região da foto original (pixels da fonte); null = foto inteira. */
  crop: Crop | null;
  adjust: Adjust;
  /** Remoção de fundo por cor (tolerância 0 a 100). */
  keyColor: KeyColor | null;
};

export const SHAPE_KINDS = [
  "rect",
  "round",
  "ellipse",
  "line",
  "arrow",
  "star",
  "polygon",
] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export type ShapeElement = Common & {
  kind: "shape";
  shape: ShapeKind;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  /** Raio dos cantos (retângulo arredondado), em pixels. */
  radius: number;
  /** Pontas da estrela ou lados do polígono. */
  sides: number;
};

export type Shadow = { color: string; blur: number; x: number; y: number };

export type TextElement = Common & {
  kind: "text";
  text: string;
  font: string;
  weight: number;
  size: number;
  color: string;
  align: "left" | "center" | "right";
  /** Entrelinha, como múltiplo do tamanho. */
  lineHeight: number;
  shadow: Shadow | null;
  outline: { color: string; width: number } | null;
  background: { color: string; padding: number; radius: number } | null;
};

export type StickerElement = Common & { kind: "sticker"; glyph: string };

export type Element = ImageElement | ShapeElement | TextElement | StickerElement;
export type ElementKind = Element["kind"];

export type Doc = {
  width: number;
  height: number;
  /** Cor de fundo, ou null para transparente. */
  background: string | null;
  elements: Element[];
};

export type Asset = {
  id: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  dataUrl: string;
};
export type Assets = Record<string, Asset>;

export const LIMITS = {
  dimension: { min: 16, max: 10000 },
  elements: 500,
  textLength: 20000,
  zoom: { min: 0.05, max: 8 },
} as const;

export const DEFAULT_ADJUST: Adjust = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  hue: 0,
  blur: 0,
  sharpen: 0,
  grayscale: 0,
  sepia: 0,
  vignette: 0,
};

export const ADJUST_KEYS = Object.keys(DEFAULT_ADJUST) as (keyof Adjust)[];

export function isNeutralAdjust(adjust: Adjust) {
  return ADJUST_KEYS.every((key) => adjust[key] === DEFAULT_ADJUST[key]);
}

export function emptyDoc(width = 1080, height = 1080, background: string | null = "#ffffff"): Doc {
  return { width, height, background, elements: [] };
}

export function transformAt(x: number, y: number, width: number, height: number): Transform {
  return { x, y, width, height, rotation: 0, flipX: false, flipY: false };
}

export function findElement(doc: Doc, id: string): Element | undefined {
  return doc.elements.find((element) => element.id === id);
}

export function addElement(doc: Doc, element: Element): Doc {
  return { ...doc, elements: [...doc.elements, element] };
}

export function removeElements(doc: Doc, ids: readonly string[]): Doc {
  const drop = new Set(ids);
  return { ...doc, elements: doc.elements.filter((element) => !drop.has(element.id)) };
}

/** Troca o elemento (por id) com a função; os outros ficam como estão. */
export function mapElements(
  doc: Doc,
  ids: readonly string[],
  change: (element: Element) => Element,
): Doc {
  const pick = new Set(ids);
  return {
    ...doc,
    elements: doc.elements.map((element) => (pick.has(element.id) ? change(element) : element)),
  };
}

/** Atualiza o conteúdo de um elemento, mantendo o tipo (o patch é um Partial do mesmo tipo). */
export function patchElement<T extends Element>(doc: Doc, id: string, patch: Partial<T>): Doc {
  return mapElements(doc, [id], (element) => ({ ...element, ...patch }) as Element);
}

export type Reorder = "forward" | "backward" | "front" | "back";

/**
 * Muda a ordem dos elementos selecionados, mantendo a ordem relativa entre eles. Frente e
 * trás levam ao topo e ao fundo; subir e descer trocam com o vizinho não selecionado.
 */
export function reorder(doc: Doc, ids: readonly string[], direction: Reorder): Doc {
  const pick = new Set(ids);
  const list = [...doc.elements];
  if (direction === "front" || direction === "back") {
    const chosen = list.filter((element) => pick.has(element.id));
    const rest = list.filter((element) => !pick.has(element.id));
    return {
      ...doc,
      elements: direction === "front" ? [...rest, ...chosen] : [...chosen, ...rest],
    };
  }
  if (direction === "forward") {
    for (let index = list.length - 2; index >= 0; index -= 1) {
      const current = list[index]!;
      const above = list[index + 1]!;
      if (pick.has(current.id) && !pick.has(above.id)) {
        list[index] = above;
        list[index + 1] = current;
      }
    }
  } else {
    for (let index = 1; index < list.length; index += 1) {
      const current = list[index]!;
      const below = list[index - 1]!;
      if (pick.has(current.id) && !pick.has(below.id)) {
        list[index] = below;
        list[index - 1] = current;
      }
    }
  }
  return { ...doc, elements: list };
}

/** Duplica os selecionados por cima de tudo, deslocados; devolve os novos ids. */
export function duplicate(
  doc: Doc,
  ids: readonly string[],
  nextId: () => string,
  offset = 24,
): { doc: Doc; ids: string[] } {
  const originals = doc.elements.filter((element) => ids.includes(element.id));
  const copies = originals.map((element) => {
    const copy = {
      ...element,
      id: nextId(),
      transform: {
        ...element.transform,
        x: element.transform.x + offset,
        y: element.transform.y + offset,
      },
    } as Element;
    return copy;
  });
  return {
    doc: { ...doc, elements: [...doc.elements, ...copies] },
    ids: copies.map((copy) => copy.id),
  };
}

/** Move os selecionados (os bloqueados ficam). */
export function moveElements(doc: Doc, ids: readonly string[], dx: number, dy: number): Doc {
  const unlocked = doc.elements.filter((element) => ids.includes(element.id) && !element.locked);
  return mapElements(
    doc,
    unlocked.map((element) => element.id),
    (element) => ({
      ...element,
      transform: { ...element.transform, x: element.transform.x + dx, y: element.transform.y + dy },
    }),
  );
}

export type Align = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** Alinha os selecionados entre si, pela caixa que os envolve (sem girar). */
export function alignElements(doc: Doc, ids: readonly string[], align: Align): Doc {
  const chosen = doc.elements.filter((element) => ids.includes(element.id) && !element.locked);
  if (chosen.length < 2) return doc;
  const left = Math.min(...chosen.map((element) => element.transform.x));
  const top = Math.min(...chosen.map((element) => element.transform.y));
  const right = Math.max(...chosen.map((element) => element.transform.x + element.transform.width));
  const bottom = Math.max(
    ...chosen.map((element) => element.transform.y + element.transform.height),
  );
  return mapElements(
    doc,
    chosen.map((element) => element.id),
    (element) => {
      const t = element.transform;
      let x = t.x;
      let y = t.y;
      if (align === "left") x = left;
      if (align === "right") x = right - t.width;
      if (align === "center") x = (left + right) / 2 - t.width / 2;
      if (align === "top") y = top;
      if (align === "bottom") y = bottom - t.height;
      if (align === "middle") y = (top + bottom) / 2 - t.height / 2;
      return { ...element, transform: { ...t, x, y } };
    },
  );
}

/**
 * Muda o tamanho da tela. Com `center`, o conteúdo acompanha o meio (desloca pela metade da
 * diferença); sem, fica no canto de cima à esquerda.
 */
export function resizeCanvas(doc: Doc, width: number, height: number, center: boolean): Doc {
  const dx = center ? (width - doc.width) / 2 : 0;
  const dy = center ? (height - doc.height) / 2 : 0;
  return {
    ...doc,
    width,
    height,
    elements: doc.elements.map((element) => ({
      ...element,
      transform: {
        ...element.transform,
        x: element.transform.x + dx,
        y: element.transform.y + dy,
      },
    })) as Element[],
  };
}

/** Elemento novo de forma, no centro do documento ou no ponto dado. */
export function newShape(
  id: string,
  shape: ShapeElement["shape"],
  transform: Transform,
  colors: { fill: string | null; stroke: string | null },
): ShapeElement {
  return {
    id,
    kind: "shape",
    name: SHAPE_NAMES[shape],
    shape,
    transform,
    fill: colors.fill,
    stroke: colors.stroke,
    strokeWidth: colors.stroke ? 6 : 0,
    radius: shape === "round" ? 48 : 0,
    sides: shape === "star" ? 5 : 6,
    opacity: 1,
    blend: "normal",
    hidden: false,
    locked: false,
  };
}

export const SHAPE_NAMES: Record<ShapeKind, string> = {
  rect: "Retângulo",
  round: "Retângulo arredondado",
  ellipse: "Elipse",
  line: "Linha",
  arrow: "Seta",
  star: "Estrela",
  polygon: "Polígono",
};

export function newText(
  id: string,
  transform: Transform,
  text: string,
  size: number,
  color: string,
): TextElement {
  return {
    id,
    kind: "text",
    name: text.split("\n")[0]?.slice(0, 32) || "Texto",
    transform,
    text,
    font: "Sans",
    weight: 700,
    size,
    color,
    align: "left",
    lineHeight: 1.2,
    shadow: null,
    outline: null,
    background: null,
    opacity: 1,
    blend: "normal",
    hidden: false,
    locked: false,
  };
}

export function newSticker(
  id: string,
  transform: Transform,
  glyph: string,
  name: string,
): StickerElement {
  return {
    id,
    kind: "sticker",
    name,
    glyph,
    transform,
    opacity: 1,
    blend: "normal",
    hidden: false,
    locked: false,
  };
}

export function newImage(
  id: string,
  asset: Asset,
  transform: Transform,
  name = asset.name,
): ImageElement {
  return {
    id,
    kind: "image",
    name,
    asset: asset.id,
    crop: null,
    adjust: { ...DEFAULT_ADJUST },
    keyColor: null,
    transform,
    opacity: 1,
    blend: "normal",
    hidden: false,
    locked: false,
  };
}

/** Tamanho que cabe no documento mantendo a proporção da foto (ou do recorte). */
export function fitInside(
  width: number,
  height: number,
  bounds: { width: number; height: number },
): { width: number; height: number } {
  const scale = Math.min(bounds.width / width, bounds.height / height, 1);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Caixa do conteúdo: centraliza algo de tamanho `size` no documento. */
export function centered(doc: Doc, size: { width: number; height: number }): Transform {
  return transformAt(
    Math.round((doc.width - size.width) / 2),
    Math.round((doc.height - size.height) / 2),
    size.width,
    size.height,
  );
}
