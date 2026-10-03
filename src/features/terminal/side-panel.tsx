import {
  ArrowUp,
  Eye,
  EyeOff,
  File,
  FileCode,
  Folder,
  FolderInput,
  Globe,
  House,
  Image as ImageIcon,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  TextCursorInput,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CliSkill, DesktopBridge, FileListing } from "@/features/browser/desktop";
import { cn } from "@/lib/utils";
import { newId, type TerminalSettings } from "./config";

export type SideMode = "files" | "snippets" | "skills";

const TOOL_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  gemini: "Gemini CLI",
};

function formatSize(bytes: number | null) {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0).replace(".", ",")} ${units[unit]}`;
}

/**
 * Painel lateral do terminal (4.1.1): o modo ls (navegador de arquivos), os comandos
 * rápidos (snippets) e as skills das CLIs de IA.
 */
export function TerminalSidePanel({
  mode,
  desktop,
  settings,
  cwd,
  canType,
  quote,
  onSettings,
  onCd,
  onType,
  onClose,
}: {
  mode: SideMode;
  /** Caminho entre aspas para o shell da sessão ativa. */
  quote: (path: string) => string;
  desktop: DesktopBridge;
  settings: TerminalSettings;
  /** Pasta da sessão ativa (ponto de partida dos arquivos e skills do projeto). */
  cwd: string;
  /** A sessão ativa aceita texto (não é SSH nem programa). */
  canType: boolean;
  onSettings: (patch: Partial<TerminalSettings>) => void;
  onCd: (dir: string) => void;
  onType: (text: string, run: boolean) => void;
  onClose: () => void;
}) {
  const titles: Record<SideMode, string> = {
    files: "Arquivos",
    snippets: "Snippets",
    skills: "Skills",
  };
  return (
    <aside className="terminal-side" aria-label={titles[mode]}>
      <header>
        <strong>{titles[mode]}</strong>
        <button type="button" aria-label={`Fechar ${titles[mode]}`} onClick={onClose}>
          <X />
        </button>
      </header>
      {mode === "files" && (
        <FilesPanel
          desktop={desktop}
          cwd={cwd}
          hidden={settings.showHidden}
          canType={canType}
          onHidden={(showHidden) => onSettings({ showHidden })}
          onCd={onCd}
          onType={(path) => onType(quote(path), false)}
        />
      )}
      {mode === "snippets" && (
        <SnippetsPanel
          settings={settings}
          canType={canType}
          onSettings={onSettings}
          onType={onType}
        />
      )}
      {mode === "skills" && (
        <SkillsPanel desktop={desktop} cwd={cwd} canType={canType} onType={onType} />
      )}
    </aside>
  );
}

function FilesPanel({
  desktop,
  cwd,
  hidden,
  canType,
  onHidden,
  onCd,
  onType,
}: {
  desktop: DesktopBridge;
  cwd: string;
  hidden: boolean;
  canType: boolean;
  onHidden: (hidden: boolean) => void;
  onCd: (dir: string) => void;
  onType: (path: string) => void;
}) {
  const [dir, setDir] = useState(cwd);
  const [listing, setListing] = useState<FileListing | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const dirRef = useRef(dir);
  dirRef.current = dir;

  const load = useCallback(
    async (target: string) => {
      const result = await desktop.filesList(target, hiddenRef.current);
      setListing(result);
      if (result.ok) {
        setDir(result.path);
        setFilter("");
      }
    },
    [desktop],
  );

  // A sessão mudou de pasta (cd no shell): o painel acompanha.
  useEffect(() => {
    void load(cwd);
  }, [cwd, load]);
  // Ocultos ligados/desligados: a mesma pasta de novo.
  useEffect(() => {
    void load(dirRef.current);
  }, [hidden, load]);

  /** Selecionar uma pasta abre ela no terminal (cd) e no painel. */
  function enter(path: string) {
    void load(path);
    if (canType) onCd(path);
  }

  const entries = listing?.ok
    ? listing.entries.filter((item) => item.name.toLowerCase().includes(filter.toLowerCase()))
    : [];

  return (
    <div className="terminal-files">
      <div className="terminal-side-tools">
        <button
          type="button"
          title="Pasta acima"
          aria-label="Pasta acima"
          disabled={!listing?.ok || !listing.parent}
          onClick={() => listing?.ok && listing.parent && enter(listing.parent)}
        >
          <ArrowUp />
        </button>
        <button
          type="button"
          title="Pasta pessoal"
          aria-label="Pasta pessoal"
          onClick={() => void desktop.filesHome().then(enter)}
        >
          <House />
        </button>
        <button
          type="button"
          title="Atualizar"
          aria-label="Atualizar a lista"
          onClick={() => void load(dir)}
        >
          <RefreshCw />
        </button>
        <button
          type="button"
          title={hidden ? "Esconder arquivos ocultos" : "Mostrar arquivos ocultos"}
          aria-label="Arquivos ocultos"
          aria-pressed={hidden}
          onClick={() => onHidden(!hidden)}
        >
          {hidden ? <Eye /> : <EyeOff />}
        </button>
        <button
          type="button"
          title="Abrir esta pasta no terminal (cd)"
          aria-label="Abrir esta pasta no terminal"
          disabled={!canType}
          onClick={() => onCd(dir)}
        >
          <FolderInput />
        </button>
      </div>
      <p className="terminal-files-path" title={dir}>
        {dir}
      </p>
      <input
        className="terminal-side-filter"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        placeholder="Filtrar…"
        aria-label="Filtrar arquivos"
      />
      {listing && !listing.ok && (
        <p className="terminal-side-empty">
          {listing.error === "access"
            ? "Sem permissão para abrir esta pasta."
            : "Pasta não encontrada."}
        </p>
      )}
      <ul className="terminal-files-list" role="listbox" aria-label="Arquivos da pasta">
        {entries.map((item) => {
          const Icon = item.dir
            ? Folder
            : item.image
              ? ImageIcon
              : /\.[a-z0-9]+$/i.test(item.name)
                ? FileCode
                : File;
          return (
            <li
              key={item.path}
              role="option"
              aria-selected={selected === item.path}
              className={cn(item.dir && "dir", selected === item.path && "selected")}
              title={
                item.dir
                  ? `${item.name} — clique para abrir no terminal`
                  : `${item.name} — clique para inserir o caminho; duplo clique abre no navegador`
              }
              onClick={() => {
                setSelected(item.path);
                if (item.dir) enter(item.path);
                else if (canType) onType(item.path);
              }}
              onDoubleClick={() => !item.dir && void desktop.filesOpen(item.path, "tab")}
            >
              <Icon />
              <span>{item.name}</span>
              {!item.dir && <small>{formatSize(item.size)}</small>}
              <span className="terminal-files-actions">
                {item.dir ? (
                  <button
                    type="button"
                    title="Abrir no navegador (listagem)"
                    aria-label={`Abrir ${item.name} no navegador`}
                    onClick={(event) => {
                      event.stopPropagation();
                      void desktop.filesOpen(item.path, "tab");
                    }}
                  >
                    <Globe />
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      title="Abrir no navegador"
                      aria-label={`Abrir ${item.name} no navegador`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void desktop.filesOpen(item.path, "tab");
                      }}
                    >
                      <Globe />
                    </button>
                    <button
                      type="button"
                      title="Inserir o caminho no terminal"
                      aria-label={`Inserir o caminho de ${item.name}`}
                      disabled={!canType}
                      onClick={(event) => {
                        event.stopPropagation();
                        onType(item.path);
                      }}
                    >
                      <TextCursorInput />
                    </button>
                  </>
                )}
              </span>
            </li>
          );
        })}
        {listing?.ok && !entries.length && <li className="terminal-side-empty">Pasta vazia.</li>}
      </ul>
      {listing?.ok && listing.truncated && (
        <p className="terminal-side-empty">Mostrando os primeiros 2000 itens.</p>
      )}
    </div>
  );
}

function SnippetsPanel({
  settings,
  canType,
  onSettings,
  onType,
}: {
  settings: TerminalSettings;
  canType: boolean;
  onSettings: (patch: Partial<TerminalSettings>) => void;
  onType: (text: string, run: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [run, setRun] = useState(true);
  return (
    <div className="terminal-snippets">
      <ul className="terminal-side-list">
        {settings.snippets.map((snippet) => (
          <li key={snippet.id}>
            <button
              type="button"
              className="terminal-side-main"
              disabled={!canType}
              title={snippet.command}
              onClick={() => onType(snippet.command, snippet.run)}
            >
              {snippet.run ? <Play /> : <Zap />}
              <span>
                {snippet.name}
                <small>{snippet.command}</small>
              </span>
            </button>
            <button
              type="button"
              title="Só digitar (sem Enter)"
              aria-label={`Digitar ${snippet.name}`}
              disabled={!canType}
              onClick={() => onType(snippet.command, false)}
            >
              <TextCursorInput />
            </button>
            <button
              type="button"
              aria-label={`Apagar ${snippet.name}`}
              onClick={() =>
                onSettings({ snippets: settings.snippets.filter((item) => item.id !== snippet.id) })
              }
            >
              <Trash2 />
            </button>
          </li>
        ))}
        {!settings.snippets.length && (
          <li className="terminal-side-empty">Nenhum snippet ainda.</li>
        )}
      </ul>
      <form
        className="terminal-side-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || !command.trim()) return;
          onSettings({
            snippets: [
              ...settings.snippets,
              {
                id: newId("snippet"),
                name: name.trim().slice(0, 60),
                command: command.slice(0, 2000),
                run,
              },
            ],
          });
          setName("");
          setCommand("");
        }}
      >
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Nome"
          aria-label="Nome do snippet"
        />
        <textarea
          value={command}
          rows={2}
          onChange={(event) => setCommand(event.target.value)}
          placeholder="Comando"
          aria-label="Comando do snippet"
        />
        <label className="terminal-inline-check">
          <input type="checkbox" checked={run} onChange={(event) => setRun(event.target.checked)} />
          Executar (Enter)
        </label>
        <button type="submit" disabled={!name.trim() || !command.trim()}>
          <Plus /> Adicionar snippet
        </button>
      </form>
    </div>
  );
}

function SkillsPanel({
  desktop,
  cwd,
  canType,
  onType,
}: {
  desktop: DesktopBridge;
  cwd: string;
  canType: boolean;
  onType: (text: string, run: boolean) => void;
}) {
  const [skills, setSkills] = useState<CliSkill[] | null>(null);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    description: "",
    body: "",
    scope: "user" as "user" | "project",
  });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void desktop.terminalSkills(cwd).then(setSkills);
  }, [desktop, cwd]);
  useEffect(load, [load]);

  const visible = (skills ?? []).filter((skill) =>
    `${skill.name} ${skill.description} ${skill.tool}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const groups = [...new Set(visible.map((skill) => skill.tool))];

  async function create() {
    setError(null);
    const result = await desktop.terminalSkillCreate({ ...form, cwd });
    if (!result.ok) {
      setError(
        result.error === "name"
          ? "Nome: letras minúsculas, números e hífen."
          : result.error === "description"
            ? "Escreva uma descrição (até 300 caracteres)."
            : result.error === "exists"
              ? "Já existe uma skill com esse nome."
              : "Não foi possível gravar a skill.",
      );
      return;
    }
    setCreating(false);
    setForm({ name: "", description: "", body: "", scope: "user" });
    load();
  }

  return (
    <div className="terminal-skills">
      <div className="terminal-side-tools">
        <input
          className="terminal-side-filter"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filtrar skills…"
          aria-label="Filtrar skills"
        />
        <button type="button" title="Atualizar" aria-label="Atualizar as skills" onClick={load}>
          <RefreshCw />
        </button>
        <button
          type="button"
          title="Nova skill do Claude Code"
          aria-label="Nova skill"
          aria-pressed={creating}
          onClick={() => setCreating((value) => !value)}
        >
          <Plus />
        </button>
      </div>
      {creating && (
        <form
          className="terminal-side-form"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value.toLowerCase() })}
            placeholder="nome-da-skill"
            aria-label="Nome da skill"
          />
          <input
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            placeholder="Quando usar esta skill"
            aria-label="Descrição da skill"
          />
          <textarea
            value={form.body}
            rows={4}
            onChange={(event) => setForm({ ...form, body: event.target.value })}
            placeholder="Instruções (Markdown)"
            aria-label="Instruções da skill"
          />
          <select
            value={form.scope}
            aria-label="Onde gravar"
            onChange={(event) =>
              setForm({ ...form, scope: event.target.value as "user" | "project" })
            }
          >
            <option value="user">Minhas skills (~/.claude/skills)</option>
            <option value="project">Deste projeto (.claude/skills)</option>
          </select>
          {error && <p className="terminal-side-error">{error}</p>}
          <button type="submit">
            <Sparkles /> Criar skill
          </button>
        </form>
      )}
      {skills === null && <p className="terminal-side-empty">Procurando…</p>}
      {skills !== null && !visible.length && (
        <p className="terminal-side-empty">
          Nenhuma skill encontrada em ~/.claude, ~/.codex, ~/.config/opencode, ~/.gemini nem no
          projeto.
        </p>
      )}
      {groups.map((tool) => (
        <section key={tool}>
          <h4>{TOOL_NAMES[tool] ?? tool}</h4>
          <ul className="terminal-side-list">
            {visible
              .filter((skill) => skill.tool === tool)
              .map((skill) => (
                <li key={`${skill.tool}${skill.invoke}${skill.scope}`}>
                  <button
                    type="button"
                    className="terminal-side-main"
                    disabled={!canType}
                    title={`Digitar ${skill.invoke} no terminal`}
                    onClick={() => onType(`${skill.invoke} `, false)}
                  >
                    <Sparkles />
                    <span>
                      {skill.invoke}
                      {skill.scope === "project" && <em> projeto</em>}
                      <small>{skill.description}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    title="Abrir o arquivo da skill no navegador"
                    aria-label={`Abrir o arquivo de ${skill.name}`}
                    onClick={() => void desktop.filesOpen(skill.file, "tab")}
                  >
                    <Globe />
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
