import { ArrowLeftRight, KeyRound, Languages, Settings2, ShieldAlert, X } from "lucide-react";

import { cn } from "@/lib/utils";

import "./translate.css";
import type { TranslateStatus } from "./bridge";
import { LanguagePicker } from "./language-picker";
import { languageLabel, shortLanguageLabel } from "./languages";
import {
  TRANSLATE_MODES,
  TRANSLATE_SCOPES,
  TRANSLATE_TONES,
  hasRule,
  type TranslatePrefs,
  type TranslateRule,
} from "./prefs";

export type TranslateBlocker = "no-key" | "private" | null;

export type TranslatePagePanelProps = {
  dark: boolean;
  right: number;
  top: number;
  /** Site da guia ("example.com"); vazio fora de sites. */
  host: string;
  /** Idioma da página (código) ou vazio quando não se sabe. */
  pageLang: string;
  status: TranslateStatus;
  prefs: TranslatePrefs;
  blocker: TranslateBlocker;
  errorText: string | null;
  /** Atalho pronto ("Alt+Shift+T") ou vazio. */
  shortcut: string;
  onTranslate: () => void;
  onRestore: () => void;
  onCancel: () => void;
  onPrefs: (patch: Partial<TranslatePrefs>) => void;
  onRule: (rule: TranslateRule, value: string, on: boolean) => void;
  onSetupKey: () => void;
  onAllowPrivate: (session: boolean) => void;
  onSettings: () => void;
  onClose: () => void;
};

/** Popup do ícone de tradução da barra de URL (como no Chrome), com as opções da página. */
export function TranslatePagePanel(props: TranslatePagePanelProps) {
  const { status, prefs } = props;
  const lang = status.detected || props.pageLang;
  const target = shortLanguageLabel(prefs.target);
  const running = status.state === "running";
  const translated = status.state === "done" || running;
  const fraction = status.total ? Math.min(1, status.done / status.total) : 0;
  const sourceLabel = lang ? languageLabel(lang) : "outro idioma";
  return (
    <aside
      className={cn("app-menu tr-panel", props.dark ? "dark" : "agz-light")}
      style={{ right: props.right, top: props.top }}
      aria-label="Tradução da página"
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onClose();
      }}
    >
      <header className="tr-head">
        <Languages />
        <strong>Tradução</strong>
        <button
          type="button"
          className="tr-icon"
          title="Configurações da tradução"
          aria-label="Configurações da tradução"
          onClick={props.onSettings}
        >
          <Settings2 />
        </button>
        <button
          type="button"
          className="tr-icon"
          title="Fechar"
          aria-label="Fechar tradução"
          onClick={props.onClose}
        >
          <X />
        </button>
      </header>

      {props.blocker === "no-key" ? (
        <div className="tr-callout" role="status">
          <KeyRound />
          <p>
            A tradução usa a Groq com a chave do Agzos AI. Configure a chave uma vez e as páginas e
            trechos passam a ser traduzidos aqui.
          </p>
          <button type="button" className="tr-button primary" onClick={props.onSetupKey}>
            Configurar a chave do Agzos AI
          </button>
        </div>
      ) : props.blocker === "private" ? (
        <div className="tr-callout" role="status">
          <ShieldAlert />
          <p>
            Esta é uma guia anônima. Para traduzir, o texto da página vai para a Groq. Nada fica no
            cache nem no histórico.
          </p>
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
        <div className="tr-status" role="status" aria-live="polite">
          {running ? (
            <>
              <p>
                Traduzindo para {target}… {status.done} de {status.total} blocos
              </p>
              <div
                className="tr-progress"
                role="progressbar"
                aria-label="Progresso da tradução"
                aria-valuemin={0}
                aria-valuemax={status.total}
                aria-valuenow={status.done}
              >
                <i style={{ width: `${Math.round(fraction * 100)}%` }} />
              </div>
            </>
          ) : status.state === "done" ? (
            <p>
              Traduzida para {target}
              {status.total ? ` · ${status.done} blocos` : ""}
            </p>
          ) : status.state === "original" ? (
            <p>Mostrando o original ({sourceLabel}).</p>
          ) : (
            <p>
              {lang
                ? `Esta página está em ${sourceLabel}.`
                : "Traduza esta página para o seu idioma."}
            </p>
          )}
          {props.errorText && (
            <p className="tr-error" role="alert">
              {props.errorText}
            </p>
          )}
          <div className="tr-row">
            {running && (
              <button type="button" className="tr-button" onClick={props.onCancel}>
                Cancelar
              </button>
            )}
            {translated ? (
              <button type="button" className="tr-button primary" onClick={props.onRestore}>
                Mostrar original
              </button>
            ) : (
              <button type="button" className="tr-button primary" onClick={props.onTranslate}>
                Traduzir para {target}
              </button>
            )}
            {props.shortcut && <kbd className="tr-kbd">{props.shortcut}</kbd>}
          </div>
        </div>
      )}

      <div className="tr-body">
        <div className="tr-langs">
          <LanguagePicker
            label="Idioma de origem"
            value={prefs.source}
            auto
            detected={lang || undefined}
            onChange={(source) => props.onPrefs({ source })}
          />
          <button
            type="button"
            className="tr-icon"
            title="Inverter idiomas"
            aria-label="Inverter idiomas"
            disabled={prefs.source === "auto" && !lang}
            onClick={() =>
              props.onPrefs({
                source: prefs.target,
                target: prefs.source === "auto" ? lang : prefs.source,
              })
            }
          >
            <ArrowLeftRight />
          </button>
          <LanguagePicker
            label="Idioma de destino"
            value={prefs.target}
            onChange={(next) => props.onPrefs({ target: next })}
          />
        </div>

        <div className="tr-field">
          <span>Exibição</span>
          <div className="tr-seg" role="radiogroup" aria-label="Exibição da tradução">
            {TRANSLATE_MODES.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={prefs.mode === item.id}
                className={cn(prefs.mode === item.id && "on")}
                title={item.hint}
                onClick={() => props.onPrefs({ mode: item.id })}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="tr-grid">
          <label className="tr-field">
            <span>Tom</span>
            <select
              className="tr-select"
              aria-label="Tom da tradução"
              value={prefs.tone}
              onChange={(event) =>
                props.onPrefs({ tone: event.target.value as TranslatePrefs["tone"] })
              }
            >
              {TRANSLATE_TONES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="tr-field">
            <span>O que traduzir</span>
            <select
              className="tr-select"
              aria-label="O que traduzir"
              value={prefs.scope}
              onChange={(event) =>
                props.onPrefs({ scope: event.target.value as TranslatePrefs["scope"] })
              }
            >
              {TRANSLATE_SCOPES.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="tr-check">
          <input
            type="checkbox"
            checked={prefs.observe}
            onChange={(event) => props.onPrefs({ observe: event.target.checked })}
          />
          Traduzir também ao rolar e o que aparecer depois
        </label>

        <div className="tr-rules" aria-label="Regras">
          {lang && (
            <>
              <RuleCheck
                label={`Sempre traduzir ${languageLabel(lang)}`}
                checked={hasRule(prefs, "alwaysLang", lang)}
                onChange={(on) => props.onRule("alwaysLang", lang, on)}
              />
              <RuleCheck
                label={`Nunca traduzir ${languageLabel(lang)}`}
                checked={hasRule(prefs, "neverLang", lang)}
                onChange={(on) => props.onRule("neverLang", lang, on)}
              />
            </>
          )}
          {props.host && (
            <>
              <RuleCheck
                label="Sempre traduzir este site"
                checked={hasRule(prefs, "alwaysSite", props.host)}
                onChange={(on) => props.onRule("alwaysSite", props.host, on)}
              />
              <RuleCheck
                label="Nunca traduzir este site"
                checked={hasRule(prefs, "neverSite", props.host)}
                onChange={(on) => props.onRule("neverSite", props.host, on)}
              />
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function RuleCheck({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="tr-check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
