import type { Asset } from "./model";
import { ASSET_MIMES } from "./project";

/**
 * Foto → Asset (com as dimensões reais). Ids são curtos e únicos na sessão; ao abrir um
 * projeto, os ids são os do arquivo (o parse já garante que não se repetem).
 */

let counter = 0;
export function newId(prefix = "e"): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function mimeOfDataUrl(dataUrl: string): string | null {
  const match = /^data:([a-z/+.-]+);base64,/i.exec(dataUrl);
  const mime = match?.[1]?.toLowerCase() ?? "";
  return (ASSET_MIMES as readonly string[]).includes(mime) ? mime : null;
}

export function loadDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("image"));
    image.src = dataUrl;
  });
}

/** Data URL de imagem aceita → Asset. Null se o formato não serve ou não decodifica. */
export async function assetFromDataUrl(
  name: string,
  dataUrl: string,
  id = newId("a"),
): Promise<Asset | null> {
  const mime = mimeOfDataUrl(dataUrl);
  if (!mime) return null;
  try {
    const { width, height } = await loadDimensions(dataUrl);
    if (!width || !height) return null;
    return { id, name: name.slice(0, 200), mime, width, height, dataUrl };
  } catch {
    return null;
  }
}
