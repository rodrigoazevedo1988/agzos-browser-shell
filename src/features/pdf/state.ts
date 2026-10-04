import type { PDFDocumentProxy } from "pdfjs-dist";

import type { DesktopBridge } from "@/features/browser/desktop";
import type { FeaturePrefs } from "@/features/browser/feature-prefs";

import type { PdfInfo } from "./engine";

/** Documento aberto no PDF Tools (os bytes atuais, com as mudanças ainda não salvas). */
export type PdfDoc = {
  name: string;
  /** Caminho do arquivo aberto ("" quando veio de um link). */
  path: string;
  bytes: Uint8Array;
  /** Senha do PDF (só em memória; lembrada cifrada só se o usuário pedir). */
  password: string | null;
  info: PdfInfo;
  /** SHA-256 do arquivo como foi aberto (chave da senha lembrada). */
  fingerprint: string;
  dirty: boolean;
};

export type PdfToolId =
  | "edit"
  | "organize"
  | "merge"
  | "split"
  | "compress"
  | "convert"
  | "security"
  | "form"
  | "ocr"
  | "summary";

export const PDF_TOOLS: { id: PdfToolId; label: string; hint: string; offline: boolean }[] = [
  {
    id: "edit",
    label: "Editar",
    hint: "Texto, imagem, formas, comentário, assinatura e marca-d'água",
    offline: true,
  },
  {
    id: "organize",
    label: "Organizar páginas",
    hint: "Reordenar, girar, apagar e recortar",
    offline: true,
  },
  { id: "merge", label: "Juntar", hint: "Vários PDFs num só", offline: true },
  { id: "split", label: "Dividir", hint: "Por intervalo ou a cada N páginas", offline: true },
  { id: "compress", label: "Comprimir", hint: "Fraca, equilibrada ou forte", offline: true },
  { id: "convert", label: "Converter", hint: "Imagens, texto e Office", offline: true },
  { id: "security", label: "Senha", hint: "Definir ou remover (AES-256)", offline: true },
  { id: "form", label: "Formulário", hint: "Preencher campos AcroForm", offline: true },
  { id: "ocr", label: "OCR", hint: "Texto pesquisável em PDF escaneado", offline: true },
  { id: "summary", label: "Resumo com IA", hint: "Agzos AI, só com consentimento", offline: false },
];

export type JobControl = {
  progress: (fraction: number | null, label?: string) => void;
  signal: { cancelled: boolean };
};

export type ToolContext = {
  desktop: DesktopBridge;
  doc: PdfDoc;
  render: PDFDocumentProxy;
  prefs: FeaturePrefs["pdf"];
  online: boolean;
  /** Roda uma tarefa com barra de progresso e Cancelar; null quando falhou ou cancelou. */
  run: <T>(label: string, job: (control: JobControl) => Promise<T>) => Promise<T | null>;
  /** Troca o documento pelo resultado (fica "não salvo"). */
  replace: (
    bytes: Uint8Array,
    change: { label: string; password?: string | null },
  ) => Promise<void>;
  /** Abre outro arquivo no PDF Tools (ex.: Office convertido, imagens juntadas). */
  openBytes: (name: string, bytes: Uint8Array) => Promise<void>;
  notify: (text: string) => void;
  /** Grava vários arquivos numa pasta escolhida (dividir, PDF→imagens). */
  saveMany: (files: { name: string; bytes: Uint8Array }[]) => Promise<void>;
  /** Exporta um arquivo (diálogo Salvar como). */
  exportFile: (name: string, bytes: Uint8Array, extensions: string[]) => Promise<void>;
  confirm: (title: string, text: string) => Promise<boolean>;
  openSettings: () => void;
};

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** "relatório.pdf" → "relatório (editado).pdf" etc. */
export function derivedName(name: string, suffix: string, ext = "pdf"): string {
  const stem = name.replace(/\.[^.]+$/, "") || "documento";
  return `${stem}${suffix ? ` (${suffix})` : ""}.${ext}`;
}
