import {
  Check,
  Cpu,
  Download,
  Info,
  Keyboard,
  Palette,
  PartyPopper,
  Power,
  Search,
  ShieldCheck,
  Wand2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

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
import { Toggle } from "@/features/ui/toggle";
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

export type SettingsSectionId =
  | "aparencia"
  | "personalizacao"
  | "pesquisa"
  | "privacidade"
  | "desempenho"
  | "inicializacao"
  | "downloads"
  | "atalhos"
  | "sobre";

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
};

type Row = { id: string; label: string; keywords?: string; node: ReactNode };
type Section = { id: SettingsSectionId; label: string; icon: LucideIcon; rows: Row[] };

const normalize = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

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
 * agzos://configuracoes: seções na lateral e busca em todas, como nos navegadores
 * Chromium, no visual do Agzos. Preferências mudam na hora e valem em todas as janelas.
 */
export function SettingsPage(props: SettingsPageProps) {
  const { prefs, setPrefs, desktop } = props;
  const [section, setSection] = useState<SettingsSectionId>("aparencia");
  const [query, setQuery] = useState("");

  const sections = useMemo<Section[]>(() => {
    const list: Section[] = [
      {
        id: "aparencia",
        label: "Aparência",
        icon: Palette,
        rows: [
          {
            id: "tema",
            label: "Tema escuro",
            keywords: "cores claro noite",
            node: (
              <Toggle
                label="Tema escuro"
                checked={prefs.dark}
                onChange={(dark) => setPrefs({ dark })}
              />
            ),
          },
          {
            id: "guias-verticais",
            label: "Guias na vertical",
            keywords: "abas barra lateral horizontal",
            node: (
              <Toggle
                label="Guias na vertical"
                hint="Barra de guias à esquerda, em vez de em cima"
                checked={prefs.orientation === "vertical"}
                onChange={(vertical) =>
                  setPrefs({ orientation: vertical ? "vertical" : "horizontal" })
                }
              />
            ),
          },
          {
            id: "barra-favoritos",
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
            id: "sidebar",
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
            label: "Agzos AI visível",
            keywords: "assistente inteligencia artificial lateral",
            node: (
              <Toggle
                label="Agzos AI visível"
                hint="Barra lateral de IA"
                checked={prefs.aiOpen}
                onChange={(aiOpen) => setPrefs({ aiOpen })}
              />
            ),
          },
        ],
      },
      {
        id: "personalizacao",
        label: "Personalização",
        icon: Wand2,
        rows: [
          {
            id: "cor-acento",
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
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPrefs({ backgroundImage: "" })}
                  >
                    Remover
                  </Button>
                </div>
                {prefs.backgroundImage && (
                  <div className="w-full flex flex-col gap-4">
                    <label className="flex flex-col gap-2">
                      <span className="text-sm font-medium">
                        Opacidade: {prefs.backgroundOpacity}%
                      </span>
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
        ],
      },
      {
        id: "pesquisa",
        label: "Mecanismo de pesquisa",
        icon: Search,
        rows: [
          {
            id: "motor",
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
        ],
      },
      {
        id: "privacidade",
        label: "Privacidade e segurança",
        icon: ShieldCheck,
        rows: [
          {
            id: "escudo",
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
            ? [
                {
                  id: "permissoes",
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
              ]
            : []),
          {
            id: "limpar",
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
        ],
      },
    ];

    if (desktop) {
      list.push({
        id: "desempenho",
        label: "Desempenho",
        icon: Cpu,
        rows: [
          {
            id: "hibernar",
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
            ? [
                {
                  id: "hibernar-tempo",
                  label: "Hibernar depois de",
                  keywords: "minutos tempo memoria",
                  node: (
                    <label className="settings-select">
                      <span>Hibernar depois de</span>
                      <select
                        value={prefs.hibernateMinutes}
                        onChange={(event) =>
                          setPrefs({ hibernateMinutes: Number(event.target.value) })
                        }
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
              ]
            : []),
        ],
      });
    }

    list.push({
      id: "inicializacao",
      label: "Inicialização",
      icon: Power,
      rows: [
        {
          id: "abrir",
          label: "Ao abrir",
          keywords: "sessao restaurar abas iniciar",
          node: (
            <div className="settings-block">
              <strong>Ao abrir</strong>
              <small>
                O Agzos volta com as janelas e guias da última vez, inclusive depois de um
                fechamento inesperado.
              </small>
            </div>
          ),
        },
        {
          id: "restaurar",
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
      ],
    });

    if (desktop) {
      list.push({
        id: "downloads",
        label: "Downloads",
        icon: Download,
        rows: [
          {
            id: "pasta",
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
          },
        ],
      });
    }

    list.push({
      id: "atalhos",
      label: "Atalhos de teclado",
      icon: Keyboard,
      rows: shortcutRows(props.isMac),
    });

    const update = props.update;
    list.push({
      id: "sobre",
      label: "Sobre o Agzos",
      icon: Info,
      rows: [
        {
          id: "versao",
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
          ? [
              {
                id: "atualizacoes",
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
            ]
          : []),
        {
          id: "biblioteca",
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
      ],
    });
    return list;
  }, [prefs, setPrefs, desktop, props]);

  // Cada palavra precisa aparecer (em qualquer ordem): "atalho fav" acha o Ctrl+D.
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  const matches = terms.length
    ? sections
        .map((item) => ({
          ...item,
          rows: item.rows.filter((row) => {
            const text = normalize(`${row.label} ${row.keywords ?? ""} ${item.label}`);
            return terms.every((term) => text.includes(term));
          }),
        }))
        .filter((item) => item.rows.length)
    : null;
  const current = sections.find((item) => item.id === section) ?? sections[0]!;

  return (
    <div className="settings-page">
      <nav className="settings-nav" aria-label="Seções das configurações">
        <div className="settings-brand">
          <img src={symbolUrl} alt="" />
          <h1>Configurações</h1>
        </div>
        {sections.map((item) => (
          <button
            key={item.id}
            type="button"
            className={cn("settings-nav-item", !matches && item.id === current.id && "active")}
            aria-current={!matches && item.id === current.id ? "page" : undefined}
            onClick={() => {
              setQuery("");
              setSection(item.id);
            }}
          >
            <item.icon aria-hidden="true" />
            {item.label}
          </button>
        ))}
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
            matches.map((item) => <SectionView key={item.id} section={item} />)
          ) : (
            <p className="settings-empty">Nenhuma configuração com "{query.trim()}".</p>
          )
        ) : (
          <SectionView section={current} />
        )}
      </main>
    </div>
  );
}

function SectionView({ section }: { section: Section }) {
  return (
    <section className="settings-section-card" aria-labelledby={`settings-${section.id}`}>
      <h2 id={`settings-${section.id}`}>{section.label}</h2>
      <div className="settings-card">
        {section.rows.map((row) => (
          <div key={row.id} className="settings-card-row">
            {row.node}
          </div>
        ))}
      </div>
    </section>
  );
}
