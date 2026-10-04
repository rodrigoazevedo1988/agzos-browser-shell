/// <reference lib="webworker" />
/**
 * Worker do PDF Tools (4.7): o motor (engine.ts) roda aqui, fora da thread da interface.
 * Recebe { id, op, args } e responde { id, ok, result } / { id, ok: false, error } e,
 * durante a compressão, { id, progress }.
 */
import {
  PdfPasswordError,
  addOcrLayer,
  addWatermark,
  applyEdits,
  compressPdf,
  fillForm,
  imagesToPdf,
  mergePdfs,
  organizePdf,
  pdfInfo,
  protectPdf,
  splitPdf,
  unprotectPdf,
  type ImageRecompressor,
} from "./engine";

declare const self: DedicatedWorkerGlobalScope;

const recompress: ImageRecompressor = async (image) => {
  let bitmap: ImageBitmap;
  if (image.format === "jpeg") {
    bitmap = await createImageBitmap(new Blob([image.bytes as BlobPart], { type: "image/jpeg" }), {
      imageOrientation: "none",
    });
  } else {
    const rgba = new Uint8ClampedArray(image.width * image.height * 4);
    for (let i = 0, p = 0; i < image.width * image.height; i++, p += image.channels) {
      const r = image.bytes[p]!;
      rgba[i * 4] = r;
      rgba[i * 4 + 1] = image.channels === 3 ? image.bytes[p + 1]! : r;
      rgba[i * 4 + 2] = image.channels === 3 ? image.bytes[p + 2]! : r;
      rgba[i * 4 + 3] = 255;
    }
    bitmap = await createImageBitmap(new ImageData(rgba, image.width, image.height));
  }
  const scale = Math.min(1, image.maxSide / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: image.quality });
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
};

async function inflate(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([data as BlobPart])
      .stream()
      .pipeThrough(new DecompressionStream("deflate"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

type Request = { id: number; op: string; args: unknown[] };

const ops: Record<string, (id: number, ...args: never[]) => Promise<unknown>> = {
  info: (_id, bytes: Uint8Array, password?: string) => pdfInfo(bytes, password),
  merge: (_id, inputs: Parameters<typeof mergePdfs>[0]) => mergePdfs(inputs),
  split: (_id, bytes: Uint8Array, groups: number[][], password?: string) =>
    splitPdf(bytes, groups, password),
  organize: (_id, bytes: Uint8Array, ops: Parameters<typeof organizePdf>[1], password?: string) =>
    organizePdf(bytes, ops, password),
  edit: (_id, bytes: Uint8Array, items: Parameters<typeof applyEdits>[1], password?: string) =>
    applyEdits(bytes, items, password),
  watermark: (
    _id,
    bytes: Uint8Array,
    mark: Parameters<typeof addWatermark>[1],
    password?: string,
  ) => addWatermark(bytes, mark, password),
  protect: (_id, bytes: Uint8Array, user: string, owner: string, current?: string) =>
    protectPdf(bytes, user, owner, current),
  unprotect: (_id, bytes: Uint8Array, password: string) => unprotectPdf(bytes, password),
  form: (
    _id,
    bytes: Uint8Array,
    values: Parameters<typeof fillForm>[1],
    flatten: boolean,
    password?: string,
  ) => fillForm(bytes, values, flatten, password),
  images: (_id, images: Parameters<typeof imagesToPdf>[0]) => imagesToPdf(images),
  ocrLayer: (_id, bytes: Uint8Array, pages: Parameters<typeof addOcrLayer>[1], password?: string) =>
    addOcrLayer(bytes, pages, password),
  compress: (id, bytes: Uint8Array, level: Parameters<typeof compressPdf>[1], password?: string) =>
    compressPdf(
      bytes,
      level,
      recompress,
      (done, total) => self.postMessage({ id, progress: total ? done / total : 1 }),
      password,
      inflate,
    ),
};

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, op, args } = event.data;
  const run = ops[op];
  if (!run) {
    self.postMessage({ id, ok: false, error: { message: `Operação desconhecida: ${op}` } });
    return;
  }
  try {
    const result = await run(id, ...(args as never[]));
    const transfer: Transferable[] = [];
    const collect = (value: unknown) => {
      if (value instanceof Uint8Array && value.buffer instanceof ArrayBuffer)
        transfer.push(value.buffer);
    };
    if (Array.isArray(result)) result.forEach(collect);
    else if (result && typeof result === "object" && "bytes" in result)
      collect((result as { bytes: unknown }).bytes);
    else collect(result);
    self.postMessage({ id, ok: true, result }, transfer);
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: {
        message: error instanceof Error ? error.message : String(error),
        password: error instanceof PdfPasswordError ? (error.wrong ? "wrong" : "needed") : null,
      },
    });
  }
};
