import { strokeArrow } from "../annotate/paint";
import {
  colorAffine,
  applyColorAffine,
  keyAlpha,
  needsPixels,
  parseHex,
  sharpenKernel,
  convolve3,
  vignetteAlpha,
} from "./filters";
import { fontCss, layoutLines } from "./text";
import {
  type Asset,
  type Doc,
  type Element,
  type ImageElement,
  type ShapeElement,
  type TextElement,
  type StickerElement,
  type Transform,
} from "./model";

/**
 * Desenho do documento num canvas: o mesmo código monta a tela (com zoom), o PNG/JPEG/WebP
 * exportado e as miniaturas. Fotos são decodificadas uma vez e os ajustes (cor, nitidez,
 * remoção de fundo) são aplicados numa cópia cacheada, nunca na foto original.
 */

const rad = (degrees: number) => (degrees * Math.PI) / 180;
const MAX_PROCESSED_SIDE = 4096;
const MAX_EXPORT_SIDE = 8192;

const BLEND_MAP = (blend: string): GlobalCompositeOperation =>
  (blend === "normal" ? "source-over" : blend) as GlobalCompositeOperation;

/** Fotos decodificadas (por objeto de foto) e versões já ajustadas. */
export class ImageCache {
  private loaded = new WeakMap<Asset, HTMLImageElement>();
  private pending = new WeakMap<Asset, Promise<HTMLImageElement>>();
  private processed = new WeakMap<Asset, Map<string, HTMLCanvasElement>>();

  constructor(private readonly onReady: () => void = () => {}) {}

  /** A foto se já está decodificada; senão começa a carregar e devolve null. */
  get(asset: Asset): HTMLImageElement | null {
    const image = this.loaded.get(asset);
    if (image) return image;
    void this.load(asset).then(
      () => this.onReady(),
      () => {},
    );
    return null;
  }

  load(asset: Asset): Promise<HTMLImageElement> {
    const done = this.loaded.get(asset);
    if (done) return Promise.resolve(done);
    let promise = this.pending.get(asset);
    if (!promise) {
      promise = new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          this.loaded.set(asset, image);
          resolve(image);
        };
        image.onerror = () => reject(new Error("image"));
        image.src = asset.dataUrl;
      });
      this.pending.set(asset, promise);
    }
    return promise;
  }

  /** Foto do elemento já com recorte, remoção de fundo e ajustes de cor/nitidez. */
  processedFor(element: ImageElement, asset: Asset, image: HTMLImageElement): HTMLCanvasElement {
    const crop = element.crop ?? {
      x: 0,
      y: 0,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
    const scale = Math.min(1, MAX_PROCESSED_SIDE / Math.max(crop.width, crop.height));
    const key = [
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      JSON.stringify(element.keyColor),
      JSON.stringify({ ...element.adjust, blur: 0, vignette: 0 }),
    ].join("|");
    let byKey = this.processed.get(asset);
    if (!byKey) {
      byKey = new Map();
      this.processed.set(asset, byKey);
    }
    const cached = byKey.get(key);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(crop.width * scale));
    canvas.height = Math.max(1, Math.round(crop.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context) {
      context.imageSmoothingQuality = "high";
      context.drawImage(
        image,
        crop.x,
        crop.y,
        crop.width,
        crop.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      const needsKey = element.keyColor !== null;
      if (needsKey || needsPixels(element.adjust)) {
        const frame = context.getImageData(0, 0, canvas.width, canvas.height);
        if (element.keyColor) {
          const rgb = parseHex(element.keyColor.color);
          if (rgb) keyAlpha(frame.data, [rgb[0], rgb[1], rgb[2]], element.keyColor.tolerance);
        }
        if (needsPixels(element.adjust)) {
          applyColorAffine(frame.data, colorAffine(element.adjust));
          if (element.adjust.sharpen > 0) {
            frame.data.set(
              convolve3(
                frame.data,
                canvas.width,
                canvas.height,
                sharpenKernel(element.adjust.sharpen),
              ),
            );
          }
        }
        context.putImageData(frame, 0, 0);
      }
    }
    if (byKey.size > 24) byKey.delete(byKey.keys().next().value as string);
    byKey.set(key, canvas);
    return canvas;
  }
}

let measureCanvas: CanvasRenderingContext2D | null = null;

/** Altura que o texto ocupa na caixa atual (quebra pela largura, como no desenho). */
export function fittedTextHeight(text: TextElement): number {
  measureCanvas ??= document.createElement("canvas").getContext("2d");
  const context = measureCanvas;
  if (!context) return text.transform.height;
  const pad = text.background?.padding ?? 0;
  const inset = text.background ? pad : 0;
  context.font = fontCss(text.font, text.weight, text.size);
  const lines = layoutLines(text.text, Math.max(1, text.transform.width - inset * 2), (line) => {
    context.font = fontCss(text.font, text.weight, text.size);
    return context.measureText(line).width;
  });
  return Math.max(text.size, Math.ceil(lines.length * text.size * text.lineHeight) + inset * 2);
}

/** Cor de fundo do elemento: sem cor, nada. */
function paintOf(color: string | null): string | null {
  return color && parseHex(color) ? color : null;
}

function shapePath(context: CanvasRenderingContext2D, shape: ShapeElement) {
  const w = shape.transform.width;
  const h = shape.transform.height;
  const sw = shape.strokeWidth;
  context.beginPath();
  switch (shape.shape) {
    case "rect":
      context.rect(sw / 2, sw / 2, Math.max(0, w - sw), Math.max(0, h - sw));
      break;
    case "round": {
      const radius = Math.min(shape.radius, w / 2, h / 2);
      context.roundRect(
        sw / 2,
        sw / 2,
        Math.max(0, w - sw),
        Math.max(0, h - sw),
        Math.max(0, radius),
      );
      break;
    }
    case "ellipse":
      context.ellipse(
        w / 2,
        h / 2,
        Math.max(0, w / 2 - sw / 2),
        Math.max(0, h / 2 - sw / 2),
        0,
        0,
        Math.PI * 2,
      );
      break;
    case "star":
    case "polygon": {
      const sides = shape.shape === "star" ? shape.sides * 2 : shape.sides;
      const rx = Math.max(0, w / 2 - sw / 2);
      const ry = Math.max(0, h / 2 - sw / 2);
      for (let index = 0; index < sides; index += 1) {
        const ratio = shape.shape === "star" && index % 2 === 1 ? 0.5 : 1;
        const angle = -Math.PI / 2 + (index * 2 * Math.PI) / sides;
        const x = w / 2 + Math.cos(angle) * rx * ratio;
        const y = h / 2 + Math.sin(angle) * ry * ratio;
        if (index) context.lineTo(x, y);
        else context.moveTo(x, y);
      }
      context.closePath();
      break;
    }
    default:
      break;
  }
}

function drawShape(context: CanvasRenderingContext2D, shape: ShapeElement) {
  const w = shape.transform.width;
  const h = shape.transform.height;
  const fill = paintOf(shape.fill);
  const stroke = paintOf(shape.stroke);
  if (shape.shape === "line" || shape.shape === "arrow") {
    const color = stroke ?? fill ?? "#0e0e0e";
    const width = Math.max(1, shape.strokeWidth || 4);
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = width;
    context.lineCap = "round";
    if (shape.shape === "line") {
      context.beginPath();
      context.moveTo(0, 0);
      context.lineTo(w, h);
      context.stroke();
    } else strokeArrow(context, { x: 0, y: 0 }, { x: w, y: h }, width);
    return;
  }
  shapePath(context, shape);
  if (fill) {
    context.fillStyle = fill;
    context.fill();
  }
  if (stroke && shape.strokeWidth > 0) {
    context.strokeStyle = stroke;
    context.lineWidth = shape.strokeWidth;
    context.lineJoin = "round";
    context.stroke();
  }
}

function drawText(context: CanvasRenderingContext2D, text: TextElement) {
  const w = text.transform.width;
  const h = text.transform.height;
  const pad = text.background?.padding ?? 0;
  const inset = text.background ? pad : 0;
  const innerWidth = Math.max(1, w - inset * 2);
  if (text.background) {
    const color = paintOf(text.background.color);
    if (color) {
      context.fillStyle = color;
      context.beginPath();
      context.roundRect(0, 0, w, h, Math.min(text.background.radius, w / 2, h / 2));
      context.fill();
    }
  }
  context.font = fontCss(text.font, text.weight, text.size);
  const lines = layoutLines(text.text, innerWidth, (line) => context.measureText(line).width);
  const lineHeight = text.size * text.lineHeight;
  const x = text.align === "left" ? inset : text.align === "center" ? w / 2 : w - inset;
  context.textAlign = text.align;
  context.textBaseline = "top";
  context.font = fontCss(text.font, text.weight, text.size);
  if (text.shadow) {
    context.shadowColor = paintOf(text.shadow.color) ?? "transparent";
    context.shadowBlur = text.shadow.blur;
    context.shadowOffsetX = text.shadow.x;
    context.shadowOffsetY = text.shadow.y;
  }
  const color = paintOf(text.color) ?? "#0e0e0e";
  if (text.outline && text.outline.width > 0) {
    context.lineJoin = "round";
    context.strokeStyle = paintOf(text.outline.color) ?? "#000000";
    context.lineWidth = text.outline.width;
    lines.forEach((line, index) => context.strokeText(line, x, inset + index * lineHeight));
  }
  context.fillStyle = color;
  lines.forEach((line, index) => context.fillText(line, x, inset + index * lineHeight));
  context.shadowColor = "transparent";
  context.shadowBlur = 0;
  context.shadowOffsetX = 0;
  context.shadowOffsetY = 0;
}

function drawSticker(context: CanvasRenderingContext2D, sticker: StickerElement) {
  const size = Math.min(sticker.transform.width, sticker.transform.height) * 0.85;
  context.font = `${Math.max(1, size)}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#000000";
  context.fillText(sticker.glyph, sticker.transform.width / 2, sticker.transform.height / 2);
}

function drawImage(
  context: CanvasRenderingContext2D,
  element: ImageElement,
  assets: Record<string, Asset>,
  cache: ImageCache,
) {
  const asset = assets[element.asset];
  if (!asset) return;
  const image = cache.get(asset);
  if (!image) return;
  const source = cache.processedFor(element, asset, image);
  const w = element.transform.width;
  const h = element.transform.height;
  context.save();
  if (element.adjust.blur > 0) context.filter = `blur(${element.adjust.blur}px)`;
  context.drawImage(source, 0, 0, w, h);
  context.restore();
  if (element.adjust.vignette > 0) {
    const radius = (Math.min(w, h) / 2) * 1.42;
    const gradient = context.createRadialGradient(
      w / 2,
      h / 2,
      0,
      w / 2,
      h / 2,
      Math.max(1, radius),
    );
    for (let step = 0; step <= 8; step += 1) {
      const t = step / 8;
      gradient.addColorStop(t, `rgba(0,0,0,${vignetteAlpha(t * 1.42, element.adjust.vignette)})`);
    }
    context.fillStyle = gradient;
    context.fillRect(0, 0, w, h);
  }
}

/** Desenha um elemento (já com a caixa, o giro, o espelho, a opacidade e o modo de mistura). */
export function drawElement(
  context: CanvasRenderingContext2D,
  element: Element,
  doc: Doc & { assets?: Record<string, Asset> },
  cache: ImageCache,
): void {
  if (element.hidden) return;
  const t: Transform = element.transform;
  context.save();
  context.globalAlpha = element.opacity;
  context.globalCompositeOperation = BLEND_MAP(element.blend);
  context.translate(t.x + t.width / 2, t.y + t.height / 2);
  context.rotate(rad(t.rotation));
  context.scale(t.flipX ? -1 : 1, t.flipY ? -1 : 1);
  context.translate(-t.width / 2, -t.height / 2);
  switch (element.kind) {
    case "image":
      drawImage(context, element, doc.assets ?? {}, cache);
      break;
    case "shape":
      drawShape(context, element);
      break;
    case "text":
      drawText(context, element);
      break;
    case "sticker":
      drawSticker(context, element);
      break;
  }
  context.restore();
}

export type RenderOptions = {
  assets: Record<string, Asset>;
  cache: ImageCache;
  /** Pinta o fundo do documento (a tela de transparência não pinta). */
  background?: boolean;
};

/** Documento inteiro, em coordenadas do documento (o contexto já vem com zoom/escala). */
export function renderDoc(
  context: CanvasRenderingContext2D,
  doc: Doc,
  options: RenderOptions,
): void {
  context.clearRect(0, 0, doc.width, doc.height);
  if (doc.background && options.background !== false) {
    context.fillStyle = doc.background;
    context.fillRect(0, 0, doc.width, doc.height);
  }
  const withAssets = { ...doc, assets: options.assets };
  for (const element of doc.elements) {
    drawElement(context, element, withAssets, options.cache);
  }
}

export type ExportFormat = "png" | "jpeg" | "webp";
export const EXPORT_MIME: Record<ExportFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

/** Tamanho final da exportação: escala, limitado a um lado máximo que o canvas aguenta. */
export function exportSize(
  doc: Doc,
  scale: number,
): { width: number; height: number; scale: number } {
  const limited = Math.min(scale, MAX_EXPORT_SIDE / Math.max(doc.width, doc.height));
  return {
    width: Math.max(1, Math.round(doc.width * limited)),
    height: Math.max(1, Math.round(doc.height * limited)),
    scale: limited,
  };
}

/** Documento → arquivo. Espera as fotos carregarem antes de desenhar. */
export async function exportDoc(
  doc: Doc,
  assets: Record<string, Asset>,
  cache: ImageCache,
  options: { format: ExportFormat; quality: number; scale: number },
): Promise<Blob> {
  const used = doc.elements.filter((element): element is ImageElement => element.kind === "image");
  await Promise.all(
    used.map((element) => {
      const asset = assets[element.asset];
      return asset ? cache.load(asset) : Promise.resolve(null);
    }),
  );
  const size = exportSize(doc, options.scale);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.setTransform(size.scale, 0, 0, size.scale, 0, 0);
  // JPEG não tem transparência: sem fundo, o branco entra no lugar.
  if (options.format === "jpeg" && !doc.background) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, doc.width, doc.height);
  }
  renderDoc(context, doc, { assets, cache });
  const quality =
    options.format === "png" ? undefined : Math.min(1, Math.max(0.1, options.quality / 100));
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("export"))),
      EXPORT_MIME[options.format],
      quality,
    ),
  );
}
