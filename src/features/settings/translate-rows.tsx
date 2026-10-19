import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { DesktopBridge } from "@/features/browser/desktop";
import type { FeaturePrefs } from "@/features/browser/feature-prefs";
import { LanguagePicker } from "@/features/translate/language-picker";
import { languageLabel } from "@/features/translate/languages";
import {
  TRANSLATE_MODES,
  TRANSLATE_SCOPES,
  TRANSLATE_TONES,
  parseTranslatePrefs,
  siteKey,
  toggleRule,
  type TranslatePrefs,
  type TranslateRule,
} from "@/features/translate/prefs";
import { Toggle } from "@/features/ui/toggle";

type Props = {
  desktop: DesktopBridge | null;
  features: FeaturePrefs;
  setFeatures: (patch: Partial<FeaturePrefs>) => void;
  onNotice?: (text: string) => void;
};

const RULES: { rule: TranslateRule; key: keyof TranslatePrefs; label: string; lang: boolean }[] = [
  { rule: "alwaysLang", key: "alwaysLangs", label: "Sempre traduzir estes idiomas", lang: true },
  { rule: "neverLang", key: "neverLangs", label: "Nunca traduzir estes idiomas", lang: true },
  { rule: "alwaysSite", key: "alwaysSites", label: "Sempre traduzir estes sites", lang: false },
  { rule: "neverSite", key: "neverSites", label: "Nunca traduzir estes sites", lang: false },
];

/**
 * Configurações > Tradução: padrões (destino, exibição, tom, escopo), automático, ícone,
 * glossário, "Não traduzir", regras por idioma/site e o cache das traduções.
 */
export function TranslateSettings({ desktop, features, setFeatures, onNotice }: Props) {
  const prefs = features.translate;
  const save = (patch: Partial<TranslatePrefs>) =>
    setFeatures({ translate: parseTranslatePrefs({ ...prefs, ...patch }) });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [keep, setKeep] = useState("");
  const [site, setSite] = useState<{ rule: TranslateRule; value: string }>({
    rule: "neverSite",
    value: "",
  });
  const [ruleLang, setRuleLang] = useState<{ rule: TranslateRule; value: string }>({
    rule: "alwaysLang",
    value: "en",
  });
  const [cache, setCache] = useState<number | null>(null);
  useEffect(() => {
    if (!desktop) return;
    void desktop.translateCacheInfo().then((info) => setCache(info.entries));
  }, [desktop]);

  const addGlossary = () => {
    const a = from.trim();
    const b = to.trim();
    if (!a || !b) {
      onNotice?.("Preencha o termo original e a tradução.");
      return;
    }
    save({
      glossary: [
        ...prefs.glossary.filter((pair) => pair.from.toLowerCase() !== a.toLowerCase()),
        { from: a, to: b },
      ],
    });
    setFrom("");
    setTo("");
  };
  const addKeep = () => {
    const value = keep.trim();
    if (!value) return;
    save({ keep: [...prefs.keep.filter((item) => item !== value), value] });
    setKeep("");
  };

  return (
    <div className="sf-body">
      <div className="settings-block row">
        <span>
          <strong>Traduzir para</strong>
          <small>Idioma de destino da página, dos trechos e do que você escreve.</small>
        </span>
        <span className="settings-buttons">
          <LanguagePicker
            label="Idioma de destino padrão"
            value={prefs.target}
            onChange={(target) => save({ target })}
          />
        </span>
      </div>
      <div className="settings-block row">
        <span>
          <strong>Idioma de origem</strong>
          <small>“Detectar” usa o idioma declarado pela página, o texto e a resposta da IA.</small>
        </span>
        <span className="settings-buttons">
          <LanguagePicker
            label="Idioma de origem padrão"
            value={prefs.source}
            auto
            onChange={(source) => save({ source })}
          />
        </span>
      </div>
      <div className="settings-block row">
        <span>
          <strong>Exibição</strong>
          <small>{TRANSLATE_MODES.find((item) => item.id === prefs.mode)?.hint}</small>
        </span>
        <select
          className="sf-select"
          aria-label="Exibição padrão da tradução"
          value={prefs.mode}
          onChange={(event) => save({ mode: event.target.value as TranslatePrefs["mode"] })}
        >
          {TRANSLATE_MODES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <div className="settings-block row">
        <span>
          <strong>Tom</strong>
          <small>Natural, literal, formal, informal ou técnico.</small>
        </span>
        <select
          className="sf-select"
          aria-label="Tom padrão da tradução"
          value={prefs.tone}
          onChange={(event) => save({ tone: event.target.value as TranslatePrefs["tone"] })}
        >
          {TRANSLATE_TONES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <div className="settings-block row">
        <span>
          <strong>O que traduzir</strong>
          <small>A página inteira, só o que está na tela ou só o artigo principal.</small>
        </span>
        <select
          className="sf-select"
          aria-label="O que traduzir por padrão"
          value={prefs.scope}
          onChange={(event) => save({ scope: event.target.value as TranslatePrefs["scope"] })}
        >
          {TRANSLATE_SCOPES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <Toggle
        label="Traduzir também ao rolar e o que aparecer depois"
        hint="Sites que carregam conteúdo sem recarregar a página (SPA) continuam traduzidos."
        checked={prefs.observe}
        onChange={(observe) => save({ observe })}
      />
      <Toggle
        label="Traduzir sozinho pelas regras"
        hint="Páginas que caem em “Sempre traduzir” são traduzidas ao abrir. Guias anônimas nunca."
        checked={prefs.autoTranslate}
        onChange={(autoTranslate) => save({ autoTranslate })}
      />
      <Toggle
        label="Ícone de tradução na barra de endereço"
        hint="Aparece quando a página está em outro idioma."
        checked={prefs.showIcon}
        onChange={(showIcon) => save({ showIcon })}
      />

      <div className="settings-block">
        <strong>Glossário</strong>
        <small>Termos que sempre recebem esta tradução (nomes de produto, jargão da equipe).</small>
      </div>
      {prefs.glossary.length > 0 && (
        <ul className="settings-list" aria-label="Glossário">
          {prefs.glossary.map((pair) => (
            <li key={pair.from}>
              <span>
                <strong>{pair.from}</strong>
                <small>→ {pair.to}</small>
              </span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remover ${pair.from} do glossário`}
                onClick={() => save({ glossary: prefs.glossary.filter((item) => item !== pair) })}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="settings-block row">
        <input
          className="sf-input"
          aria-label="Termo original"
          placeholder="Termo original"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
        />
        <input
          className="sf-input"
          aria-label="Tradução do termo"
          placeholder="Tradução"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && addGlossary()}
        />
        <Button variant="outline" size="sm" onClick={addGlossary}>
          <Plus /> Adicionar
        </Button>
      </div>

      <div className="settings-block">
        <strong>Não traduzir</strong>
        <small>Termos que ficam exatamente como estão (marcas, nomes, siglas).</small>
      </div>
      {prefs.keep.length > 0 && (
        <ul className="settings-list" aria-label="Não traduzir">
          {prefs.keep.map((item) => (
            <li key={item}>
              <span>
                <strong>{item}</strong>
              </span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remover ${item} de Não traduzir`}
                onClick={() => save({ keep: prefs.keep.filter((value) => value !== item) })}
              >
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="settings-block row">
        <input
          className="sf-input"
          aria-label="Termo que não se traduz"
          placeholder="Ex.: Agzos Browser"
          value={keep}
          onChange={(event) => setKeep(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && addKeep()}
        />
        <Button variant="outline" size="sm" onClick={addKeep}>
          <Plus /> Adicionar
        </Button>
      </div>

      <div className="settings-block">
        <strong>Regras por idioma e por site</strong>
        <small>“Nunca” vence “sempre”. O ícone da barra também liga e desliga estas regras.</small>
      </div>
      {RULES.map(({ rule, key, label, lang }) => {
        const list = prefs[key] as string[];
        if (!list.length) return null;
        return (
          <ul key={rule} className="settings-list" aria-label={label}>
            {list.map((value) => (
              <li key={value}>
                <span>
                  <strong>{lang ? languageLabel(value) : value}</strong>
                  <small>{label}</small>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Remover ${value} de ${label}`}
                  onClick={() => setFeatures({ translate: toggleRule(prefs, rule, value, false) })}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        );
      })}
      <div className="settings-block row">
        <select
          className="sf-select"
          aria-label="Regra de idioma"
          value={ruleLang.rule}
          onChange={(event) =>
            setRuleLang({ ...ruleLang, rule: event.target.value as TranslateRule })
          }
        >
          <option value="alwaysLang">Sempre traduzir</option>
          <option value="neverLang">Nunca traduzir</option>
        </select>
        <LanguagePicker
          label="Idioma da regra"
          value={ruleLang.value}
          onChange={(value) => setRuleLang({ ...ruleLang, value })}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            setFeatures({ translate: toggleRule(prefs, ruleLang.rule, ruleLang.value, true) })
          }
        >
          <Plus /> Adicionar
        </Button>
      </div>
      <div className="settings-block row">
        <select
          className="sf-select"
          aria-label="Regra de site"
          value={site.rule}
          onChange={(event) => setSite({ ...site, rule: event.target.value as TranslateRule })}
        >
          <option value="alwaysSite">Sempre traduzir</option>
          <option value="neverSite">Nunca traduzir</option>
        </select>
        <input
          className="sf-input"
          aria-label="Site da regra"
          placeholder="exemplo.com"
          value={site.value}
          onChange={(event) => setSite({ ...site, value: event.target.value })}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const host = siteKey(site.value.replace(/^https?:\/\//i, "").split("/")[0]);
            if (!host) {
              onNotice?.("Digite um site, como exemplo.com.");
              return;
            }
            setFeatures({ translate: toggleRule(prefs, site.rule, host, true) });
            setSite({ ...site, value: "" });
          }}
        >
          <Plus /> Adicionar
        </Button>
      </div>

      <Toggle
        label="Guardar traduções (cache)"
        hint="Reaproveita trechos já traduzidos e economiza tokens. Guias anônimas nunca entram."
        checked={prefs.cache}
        onChange={(value) => save({ cache: value })}
      />
      <div className="settings-block row">
        <span>
          <strong>Cache de traduções</strong>
          <small>
            {cache === null
              ? "Só no app para computador."
              : cache === 1
                ? "1 trecho guardado neste computador."
                : `${cache} trechos guardados neste computador.`}
          </small>
        </span>
        <span className="settings-buttons">
          <Button
            variant="outline"
            size="sm"
            disabled={!desktop}
            onClick={() =>
              void desktop?.translateCacheClear().then((info) => {
                setCache(info.entries);
                onNotice?.("Cache de traduções limpo.");
              })
            }
          >
            Limpar cache
          </Button>
        </span>
      </div>
      <p className="sf-note">
        Guias anônimas: o navegador pergunta antes de mandar qualquer texto para a Groq e nunca
        traduz sozinho.
      </p>
    </div>
  );
}
