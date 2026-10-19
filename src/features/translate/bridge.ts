/**
 * Ponte da tradução (electron/preload.cjs → electron/translate-service.cjs). A casca só manda
 * opções e recebe texto traduzido e estado; a chave da Groq nunca passa por aqui.
 */
import type { AiError } from "@/features/browser/desktop";

import type { GlossaryPair, TranslateMode, TranslateScope, TranslateTone } from "./prefs";

export type TranslateTask = "translate" | "explain" | "alternatives";

export type TranslateOptions = {
  source: string;
  target: string;
  tone: TranslateTone;
  mode: TranslateMode;
  scope: TranslateScope;
  observe: boolean;
  glossary: GlossaryPair[];
  keep: string[];
  cache: boolean;
  /** Guia anônima: o usuário aceitou mandar o texto para a Groq. */
  consent: boolean;
};

export type TranslateError = AiError | "private" | "page" | "field";

export type TranslateStatus = {
  state: "idle" | "running" | "done" | "error" | "original";
  done: number;
  total: number;
  mode?: TranslateMode;
  target?: string;
  source?: string;
  /** Idioma que a Groq disse ser o do original. */
  detected?: string;
  error?: TranslateError | null;
  retryAfter?: number | null;
};

export type TranslateTabEvent =
  /** Idioma da página (declarado no <html lang> ou adivinhado pelo texto). */
  | { type: "translate-lang"; id: number; url: string; lang: string; declared: boolean }
  /** Progresso e estado da tradução da página. */
  | ({ type: "translate"; id: number; url: string } & TranslateStatus);

export type TranslateResult =
  | {
      ok: true;
      translation?: string;
      explanation?: string;
      alternatives?: { text: string; note: string }[];
      source?: string;
      cached?: boolean;
    }
  | { ok: false; error: TranslateError; retryAfter?: number | null };

export type TranslateAction =
  | {
      action: "selection";
      tabId: number;
      x: number;
      y: number;
      text: string;
      editable: boolean;
    }
  | { action: "field" | "page"; tabId: number; x: number; y: number };

export type DesktopTranslate = {
  translatePage(
    id: number,
    options: TranslateOptions,
  ): Promise<{ ok: boolean; error?: TranslateError }>;
  translateCancel(id: number): Promise<{ ok: boolean }>;
  translateRestore(id: number): Promise<{ ok: boolean }>;
  translateMode(id: number, mode: TranslateMode): Promise<{ ok: boolean }>;
  translateState(id: number): Promise<TranslateStatus>;
  translateProbe(id: number): Promise<{ url: string; lang: string; declared: boolean } | null>;
  translateText(
    id: number,
    text: string,
    task: TranslateTask,
    options: TranslateOptions,
  ): Promise<TranslateResult>;
  translateField(
    id: number,
    options: TranslateOptions,
  ): Promise<{ ok: boolean; translation?: string; error?: TranslateError; retryAfter?: number }>;
  translateReplace(id: number, text: string): Promise<{ ok: boolean }>;
  translateCacheClear(): Promise<{ ok: boolean; entries: number }>;
  translateCacheInfo(): Promise<{ entries: number }>;
  translateMenuTarget(code: string, label: string): Promise<unknown>;
  onTranslateAction(callback: (payload: TranslateAction) => void): () => void;
};
