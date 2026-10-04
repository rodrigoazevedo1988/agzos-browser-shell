import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { DesktopBridge } from "@/features/browser/desktop";
import type {
  DownloadFileType,
  DownloadRule,
  DownloadsConfig,
  PageThemeMode,
  PdfCloudTarget,
} from "@/features/browser/desktop-v47";
import {
  FEATURE_SHORTCUTS,
  PDF_MAX_MB,
  comboLabel,
  comboOfEvent,
  type FeaturePrefs,
  type FeatureShortcutId,
  type UiTheme,
} from "@/features/browser/feature-prefs";
import { TYPE_LABELS } from "@/features/downloads/filters";
import { Toggle } from "@/features/ui/toggle";
import { cn } from "@/lib/utils";

type FeatureProps = {
  desktop: DesktopBridge | null;
  features: FeaturePrefs;
  setFeatures: (patch: Partial<FeaturePrefs>) => void;
  isMac: boolean;
  onNotice?: (text: string) => void;
};

function ThemeSelect({
  value,
  onChange,
  label,
}: {
  value: UiTheme;
  onChange: (value: UiTheme) => void;
  label: string;
}) {
  return (
    <select
      className="sf-select"
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as UiTheme)}
    >
      <option value="browser">Segue o navegador</option>
      <option value="light">Claro</option>
      <option value="dark">Escuro</option>
    </select>
  );
}

/** Grava um atalho apertando as teclas (Esc cancela, Backspace desliga). */
export function ShortcutField({
  id,
  features,
  setFeatures,
  isMac,
}: Omit<FeatureProps, "desktop"> & { id: FeatureShortcutId }) {
  const [recording, setRecording] = useState(false);
  const meta = FEATURE_SHORTCUTS.find((item) => item.id === id)!;
  const value = features.shortcuts[id];
  const taken = (combo: string) =>
    FEATURE_SHORTCUTS.find((item) => item.id !== id && features.shortcuts[item.id] === combo);
  return (
    <div className="settings-block row">
      <span>
        <strong>{meta.label}</strong>
        <small>
          {recording
            ? "Aperte a combinação (Esc cancela, Backspace desliga)"
            : "Clique para gravar outra combinação."}
        </small>
      </span>
      <span className="settings-buttons">
        <button
          type="button"
          className={cn("shortcut-recorder", recording && "on")}
          aria-label={`Atalho de ${meta.label}`}
          onClick={() => setRecording(true)}
          onBlur={() => setRecording(false)}
          onKeyDown={(event) => {
            if (!recording) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "Escape") return setRecording(false);
            if (event.key === "Backspace" || event.key === "Delete") {
              setFeatures({ shortcuts: { ...features.shortcuts, [id]: "" } });
              return setRecording(false);
            }
            const combo = comboOfEvent(event);
            if (!combo) return;
            const other = taken(combo);
            setFeatures({
              shortcuts: {
                ...features.shortcuts,
                [id]: combo,
                ...(other ? { [other.id]: "" } : {}),
              },
            });
            setRecording(false);
          }}
        >
          <kbd>{recording ? "…" : comboLabel(value, isMac)}</kbd>
        </button>
        {value !== meta.fallback && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              setFeatures({ shortcuts: { ...features.shortcuts, [id]: meta.fallback } })
            }
          >
            Padrão
          </Button>
        )}
      </span>
    </div>
  );
}

const RULE_LABELS: Record<DownloadRule["match"], string> = {
  type: "Tipo ou extensão",
  domain: "Site (domínio)",
  name: "Nome (regex)",
};

/** Downloads: pasta padrão, pastas por tipo, regras de catálogo, etiquetas e tema. */
export function DownloadsFeatureSettings({
  desktop,
  features,
  setFeatures,
  onNotice,
}: FeatureProps) {
  const [config, setConfig] = useState<DownloadsConfig | null>(null);
  const [base, setBase] = useState("");
  const [draft, setDraft] = useState<Omit<DownloadRule, "id" | "enabled">>({
    match: "domain",
    pattern: "",
    tag: "",
    folder: "",
    subfolder: "",
  });
  useEffect(() => {
    if (!desktop) return;
    void desktop.downloadsConfig().then((result) => {
      setConfig(result.config);
      setBase(result.base);
    });
    return desktop.onDownloadsConfig(setConfig);
  }, [desktop]);
  if (!desktop)
    return <p className="sf-note">O gerenciador de downloads funciona no app para computador.</p>;
  if (!config) return null;
  const save = (next: DownloadsConfig) => void desktop.downloadsSetConfig(next).then(setConfig);
  const pick = async (title: string) => desktop.downloadsPickDir(title);
  const addRule = () => {
    if (!draft.pattern.trim() || (!draft.tag.trim() && !draft.folder && !draft.subfolder.trim())) {
      onNotice?.("A regra precisa de um padrão e de uma ação (etiqueta, pasta ou subpasta).");
      return;
    }
    if (draft.match === "name") {
      try {
        new RegExp(draft.pattern);
      } catch {
        onNotice?.("Essa regex não é válida.");
        return;
      }
    }
    save({
      ...config,
      rules: [...config.rules, { ...draft, id: `r${Date.now().toString(36)}`, enabled: true }],
    });
    setDraft({ ...draft, pattern: "", tag: "", folder: "", subfolder: "" });
  };
  return (
    <div className="sf-body">
      <div className="settings-block row">
        <span>
          <strong>Pasta padrão</strong>
          <small>{config.dir || `${base} (pasta do sistema)`}</small>
        </span>
        <span className="settings-buttons">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void pick("Pasta padrão dos downloads").then((dir) => dir && save({ ...config, dir }))
            }
          >
            Mudar
          </Button>
          {config.dir && (
            <Button variant="ghost" size="sm" onClick={() => save({ ...config, dir: "" })}>
              Usar a do sistema
            </Button>
          )}
        </span>
      </div>
      <Toggle
        label="Organizar por tipo"
        hint="PDF, imagens, vídeos, áudio e compactados vão para a pasta de cada tipo."
        checked={config.byTypeOn}
        onChange={(byTypeOn) => save({ ...config, byTypeOn })}
      />
      {config.byTypeOn && (
        <ul className="settings-list sf-types">
          {(Object.keys(TYPE_LABELS) as DownloadFileType[]).map((type) => (
            <li key={type}>
              <span>
                <strong>{TYPE_LABELS[type]}</strong>
                <small>{config.byType[type]}</small>
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void pick(`Pasta para ${TYPE_LABELS[type]}`).then(
                    (dir) => dir && save({ ...config, byType: { ...config.byType, [type]: dir } }),
                  )
                }
              >
                Mudar
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="settings-block">
        <strong>Regras de catálogo</strong>
        <small>
          Valem para cada download novo, de cima para baixo. A última pasta vence; etiquetas e
          subpastas se somam.
        </small>
      </div>
      {config.rules.length > 0 && (
        <ul className="settings-list sf-rules">
          {config.rules.map((rule) => (
            <li key={rule.id} className={cn(!rule.enabled && "off")}>
              <span>
                <strong>
                  {RULE_LABELS[rule.match]}: <code>{rule.pattern}</code>
                </strong>
                <small>
                  {[
                    rule.tag && `etiqueta "${rule.tag}"`,
                    rule.folder && `pasta ${rule.folder}`,
                    rule.subfolder && `subpasta ${rule.subfolder}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </span>
              <span className="settings-buttons">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    save({
                      ...config,
                      rules: config.rules.map((item) =>
                        item.id === rule.id ? { ...item, enabled: !item.enabled } : item,
                      ),
                    })
                  }
                >
                  {rule.enabled ? "Pausar" : "Ligar"}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Apagar regra"
                  onClick={() =>
                    save({ ...config, rules: config.rules.filter((item) => item.id !== rule.id) })
                  }
                >
                  <Trash2 />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="sf-rule-form">
        <select
          className="sf-select"
          aria-label="Quando"
          value={draft.match}
          onChange={(event) =>
            setDraft({ ...draft, match: event.target.value as DownloadRule["match"] })
          }
        >
          <option value="domain">Site (domínio)</option>
          <option value="type">Tipo ou extensão</option>
          <option value="name">Nome (regex)</option>
        </select>
        <input
          aria-label="Padrão"
          placeholder={
            draft.match === "domain"
              ? "github.com"
              : draft.match === "type"
                ? "pdf, .zip, image/*"
                : "^Nota.*\\.pdf$"
          }
          value={draft.pattern}
          onChange={(event) => setDraft({ ...draft, pattern: event.target.value })}
        />
        <input
          aria-label="Etiqueta"
          placeholder="Etiqueta (opcional)"
          value={draft.tag}
          maxLength={32}
          onChange={(event) => setDraft({ ...draft, tag: event.target.value })}
        />
        <input
          aria-label="Subpasta"
          placeholder="Subpasta (opcional)"
          value={draft.subfolder}
          onChange={(event) => setDraft({ ...draft, subfolder: event.target.value })}
        />
        <Button
          variant="outline"
          size="sm"
          title={draft.folder || "Pasta (opcional)"}
          onClick={() =>
            void pick("Pasta da regra").then((folder) => folder && setDraft({ ...draft, folder }))
          }
        >
          {draft.folder ? "Pasta ✓" : "Pasta…"}
        </Button>
        <Button size="sm" onClick={addRule}>
          <Plus /> Adicionar
        </Button>
      </div>
      <div className="settings-block row">
        <span>
          <strong>Regras em arquivo</strong>
          <small>Exportar e importar as pastas e regras (JSON). O histórico não entra.</small>
        </span>
        <span className="settings-buttons">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void desktop.downloadsExport({ what: "rules" })}
          >
            Exportar
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void desktop.downloadsImportRules().then((result) => {
                if (result.ok && result.config) setConfig(result.config);
                else if (!result.ok && result.error)
                  onNotice?.("Esse arquivo não tem regras de download do Agzos.");
              })
            }
          >
            Importar
          </Button>
        </span>
      </div>
      <div className="settings-block row">
        <span>
          <strong>Tema do gerenciador</strong>
          <small>agzos://downloads (Ctrl+J)</small>
        </span>
        <ThemeSelect
          label="Tema do gerenciador"
          value={features.downloadsTheme}
          onChange={(downloadsTheme) => setFeatures({ downloadsTheme })}
        />
      </div>
    </div>
  );
}

const MODE_LABELS: Record<PageThemeMode, string> = {
  lightning: "Lightning",
  dark: "Dark",
  auto: "Auto (sistema)",
};

/** Tema da página: sites com Dark/Auto e o atalho. */
export function PageThemeSettings(props: FeatureProps) {
  const { desktop } = props;
  const [map, setMap] = useState<Record<string, PageThemeMode> | null>(null);
  const [domain, setDomain] = useState("");
  const [mode, setMode] = useState<PageThemeMode>("auto");
  useEffect(() => {
    if (desktop) void desktop.pageThemeList().then(setMap);
  }, [desktop]);
  if (!desktop) return <p className="sf-note">O tema por site funciona no app para computador.</p>;
  const entries = Object.entries(map ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const select = (value: PageThemeMode, onChange: (mode: PageThemeMode) => void, label: string) => (
    <select
      className="sf-select"
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value as PageThemeMode)}
    >
      {(Object.keys(MODE_LABELS) as PageThemeMode[]).map((item) => (
        <option key={item} value={item}>
          {MODE_LABELS[item]}
        </option>
      ))}
    </select>
  );
  return (
    <div className="sf-body">
      <p className="sf-note">
        O botão de lua/sol na barra de endereço liga o Dark só no site aberto (vale para o domínio
        todo, em todas as guias, e fica gravado). Fotos, vídeos, canvas e logos ficam como estão.
        Auto segue o tema claro/escuro do sistema.
      </p>
      {entries.length ? (
        <ul className="settings-list sf-types">
          {entries.map(([site, value]) => (
            <li key={site}>
              <span>
                <strong>{site}</strong>
              </span>
              {select(
                value,
                (next) => void desktop.pageThemeSetDomain(site, next).then(setMap),
                `Tema de ${site}`,
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="sf-note">Nenhum site em Dark ou Auto ainda.</p>
      )}
      <div className="sf-rule-form sf-theme-form">
        <input
          aria-label="Site"
          placeholder="exemplo.com"
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
        />
        {select(mode, setMode, "Tema do site")}
        <Button
          size="sm"
          disabled={!domain.trim()}
          onClick={() =>
            void desktop.pageThemeSetDomain(domain, mode).then((next) => {
              setMap(next);
              setDomain("");
            })
          }
        >
          <Plus /> Adicionar
        </Button>
      </div>
      {entries.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void desktop.pageThemeForget(null).then(setMap)}
        >
          Todos os sites em Lightning
        </Button>
      )}
      <ShortcutField id="page-theme.toggle" {...props} />
    </div>
  );
}

/** ColorTools: formato da cópia, tema do painel, histórico e atalhos. */
export function ColorToolsSettings(props: FeatureProps) {
  const { features, setFeatures } = props;
  const colors = features.colors;
  return (
    <div className="sf-body">
      <div className="settings-block row">
        <span>
          <strong>Copiar ao escolher uma cor</strong>
          <small>Conta-gotas, "Copiar cor do pixel" e cliques nas paletas.</small>
        </span>
        <select
          className="sf-select"
          aria-label="Formato da cópia"
          value={colors.autoCopy}
          onChange={(event) =>
            setFeatures({
              colors: { ...colors, autoCopy: event.target.value as typeof colors.autoCopy },
            })
          }
        >
          <option value="hex">HEX</option>
          <option value="rgb">RGB</option>
          <option value="hsl">HSL</option>
          <option value="off">Não copiar</option>
        </select>
      </div>
      <div className="settings-block row">
        <span>
          <strong>Tema do painel</strong>
        </span>
        <ThemeSelect
          label="Tema do ColorTools"
          value={colors.theme}
          onChange={(theme) => setFeatures({ colors: { ...colors, theme } })}
        />
      </div>
      <div className="settings-block row">
        <span>
          <strong>Cores no histórico</strong>
          <small>As fixadas não contam.</small>
        </span>
        <input
          className="sf-number"
          type="number"
          min={10}
          max={500}
          value={colors.historyLimit}
          aria-label="Cores no histórico"
          onChange={(event) =>
            setFeatures({
              colors: {
                ...colors,
                historyLimit: Math.min(500, Math.max(10, Number(event.target.value) || 60)),
              },
            })
          }
        />
      </div>
      <ShortcutField id="colors.eyedropper" {...props} />
      <ShortcutField id="colors.panel" {...props} />
    </div>
  );
}

/** PDF Tools: limite, painel, nuvem, IA, OCR, senhas lembradas e atalho. */
export function PdfToolsSettings(props: FeatureProps) {
  const { desktop, features, setFeatures, onNotice } = props;
  const pdf = features.pdf;
  const [targets, setTargets] = useState<PdfCloudTarget[] | null>(null);
  useEffect(() => {
    if (desktop && pdf.cloud) void desktop.pdfCloudTargets().then(setTargets);
  }, [desktop, pdf.cloud]);
  const set = (patch: Partial<FeaturePrefs["pdf"]>) => setFeatures({ pdf: { ...pdf, ...patch } });
  return (
    <div className="sf-body">
      <div className="settings-block row">
        <span>
          <strong>Tamanho máximo</strong>
          <small>PDFs maiores não abrem (o processamento é local).</small>
        </span>
        <span className="settings-buttons">
          <input
            className="sf-number"
            type="number"
            min={PDF_MAX_MB.min}
            max={PDF_MAX_MB.max}
            value={pdf.maxMb}
            aria-label="Tamanho máximo em MB"
            onChange={(event) =>
              set({
                maxMb: Math.min(
                  PDF_MAX_MB.max,
                  Math.max(PDF_MAX_MB.min, Number(event.target.value) || PDF_MAX_MB.initial),
                ),
              })
            }
          />
          MB
        </span>
      </div>
      <div className="settings-block row">
        <span>
          <strong>Ferramenta aberta</strong>
          <small>Painel ao lado das páginas ou janela por cima.</small>
        </span>
        <select
          className="sf-select"
          aria-label="Onde abrir a ferramenta"
          value={pdf.dock}
          onChange={(event) => set({ dock: event.target.value as "side" | "modal" })}
        >
          <option value="side">Painel lateral</option>
          <option value="modal">Janela (modal)</option>
        </select>
      </div>
      <Toggle
        label="Salvar na nuvem"
        hint="Mostra Google Drive, Dropbox e OneDrive quando a pasta deles existe neste computador (o app do serviço envia). Cada arquivo pede confirmação."
        checked={pdf.cloud}
        onChange={(cloud) => set({ cloud })}
      />
      {pdf.cloud && targets && (
        <p className="sf-note">
          {targets.length
            ? `Encontrado: ${targets.map((item) => item.name).join(", ")}.`
            : "Nenhuma pasta do Google Drive, Dropbox ou OneDrive encontrada."}
        </p>
      )}
      <Toggle
        label="Resumo com IA"
        hint="Usa o Agzos AI (Groq): o texto das páginas sai do computador, com confirmação a cada arquivo. Offline fica indisponível."
        checked={pdf.ai}
        onChange={(ai) => set({ ai })}
      />
      <div className="settings-block row">
        <span>
          <strong>Senhas de PDF lembradas</strong>
          <small>
            Só existem se você marcou "Lembrar" ao abrir (AES-256, chave no chaveiro do sistema).
          </small>
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={!desktop}
          onClick={() =>
            void desktop
              ?.pdfPasswordForget(null)
              .then(() => onNotice?.("Senhas de PDF esquecidas."))
          }
        >
          Esquecer todas
        </Button>
      </div>
      <ShortcutField id="pdf.open" {...props} />
    </div>
  );
}
