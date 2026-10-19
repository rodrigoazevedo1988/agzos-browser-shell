import {
  Check,
  Cpu,
  Info,
  Keyboard,
  Palette,
  PartyPopper,
  Puzzle,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import symbolUrl from "@/assets/agzos-symbol-red.svg";
import { Button } from "@/components/ui/button";
import { commands, shortcutLabel } from "@/features/browser/commands";
import type {
  PermissionType,
  PermissionValue,
  SitePermission,
  UpdateState,
} from "@/features/browser/desktop";
import { engines } from "@/features/browser/engines";
import { HIBERNATE_MINUTES, type Prefs } from "@/features/browser/store/state";
import { PermissionSelect } from "@/features/site/panel";
import { PERMISSION_LABELS } from "@/features/site/permissions";
import { playSound } from "@/features/sounds/player";
import { SOUND_TICKS, soundGain, type SoundTick } from "@/features/sounds/sounds";
import { Toggle } from "@/features/ui/toggle";
import { ACTION_LABELS, GESTURES } from "@/features/gestures/gestures";
import { FEATURE_SHORTCUTS } from "@/features/browser/feature-prefs";
import {
  CATEGORIES,
  DEFAULT_CATEGORY,
  categorize,
  normalize,
  resolveSection,
  type CategoryId,
  type SettingsCategory,
  type SettingsGroup,
  type SettingsSectionId,
} from "./categories";
import { InstalledAppsSetting } from "./apps-rows";
import { ExtensionsSetting, WidevineSetting } from "./v45-rows";
import {
  ColorToolsSettings,
  DownloadsFeatureSettings,
  PageThemeSettings,
  PdfToolsSettings,
  ShortcutField,
} from "./v47-rows";
import { FormAutofillSettings } from "./autofill-rows";
import { TranslateSettings } from "./translate-rows";
import { DevtoolsSettings } from "./v48-rows";
import { desktopBridge } from "@/features/browser/desktop";
import { AiKeySettings, GestureRow, GpuSettings, TerminalShellSelect } from "./v4-rows";
import {
  SshConnectionsSetting,
  SshKeysSetting,
  TerminalAliasSetting,
  TerminalApiKeysSetting,
  TerminalDockSetting,
  TerminalFontSetting,
  TerminalShortcutList,
  TerminalSnippetSetting,
  TerminalThemeSetting,
  TerminalToolsSetting,
  TerminalVoiceSetting,
} from "@/features/terminal/settings";
import { ColorPicker } from "@/features/browser/ui/color-picker";
import { cn } from "@/lib/utils";

function updateText(update: UpdateState): string {
  switch (update.status) {
    case "checking":
      return "Procurando atualizações…";
    case "up-to-date":
      return "Você está na versão mais recente.";
    case "downloading":
      return `Baixando a versão ${update.version}… ${Math.round((update.progress ?? 0) * 100)}%`;
    case "ready":
      return `Versão ${update.version} pronta. Entra ao reiniciar (ou quando você fechar o app).`;
    case "unsupported":
    case "error":
      return update.error ?? "Não foi possível verificar.";
    default:
      return update.error ?? "Atualizações automáticas ligadas.";
  }
}

export type { SettingsSectionId };

export type SettingsPageProps = {
  prefs: Prefs;
  setPrefs: (patch: Partial<Prefs>) => void;
  onUnpauseHost: (host: string) => void;
  /** false na web: recursos que só existem no app ficam de fora. */
  desktop: boolean;
  isMac: boolean;
  permissions: SitePermission[] | null;
  onPermissionChange: (origin: string, type: PermissionType, value: PermissionValue | null) => void;
  update: UpdateState | null;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
  appVersion: string | null;
  onShowWhatsNew: (() => void) | null;
  downloadsDir: string | null;
  onOpenDownloadsDir: (() => void) | null;
  onOpenHistory: () => void;
  onOpenBookmarks: () => void;
  onReset: () => void;
  /** Guias da web abertas (a última ativa primeiro): "Tentar instalar este site como app". */
  siteTabs?: { id: number; url: string; title: string }[];
  /** Abre um endereço numa guia nova (popup e opções de extensão, 4.5). */
  onOpenUrl?: (url: string) => void;
  /** Seção pedida de fora (4.5: "Extensões" da barra e das Ferramentas). */
  requestedSection?: { id: SettingsSectionId; at: number } | null;
  /** 4.7: avisos da casca (regras de download, senhas esquecidas…). */
  onNotice?: (text: string) => void;
};

/** Uma linha das Configurações: `category` e `group` dizem onde ela fica (sem eles, `categorize` escolhe). */
export type Row = {
  id: string;
  label: string;
  keywords?: string;
  category?: CategoryId;
  group?: string;
  node: ReactNode;
};

/** Atalhos do registro de comandos (a lista nunca fica desatualizada). */
function shortcutRows(isMac: boolean): Row[] {
  return commands
    .filter(
      (command) =>
        command.shortcuts?.length &&
        typeof command.label === "string" &&
        !/^tab\.select-[2-8]$/.test(command.id),
    )
    .map((command) => {
      const label =
        command.id === "tab.select-1" ? "Ir para a guia 1 a 8" : (command.label as string);
      const keys =
        command.id === "tab.select-1"
          ? `${isMac ? "⌘" : "Ctrl+"}1…8`
          : (shortcutLabel(command, isMac) ?? "");
      return {
        id: `atalho-${command.id}`,
        category: "atalhos",
        group: "atalhos-teclado",
        label,
        keywords: `atalho teclado ${keys}`,
        node: (
          <div className="settings-shortcut">
            <span>{label}</span>
            <kbd>{keys}</kbd>
          </div>
        ),
      };
    });
}

/**
 * Todas as linhas das Configurações, cada uma com a categoria e o grupo dela (a página
 * agrupa na ordem de CATEGORIES). Exportado para os testes conferirem onde cada uma fica.
 */
export function buildSettingsRows(
  props: SettingsPageProps,
  goTo: (id: CategoryId) => void = () => {},
): Row[] {
  const { prefs, setPrefs, desktop } = props;
  const setTerminal = (patch: Partial<Prefs["terminal"]>) =>
    setPrefs({ terminal: { ...prefs.terminal, ...patch } });
  const rows: Row[] = [
    {
      id: "tema",
      category: "aparencia",
      group: "tema-layout",
      label: "Tema",
      keywords: "tema escuro claro cores noite dark light",
      node: (
        <div className="settings-block">
          <div className="flex flex-col gap-1">
            <strong>Tema</strong>
            <small>Vale para a interface do navegador; as páginas dos sites não mudam.</small>
          </div>
          <div className="theme-choice" role="radiogroup" aria-label="Tema">
            {(
              [
                { dark: true, label: "Escuro" },
                { dark: false, label: "Claro" },
              ] as const
            ).map((option) => (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={prefs.dark === option.dark}
                onClick={() => setPrefs({ dark: option.dark })}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ),
    },
    {
      id: "guias-verticais",
      category: "aparencia",
      group: "tema-layout",
      label: "Guias na vertical",
      keywords: "abas barra lateral horizontal",
      node: (
        <Toggle
          label="Guias na vertical"
          hint="Barra de guias à esquerda, em vez de em cima"
          checked={prefs.orientation === "vertical"}
          onChange={(vertical) => setPrefs({ orientation: vertical ? "vertical" : "horizontal" })}
        />
      ),
    },
    {
      id: "barra-favoritos",
      category: "aparencia",
      group: "tema-layout",
      label: "Barra de favoritos",
      keywords: "bookmarks",
      node: (
        <Toggle
          label="Barra de favoritos"
          hint={`Abaixo da barra de endereço (${props.isMac ? "⌘" : "Ctrl"} Shift B)`}
          checked={prefs.bookmarksBar}
          onChange={(bookmarksBar) => setPrefs({ bookmarksBar })}
        />
      ),
    },
    {
      id: "janela-de-video",
      category: "aparencia",
      group: "tema-layout",
      label: "Picture-in-Picture com controles",
      keywords: "pip picture in picture video flutuante janela volume velocidade qualidade",
      node: (
        <Toggle
          label="Picture-in-Picture com controles"
          hint="Janela de vídeo do Agzos: volume, velocidade, ±10 s e qualidade. Desligado, usa o PiP simples do Chromium"
          checked={prefs.pipMode === "agzos"}
          onChange={(on) => setPrefs({ pipMode: on ? "agzos" : "nativo" })}
        />
      ),
    },
    {
      id: "sidebar",
      category: "aparencia",
      group: "tema-layout",
      label: "Barra lateral",
      keywords: "painéis whatsapp telegram gx control atalhos lateral ocultar",
      node: (
        <Toggle
          label="Barra lateral"
          hint="GX Control e os apps (WhatsApp, Claude, YouTube…) à esquerda da página"
          checked={prefs.sidebar}
          onChange={(sidebar) => setPrefs({ sidebar })}
        />
      ),
    },
    {
      id: "ai",
      category: "aparencia",
      group: "tema-layout",
      label: "Agzos AI visível",
      keywords: "assistente inteligencia artificial lateral",
      node: (
        <Toggle
          label="Agzos AI visível"
          hint="Painel do Agzos AI ao lado da página (Ctrl+Shift+A)"
          checked={prefs.aiOpen}
          onChange={(aiOpen) => setPrefs({ aiOpen })}
        />
      ),
    },
    {
      id: "cor-acento",
      category: "aparencia",
      group: "personalizacao",
      label: "Cor de acento",
      keywords: "cor tema accent color rgb mandala",
      node: (
        <div className="settings-block flex-col items-start gap-4">
          <strong>Cor de acento da interface</strong>
          <ColorPicker
            color={prefs.accentColor}
            onChange={(accentColor) => setPrefs({ accentColor })}
          />
        </div>
      ),
    },
    {
      id: "ui-blur",
      category: "aparencia",
      group: "personalizacao",
      label: "Efeitos visuais da interface",
      keywords: "blur glassmorphism transparencia",
      node: (
        <Toggle
          label="Painéis translúcidos"
          hint="Ativa efeitos de desfoque (glassmorphism) em menus e barra de guias"
          checked={prefs.uiBlur}
          onChange={(uiBlur) => setPrefs({ uiBlur })}
        />
      ),
    },
    {
      id: "papel-parede",
      category: "aparencia",
      group: "personalizacao",
      label: "Papel de parede",
      keywords: "fundo imagem background wallpaper",
      node: (
        <div className="settings-block flex-col items-start gap-4">
          <strong>Imagem da Nova aba</strong>
          <div className="flex gap-4 items-center">
            <input
              type="url"
              className="flex-1 bg-muted rounded-md border px-3 py-2 text-sm"
              placeholder="URL da imagem (ex: https://...)"
              value={prefs.backgroundImage}
              onChange={(e) => setPrefs({ backgroundImage: e.target.value })}
            />
            <Button variant="outline" size="sm" onClick={() => setPrefs({ backgroundImage: "" })}>
              Remover
            </Button>
          </div>
          {prefs.backgroundImage && (
            <div className="w-full flex flex-col gap-4">
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">Opacidade: {prefs.backgroundOpacity}%</span>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="1"
                  value={prefs.backgroundOpacity}
                  onChange={(e) => setPrefs({ backgroundOpacity: Number(e.target.value) })}
                />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">
                  Desfoque (Blur): {prefs.backgroundBlur}px
                </span>
                <input
                  type="range"
                  min="0"
                  max="20"
                  step="1"
                  value={prefs.backgroundBlur}
                  onChange={(e) => setPrefs({ backgroundBlur: Number(e.target.value) })}
                />
              </label>
            </div>
          )}
        </div>
      ),
    },
    {
      id: "sons-geral",
      category: "aparencia",
      group: "sons",
      label: "Sons da interface",
      keywords: "som audio tick clique mudo silencio",
      node: (
        <Toggle
          label="Sons da interface"
          hint="Ticks curtos ao passar o mouse e ao digitar (desligado, tudo fica em silêncio)"
          checked={prefs.sounds}
          onChange={(sounds) => setPrefs({ sounds })}
        />
      ),
    },
    {
      id: "sons-hover",
      category: "aparencia",
      group: "sons",
      label: "Som ao passar o mouse",
      keywords: "hover barra lateral discador cards tick navegacao",
      node: (
        <Toggle
          label="Som ao passar o mouse"
          hint="Na barra lateral e nos cards do Discador"
          checked={prefs.soundHover}
          disabled={!prefs.sounds}
          onChange={(soundHover) => setPrefs({ soundHover })}
        />
      ),
    },
    {
      id: "sons-teclado",
      category: "aparencia",
      group: "sons",
      label: "Som do teclado",
      keywords: "digitar teclas busca endereco tick",
      node: (
        <Toggle
          label="Som do teclado"
          hint="Na busca, na barra de endereço e nos campos dos modais"
          checked={prefs.soundKeys}
          disabled={!prefs.sounds}
          onChange={(soundKeys) => setPrefs({ soundKeys })}
        />
      ),
    },
    {
      id: "sons-tick",
      category: "aparencia",
      group: "sons",
      label: "Tick do teclado",
      keywords: "som tecla mecanico suave maquina escrever",
      node: (
        <label className="sf-select">
          <span>Tick do teclado</span>
          <span className="settings-inline">
            <select
              value={prefs.soundTick}
              disabled={!prefs.sounds}
              onChange={(event) => {
                const soundTick = event.target.value as SoundTick;
                setPrefs({ soundTick });
                playSound(soundTick, soundGain({ ...prefs, soundKeys: true }, "key"));
              }}
            >
              {SOUND_TICKS.map((tick) => (
                <option key={tick.id} value={tick.id}>
                  {tick.label}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!prefs.sounds}
              onClick={() =>
                playSound(prefs.soundTick, soundGain({ ...prefs, soundKeys: true }, "key"))
              }
            >
              Ouvir
            </Button>
          </span>
        </label>
      ),
    },
    {
      id: "sons-volume",
      category: "aparencia",
      group: "sons",
      label: "Volume dos sons",
      keywords: "volume alto baixo",
      node: (
        <label className="settings-range">
          <span>Volume: {prefs.soundVolume}%</span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={prefs.soundVolume}
            disabled={!prefs.sounds}
            aria-label="Volume dos sons"
            onChange={(event) => setPrefs({ soundVolume: Number(event.target.value) })}
            onPointerUp={() => playSound("nav", soundGain({ ...prefs, soundHover: true }, "hover"))}
          />
        </label>
      ),
    },
    {
      id: "motor",
      category: "geral",
      group: "pesquisa",
      label: "Motor de busca",
      keywords: "duckduckgo yandex pesquisa buscador",
      node: (
        <div className="engine-choice">
          {engines.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn("engine-option", prefs.engine === item.id && "selected")}
              aria-pressed={prefs.engine === item.id}
              onClick={() => setPrefs({ engine: item.id })}
            >
              <Search />
              <span>
                <strong>{item.name}</strong>
                <small>{item.hint}</small>
              </span>
              {prefs.engine === item.id && <Check />}
            </button>
          ))}
        </div>
      ),
    },
    {
      id: "sugestoes",
      category: "geral",
      group: "pesquisa",
      label: "Sugestões do buscador",
      keywords: "omnibox autocompletar",
      node: (
        <Toggle
          label="Sugestões do buscador"
          hint="O que você digita na barra vai para o motor de busca"
          checked={prefs.searchSuggestions}
          onChange={(searchSuggestions) => setPrefs({ searchSuggestions })}
        />
      ),
    },
    {
      id: "ia-chave",
      category: "ia",
      group: "ia-groq",
      label: "Chave da API Groq",
      keywords: "groq api chave key modelo llama inteligencia artificial assistente",
      node: <AiKeySettings model={prefs.aiModel} onModel={(aiModel) => setPrefs({ aiModel })} />,
    },
    ...GESTURES.map((gesture): Row => ({
      id: `gesto-${gesture.id}`,
      category: "atalhos",
      group: "gestos",
      label: gesture.label,
      keywords: `gestos trackpad mouse ${gesture.hint} ${ACTION_LABELS[prefs.gestures[gesture.id].action]}`,
      node: (
        <GestureRow
          id={gesture.id}
          label={gesture.label}
          hint={gesture.hint}
          fixed={Boolean(gesture.fixed)}
          setting={prefs.gestures[gesture.id]}
          onChange={(setting) =>
            setPrefs({ gestures: { ...prefs.gestures, [gesture.id]: setting } })
          }
        />
      ),
    })),
    {
      id: "escudo",
      category: "privacidade",
      group: "bloqueador",
      label: "Bloquear anúncios e rastreadores",
      keywords: "escudo adblock propaganda",
      node: (
        <Toggle
          label="Bloquear anúncios e rastreadores"
          hint="Em todos os sites"
          checked={prefs.shield}
          onChange={(shield) => setPrefs({ shield })}
        />
      ),
    },
    {
      id: "sites-pausados",
      category: "privacidade",
      group: "bloqueador",
      label: "Sites sem bloqueio",
      keywords: "escudo pausado excecao permitido",
      node: (
        <div className="settings-block">
          <strong>Sites sem bloqueio</strong>
          {prefs.pausedHosts.length ? (
            <ul className="settings-list">
              {prefs.pausedHosts.map((host) => (
                <li key={host}>
                  <span>{host}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Voltar a bloquear em ${host}`}
                    onClick={() => props.onUnpauseHost(host)}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <small>O escudo está ativo em todos os sites.</small>
          )}
        </div>
      ),
    },
    ...(props.permissions
      ? ([
          {
            id: "permissoes",
            category: "privacidade",
            group: "permissoes",
            label: "Permissões dos sites",
            keywords: "camera microfone notificacoes localizacao",
            node: (
              <div className="settings-block">
                <strong>Permissões dos sites</strong>
                {props.permissions.length === 0 ? (
                  <small>
                    Quando você permitir ou bloquear algo com "Lembrar", o site aparece aqui.
                  </small>
                ) : (
                  <ul className="permission-list">
                    {props.permissions.map((item) => {
                      const host = new URL(item.origin).host;
                      return (
                        <li key={`${item.origin}-${item.type}`}>
                          <span>
                            <strong>{host}</strong>
                            <small>{PERMISSION_LABELS[item.type]}</small>
                          </span>
                          <PermissionSelect
                            label={`${PERMISSION_LABELS[item.type]} em ${host}`}
                            value={item.value}
                            onChange={(value) =>
                              props.onPermissionChange(item.origin, item.type, value)
                            }
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ),
          },
        ] satisfies Row[])
      : []),
    {
      id: "limpar",
      category: "privacidade",
      group: "dados",
      label: "Limpar dados de navegação",
      keywords: "historico apagar",
      node: (
        <div className="settings-block row">
          <span>
            <strong>Limpar dados de navegação</strong>
            <small>Apague o histórico por período na página do histórico.</small>
          </span>
          <Button variant="outline" size="sm" onClick={props.onOpenHistory}>
            Abrir histórico
          </Button>
        </div>
      ),
    },
  ];

  if (desktop) {
    rows.push(
      {
        id: "gpu",
        category: "desempenho",
        group: "aceleracao",
        label: "Aceleração de hardware forçada",
        keywords: "gpu video placa youtube travando decodificacao hardware",
        node: <GpuSettings />,
      },
      {
        id: "hibernar",
        category: "desempenho",
        group: "hibernacao",
        label: "Hibernar guias sem uso",
        keywords: "memoria ram economia dormir",
        node: (
          <Toggle
            label="Hibernar guias sem uso"
            hint="Libera a memória das guias paradas; elas recarregam ao voltar"
            checked={prefs.hibernate}
            onChange={(hibernate) => setPrefs({ hibernate })}
          />
        ),
      },
      ...(prefs.hibernate
        ? ([
            {
              id: "hibernar-tempo",
              category: "desempenho",
              group: "hibernacao",
              label: "Hibernar depois de",
              keywords: "minutos tempo memoria",
              node: (
                <label className="sf-select">
                  <span>Hibernar depois de</span>
                  <select
                    value={prefs.hibernateMinutes}
                    onChange={(event) => setPrefs({ hibernateMinutes: Number(event.target.value) })}
                  >
                    {[...HIBERNATE_MINUTES]
                      .sort((a, b) => a - b)
                      .map((minutes) => (
                        <option key={minutes} value={minutes}>
                          {minutes < 60 ? `${minutes} minutos` : `${minutes / 60} h`}
                        </option>
                      ))}
                  </select>
                </label>
              ),
            },
          ] satisfies Row[])
        : []),
    );
  }

  if (desktop) {
    rows.push(
      {
        id: "terminal-shell",
        category: "terminal",
        group: "terminal-basico",
        label: "Shell padrão",
        keywords: "terminal powershell pwsh cmd zsh bash console",
        node: (
          <TerminalShellSelect
            value={prefs.terminalShell}
            onChange={(terminalShell) => setPrefs({ terminalShell })}
          />
        ),
      },
      {
        id: "terminal-pasta",
        category: "terminal",
        group: "terminal-basico",
        label: "Pasta inicial",
        keywords: "terminal diretorio pasta cwd inicial",
        node: (
          <label className="settings-select settings-text">
            <span>
              Pasta inicial
              <small>Vazio: a pasta do usuário. Cada aba volta na última pasta dela.</small>
            </span>
            <input
              type="text"
              spellCheck={false}
              placeholder="Pasta do usuário"
              defaultValue={prefs.terminalCwd}
              onBlur={(event) => setPrefs({ terminalCwd: event.target.value.trim() })}
            />
          </label>
        ),
      },
      {
        id: "terminal-posicao",
        category: "terminal",
        group: "terminal-basico",
        label: "Posição do terminal",
        keywords: "terminal embaixo direita lateral vertical horizontal janela flutuante pip",
        node: <TerminalDockSetting settings={prefs.terminal} onChange={setTerminal} />,
      },
      {
        id: "terminal-tema",
        category: "terminal",
        group: "terminal-basico",
        label: "Tema e cores do terminal",
        keywords: "terminal cor fundo texto cursor tema dracula solarized monokai claro",
        node: <TerminalThemeSetting settings={prefs.terminal} onChange={setTerminal} />,
      },
      {
        id: "terminal-fonte",
        category: "terminal",
        group: "terminal-basico",
        label: "Fonte do terminal",
        keywords: "terminal fonte tamanho cursor cascadia jetbrains fira menlo consolas",
        node: <TerminalFontSetting settings={prefs.terminal} onChange={setTerminal} />,
      },
      {
        id: "terminal-voz",
        category: "terminal",
        group: "terminal-basico",
        label: "Modo voz",
        keywords: "terminal voz microfone falar transcrever whisper groq ditado",
        node: <TerminalVoiceSetting settings={prefs.terminal} onChange={setTerminal} />,
      },
      {
        id: "terminal-atalhos",
        category: "terminal",
        group: "terminal-basico",
        label: "Atalhos do terminal",
        keywords: "terminal atalhos teclado sessao nova fechar fonte",
        node: <TerminalShortcutList />,
      },
    );
    rows.push(
      {
        id: "terminal-aliases",
        category: "terminal",
        group: "terminal-automacao",
        label: "Aliases",
        keywords: "terminal alias atalho comando apelido",
        node: <TerminalAliasSetting settings={prefs.terminal} onChange={setTerminal} />,
      },
      {
        id: "terminal-comandos",
        category: "terminal",
        group: "terminal-automacao",
        label: "Comandos rápidos",
        keywords: "terminal snippets comandos rapidos lançador",
        node: <TerminalSnippetSetting settings={prefs.terminal} onChange={setTerminal} />,
      },
      {
        id: "terminal-ferramentas",
        category: "terminal",
        group: "terminal-automacao",
        label: "Ferramentas de IA",
        keywords: "terminal ia claude code opencode kiro antigravity agy freebuff codex gemini",
        node: <TerminalToolsSetting settings={prefs.terminal} onChange={setTerminal} />,
      },
      {
        id: "terminal-chaves-api",
        category: "terminal",
        group: "terminal-chaves",
        label: "Chaves de API",
        keywords:
          "terminal api chave anthropic openai gemini openrouter groq deepseek variavel ambiente",
        node: <TerminalApiKeysSetting settings={prefs.terminal} onChange={setTerminal} />,
      },
      {
        id: "terminal-ssh-chaves",
        category: "terminal",
        group: "terminal-chaves",
        label: "Chaves SSH",
        keywords: "ssh chave ed25519 publica gerar keygen",
        node: <SshKeysSetting />,
      },
      {
        id: "terminal-ssh",
        category: "terminal",
        group: "terminal-chaves",
        label: "Conexões SSH",
        keywords: "ssh servidor conexao host usuario porta",
        node: <SshConnectionsSetting settings={prefs.terminal} onChange={setTerminal} />,
      },
    );
    rows.push({
      id: "apps-pwa",
      category: "apps",
      group: "apps-pwa",
      label: "Apps instalados (PWA)",
      keywords: "pwa app instalar desinstalar janela atalho manifesto tentar instalar este site",
      node: <InstalledAppsSetting siteTabs={props.siteTabs ?? []} />,
    });
    rows.push(
      {
        id: "extensoes-lista",
        category: "apps",
        group: "extensoes",
        label: "Extensões (Manifest V3 e V2)",
        keywords: "extensão extensao chrome web store descompactada mv3 mv2 plugin addon",
        node: <ExtensionsSetting onOpenUrl={(url) => props.onOpenUrl?.(url)} />,
      },
      {
        id: "preenchimento-formularios",
        category: "privacidade",
        group: "preenchimento",
        label: "Preenchimento automático de formulários",
        keywords:
          "autofill preencher formulário perfil pessoal trabalho endereço cpf cnpj cep telefone campos aprendidos nunca preencher",
        node: <FormAutofillSettings desktop={desktop ? desktopBridge() : null} />,
      },
      {
        id: "widevine",
        category: "privacidade",
        group: "conteudo-protegido",
        label: "Conteúdo protegido (Widevine)",
        keywords: "drm widevine netflix spotify protegido video musica",
        node: <WidevineSetting />,
      },
    );
  }

  rows.push(
    {
      id: "abrir",
      category: "geral",
      group: "inicializacao",
      label: "Ao abrir",
      keywords: "sessao restaurar abas iniciar",
      node: (
        <div className="settings-block">
          <strong>Ao abrir</strong>
          <small>
            O Agzos volta com as janelas e guias da última vez, inclusive depois de um fechamento
            inesperado.
          </small>
        </div>
      ),
    },
    {
      id: "restaurar",
      category: "geral",
      group: "inicializacao",
      label: "Restaurar abas iniciais",
      keywords: "limpar guias reset",
      node: (
        <div className="settings-block row">
          <span>
            <strong>Restaurar abas iniciais</strong>
            <small>Fecha as guias desta janela e abre uma Nova aba.</small>
          </span>
          <Button variant="outline" size="sm" onClick={props.onReset}>
            Restaurar
          </Button>
        </div>
      ),
    },
  );

  if (desktop) {
    rows.push({
      id: "pasta",
      category: "geral",
      group: "downloads",
      label: "Pasta dos downloads",
      keywords: "arquivos salvar local",
      node: (
        <div className="settings-block row">
          <span>
            <strong>Pasta dos downloads</strong>
            <small>{props.downloadsDir ?? "Pasta Downloads do sistema"}</small>
          </span>
          {props.onOpenDownloadsDir && (
            <Button variant="outline" size="sm" onClick={props.onOpenDownloadsDir}>
              Abrir pasta
            </Button>
          )}
        </div>
      ),
    });
  }

  // 4.7: Configurações > Recursos.
  const featureProps = {
    desktop: desktop ? desktopBridge() : null,
    features: prefs.features,
    setFeatures: (patch: Partial<Prefs["features"]>) =>
      setPrefs({ features: { ...prefs.features, ...patch } }),
    isMac: props.isMac,
    ...(props.onNotice ? { onNotice: props.onNotice } : {}),
  };
  rows.push(
    {
      id: "recurso-downloads",
      category: "geral",
      group: "downloads",
      label: "Downloads",
      keywords: "gerenciador pasta tipo regra etiqueta exportar ctrl+j",
      node: <DownloadsFeatureSettings {...featureProps} />,
    },
    {
      id: "recurso-tema",
      category: "ferramentas",
      group: "tema-pagina",
      label: "Tema da página",
      keywords: "dark lightning escuro claro site domínio lua sol",
      node: <PageThemeSettings {...featureProps} />,
    },
    {
      id: "recurso-cores",
      category: "ferramentas",
      group: "colortools",
      label: "ColorTools",
      keywords: "cor conta-gotas paleta gradiente hex rgb hsl colorzilla",
      node: <ColorToolsSettings {...featureProps} />,
    },
    {
      id: "recurso-pdf",
      category: "ferramentas",
      group: "pdf",
      label: "PDF Tools",
      keywords: "pdf editar comprimir ocr senha nuvem ia resumo",
      node: <PdfToolsSettings {...featureProps} />,
    },
    {
      id: "recurso-devtools",
      category: "ferramentas",
      group: "devtools",
      label: "DevTools",
      keywords: "desenvolvedor inspecionar f12 console elementos dispositivo debug",
      node: <DevtoolsSettings desktop={featureProps.desktop} isMac={props.isMac} />,
    },
    {
      id: "recurso-traducao",
      category: "ferramentas",
      group: "traducao",
      label: "Tradução de páginas e textos",
      keywords:
        "traduzir tradução idioma língua destino bilíngue glossário não traduzir tom sempre nunca cache",
      node: <TranslateSettings {...featureProps} />,
    },
  );

  rows.push(...shortcutRows(props.isMac), {
    // Os mesmos campos dos cards das ferramentas: a busca por "atalho" acha os dois.
    id: "atalhos-ferramentas",
    category: "atalhos",
    group: "atalhos-teclado",
    label: "Atalhos das ferramentas",
    keywords: `atalho teclado ferramentas ${FEATURE_SHORTCUTS.map((item) => item.label).join(" ")}`,
    node: (
      <div className="settings-block">
        <span className="settings-block row">
          <span>
            <strong>Atalhos das ferramentas</strong>
            <small>Também ficam no card de cada ferramenta.</small>
          </span>
          <Button variant="outline" size="sm" onClick={() => goTo("ferramentas")}>
            Abrir Ferramentas
          </Button>
        </span>
        {FEATURE_SHORTCUTS.map((item) => (
          <ShortcutField key={item.id} id={item.id} {...featureProps} />
        ))}
      </div>
    ),
  });

  const update = props.update;
  rows.push(
    {
      id: "versao",
      category: "sobre",
      group: "versao",
      label: "Versão",
      keywords: "agzos browser sobre",
      node: (
        <div className="settings-block row">
          <span>
            <strong>Agzos Browser {props.appVersion ?? ""}</strong>
            <small>Navegue com clareza. Decida com controle.</small>
          </span>
          {props.onShowWhatsNew && (
            <Button variant="outline" size="sm" onClick={props.onShowWhatsNew}>
              <PartyPopper /> Novidades desta versão
            </Button>
          )}
        </div>
      ),
    },
    ...(update
      ? ([
          {
            id: "atualizacoes",
            category: "sobre",
            group: "versao",
            label: "Atualizações",
            keywords: "atualizar versao nova",
            node: (
              <div className="settings-block settings-update">
                <strong>Atualizações · versão {update.currentVersion}</strong>
                {update.installError && (
                  <p className="update-error" role="alert">
                    {update.installError} Detalhes em <code>{update.logFile}</code>
                  </p>
                )}
                <p role="status">{updateText(update)}</p>
                {update.status === "downloading" && (
                  <div
                    className="download-progress"
                    role="progressbar"
                    aria-label="Baixando atualização"
                  >
                    <i style={{ width: `${Math.round((update.progress ?? 0) * 100)}%` }} />
                  </div>
                )}
                <div className="settings-actions">
                  {update.status === "ready" ? (
                    <Button size="sm" onClick={props.onInstallUpdate}>
                      Reiniciar e atualizar
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={update.status === "checking" || update.status === "downloading"}
                      onClick={props.onCheckUpdate}
                    >
                      Verificar agora
                    </Button>
                  )}
                </div>
              </div>
            ),
          },
        ] satisfies Row[])
      : []),
    {
      id: "biblioteca",
      category: "sobre",
      group: "biblioteca",
      label: "Histórico e favoritos",
      keywords: "biblioteca",
      node: (
        <div className="settings-block row">
          <span>
            <strong>Histórico e favoritos</strong>
          </span>
          <span className="settings-buttons">
            <Button variant="outline" size="sm" onClick={props.onOpenHistory}>
              Histórico
            </Button>
            <Button variant="outline" size="sm" onClick={props.onOpenBookmarks}>
              Favoritos
            </Button>
          </span>
        </div>
      ),
    },
  );
  return rows;
}

type GroupView = { group: SettingsGroup; rows: Row[] };
type CategoryView = { category: SettingsCategory; groups: GroupView[] };

/** Linhas agrupadas na ordem de CATEGORIES; grupos e categorias vazios ficam de fora. */
function groupRows(rows: Row[]): CategoryView[] {
  const placed = rows.map((row) => ({ row, at: categorize(row) }));
  return CATEGORIES.map((category) => ({
    category,
    groups: category.groups
      .map((group) => ({
        group,
        rows: placed
          .filter(({ at }) => at.category === category.id && at.group === group.id)
          .map(({ row }) => row),
      }))
      .filter((item) => item.rows.length),
  })).filter((item) => item.groups.length);
}

const CATEGORY_ICONS: Record<CategoryId, LucideIcon> = {
  geral: Settings2,
  aparencia: Palette,
  privacidade: ShieldCheck,
  desempenho: Cpu,
  ferramentas: Wrench,
  ia: Sparkles,
  terminal: SquareTerminal,
  apps: Puzzle,
  atalhos: Keyboard,
  sobre: Info,
};

/**
 * agzos://configuracoes: categorias na lateral (com subgrupos) e busca em todas, como nos
 * navegadores Chromium, no visual do Agzos. Preferências mudam na hora e valem em todas as
 * janelas.
 */
export function SettingsPage(props: SettingsPageProps) {
  const requested = props.requestedSection ? resolveSection(props.requestedSection.id) : null;
  const [section, setSection] = useState<CategoryId>(requested?.category ?? DEFAULT_CATEGORY);
  const [query, setQuery] = useState("");
  // Seção antiga que virou grupo ("Extensões", "Sons"…): rola até o grupo depois de mostrar.
  const [scrollTo, setScrollTo] = useState<string | null>(requested?.group ?? null);
  const requestedAt = props.requestedSection?.at;
  useEffect(() => {
    if (!props.requestedSection) return;
    const target = resolveSection(props.requestedSection.id);
    setQuery("");
    setSection(target.category);
    setScrollTo(target.group ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedAt]);
  useEffect(() => {
    if (!scrollTo) return;
    document.getElementById(`settings-group-${scrollTo}`)?.scrollIntoView({ block: "start" });
    setScrollTo(null);
  }, [scrollTo, section]);

  const categories = useMemo(
    () =>
      groupRows(
        buildSettingsRows(props, (id) => {
          setQuery("");
          setSection(id);
        }),
      ),
    [props],
  );

  // Cada palavra precisa aparecer (em qualquer ordem): "atalho fav" acha o Ctrl+D. O nome do
  // grupo e o da categoria contam: "terminal ssh" acha as conexões.
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const matches = terms.length
    ? categories
        .map((item) => ({
          ...item,
          groups: item.groups
            .map((view) => ({
              ...view,
              rows: view.rows.filter((row) => {
                const text = normalize(
                  `${row.label} ${row.keywords ?? ""} ${view.group.label} ${item.category.label}`,
                );
                return terms.every((term) => text.includes(term));
              }),
            }))
            .filter((view) => view.rows.length),
        }))
        .filter((item) => item.groups.length)
    : null;
  const current = categories.find((item) => item.category.id === section) ?? categories[0]!;

  const navItem = (item: CategoryView) => {
    const active = !matches && item.category.id === current.category.id;
    const Icon = CATEGORY_ICONS[item.category.id];
    return (
      <button
        key={item.category.id}
        type="button"
        className={cn("settings-nav-item", active && "active")}
        aria-current={active ? "page" : undefined}
        onClick={() => {
          setQuery("");
          setSection(item.category.id);
        }}
      >
        <Icon aria-hidden="true" />
        {item.category.label}
      </button>
    );
  };

  return (
    <div className="settings-page">
      <nav className="settings-nav" aria-label="Seções das configurações">
        <div className="settings-brand">
          <img src={symbolUrl} alt="" />
          <h1>Configurações</h1>
        </div>
        {categories.filter((item) => !item.category.footer).map(navItem)}
        <div className="settings-nav-footer">
          {categories.filter((item) => item.category.footer).map(navItem)}
        </div>
      </nav>
      <main className="settings-main">
        <label className="library-search settings-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            placeholder="Pesquise nas configurações"
            aria-label="Pesquise nas configurações"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        {matches ? (
          matches.length ? (
            matches.map((item) => <CategorySection key={item.category.id} view={item} />)
          ) : (
            <p className="settings-empty">Nenhuma configuração com "{query.trim()}".</p>
          )
        ) : (
          <CategorySection view={current} />
        )}
      </main>
    </div>
  );
}

function CategorySection({ view }: { view: CategoryView }) {
  const { category } = view;
  return (
    <section className="settings-section-card" aria-labelledby={`settings-${category.id}`}>
      <h2 id={`settings-${category.id}`}>{category.label}</h2>
      {view.groups.map(({ group, rows }) => (
        <section
          key={group.id}
          id={`settings-group-${group.id}`}
          className="settings-group"
          aria-labelledby={`settings-group-${group.id}-title`}
        >
          <h3 id={`settings-group-${group.id}-title`}>{group.label}</h3>
          <div className="settings-card">
            {rows.map((row) => (
              <div key={row.id} className="settings-card-row">
                {row.node}
              </div>
            ))}
          </div>
        </section>
      ))}
    </section>
  );
}
