import {
  Copy,
  KeyRound,
  Lightbulb,
  ListTree,
  Replace,
  ShieldAlert,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";

import "./translate.css";
import type { TranslateTask } from "./bridge";
import type { TranslateBlocker } from "./page-panel";
import { LanguagePicker } from "./language-picker";
import { languageLabel } from "./languages";

export type TranslationBubbleProps = {
  dark: boolean;
  left: number;
  top: number;
  text: string;
  target: string;
  /** Idioma do original (o que a Groq detectou), se já se sabe. */
  source: string;
  loading: TranslateTask | null;
  translation: string | null;
  explanation: string | null;
  alternatives: { text: string; note: string }[] | null;
  errorText: string | null;
  blocker: TranslateBlocker;
  /** A seleção está num campo editável: "Substituir" troca o texto dele. */
  editable: boolean;
  canSpeak: boolean;
  onTarget: (code: string) => void;
  onTask: (task: TranslateTask) => void;
  onCopy: (text: string) => void;
  onSpeak: (text: string) => void;
  onReplace: (text: string) => void;
  onOpenAi: () => void;
  onSetupKey: () => void;
  onAllowPrivate: (session: boolean) => void;
  onClose: () => void;
};

const WIDTH = 380;

/** Bolha da tradução do trecho selecionado (menu de contexto da página). */
export function TranslationBubble(props: TranslationBubbleProps) {
  const left = Math.max(8, Math.min(props.left, window.innerWidth - WIDTH - 8));
  const top = Math.max(8, Math.min(props.top, window.innerHeight - 220));
  const result = props.translation;
  return (
    <aside
      className={cn("app-menu tr-bubble", props.dark ? "dark" : "agz-light")}
      style={{ left, top, right: "auto", width: WIDTH }}
      aria-label="Tradução do trecho"
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onClose();
      }}
    >
      <header className="tr-head">
        <span className="tr-from">
          {props.source ? languageLabel(props.source) : "Trecho selecionado"} →
        </span>
        <LanguagePicker label="Traduzir para" value={props.target} onChange={props.onTarget} />
        <button
          type="button"
          className="tr-icon"
          title="Fechar"
          aria-label="Fechar tradução do trecho"
          onClick={props.onClose}
        >
          <X />
        </button>
      </header>
      <blockquote className="tr-original" title={props.text}>
        {props.text.length > 280 ? `${props.text.slice(0, 280)}…` : props.text}
      </blockquote>

      {props.blocker === "no-key" ? (
        <div className="tr-callout" role="status">
          <KeyRound />
          <p>A tradução usa a Groq com a chave do Agzos AI.</p>
          <button type="button" className="tr-button primary" onClick={props.onSetupKey}>
            Configurar a chave do Agzos AI
          </button>
        </div>
      ) : props.blocker === "private" ? (
        <div className="tr-callout" role="status">
          <ShieldAlert />
          <p>Guia anônima: o trecho vai para a Groq para ser traduzido.</p>
          <div className="tr-row">
            <button
              type="button"
              className="tr-button primary"
              onClick={() => props.onAllowPrivate(false)}
            >
              Traduzir só desta vez
            </button>
            <button type="button" className="tr-button" onClick={() => props.onAllowPrivate(true)}>
              Permitir até fechar o navegador
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="tr-result" role="status" aria-live="polite" aria-label="Tradução">
            {props.loading === "translate" && !result ? (
              <p className="tr-muted">Traduzindo…</p>
            ) : result ? (
              <p className="tr-translation">{result}</p>
            ) : null}
            {props.errorText && (
              <p className="tr-error" role="alert">
                {props.errorText}
              </p>
            )}
          </div>
          {props.explanation && (
            <div className="tr-extra" aria-label="Explicação">
              <strong>Explicação</strong>
              <p>{props.explanation}</p>
            </div>
          )}
          {props.alternatives && (
            <ul className="tr-extra tr-alternatives" aria-label="Alternativas">
              {props.alternatives.map((item, index) => (
                <li key={index}>
                  <button type="button" title="Copiar" onClick={() => props.onCopy(item.text)}>
                    <span>{item.text}</span>
                    {item.note && <small>{item.note}</small>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {(props.loading === "explain" || props.loading === "alternatives") && (
            <p className="tr-muted">
              {props.loading === "explain" ? "Explicando…" : "Buscando alternativas…"}
            </p>
          )}
          <div className="tr-actions">
            <button
              type="button"
              className="tr-icon"
              title="Copiar tradução"
              aria-label="Copiar tradução"
              disabled={!result}
              onClick={() => result && props.onCopy(result)}
            >
              <Copy />
            </button>
            <button
              type="button"
              className="tr-icon"
              title="Ouvir"
              aria-label="Ouvir a tradução"
              disabled={!result || !props.canSpeak}
              onClick={() => result && props.onSpeak(result)}
            >
              <Volume2 />
            </button>
            <button
              type="button"
              className="tr-icon"
              title="Explicar (gírias, expressões)"
              aria-label="Explicar o trecho"
              disabled={props.loading !== null}
              onClick={() => props.onTask("explain")}
            >
              <Lightbulb />
            </button>
            <button
              type="button"
              className="tr-icon"
              title="Outras traduções"
              aria-label="Outras traduções"
              disabled={props.loading !== null}
              onClick={() => props.onTask("alternatives")}
            >
              <ListTree />
            </button>
            {props.editable && (
              <button
                type="button"
                className="tr-icon"
                title="Substituir no campo"
                aria-label="Substituir no campo"
                disabled={!result}
                onClick={() => result && props.onReplace(result)}
              >
                <Replace />
              </button>
            )}
            <button
              type="button"
              className="tr-button tr-ai"
              title="Abrir no Agzos AI"
              onClick={props.onOpenAi}
            >
              <Sparkles />
              Agzos AI
            </button>
          </div>
        </>
      )}
    </aside>
  );
}
