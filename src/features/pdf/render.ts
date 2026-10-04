/**
 * PDF Tools (4.7): desenhar e ler PDFs com o pdf.js (Apache-2.0). O worker do pdf.js vem
 * embutido (blob), porque a casca roda em file:// e lá o fetch de arquivos não existe.
 */
import { PDFWorker, getDocument, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist";
import PdfJsWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker&inline";

export class RenderPasswordError extends Error {
  constructor(readonly wrong: boolean) {
    super(wrong ? "Senha incorreta." : "Este PDF pede senha.");
  }
}

/** Abre para desenhar (o pdf.js fica com uma cópia: os bytes do chamador não mudam). */
export async function openForRender(
  bytes: Uint8Array,
  password?: string,
): Promise<PDFDocumentProxy> {
  // Um worker por documento: fechar o documento (loadingTask.destroy) encerra só o dele.
  // Com um worker global, fechar o anterior derrubava o do documento novo.
  const port = new PdfJsWorker();
  const task = getDocument({
    worker: new PDFWorker({ port } as unknown as ConstructorParameters<typeof PDFWorker>[0]),
    data: bytes.slice(),
    ...(password ? { password } : {}),
    disableFontFace: false,
  });
  try {
    const doc = await task.promise;
    const destroy = task.destroy.bind(task);
    task.destroy = async () => {
      await destroy();
      port.terminate();
    };
    return doc;
  } catch (error) {
    port.terminate();
    const name = (error as { name?: string })?.name;
    const code = (error as { code?: number })?.code;
    if (name === "PasswordException") throw new RenderPasswordError(code === 2);
    throw error;
  }
}

/** Desenha a página num canvas (escala 1 = 72 dpi). */
export async function renderPage(
  doc: PDFDocumentProxy,
  index: number,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  scale: number,
): Promise<{ width: number; height: number }> {
  const page = await doc.getPage(index + 1);
  const viewport = page.getViewport({ scale });
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const context = canvas.getContext("2d") as CanvasRenderingContext2D | null;
  if (!context) throw new Error("canvas");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport, canvas: canvas as HTMLCanvasElement })
    .promise;
  page.cleanup();
  return { width: canvas.width, height: canvas.height };
}

/** Miniatura (data URL) com a largura pedida. */
export async function thumbnail(doc: PDFDocumentProxy, index: number, width: number) {
  const page = await doc.getPage(index + 1);
  const base = page.getViewport({ scale: 1 });
  const canvas = document.createElement("canvas");
  await renderPage(doc, index, canvas, width / base.width);
  return canvas.toDataURL("image/jpeg", 0.8);
}

/** Texto da página (para PDF→texto, busca e resumo). */
export async function pageText(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  let text = "";
  for (const item of content.items) {
    if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
  }
  return text.replace(/[ \t]+\n/g, "\n").trim();
}

/** Texto de um intervalo de páginas, com "--- Página N ---" entre elas. */
export async function documentText(
  doc: PDFDocumentProxy,
  pages: number[],
  onProgress?: (fraction: number) => void,
  signal?: { cancelled: boolean },
): Promise<string> {
  const parts: string[] = [];
  for (const [step, index] of pages.entries()) {
    if (signal?.cancelled) break;
    const page = await doc.getPage(index + 1);
    parts.push(`--- Página ${index + 1} ---\n${await pageText(page)}`);
    page.cleanup();
    onProgress?.((step + 1) / pages.length);
  }
  return parts.join("\n\n");
}

/** Página → PNG ou JPEG (PDF→imagens), na resolução pedida (dpi). */
export async function pageImage(
  doc: PDFDocumentProxy,
  index: number,
  dpi: number,
  type: "image/png" | "image/jpeg",
): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  await renderPage(doc, index, canvas, dpi / 72);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
  if (!blob) throw new Error("imagem");
  return new Uint8Array(await blob.arrayBuffer());
}
