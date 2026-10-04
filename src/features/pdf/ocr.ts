/**
 * OCR local do PDF Tools (4.7): Tesseract (tesseract.js, Apache-2.0) num Web Worker.
 * Núcleo WASM, script do worker e idiomas vêm do app (electron/pdf-tools.cjs lê de
 * dist/ocr ou dos idiomas baixados com consentimento); nada é buscado na rede aqui.
 * O worker sobe por blob: o prefixo carrega o núcleo e responde os pedidos de idioma.
 */
import { OEM, createWorker, type Worker as TesseractWorker } from "tesseract.js";

import type { DesktopBridge } from "@/features/browser/desktop";

import type { OcrWord } from "./engine";

export const OCR_LANGUAGES: { code: string; label: string }[] = [
  { code: "por", label: "Português" },
  { code: "eng", label: "Inglês" },
  { code: "spa", label: "Espanhol" },
  { code: "fra", label: "Francês" },
  { code: "deu", label: "Alemão" },
  { code: "ita", label: "Italiano" },
  { code: "jpn", label: "Japonês" },
  { code: "chi_sim", label: "Chinês simplificado" },
];

const CORE = "tesseract-core-simd-lstm.wasm.js";
const WORKER = "worker.min.js";

export type OcrEngine = {
  recognize(
    image: HTMLCanvasElement,
  ): Promise<{ text: string; words: OcrWord[]; width: number; height: number }>;
  terminate(): Promise<void>;
};

async function asset(desktop: DesktopBridge, name: string, type: string) {
  const data = await desktop.pdfOcrAsset(name);
  if (!data) throw new Error(`Arquivo do OCR ausente: ${name}`);
  return URL.createObjectURL(new Blob([data], { type }));
}

/** Liga o OCR com os idiomas pedidos (os que não existem no app ficam de fora). */
export async function createOcr(
  desktop: DesktopBridge,
  langs: string[],
  onProgress?: (status: string, fraction: number) => void,
): Promise<OcrEngine> {
  const available = await desktop.pdfOcrLanguages();
  const usable = langs.filter(
    (code) => available.bundled.includes(code) || available.downloaded.includes(code),
  );
  if (!usable.length) throw new Error("Nenhum idioma do OCR disponível.");
  const urls: string[] = [];
  try {
    const core = await asset(desktop, CORE, "text/javascript");
    urls.push(core);
    const langUrls: Record<string, string> = {};
    for (const code of usable) {
      langUrls[code] = await asset(desktop, `${code}.traineddata.gz`, "application/gzip");
      urls.push(langUrls[code]!);
    }
    const script = await desktop.pdfOcrAsset(WORKER);
    if (!script) throw new Error("Arquivo do OCR ausente: worker");
    const prefix = `importScripts(${JSON.stringify(core)});
const AGZOS_LANGS = ${JSON.stringify(langUrls)};
const agzosFetch = self.fetch.bind(self);
self.fetch = (input, init) => {
  const match = /^agzos-ocr:\\/*([a-z_]+)\\.traineddata/.exec(String(input));
  return agzosFetch(match && AGZOS_LANGS[match[1]] ? AGZOS_LANGS[match[1]] : input, init);
};
`;
    const workerUrl = URL.createObjectURL(
      new Blob([prefix, new Uint8Array(script)], { type: "text/javascript" }),
    );
    urls.push(workerUrl);
    const worker: TesseractWorker = await createWorker(usable.join("+"), OEM.LSTM_ONLY, {
      workerPath: workerUrl,
      workerBlobURL: false,
      corePath: "agzos-ocr-core",
      langPath: "agzos-ocr:",
      gzip: true,
      cacheMethod: "none",
      logger: (message: { status: string; progress: number }) =>
        onProgress?.(message.status, message.progress),
    });
    return {
      async recognize(image) {
        const result = await worker.recognize(image, {}, { text: true, blocks: true });
        const words: OcrWord[] = [];
        for (const block of result.data.blocks ?? []) {
          for (const paragraph of block.paragraphs) {
            for (const line of paragraph.lines) {
              for (const word of line.words) {
                if (!word.text.trim() || word.confidence < 30) continue;
                words.push({ text: word.text, ...word.bbox });
              }
            }
          }
        }
        return { text: result.data.text ?? "", words, width: image.width, height: image.height };
      },
      async terminate() {
        await worker.terminate().catch(() => {});
        for (const url of urls) URL.revokeObjectURL(url);
      },
    };
  } catch (error) {
    for (const url of urls) URL.revokeObjectURL(url);
    throw error;
  }
}
