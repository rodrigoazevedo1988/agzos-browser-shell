import brandSymbolSvg from "@/assets/agzos-symbol-red.svg?raw";
import brandWordmarkSvg from "@/assets/agzos-logo.svg?raw";

import { BRAND_COLORS } from "./templates";

/**
 * Marca Agzos para o editor: o símbolo e a marca escrita (os SVGs do app) viram PNG antes de
 * entrar no documento (o projeto só aceita fotos raster, sem script possível).
 */

export type BrandLogo = "symbol" | "wordmark";

export const BRAND_LOGOS: { id: BrandLogo; label: string; svg: string; width: number }[] = [
  { id: "symbol", label: "Símbolo", svg: brandSymbolSvg, width: 305 },
  { id: "wordmark", label: "Marca escrita", svg: brandWordmarkSvg, width: 478 },
];

export { BRAND_COLORS };

/** SVG → PNG com `pixels` de largura (o lado maior da figura). */
export function rasterizeSvg(
  svg: string,
  pixels: number,
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const source = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    const image = new Image();
    image.onload = () => {
      const ratio =
        image.naturalHeight && image.naturalWidth ? image.naturalHeight / image.naturalWidth : 1;
      const width = Math.round(pixels);
      const height = Math.round(pixels * ratio);
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return reject(new Error("canvas"));
      context.drawImage(image, 0, 0, width, height);
      resolve({ dataUrl: canvas.toDataURL("image/png"), width, height });
    };
    image.onerror = () => reject(new Error("svg"));
    image.src = source;
  });
}

/** Símbolo como data URL SVG (só para a barra; não entra no documento). */
export const brandSymbolSrc = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(brandSymbolSvg)))}`;

export function logoOf(id: BrandLogo) {
  return BRAND_LOGOS.find((logo) => logo.id === id) ?? BRAND_LOGOS[0]!;
}
