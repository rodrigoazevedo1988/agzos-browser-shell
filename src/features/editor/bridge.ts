/**
 * Ponte do editor (electron/editor-files.cjs via preload). O main lê e grava só o que a
 * janela abriu ou escolheu num diálogo; a casca recebe texto e metadados.
 */
import type { Encoding, Eol } from "./language";

export type EditorRead =
  | {
      ok: true;
      path: string;
      name: string;
      text: string;
      encoding: Encoding;
      eol: Eol;
      size: number;
      mtime: number;
    }
  | { ok: false; error: string; size?: number };

export type EditorSaved =
  | { ok: true; mtime: number; size: number; lossy: number; file?: string }
  | { ok: false; error: string };

export type EditorStat =
  { ok: true; exists: boolean; size: number; mtime: number } | { ok: false; error: string };

export type EditorSavePayload = { file: string; text: string; encoding: Encoding; eol: Eol };

export type DesktopEditor = {
  editorOpen(): Promise<{ paths: string[] }>;
  editorRead(file: string): Promise<EditorRead>;
  editorStat(file: string): Promise<EditorStat>;
  editorSave(payload: EditorSavePayload): Promise<EditorSaved>;
  editorSaveAs(payload: Omit<EditorSavePayload, "file"> & { name: string }): Promise<EditorSaved>;
  editorWatch(file: string): Promise<boolean>;
  editorUnwatch(file: string): Promise<boolean>;
  onEditorChanged(callback: (payload: { file: string }) => void): () => void;
  /** Caminho de um arquivo arrastado para a página (webUtils, no preload). */
  filePathOf(file: File): string;
};
