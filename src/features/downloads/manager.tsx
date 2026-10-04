import {
  Archive,
  Download,
  File,
  FileDown,
  FilePenLine,
  FileText,
  Film,
  FolderInput,
  FolderOpen,
  Image,
  Music,
  Pause,
  Play,
  RotateCcw,
  Search,
  Tag,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import type { DesktopBridge, DownloadRecord } from "@/features/browser/desktop";
import type { DownloadFileType, DownloadsConfig } from "@/features/browser/desktop-v47";
import { themeIsDark, type UiTheme } from "@/features/browser/feature-prefs";
import { cn } from "@/lib/utils";

import {
  STATUS_FILTERS,
  TYPE_LABELS,
  domainOf,
  filterDownloads,
  folderOf,
  managerKeyAction,
  statusCounts,
  statusGroupOf,
  tagsInUse,
  typeOfDownload,
  type DownloadFilters,
} from "./filters";
import { formatBytes, progressOf, statusOf } from "./format";
import { tagColorOf } from "./filters";

const TYPE_ICONS: Record<DownloadFileType, LucideIcon> = {
  pdf: FileText,
  image: Image,
  video: Film,
  audio: Music,
  archive: Archive,
  other: File,
};

export type DownloadsManagerProps = {
  downloads: DownloadRecord[];
  desktop: DesktopBridge | null;
  browserDark: boolean;
  theme: UiTheme;
  onTheme: (theme: UiTheme) => void;
  onOpenPdf: (record: DownloadRecord) => void;
  onOpenSettings: () => void;
  onNotice: (text: string) => void;
};

/**
 * agzos://downloads (4.7, Ctrl+J): lista com colunas, filtros, busca no histórico local,
 * etiquetas, mudar destino e exportar. As ações valem em todas as janelas (o main manda
 * cada mudança para todas).
 */
export function DownloadsManager(props: DownloadsManagerProps) {
  const { downloads, desktop } = props;
  const [filters, setFilters] = useState<DownloadFilters>({
    status: "all",
    type: "all",
    tag: null,
    query: "",
  });
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [focusId, setFocusId] = useState<number | null>(null);
  const [tagging, setTagging] = useState<number | null>(null);
  const [config, setConfig] = useState<DownloadsConfig | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const rowRefs = useRef(new Map<number, HTMLDivElement>());

  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    void desktop.downloadsConfig().then((result) => alive && setConfig(result.config));
    const off = desktop.onDownloadsConfig((next) => setConfig(next));
    return () => {
      alive = false;
      off();
    };
  }, [desktop]);

  const visible = useMemo(() => filterDownloads(downloads, filters), [downloads, filters]);
  const counts = useMemo(() => statusCounts(downloads), [downloads]);
  const tags = useMemo(() => tagsInUse(downloads), [downloads]);
  const tagColors = config?.tagColors ?? {};
  const dark = themeIsDark(props.theme, props.browserDark);

  // Seleção só do que ainda existe.
  useEffect(() => {
    setSelected((current) => {
      const ids = new Set(downloads.map((item) => item.id));
      const next = new Set([...current].filter((id) => ids.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [downloads]);

  const act = (record: DownloadRecord, action: Parameters<DesktopBridge["downloadAction"]>[1]) => {
    if (!desktop) return;
    void desktop.downloadAction(record.id, action);
  };

  const run = (record: DownloadRecord, action: ReturnType<typeof managerKeyAction>) => {
    if (!desktop || !action) return;
    switch (action) {
      case "toggle":
        act(record, record.paused ? "resume" : "pause");
        return;
      case "cancel":
        act(record, "cancel");
        return;
      case "remove":
        act(record, "remove");
        return;
      case "restart":
        void desktop.downloadAction(record.id, "restart");
        return;
      case "open":
        act(record, "open");
        return;
      case "search":
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
    }
  };

  const changeDestination = (record: DownloadRecord) => {
    if (!desktop) return;
    void desktop.downloadAction(record.id, "destination").then((result) => {
      if (result.canceled) return;
      if (!result.ok) props.onNotice("Não foi possível mover: o arquivo não está mais lá.");
      else if (result.pending) props.onNotice("O arquivo vai para a nova pasta quando terminar.");
      else props.onNotice("Arquivo movido.");
    });
  };

  const setTags = (record: DownloadRecord, next: string[]) => {
    if (desktop) void desktop.downloadAction(record.id, "tags", next);
  };

  const exportSelection = (format: "json" | "csv") => {
    if (!desktop) return;
    const ids = selected.size ? [...selected] : visible.map((item) => item.id);
    if (!ids.length) return;
    void desktop.downloadsExport({ ids, format }).then((result) => {
      if (result.ok) props.onNotice(`Exportado: ${result.path}`);
    });
  };

  const focusRow = (id: number | null) => {
    setFocusId(id);
    if (id !== null) rowRefs.current.get(id)?.focus();
  };

  // A linha com o foco saiu (Shift+Delete, outra janela limpou): o foco vai para a que
  // ficou no lugar dela, e o teclado continua no gerenciador.
  const lastIndex = useRef(0);
  const focusedIndex = visible.findIndex((item) => item.id === focusId);
  if (focusedIndex >= 0) lastIndex.current = focusedIndex;
  const lostFocus = focusId !== null && focusedIndex < 0;
  useEffect(() => {
    if (!lostFocus) return;
    const next = visible[Math.min(lastIndex.current, visible.length - 1)];
    const hadFocus = document.activeElement === document.body;
    setFocusId(next?.id ?? null);
    if (next && hadFocus) rowRefs.current.get(next.id)?.focus();
  }, [lostFocus, visible]);

  // Foco solto na página (nada focado): F ainda busca e as setas voltam para a lista.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (document.activeElement !== document.body || event.defaultPrevented) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
      } else if ((event.key === "ArrowDown" || event.key === "ArrowUp") && visible[0]) {
        event.preventDefault();
        const id =
          focusId !== null && visible.some((item) => item.id === focusId) ? focusId : visible[0].id;
        setFocusId(id);
        rowRefs.current.get(id)?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, focusId]);

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select")) return;
    const index = visible.findIndex((item) => item.id === focusId);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = visible[Math.min(visible.length - 1, Math.max(0, index + delta))];
      if (next) focusRow(next.id);
      return;
    }
    // Botões da linha mantêm Enter/Espaço deles.
    if (target.tagName === "BUTTON" && (event.key === "Enter" || event.key === " ")) return;
    const record = index >= 0 ? visible[index]! : null;
    const action = managerKeyAction(event, record);
    if (!action) return;
    event.preventDefault();
    if (record || action === "search") run(record as DownloadRecord, action);
  };

  const allSelected = visible.length > 0 && visible.every((item) => selected.has(item.id));

  return (
    <div
      className={cn("library-page downloads-manager", dark ? "dark" : "agz-light")}
      aria-label="Gerenciador de downloads"
      onKeyDown={onListKey}
    >
      <header className="library-head">
        <div className="library-title">
          <Download aria-hidden="true" />
          <div>
            <h1>Downloads</h1>
            <p>Tudo o que você baixou neste perfil. Guias anônimas aparecem só até fechar o app.</p>
          </div>
          <div className="dm-theme" role="radiogroup" aria-label="Tema do gerenciador">
            {(
              [
                ["light", "Claro"],
                ["dark", "Escuro"],
                ["browser", "Navegador"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={props.theme === value}
                className={cn(props.theme === value && "on")}
                onClick={() => props.onTheme(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <label className="library-search">
          <Search aria-hidden="true" />
          <input
            ref={searchRef}
            value={filters.query}
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Escape" && filters.query) {
                event.preventDefault();
                setFilters({ ...filters, query: "" });
              } else if (event.key === "ArrowDown" && visible[0]) {
                event.preventDefault();
                focusRow(visible[0].id);
              }
            }}
            placeholder="Pesquisar por nome, endereço, site ou etiqueta (F)"
            aria-label="Pesquisar downloads"
          />
          {filters.query && (
            <button
              type="button"
              aria-label="Limpar pesquisa"
              onClick={() => setFilters({ ...filters, query: "" })}
            >
              <X />
            </button>
          )}
        </label>
        <div className="dm-filters">
          <div className="dm-chips" role="tablist" aria-label="Situação">
            {STATUS_FILTERS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={filters.status === item.id}
                className={cn("dm-chip", filters.status === item.id && "on")}
                onClick={() => setFilters({ ...filters, status: item.id })}
              >
                {item.label}
                <small>{counts[item.id]}</small>
              </button>
            ))}
          </div>
          <select
            aria-label="Filtrar por tipo"
            value={filters.type}
            onChange={(event) =>
              setFilters({ ...filters, type: event.target.value as DownloadFilters["type"] })
            }
          >
            <option value="all">Todos os tipos</option>
            {(Object.keys(TYPE_LABELS) as DownloadFileType[]).map((type) => (
              <option key={type} value={type}>
                {TYPE_LABELS[type]}
              </option>
            ))}
          </select>
          <select
            aria-label="Filtrar por etiqueta"
            value={filters.tag ?? ""}
            onChange={(event) => setFilters({ ...filters, tag: event.target.value || null })}
          >
            <option value="">Todas as etiquetas</option>
            {tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </div>
        <div className="dm-actions">
          <label className="dm-select-all">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() =>
                setSelected(allSelected ? new Set() : new Set(visible.map((item) => item.id)))
              }
              aria-label="Selecionar todos os visíveis"
            />
            {selected.size ? `${selected.size} selecionados` : "Selecionar"}
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={!desktop || !visible.length}
            onClick={() => exportSelection("json")}
          >
            Exportar JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!desktop || !visible.length}
            onClick={() => exportSelection("csv")}
          >
            Exportar CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!desktop}
            onClick={() => void desktop?.openDownloadsDir()}
          >
            <FolderOpen /> Pasta padrão
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!desktop || !downloads.some((item) => item.state !== "progressing")}
            onClick={() => void desktop?.downloadsClear()}
          >
            <Trash2 /> Limpar concluídos
          </Button>
          <Button variant="ghost" size="sm" onClick={props.onOpenSettings}>
            Regras e pastas
          </Button>
        </div>
      </header>

      {!desktop && (
        <p className="library-empty">Downloads funcionam no app Agzos para computador.</p>
      )}
      {desktop && visible.length === 0 && (
        <p className="library-empty">
          {downloads.length
            ? "Nada com esses filtros."
            : "Os arquivos que você baixar aparecem aqui."}
        </p>
      )}

      {visible.length > 0 && (
        <div
          className="dm-table"
          role="grid"
          aria-label="Lista de downloads"
          aria-rowcount={visible.length}
        >
          <div className="dm-row dm-head" role="row">
            <span role="columnheader" aria-label="Selecionar" />
            <span role="columnheader" aria-label="Ícone" />
            <span role="columnheader">Nome</span>
            <span role="columnheader">Status</span>
            <span role="columnheader">Progresso</span>
            <span role="columnheader">Tamanho</span>
            <span role="columnheader">Destino</span>
            <span role="columnheader">Ações</span>
          </div>
          {visible.map((record) => {
            const type = typeOfDownload(record);
            const Icon = TYPE_ICONS[type] ?? FileDown;
            const group = statusGroupOf(record);
            const running = record.state === "progressing";
            const done = record.state === "completed";
            const progress = progressOf(record);
            const size = record.totalBytes || record.receivedBytes;
            return (
              <div
                key={record.id}
                ref={(node) => {
                  if (node) rowRefs.current.set(record.id, node);
                  else rowRefs.current.delete(record.id);
                }}
                role="row"
                tabIndex={
                  focusId === record.id || (focusId === null && record === visible[0]) ? 0 : -1
                }
                className={cn("dm-row", `is-${group}`, selected.has(record.id) && "selected")}
                data-id={record.id}
                data-state={record.state}
                aria-selected={selected.has(record.id)}
                onFocus={(event) => {
                  if (event.target === event.currentTarget) setFocusId(record.id);
                }}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("button, input, a")) return;
                  focusRow(record.id);
                }}
              >
                <span role="gridcell">
                  <input
                    type="checkbox"
                    tabIndex={-1}
                    checked={selected.has(record.id)}
                    aria-label={`Selecionar ${record.filename}`}
                    onChange={() =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (next.has(record.id)) next.delete(record.id);
                        else next.add(record.id);
                        return next;
                      })
                    }
                  />
                </span>
                <span role="gridcell" className={cn("dm-icon", `t-${type}`)}>
                  <Icon aria-hidden="true" />
                </span>
                <span role="gridcell" className="dm-name">
                  {done ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      className="download-name"
                      title={`Abrir ${record.filename} (Enter)`}
                      onClick={() => act(record, "open")}
                    >
                      {record.filename}
                    </button>
                  ) : (
                    <strong className="download-name">{record.filename || "Download"}</strong>
                  )}
                  <small title={record.url}>
                    {domainOf(record.url) || record.url}
                    {record.private ? " · anônimo" : ""}
                  </small>
                  {(record.tags?.length || tagging === record.id) && (
                    <span className="dm-tags">
                      {(record.tags ?? []).map((tag) => (
                        <span
                          key={tag}
                          className="dm-tag"
                          style={{ "--tag": tagColorOf(tag, tagColors) } as React.CSSProperties}
                        >
                          {tag}
                          {tagging === record.id && (
                            <button
                              type="button"
                              aria-label={`Tirar a etiqueta ${tag}`}
                              onClick={() =>
                                setTags(
                                  record,
                                  (record.tags ?? []).filter((item) => item !== tag),
                                )
                              }
                            >
                              <X />
                            </button>
                          )}
                        </span>
                      ))}
                      {tagging === record.id && (
                        <TagInput
                          suggestions={tags.filter((tag) => !(record.tags ?? []).includes(tag))}
                          onAdd={(tag) => setTags(record, [...(record.tags ?? []), tag])}
                          onDone={() => {
                            setTagging(null);
                            focusRow(record.id);
                          }}
                        />
                      )}
                    </span>
                  )}
                </span>
                <span role="gridcell" className="dm-status">
                  {group === "running"
                    ? "Baixando"
                    : group === "paused"
                      ? "Pausado"
                      : group === "completed"
                        ? "Concluído"
                        : record.state === "cancelled"
                          ? "Cancelado"
                          : "Falhou"}
                </span>
                <span role="gridcell" className="dm-progress">
                  {running ? (
                    <>
                      <span
                        className={cn("download-progress", progress === null && "indeterminate")}
                        role="progressbar"
                        aria-label={`Progresso de ${record.filename}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
                      >
                        <i style={{ width: `${Math.round((progress ?? 0.35) * 100)}%` }} />
                      </span>
                      <small>{statusOf(record)}</small>
                    </>
                  ) : (
                    <small>{done ? "100%" : "—"}</small>
                  )}
                </span>
                <span role="gridcell" className="dm-size">
                  {size ? formatBytes(size) : "—"}
                </span>
                <span role="gridcell" className="dm-dest" title={record.path}>
                  <bdi dir="ltr">{record.path ? folderOf(record.path) : "—"}</bdi>
                  {record.moveTo && <small>→ {record.moveTo}</small>}
                </span>
                <span role="gridcell" className="dm-row-actions">
                  {running &&
                    (record.paused ? (
                      <IconButton
                        icon={Play}
                        label={`Retomar ${record.filename} (Espaço)`}
                        disabled={!record.canResume}
                        onClick={() => act(record, "resume")}
                      />
                    ) : (
                      <IconButton
                        icon={Pause}
                        label={`Pausar ${record.filename} (Espaço)`}
                        onClick={() => act(record, "pause")}
                      />
                    ))}
                  {/^https?:/i.test(record.url) && (
                    <IconButton
                      icon={RotateCcw}
                      label={`Reiniciar ${record.filename} (R)`}
                      onClick={() => run(record, "restart")}
                    />
                  )}
                  {done && type === "pdf" && (
                    <IconButton
                      icon={FilePenLine}
                      label={`Abrir ${record.filename} no PDF Tools`}
                      onClick={() => props.onOpenPdf(record)}
                    />
                  )}
                  <IconButton
                    icon={FolderOpen}
                    label={`Abrir a pasta de ${record.filename}`}
                    onClick={() => act(record, "show")}
                  />
                  {(done || running) && !record.private && (
                    <IconButton
                      icon={FolderInput}
                      label={`Mudar destino de ${record.filename}`}
                      onClick={() => changeDestination(record)}
                    />
                  )}
                  {!record.private && (
                    <IconButton
                      icon={Tag}
                      label={`Etiquetar ${record.filename}`}
                      pressed={tagging === record.id}
                      onClick={() => setTagging(tagging === record.id ? null : record.id)}
                    />
                  )}
                  {running ? (
                    <IconButton
                      icon={X}
                      label={`Cancelar ${record.filename} (Delete)`}
                      onClick={() => act(record, "cancel")}
                    />
                  ) : (
                    <IconButton
                      icon={Trash2}
                      label={`Remover ${record.filename} do histórico (Shift+Delete)`}
                      onClick={() => act(record, "remove")}
                    />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
      <p className="dm-keys" aria-hidden="true">
        <kbd>Espaço</kbd> pausar/retomar · <kbd>Delete</kbd> cancelar · <kbd>Shift+Delete</kbd>{" "}
        remover · <kbd>R</kbd> reiniciar · <kbd>Enter</kbd> abrir · <kbd>F</kbd> buscar
      </p>
    </div>
  );
}

function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  pressed,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <Button
      variant={pressed ? "default" : "ghost"}
      size="icon"
      tabIndex={-1}
      title={label}
      aria-label={label}
      disabled={disabled}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <Icon />
    </Button>
  );
}

function TagInput({
  suggestions,
  onAdd,
  onDone,
}: {
  suggestions: string[];
  onAdd: (tag: string) => void;
  onDone: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <span className="dm-tag-input">
      <input
        autoFocus
        value={text}
        list="dm-tag-suggestions"
        placeholder="Nova etiqueta"
        aria-label="Nova etiqueta"
        maxLength={32}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") {
            event.preventDefault();
            if (text.trim()) onAdd(text.trim());
            setText("");
          } else if (event.key === "Escape") {
            event.preventDefault();
            onDone();
          }
        }}
      />
      <datalist id="dm-tag-suggestions">
        {suggestions.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
      <button type="button" className="dm-tag-done" onClick={onDone}>
        Pronto
      </button>
    </span>
  );
}
