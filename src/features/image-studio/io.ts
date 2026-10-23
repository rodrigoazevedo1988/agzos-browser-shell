import type { DesktopBridge } from "@/features/browser/desktop";

import { PROJECT_EXTENSION } from "./project";

/**
 * Entrada e saída do editor. No app, tudo passa pelo main (diálogos, grants, gravação no
 * caminho escolhido). Na prévia da web, o mesmo fluxo usa <input type=file> e download.
 */

export type ImageSource = { name: string; dataUrl: string; grant?: string };

export type StudioIO = {
  /** Escolhe uma imagem no disco (ou no seletor do navegador). */
  openImage(): Promise<ImageSource | null>;
  /** Imagem que a casca pediu pelo grant (captura, página de arquivo, menu da página). */
  readGrant(grant: string): Promise<ImageSource | null>;
  openProject(): Promise<{ name: string; text: string } | null>;
  saveProject(text: string, name: string): Promise<boolean>;
  exportFile(blob: Blob, name: string): Promise<boolean>;
  copyPng(blob: Blob): Promise<boolean>;
  /** No app, o aviso de erro chega pela casca; na web, o navegador já mostra. */
  readonly desktop: boolean;
};

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function download(blob: Blob, name: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
}

/** Bytes de um Blob para o IPC (Uint8Array, sem cópia de string). */
async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

export function studioIO(desktop: DesktopBridge | null): StudioIO {
  if (desktop) {
    return {
      desktop: true,
      async openImage() {
        const result = await desktop.imagemOpenDialog();
        return result.ok
          ? { name: result.name, dataUrl: result.dataUrl, grant: result.grant }
          : null;
      },
      async readGrant(grant) {
        const image = await desktop.imagemRead(grant);
        return image ? { name: image.name, dataUrl: image.dataUrl, grant } : null;
      },
      async openProject() {
        const result = await desktop.imagemOpenProject();
        return result.ok ? { name: result.name, text: result.text } : null;
      },
      async saveProject(text, name) {
        const result = await desktop.imagemSaveProject(text, name);
        return result.ok;
      },
      async exportFile(blob, name) {
        const result = await desktop.imagemExport(await bytesOf(blob), name);
        return result.ok;
      },
      async copyPng(blob) {
        return desktop.captureCopy(await readAsDataUrl(blob));
      },
    };
  }
  return {
    desktop: false,
    async openImage() {
      const file = await pickFile("image/png,image/jpeg,image/webp,image/gif");
      if (!file) return null;
      return { name: file.name, dataUrl: await readAsDataUrl(file) };
    },
    async readGrant() {
      return null;
    },
    async openProject() {
      const file = await pickFile(`.${PROJECT_EXTENSION},application/json`);
      if (!file) return null;
      return { name: file.name.replace(/\.[^.]+$/, ""), text: await file.text() };
    },
    async saveProject(text, name) {
      download(new Blob([text], { type: "application/json" }), `${name}.${PROJECT_EXTENSION}`);
      return true;
    },
    async exportFile(blob, name) {
      download(blob, name);
      return true;
    },
    async copyPng(blob) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        return true;
      } catch {
        return false;
      }
    },
  };
}
