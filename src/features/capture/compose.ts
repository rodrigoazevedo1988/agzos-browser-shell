import type { CaptureLayer } from "@/features/browser/desktop";

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * Retângulo arrastado (dois pontos, em pixels da imagem) → região dentro da imagem, com
 * largura e altura positivas. Menor que 4 px vira null (foi só um clique).
 */
export function regionOf(
  start: { x: number; y: number },
  end: { x: number; y: number },
  size: { width: number; height: number },
): Rect | null {
  const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
  const x1 = clamp(Math.min(start.x, end.x), size.width);
  const y1 = clamp(Math.min(start.y, end.y), size.height);
  const x2 = clamp(Math.max(start.x, end.x), size.width);
  const y2 = clamp(Math.max(start.y, end.y), size.height);
  const width = Math.round(x2 - x1);
  const height = Math.round(y2 - y1);
  if (width < 4 || height < 4) return null;
  return { x: Math.round(x1), y: Math.round(y1), width, height };
}

/**
 * Escala das camadas: a primeira (a casca, ou a própria guia) define quantos pixels da
 * imagem valem um pixel CSS (telas HiDPI capturam em 2x).
 */
export function layerScale(first: CaptureLayer, naturalWidth: number): number {
  return first.width > 0 && naturalWidth > 0 ? naturalWidth / first.width : 1;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image"));
    image.src = src;
  });
}

/** Camadas (casca + páginas à vista) → um PNG só, na resolução da tela. */
export async function composeLayers(layers: CaptureLayer[]): Promise<string | null> {
  if (!layers.length) return null;
  const images = await Promise.all(layers.map((layer) => loadImage(layer.dataUrl)));
  const scale = layerScale(layers[0]!, images[0]!.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(layers[0]!.width * scale);
  canvas.height = Math.round(layers[0]!.height * scale);
  const context = canvas.getContext("2d");
  if (!context) return null;
  layers.forEach((layer, index) => {
    context.drawImage(
      images[index]!,
      Math.round(layer.x * scale),
      Math.round(layer.y * scale),
      Math.round(layer.width * scale),
      Math.round(layer.height * scale),
    );
  });
  return canvas.toDataURL("image/png");
}

/** Recorte (em pixels da imagem) de um PNG. */
export async function cropPng(dataUrl: string, rect: Rect): Promise<string | null> {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = rect.width;
  canvas.height = rect.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
  return canvas.toDataURL("image/png");
}
