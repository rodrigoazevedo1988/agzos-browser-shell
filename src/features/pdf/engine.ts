/**
 * PDF Tools (4.7): o motor. Roda no Web Worker (worker.ts), fora da thread da interface;
 * também roda no Node (testes). Usa @cantoo/pdf-lib (MIT): juntar, dividir, organizar,
 * girar, recortar, marca-d'água, editar (texto, imagem, formas, anotação, assinatura),
 * formulário, senha AES-256, comprimir e camada de texto do OCR. Nada sai do computador.
 */
import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFOptionList,
  PDFPage,
  PDFRadioGroup,
  PDFRawStream,
  PDFRef,
  PDFString,
  PDFTextField,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
} from "@cantoo/pdf-lib";

export type PageBox = { width: number; height: number; rotation: number };

export type FormField =
  | { name: string; type: "text"; value: string; multiline: boolean }
  | { name: string; type: "checkbox"; value: boolean }
  | { name: string; type: "choice"; value: string; options: string[] }
  | { name: string; type: "unsupported"; value: null };

export type PdfInfo = {
  pages: PageBox[];
  encrypted: boolean;
  title: string;
  fields: FormField[];
};

/** Retângulo em frações (0–1) da página como ela aparece (com a rotação), do canto de cima. */
export type FractionBox = { x: number; y: number; w: number; h: number };

export type EditItem =
  | { kind: "text"; page: number; box: FractionBox; text: string; color: string; size: number }
  | { kind: "image"; page: number; box: FractionBox; png: Uint8Array }
  | { kind: "signature"; page: number; box: FractionBox; png: Uint8Array }
  | {
      kind: "rect" | "ellipse";
      page: number;
      box: FractionBox;
      color: string;
      fill: boolean;
      width: number;
    }
  | { kind: "line"; page: number; box: FractionBox; color: string; width: number }
  | { kind: "highlight"; page: number; box: FractionBox; color: string }
  /** Comentário de verdade (anotação /Text do PDF), com o texto no balão. */
  | { kind: "comment"; page: number; box: FractionBox; text: string; author: string };

export type Watermark = {
  text: string;
  size: number;
  opacity: number;
  color: string;
  angle: number;
  /** Páginas (índices a partir de 0); vazio = todas. */
  pages: number[];
};

export type CompressLevel = "weak" | "balanced" | "strong";

/** Recompressão de uma imagem (no worker: OffscreenCanvas). null = deixa como está. */
export type ImageRecompressor = (image: {
  bytes: Uint8Array;
  /** "jpeg": bytes do JPEG; "raw": pixels RGB/cinza de 8 bits. */
  format: "jpeg" | "raw";
  width: number;
  height: number;
  channels: 1 | 3;
  quality: number;
  maxSide: number;
}) => Promise<{ bytes: Uint8Array; width: number; height: number } | null>;

export const COMPRESS_LEVELS: Record<
  CompressLevel,
  { quality: number; maxSide: number; raw: boolean }
> = {
  weak: { quality: 0.85, maxSide: 3000, raw: false },
  balanced: { quality: 0.72, maxSide: 2000, raw: true },
  strong: { quality: 0.5, maxSide: 1300, raw: true },
};

export class PdfPasswordError extends Error {
  constructor(readonly wrong: boolean) {
    super(wrong ? "Senha incorreta." : "Este PDF pede senha.");
  }
}

/** Abre o PDF (com a senha, se tiver). Senha errada ou faltando: PdfPasswordError. */
export async function loadPdf(bytes: Uint8Array, password?: string): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, password ? { password } : { updateMetadata: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/encrypted/i.test(message)) throw new PdfPasswordError(false);
    if (/password/i.test(message)) throw new PdfPasswordError(true);
    throw error;
  }
}

/** O PDF tem senha? (sem decifrar). */
export async function isEncrypted(bytes: Uint8Array): Promise<boolean> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  return doc.isEncrypted;
}

/** "1-3, 5, 8-" → índices (a partir de 0) dentro de `total`, sem repetir, na ordem dada. */
export function parsePageRanges(text: string, total: number): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const part of text.split(/[,;\s]+/).filter(Boolean)) {
    const match = /^(\d*)\s*-\s*(\d*)$/.exec(part) ?? /^(\d+)$/.exec(part);
    if (!match) continue;
    const single = match.length === 2;
    const start = single ? Number(match[1]) : match[1] ? Number(match[1]) : 1;
    const end = single ? Number(match[1]) : match[2] ? Number(match[2]) : total;
    const step = start <= end ? 1 : -1;
    for (let page = start; step > 0 ? page <= end : page >= end; page += step) {
      if (page >= 1 && page <= total && !seen.has(page - 1)) {
        seen.add(page - 1);
        out.push(page - 1);
      }
    }
  }
  return out;
}

function fieldOf(
  field: ReturnType<ReturnType<PDFDocument["getForm"]>["getFields"]>[number],
): FormField {
  const name = field.getName();
  if (field instanceof PDFTextField) {
    return { name, type: "text", value: field.getText() ?? "", multiline: field.isMultiline() };
  }
  if (field instanceof PDFCheckBox) return { name, type: "checkbox", value: field.isChecked() };
  if (field instanceof PDFDropdown || field instanceof PDFOptionList) {
    return {
      name,
      type: "choice",
      value: field.getSelected()[0] ?? "",
      options: field.getOptions(),
    };
  }
  if (field instanceof PDFRadioGroup) {
    return { name, type: "choice", value: field.getSelected() ?? "", options: field.getOptions() };
  }
  return { name, type: "unsupported", value: null };
}

export async function pdfInfo(bytes: Uint8Array, password?: string): Promise<PdfInfo> {
  const encrypted = await isEncrypted(bytes);
  const doc = await loadPdf(bytes, password);
  let fields: FormField[] = [];
  try {
    fields = doc.getForm().getFields().map(fieldOf);
  } catch {
    fields = [];
  }
  return {
    encrypted,
    title: doc.getTitle() ?? "",
    fields,
    pages: doc.getPages().map((page) => {
      const box = page.getCropBox();
      return {
        width: box.width,
        height: box.height,
        rotation: normalizeRotation(page.getRotation().angle),
      };
    }),
  };
}

function normalizeRotation(angle: number) {
  return (((Math.round(angle / 90) * 90) % 360) + 360) % 360;
}

/** Tira o dicionário de cifra que sobra depois de decifrar (senão o PDF salvo "pede senha"). */
function dropEncryption(doc: PDFDocument) {
  const context = doc.context;
  delete (context.trailerInfo as { Encrypt?: unknown }).Encrypt;
  for (const [ref, object] of context.enumerateIndirectObjects()) {
    if (
      object instanceof PDFDict &&
      object.get(PDFName.of("Filter"))?.toString() === "/Standard" &&
      (object.has(PDFName.of("O")) || object.has(PDFName.of("CF")))
    ) {
      context.delete(ref);
    }
  }
}

async function save(doc: PDFDocument): Promise<Uint8Array> {
  return doc.save({ useObjectStreams: true });
}

export type MergeInput = { bytes: Uint8Array; password?: string; pages?: number[] };

/** Junta os PDFs na ordem (cada um com as páginas escolhidas ou todas). */
export async function mergePdfs(inputs: MergeInput[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const input of inputs) {
    const source = await loadPdf(input.bytes, input.password);
    const indices = input.pages?.length ? input.pages : source.getPageIndices();
    const pages = await out.copyPages(source, indices);
    for (const page of pages) out.addPage(page);
  }
  return save(out);
}

/** Um PDF por grupo de páginas. */
export async function splitPdf(
  bytes: Uint8Array,
  groups: number[][],
  password?: string,
): Promise<Uint8Array[]> {
  const source = await loadPdf(bytes, password);
  const results: Uint8Array[] = [];
  for (const group of groups) {
    const valid = group.filter((index) => index >= 0 && index < source.getPageCount());
    if (!valid.length) continue;
    const out = await PDFDocument.create();
    for (const page of await out.copyPages(source, valid)) out.addPage(page);
    results.push(await save(out));
  }
  return results;
}

/** Um PDF por página ou a cada N páginas. */
export function chunkPages(total: number, size: number): number[][] {
  const step = Math.max(1, Math.floor(size));
  const groups: number[][] = [];
  for (let start = 0; start < total; start += step) {
    groups.push(Array.from({ length: Math.min(step, total - start) }, (_v, i) => start + i));
  }
  return groups;
}

export type OrganizeOps = {
  /** Nova ordem (índices originais); o que faltar sai do PDF. */
  order: number[];
  /** Graus a somar por índice original (múltiplos de 90). */
  rotate?: Record<number, number>;
  /** Recorte por índice original, em frações da página como aparece. */
  crop?: Record<number, FractionBox>;
};

/** Reordena, apaga, gira e recorta páginas, mantendo formulários e marcadores. */
export async function organizePdf(
  bytes: Uint8Array,
  ops: OrganizeOps,
  password?: string,
): Promise<Uint8Array> {
  const doc = await loadPdf(bytes, password);
  const total = doc.getPageCount();
  const order = ops.order.filter((index) => index >= 0 && index < total);
  if (!order.length) throw new Error("O PDF precisa de ao menos uma página.");
  const pages = doc.getPages();
  for (const [key, delta] of Object.entries(ops.rotate ?? {})) {
    const page = pages[Number(key)];
    if (page && delta % 90 === 0) {
      page.setRotation(degrees(normalizeRotation(page.getRotation().angle + delta)));
    }
  }
  for (const [key, box] of Object.entries(ops.crop ?? {})) {
    const page = pages[Number(key)];
    if (!page) continue;
    const rect = pdfRectOf(page, clampBox(box));
    page.setCropBox(rect.left, rect.bottom, rect.right - rect.left, rect.top - rect.bottom);
  }
  const unchanged = order.length === total && order.every((index, i) => index === i);
  if (!unchanged) {
    // Nova ordem direto na árvore de páginas (mantém formulário e marcadores). A mesma
    // página duas vezes vira uma cópia.
    const used = new Set<number>();
    const refs: PDFRef[] = [];
    for (const index of order) {
      if (!used.has(index)) {
        used.add(index);
        refs.push(pages[index]!.ref);
      } else {
        const [copy] = await doc.copyPages(doc, [index]);
        refs.push(copy!.ref);
      }
    }
    const rootRef = doc.catalog.get(PDFName.of("Pages"));
    const root = doc.catalog.Pages();
    root.set(PDFName.of("Kids"), doc.context.obj(refs));
    root.set(PDFName.of("Count"), PDFNumber.of(refs.length));
    for (const ref of refs) {
      const node = doc.context.lookup(ref, PDFDict);
      if (rootRef) node.set(PDFName.of("Parent"), rootRef);
    }
  }
  return save(doc);
}

function clampBox(box: FractionBox): FractionBox {
  const x = Math.min(1, Math.max(0, box.x));
  const y = Math.min(1, Math.max(0, box.y));
  return {
    x,
    y,
    w: Math.min(1 - x, Math.max(0.001, box.w)),
    h: Math.min(1 - y, Math.max(0.001, box.h)),
  };
}

/** Ponto da página como aparece (frações) → ponto do PDF (sem rotação). */
export function pdfPointOf(page: PDFPage, fx: number, fy: number): { x: number; y: number } {
  const crop = page.getCropBox();
  const rotation = normalizeRotation(page.getRotation().angle);
  const w = crop.width;
  const h = crop.height;
  const shownW = rotation % 180 === 0 ? w : h;
  const shownH = rotation % 180 === 0 ? h : w;
  const dx = fx * shownW;
  const dy = fy * shownH;
  let x: number;
  let y: number;
  switch (rotation) {
    case 90:
      x = dy;
      y = dx;
      break;
    case 180:
      x = w - dx;
      y = dy;
      break;
    case 270:
      x = w - dy;
      y = h - dx;
      break;
    default:
      x = dx;
      y = h - dy;
  }
  return { x: crop.x + x, y: crop.y + y };
}

function pdfRectOf(page: PDFPage, box: FractionBox) {
  const a = pdfPointOf(page, box.x, box.y);
  const b = pdfPointOf(page, box.x + box.w, box.y + box.h);
  return {
    left: Math.min(a.x, b.x),
    right: Math.max(a.x, b.x),
    bottom: Math.min(a.y, b.y),
    top: Math.max(a.y, b.y),
  };
}

/**
 * Onde desenhar uma caixa (frações da página como aparece): canto de baixo à esquerda no
 * PDF, tamanho em pontos e a rotação que deixa o desenho em pé na página girada.
 */
export function placementOf(page: PDFPage, box: FractionBox) {
  const clean = clampBox(box);
  const rotation = normalizeRotation(page.getRotation().angle);
  const crop = page.getCropBox();
  const shownW = rotation % 180 === 0 ? crop.width : crop.height;
  const shownH = rotation % 180 === 0 ? crop.height : crop.width;
  const origin = pdfPointOf(page, clean.x, clean.y + clean.h);
  return {
    x: origin.x,
    y: origin.y,
    width: clean.w * shownW,
    height: clean.h * shownH,
    rotation,
  };
}

/** Desloca (dx, dy) do sistema da caixa para o do PDF (a caixa pode estar girada). */
function offset(place: { x: number; y: number; rotation: number }, dx: number, dy: number) {
  const r = (place.rotation * Math.PI) / 180;
  return {
    x: place.x + dx * Math.cos(r) - dy * Math.sin(r),
    y: place.y + dx * Math.sin(r) + dy * Math.cos(r),
  };
}

export function colorOf(hex: string) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  const value = match ? parseInt(match[1]!, 16) : 0;
  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

/** Só o que a Helvetica padrão (WinAnsi) desenha; o resto vira "?". */
export function winAnsiText(text: string): string {
  return [...text]
    .map((char) => {
      const code = char.codePointAt(0)!;
      if (char === "\n" || char === "\t") return char;
      if (code >= 0x20 && code <= 0x7e) return char;
      if (code >= 0xa0 && code <= 0xff) return char;
      if ("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ".includes(char)) return char;
      return "?";
    })
    .join("");
}

function wrapLines(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of winAnsiText(text).split("\n")) {
    let line = "";
    for (const word of paragraph.split(/(\s+)/)) {
      const next = line + word;
      if (line && font.widthOfTextAtSize(next.trimEnd(), size) > width) {
        lines.push(line.trimEnd());
        line = word.trimStart();
      } else line = next;
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function addCommentAnnotation(
  doc: PDFDocument,
  page: PDFPage,
  item: Extract<EditItem, { kind: "comment" }>,
) {
  const rect = pdfRectOf(page, {
    ...item.box,
    w: Math.max(item.box.w, 0.02),
    h: Math.max(item.box.h, 0.02),
  });
  const annotation = doc.context.obj({
    Type: "Annot",
    Subtype: "Text",
    Rect: [rect.left, rect.top - 24, rect.left + 24, rect.top],
    Contents: PDFHexString.fromText(item.text.slice(0, 4000)),
    T: PDFHexString.fromText(item.author.slice(0, 120) || "Agzos"),
    M: PDFString.fromDate(new Date()),
    Name: "Comment",
    C: [1, 0.82, 0.2],
    F: 4,
  });
  const ref = doc.context.register(annotation);
  const annots = page.node.lookup(PDFName.of("Annots"));
  if (annots instanceof PDFArray) annots.push(ref);
  else page.node.set(PDFName.of("Annots"), doc.context.obj([ref]));
}

/** Editor: aplica os itens desenhados por cima das páginas. */
export async function applyEdits(
  bytes: Uint8Array,
  items: EditItem[],
  password?: string,
): Promise<Uint8Array> {
  const doc = await loadPdf(bytes, password);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  for (const item of items) {
    const page = pages[item.page];
    if (!page) continue;
    if (item.kind === "comment") {
      addCommentAnnotation(doc, page, item);
      continue;
    }
    const place = placementOf(page, item.box);
    const rotate = degrees(place.rotation);
    switch (item.kind) {
      case "text": {
        const size = Math.min(144, Math.max(4, item.size));
        const lines = wrapLines(item.text, font, size, Math.max(size, place.width));
        lines.forEach((line, index) => {
          const at = offset(place, 0, place.height - size * (index + 1) * 1.18 + size * 0.2);
          page.drawText(line, { x: at.x, y: at.y, size, font, color: colorOf(item.color), rotate });
        });
        break;
      }
      case "image":
      case "signature": {
        const image = await doc.embedPng(item.png);
        page.drawImage(image, {
          x: place.x,
          y: place.y,
          width: place.width,
          height: place.height,
          rotate,
        });
        break;
      }
      case "rect":
        page.drawRectangle({
          x: place.x,
          y: place.y,
          width: place.width,
          height: place.height,
          rotate,
          borderColor: colorOf(item.color),
          borderWidth: item.width,
          ...(item.fill ? { color: colorOf(item.color) } : {}),
        });
        break;
      case "ellipse": {
        const center = offset(place, place.width / 2, place.height / 2);
        page.drawEllipse({
          x: center.x,
          y: center.y,
          xScale: place.width / 2,
          yScale: place.height / 2,
          rotate,
          borderColor: colorOf(item.color),
          borderWidth: item.width,
          ...(item.fill ? { color: colorOf(item.color) } : {}),
        });
        break;
      }
      case "line": {
        const start = offset(place, 0, place.height);
        const end = offset(place, place.width, 0);
        page.drawLine({ start, end, thickness: item.width, color: colorOf(item.color) });
        break;
      }
      case "highlight":
        page.drawRectangle({
          x: place.x,
          y: place.y,
          width: place.width,
          height: place.height,
          rotate,
          color: colorOf(item.color),
          opacity: 0.35,
        });
        break;
    }
  }
  return save(doc);
}

/** Marca-d'água de texto no meio das páginas. */
export async function addWatermark(
  bytes: Uint8Array,
  mark: Watermark,
  password?: string,
): Promise<Uint8Array> {
  const doc = await loadPdf(bytes, password);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const text = winAnsiText(mark.text).replace(/\n/g, " ").slice(0, 200);
  if (!text.trim()) throw new Error("Escreva o texto da marca-d'água.");
  const wanted = new Set(mark.pages);
  doc.getPages().forEach((page, index) => {
    if (wanted.size && !wanted.has(index)) return;
    const size = Math.min(200, Math.max(8, mark.size));
    const width = font.widthOfTextAtSize(text, size);
    const center = placementOf(page, { x: 0.5, y: 0.5, w: 0, h: 0 });
    const angle = center.rotation + mark.angle;
    const r = (angle * Math.PI) / 180;
    page.drawText(text, {
      x: center.x - (width / 2) * Math.cos(r) + (size / 3) * Math.sin(r),
      y: center.y - (width / 2) * Math.sin(r) - (size / 3) * Math.cos(r),
      size,
      font,
      color: colorOf(mark.color),
      opacity: Math.min(1, Math.max(0.05, mark.opacity)),
      rotate: degrees(angle),
    });
  });
  return save(doc);
}

/** Senha AES-256 (abrir) e, se dada, senha de dono (permissões). */
export async function protectPdf(
  bytes: Uint8Array,
  userPassword: string,
  ownerPassword: string,
  currentPassword?: string,
): Promise<Uint8Array> {
  if (!userPassword) throw new Error("Escolha uma senha.");
  const doc = await loadPdf(bytes, currentPassword);
  if (currentPassword) dropEncryption(doc);
  doc.encrypt({
    userPassword,
    ownerPassword: ownerPassword || userPassword,
    permissions: { printing: "highResolution", modifying: false, copying: true },
  });
  return doc.save({ useObjectStreams: true });
}

/** Tira a senha (precisa da senha atual). */
export async function unprotectPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const doc = await loadPdf(bytes, password);
  dropEncryption(doc);
  return save(doc);
}

export type FormValues = Record<string, string | boolean>;

/** Preenche o formulário AcroForm; `flatten` grava os valores na página (sem campos). */
export async function fillForm(
  bytes: Uint8Array,
  values: FormValues,
  flatten: boolean,
  password?: string,
): Promise<Uint8Array> {
  const doc = await loadPdf(bytes, password);
  const form = doc.getForm();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [name, value] of Object.entries(values)) {
    let field;
    try {
      field = form.getField(name);
    } catch {
      continue;
    }
    if (field instanceof PDFTextField && typeof value === "string") {
      field.setText(winAnsiText(value));
    } else if (field instanceof PDFCheckBox && typeof value === "boolean") {
      if (value) field.check();
      else field.uncheck();
    } else if (
      (field instanceof PDFDropdown ||
        field instanceof PDFOptionList ||
        field instanceof PDFRadioGroup) &&
      typeof value === "string" &&
      field.getOptions().includes(value)
    ) {
      field.select(value);
    }
  }
  form.updateFieldAppearances(font);
  if (flatten) form.flatten();
  return save(doc);
}

/** Imagens (PNG/JPEG) → PDF, uma por página, no tamanho da imagem (máx. A4 deitado/em pé). */
export async function imagesToPdf(
  images: { bytes: Uint8Array; type: "png" | "jpeg" }[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const item of images) {
    const image =
      item.type === "png" ? await doc.embedPng(item.bytes) : await doc.embedJpg(item.bytes);
    const portrait = image.height >= image.width;
    const [maxW, maxH] = portrait ? [595.28, 841.89] : [841.89, 595.28];
    const scale = Math.min(maxW / image.width, maxH / image.height, 1);
    const page = doc.addPage([image.width * scale, image.height * scale]);
    page.drawImage(image, { x: 0, y: 0, width: image.width * scale, height: image.height * scale });
  }
  return save(doc);
}

export type OcrWord = { text: string; x0: number; y0: number; x1: number; y1: number };
export type OcrPage = { page: number; width: number; height: number; words: OcrWord[] };

/**
 * Camada de texto invisível do OCR (o PDF fica pesquisável e copiável). As caixas vêm em
 * pixels da imagem da página como aparece.
 */
export async function addOcrLayer(
  bytes: Uint8Array,
  pagesText: OcrPage[],
  password?: string,
): Promise<Uint8Array> {
  const doc = await loadPdf(bytes, password);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  for (const item of pagesText) {
    const page = pages[item.page];
    if (!page || !item.width || !item.height) continue;
    for (const word of item.words) {
      const text = winAnsiText(word.text).trim();
      if (!text) continue;
      const box = {
        x: word.x0 / item.width,
        y: word.y0 / item.height,
        w: (word.x1 - word.x0) / item.width,
        h: (word.y1 - word.y0) / item.height,
      };
      const place = placementOf(page, box);
      const size = Math.max(1, place.height * 0.9);
      const natural = font.widthOfTextAtSize(text, size);
      // Fonte do tamanho da caixa; a largura é ajustada pelo tamanho (sem escala horizontal).
      const fitted = natural > place.width && natural > 0 ? (size * place.width) / natural : size;
      page.drawText(text, {
        x: place.x,
        y: place.y + place.height * 0.15,
        size: Math.max(1, fitted),
        font,
        opacity: 0,
        rotate: degrees(place.rotation),
      });
    }
  }
  return save(doc);
}

function numberOf(dict: PDFDict, key: string): number | null {
  const value = dict.lookup(PDFName.of(key));
  return value instanceof PDFNumber ? value.asNumber() : null;
}

function nameOf(dict: PDFDict, key: string): string | null {
  const value = dict.lookup(PDFName.of(key));
  if (value instanceof PDFName) return value.decodeText();
  if (value instanceof PDFArray && value.size() === 1) {
    const first = value.lookup(0);
    return first instanceof PDFName ? first.decodeText() : null;
  }
  return null;
}

export type CompressResult = {
  bytes: Uint8Array;
  before: number;
  after: number;
  images: number;
  recompressed: number;
};

/**
 * Comprime: imagens JPEG (e, no balanced/strong, as sem compressão com perda) com outra
 * qualidade e tamanho máximo, mais object streams. Texto e vetores ficam iguais. Se o
 * resultado não ficar menor, devolve o original.
 */
export async function compressPdf(
  bytes: Uint8Array,
  level: CompressLevel,
  recompress: ImageRecompressor | null,
  onProgress?: (done: number, total: number) => void,
  password?: string,
  decodeFlate?: (data: Uint8Array) => Promise<Uint8Array | null>,
): Promise<CompressResult> {
  const settings = COMPRESS_LEVELS[level];
  const doc = await loadPdf(bytes, password);
  if (password) dropEncryption(doc);
  const images: [PDFRef, PDFRawStream][] = [];
  for (const [ref, object] of doc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream && nameOf(object.dict, "Subtype") === "Image") {
      images.push([ref, object]);
    }
  }
  let recompressed = 0;
  for (const [index, [ref, stream]] of images.entries()) {
    onProgress?.(index, images.length);
    if (!recompress) continue;
    const dict = stream.dict;
    const width = numberOf(dict, "Width");
    const height = numberOf(dict, "Height");
    const bits = numberOf(dict, "BitsPerComponent");
    const filter = nameOf(dict, "Filter");
    const space = nameOf(dict, "ColorSpace");
    if (!width || !height || bits !== 8) continue;
    if (dict.has(PDFName.of("Decode")) || dict.has(PDFName.of("ImageMask"))) continue;
    const channels = space === "DeviceRGB" ? 3 : space === "DeviceGray" ? 1 : null;
    if (!channels) continue;
    let input: Parameters<ImageRecompressor>[0] | null = null;
    if (filter === "DCTDecode") {
      input = {
        bytes: stream.contents,
        format: "jpeg",
        width,
        height,
        channels,
        quality: settings.quality,
        maxSide: settings.maxSide,
      };
    } else if (
      filter === "FlateDecode" &&
      settings.raw &&
      decodeFlate &&
      !dict.has(PDFName.of("DecodeParms")) &&
      !dict.has(PDFName.of("SMask"))
    ) {
      const raw = await decodeFlate(stream.contents);
      if (raw && raw.length === width * height * channels) {
        input = {
          bytes: raw,
          format: "raw",
          width,
          height,
          channels,
          quality: settings.quality,
          maxSide: settings.maxSide,
        };
      }
    }
    if (!input) continue;
    const result = await recompress(input).catch(() => null);
    if (!result || result.bytes.length >= stream.contents.length * 0.92) continue;
    const next = doc.context.stream(result.bytes, {
      Type: "XObject",
      Subtype: "Image",
      Width: result.width,
      Height: result.height,
      // O JPEG do canvas sai sempre em 3 canais.
      ColorSpace: "DeviceRGB",
      BitsPerComponent: 8,
      Filter: "DCTDecode",
    });
    const smask = dict.get(PDFName.of("SMask"));
    if (smask) next.dict.set(PDFName.of("SMask"), smask);
    doc.context.assign(ref, next);
    recompressed += 1;
  }
  onProgress?.(images.length, images.length);
  const out = await save(doc);
  const smaller = out.length < bytes.length;
  return {
    bytes: smaller || password ? out : bytes,
    before: bytes.length,
    after: smaller || password ? out.length : bytes.length,
    images: images.length,
    recompressed,
  };
}
