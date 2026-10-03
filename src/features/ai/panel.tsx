import {
  Archive,
  ArchiveRestore,
  Check,
  Code2,
  Copy,
  Eraser,
  FolderOpen,
  FolderPlus,
  KeyRound,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Square,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import type {
  AiError,
  AiHistoryItem,
  AiLibrary,
  AiLibraryAction,
  AiState,
  DesktopBridge,
} from "@/features/browser/desktop";
import { cn } from "@/lib/utils";
import { type Artifact, artifactsOf, previewDocument } from "./markdown";
import { Markdown } from "./markdown-view";
import {
  type AiMessage,
  aiErrorText,
  chatGroups,
  modelLabel,
  needsKey,
  nextRequestId,
} from "./model";

export const GROQ_KEYS_URL = "https://console.groq.com/keys";
/** Evento da casca: Ctrl+N com o foco no Agzos AI abre uma conversa nova. */
export const AI_NEW_CHAT_EVENT = "agzos:ai-new-chat";

export type AiTab = { id: number; url: string; title: string; private: boolean; page: boolean };

/**
 * Campo mascarado da GROQ_API_KEY. O valor vai direto para o main (safeStorage) e sai da
 * memória da casca ao salvar; nada é gravado no estado do navegador.
 */
export function AiKeyForm({
  desktop,
  replacing = false,
  onSaved,
  onCancel,
  onOpenUrl,
}: {
  desktop: DesktopBridge;
  replacing?: boolean;
  onSaved: (models: string[]) => void;
  onCancel?: (() => void) | undefined;
  onOpenUrl?: ((url: string) => void) | undefined;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    setError(null);
    const result = await desktop.aiSetKey(value);
    setBusy(false);
    if (!result.ok) {
      setError(aiErrorText(result.error, result.retryAfter));
      return;
    }
    setValue("");
    onSaved(result.models);
  }

  return (
    <form className="ai-key-form" onSubmit={submit}>
      <label htmlFor="ai-key-input">
        {replacing ? "Nova chave da API Groq" : "Chave da API Groq"}
      </label>
      <input
        id="ai-key-input"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="gsk_…"
        aria-describedby="ai-key-help"
        disabled={busy}
      />
      <p id="ai-key-help">
        Fica cifrada pelo cofre do sistema (DPAPI no Windows, Keychain no macOS) e nunca volta para
        a tela.{" "}
        {onOpenUrl && (
          <button type="button" className="link-button" onClick={() => onOpenUrl(GROQ_KEYS_URL)}>
            Criar uma chave na Groq
          </button>
        )}
      </p>
      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}
      <div className="ai-key-actions">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
            Cancelar
          </Button>
        )}
        <Button type="submit" size="sm" disabled={busy || !value.trim()}>
          {busy ? <Loader2 className="spin" /> : <KeyRound />}
          {busy ? "Validando…" : "Salvar chave"}
        </Button>
      </div>
    </form>
  );
}

/** Título editável no lugar (duplo clique ou F2): Enter grava, Esc desiste. */
function InlineEdit({
  value,
  label,
  onSave,
  onDone,
}: {
  value: string;
  label: string;
  onSave: (value: string) => void;
  onDone: () => void;
}) {
  const [text, setText] = useState(value);
  return (
    <input
      className="ai-inline-edit"
      aria-label={label}
      autoFocus
      value={text}
      maxLength={80}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        if (text.trim() && text.trim() !== value) onSave(text.trim());
        onDone();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setText(value);
          onDone();
        }
        event.stopPropagation();
      }}
    />
  );
}

/** Artifact aberto ao lado do chat: prévia isolada (HTML, SVG) ou o código. */
function ArtifactView({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  const [view, setView] = useState<"preview" | "code">(
    artifact.kind === "code" ? "code" : "preview",
  );
  const [copied, setCopied] = useState(false);
  useEffect(() => setView(artifact.kind === "code" ? "code" : "preview"), [artifact]);
  return (
    <section className="ai-artifact" aria-label={`Artifact: ${artifact.title}`}>
      <header>
        <Code2 />
        <strong title={artifact.title}>{artifact.title}</strong>
        {artifact.kind !== "code" && (
          <div className="ai-artifact-switch" role="tablist" aria-label="Ver">
            <button
              type="button"
              role="tab"
              aria-selected={view === "preview"}
              onClick={() => setView("preview")}
            >
              Prévia
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "code"}
              onClick={() => setView("code")}
            >
              Código
            </button>
          </div>
        )}
        <button
          type="button"
          aria-label="Copiar artifact"
          title="Copiar"
          onClick={() =>
            void navigator.clipboard?.writeText(artifact.text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            })
          }
        >
          {copied ? <Check /> : <Copy />}
        </button>
        <button type="button" aria-label="Fechar artifact" onClick={onClose}>
          <X />
        </button>
      </header>
      {view === "preview" && artifact.kind !== "code" ? (
        // Origem opaca (sem allow-same-origin): o artifact não alcança a casca nem a ponte.
        <iframe
          title={`Prévia: ${artifact.title}`}
          sandbox={artifact.kind === "html" ? "allow-scripts" : ""}
          srcDoc={previewDocument(artifact)}
        />
      ) : (
        <pre className="ai-code ai-artifact-code">
          <code>{artifact.text}</code>
        </pre>
      )}
    </section>
  );
}

type Pending = { chatId: string | null; items: AiMessage[] };

/**
 * Agzos AI (4.1.3), no estilo do Claude Desktop: barra lateral com conversas, projetos,
 * artifacts e personalização; conversas em guias; composer fixo; resposta em markdown com
 * streaming. A chave da Groq fica só no main (safeStorage).
 */
export function AiPanel({
  desktop,
  tab,
  model,
  onModel,
  sidebar = true,
  onSidebar,
  onClose,
  onOpenUrl,
}: {
  desktop: DesktopBridge | null;
  tab: AiTab;
  /** Modelo padrão ("" = automático: o primeiro disponível). */
  model: string;
  onModel: (model: string) => void;
  /** Barra de conversas aberta (preferência salva). */
  sidebar?: boolean;
  onSidebar?: (open: boolean) => void;
  onClose: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const [keyState, setKeyState] = useState<AiState | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [chatModel, setChatModel] = useState(model);
  const [library, setLibrary] = useState<AiLibrary | null>(null);
  const [messages, setMessages] = useState<AiHistoryItem[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [error, setError] = useState<{ error: AiError; retryAfter?: number | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [withContext, setWithContext] = useState(false);
  const [search, setSearch] = useState("");
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [draftProject, setDraftProject] = useState<string | null>(null);
  const [persona, setPersona] = useState<string | null>(null);
  const [artifactId, setArtifactId] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const currentRequest = useRef<string | null>(null);

  const activeId = library?.activeId ?? null;
  const activeChat = library?.chats.find((chat) => chat.id === activeId) ?? null;

  // O padrão mudou (Personalização ou outra janela): o seletor do topo acompanha.
  useEffect(() => setChatModel(model), [model]);

  const loadModels = useCallback(
    async (refresh = false) => {
      if (!desktop) return;
      const result = await desktop.aiModels(refresh);
      if (result.ok) setModels(result.models);
      else if (result.error !== "no-key") setError(result);
    },
    [desktop],
  );

  useEffect(() => {
    if (!desktop) return;
    let alive = true;
    void desktop.aiState().then((state) => {
      if (!alive) return;
      setKeyState(state);
      if (state.hasKey) void loadModels();
    });
    void desktop.aiLibrary().then((value) => alive && setLibrary(value));
    const offLibrary = desktop.onAiLibrary((value) => setLibrary(value));
    const offDelta = desktop.onAiDelta(({ requestId: id, delta }) => {
      if (id !== currentRequest.current) return;
      setPending((current) => {
        if (!current) return current;
        const last = current.items[current.items.length - 1]!;
        return {
          ...current,
          items: [...current.items.slice(0, -1), { ...last, text: last.text + delta }],
        };
      });
    });
    return () => {
      alive = false;
      offLibrary();
      offDelta();
    };
  }, [desktop, loadModels]);

  // Mensagens da conversa ativa (de novo quando ela recebe resposta, em qualquer janela).
  const activeStamp = `${activeId}:${activeChat?.updatedAt ?? 0}:${activeChat?.count ?? 0}`;
  useEffect(() => {
    if (!desktop) return;
    if (!activeId) {
      setMessages([]);
      return;
    }
    let alive = true;
    void desktop.aiMessages(activeId).then((list) => alive && setMessages(list));
    return () => {
      alive = false;
    };
  }, [desktop, activeId, activeStamp]);

  // Outra conversa: o artifact aberto era da anterior.
  useEffect(() => setArtifactId(null), [activeId]);

  // A guia mudou: o consentimento era para a outra.
  useEffect(() => setWithContext(false), [tab.id, tab.url]);

  const act = useCallback(
    async (action: AiLibraryAction) => {
      if (!desktop) return null;
      const result = await desktop.aiLibraryAction(action);
      setLibrary(result.library);
      return result;
    },
    [desktop],
  );

  const newChat = useCallback(() => {
    if (requestId) return;
    // Conversa nova nasce com a primeira resposta; até lá é um rascunho na guia "Nova conversa".
    setDraftProject(projectFilter);
    setError(null);
    setNotice(null);
    setText("");
    if (library?.activeId) void act({ type: "tabs", openIds: library.openIds, activeId: null });
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [act, library, projectFilter, requestId]);

  useEffect(() => {
    const listener = () => newChat();
    window.addEventListener(AI_NEW_CHAT_EVENT, listener);
    return () => window.removeEventListener(AI_NEW_CHAT_EVENT, listener);
  }, [newChat]);

  const pendingHere = pending && pending.chatId === activeId ? pending.items : null;
  const shown: AiMessage[] = pendingHere ? [...messages, ...pendingHere] : messages;
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [shown.length, pending]);

  const artifacts = useMemo(() => artifactsOf(messages), [messages]);
  const artifact = artifacts.find((item) => item.id === artifactId) ?? null;
  const contextAllowed = tab.page && !tab.private;
  const projects = library?.projects ?? [];
  const chatProjectId = activeChat ? activeChat.projectId : draftProject;
  const groups = useMemo(
    () =>
      chatGroups(library?.chats ?? [], {
        search,
        projectId: projectFilter,
        archived: showArchived,
      }),
    [library, search, projectFilter, showArchived],
  );

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const question = text.trim();
    if (!desktop || !question || requestId) return;
    const id = nextRequestId();
    const chatId = activeId;
    let context = null;
    if (withContext && contextAllowed) {
      const selection = await desktop.tabSelection(tab.id).catch(() => "");
      context = { url: tab.url, title: tab.title, selection };
    }
    // Consentimento vale para um envio só.
    setWithContext(false);
    setText("");
    setError(null);
    setNotice(null);
    currentRequest.current = id;
    setRequestId(id);
    const now = Date.now();
    setPending({
      chatId,
      items: [
        {
          role: "user",
          text: question,
          at: now,
          ...(context
            ? {
                context: {
                  url: context.url,
                  title: context.title,
                  selection: Boolean(context.selection),
                },
              }
            : {}),
        },
        { role: "assistant", text: "", at: now, streaming: true },
      ],
    });
    const result = await desktop.aiChat({
      requestId: id,
      chatId,
      projectId: chatId ? null : draftProject,
      model: chatModel || null,
      text: question,
      context,
    });
    currentRequest.current = null;
    setRequestId(null);
    if (result.ok) {
      const target = result.chatId;
      if (target && target !== chatId) await act({ type: "chat-open", id: target });
      if (target) setMessages(await desktop.aiMessages(target));
      setPending(null);
      if (result.fallbackFrom) {
        setNotice(
          `O modelo ${modelLabel(result.fallbackFrom)} não está disponível; respondi com ${modelLabel(result.model)}.`,
        );
        void loadModels(true);
      }
      return;
    }
    // Resposta cortada no meio fica à vista; sem nada, a pergunta volta para o campo.
    if (result.partial) {
      setPending((current) =>
        current
          ? { ...current, items: current.items.map((item) => ({ ...item, streaming: false })) }
          : current,
      );
    } else {
      setPending(null);
      setText(question);
    }
    setError(result);
    if (result.error === "invalid-key" || result.error === "no-key") {
      setKeyState((state) => (state ? { ...state, hasKey: result.error !== "no-key" } : state));
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  async function deleteActive() {
    if (!activeId) {
      setPending(null);
      return;
    }
    await act({ type: "chat-delete", id: activeId });
    setMessages([]);
    setPending(null);
    setError(null);
    setNotice(null);
  }

  async function createProject(event: FormEvent) {
    event.preventDefault();
    const name = newProjectName.trim();
    if (!name) return;
    const result = await act({ type: "project-new", name });
    setNewProjectName("");
    setCreatingProject(false);
    if (result?.id) setProjectFilter(result.id);
  }

  function selectChat(id: string) {
    if (requestId) return;
    setError(null);
    setNotice(null);
    void act({ type: "chat-open", id });
  }

  const hasKey = Boolean(keyState?.hasKey);
  const askKey =
    Boolean(desktop && keyState) && (!hasKey || (error !== null && needsKey(error.error)));
  const activeModel = chatModel || models[0] || "";

  const heading = (
    <header className="ai-top">
      {desktop && (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onSidebar?.(!sidebar)}
          aria-label={sidebar ? "Esconder conversas" : "Mostrar conversas"}
          aria-pressed={sidebar}
        >
          {sidebar ? <PanelLeftClose /> : <PanelLeftOpen />}
        </Button>
      )}
      <div className="panel-title">
        <span className="ai-mark">
          <Sparkles />
        </span>
        <div>
          <strong>Agzos AI</strong>
          <small>Groq{hasKey && activeModel ? ` · ${modelLabel(activeModel)}` : ""}</small>
        </div>
      </div>
      <div className="ai-top-actions">
        {desktop && hasKey && (
          <>
            <select
              aria-label="Modelo"
              className="ai-model-select"
              value={chatModel}
              onChange={(event) => setChatModel(event.target.value)}
              disabled={Boolean(requestId)}
            >
              <option value="">Automático{models[0] ? ` (${modelLabel(models[0])})` : ""}</option>
              {chatModel && !models.includes(chatModel) && (
                <option value={chatModel}>{modelLabel(chatModel)} (indisponível)</option>
              )}
              {models.map((id) => (
                <option key={id} value={id}>
                  {modelLabel(id)}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setReplacing((value) => !value)}
              title="Trocar chave"
              aria-label="Trocar chave"
              aria-pressed={replacing}
            >
              <KeyRound />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void deleteActive()}
              title="Apagar conversa"
              aria-label="Apagar conversa"
              disabled={Boolean(requestId) || (!activeId && !pendingHere)}
            >
              <Eraser />
            </Button>
          </>
        )}
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar Agzos AI">
          <X />
        </Button>
      </div>
    </header>
  );

  if (!desktop) {
    return (
      <aside className="ai-sidebar" aria-label="Agzos AI">
        <div className="ai-main">
          {heading}
          <div className="ai-body ai-empty">
            <Sparkles />
            <p>
              O Agzos AI conversa com a Groq só no app desktop: a chave fica no cofre do sistema e
              as chamadas saem do processo principal, nunca da página.
            </p>
          </div>
        </div>
      </aside>
    );
  }

  const chatItem = (chat: AiLibrary["chats"][number]) => (
    <li
      key={chat.id}
      className={cn("ai-nav-item", chat.id === activeId && "active")}
      data-chat={chat.id}
    >
      {renaming === chat.id ? (
        <InlineEdit
          value={chat.title}
          label="Título da conversa"
          onSave={(title) => void act({ type: "chat-update", id: chat.id, title })}
          onDone={() => setRenaming(null)}
        />
      ) : (
        <button
          type="button"
          className="ai-nav-title"
          aria-current={chat.id === activeId ? "page" : undefined}
          onClick={() => selectChat(chat.id)}
          onDoubleClick={() => setRenaming(chat.id)}
          onKeyDown={(event) => {
            if (event.key === "F2") setRenaming(chat.id);
          }}
          title={chat.title}
        >
          {chat.title}
        </button>
      )}
      <span className="ai-nav-actions">
        <button
          type="button"
          aria-label={`Renomear ${chat.title}`}
          title="Renomear"
          onClick={() => setRenaming(chat.id)}
        >
          <Pencil />
        </button>
        <button
          type="button"
          aria-label={`${chat.archived ? "Desarquivar" : "Arquivar"} ${chat.title}`}
          title={chat.archived ? "Desarquivar" : "Arquivar"}
          onClick={() => void act({ type: "chat-update", id: chat.id, archived: !chat.archived })}
        >
          {chat.archived ? <ArchiveRestore /> : <Archive />}
        </button>
        <button
          type="button"
          aria-label={`Apagar ${chat.title}`}
          title="Apagar"
          onClick={() => void act({ type: "chat-delete", id: chat.id })}
        >
          <Trash2 />
        </button>
      </span>
    </li>
  );

  const nav = sidebar && (
    <nav className="ai-nav" aria-label="Conversas do Agzos AI">
      <button
        type="button"
        className="ai-new"
        onClick={newChat}
        disabled={Boolean(requestId)}
        title="Nova conversa (Ctrl+N com o foco no Agzos AI)"
      >
        <SquarePen /> Novo <kbd>Ctrl+N</kbd>
      </button>
      <label className="ai-search">
        <Search />
        <input
          type="search"
          aria-label="Buscar conversas"
          placeholder="Buscar conversas"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      <div className="ai-nav-scroll">
        <section aria-label="Projetos">
          <h4>
            Projetos
            <button
              type="button"
              aria-label="Novo projeto"
              title="Novo projeto"
              onClick={() => setCreatingProject((value) => !value)}
            >
              <FolderPlus />
            </button>
          </h4>
          {creatingProject && (
            <form onSubmit={(event) => void createProject(event)} className="ai-project-form">
              <input
                autoFocus
                aria-label="Nome do projeto"
                placeholder="Nome do projeto"
                maxLength={80}
                value={newProjectName}
                onChange={(event) => setNewProjectName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") setCreatingProject(false);
                }}
              />
              <button type="submit" aria-label="Criar projeto" disabled={!newProjectName.trim()}>
                <Plus />
              </button>
            </form>
          )}
          <ul>
            {projects
              .filter((project) => project.archived === showArchived)
              .map((project) => (
                <li
                  key={project.id}
                  className={cn("ai-nav-item", projectFilter === project.id && "active")}
                >
                  {renaming === project.id ? (
                    <InlineEdit
                      value={project.name}
                      label="Nome do projeto"
                      onSave={(name) => void act({ type: "project-update", id: project.id, name })}
                      onDone={() => setRenaming(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      className="ai-nav-title"
                      aria-pressed={projectFilter === project.id}
                      onClick={() =>
                        setProjectFilter((current) => (current === project.id ? null : project.id))
                      }
                      onDoubleClick={() => setRenaming(project.id)}
                      title={project.name}
                    >
                      <FolderOpen /> {project.name}
                    </button>
                  )}
                  <span className="ai-nav-actions">
                    <button
                      type="button"
                      aria-label={`Renomear projeto ${project.name}`}
                      title="Renomear"
                      onClick={() => setRenaming(project.id)}
                    >
                      <Pencil />
                    </button>
                    <button
                      type="button"
                      aria-label={`${project.archived ? "Desarquivar" : "Arquivar"} projeto ${project.name}`}
                      title={project.archived ? "Desarquivar" : "Arquivar"}
                      onClick={() => {
                        if (projectFilter === project.id) setProjectFilter(null);
                        void act({
                          type: "project-update",
                          id: project.id,
                          archived: !project.archived,
                        });
                      }}
                    >
                      {project.archived ? <ArchiveRestore /> : <Archive />}
                    </button>
                  </span>
                </li>
              ))}
            {!projects.some((project) => project.archived === showArchived) && (
              <li className="ai-nav-empty">
                {showArchived ? "Nenhum projeto arquivado." : "Agrupe conversas em projetos."}
              </li>
            )}
          </ul>
        </section>
        {groups.map((group) => (
          <section key={group.label} aria-label={group.label}>
            <h4>{group.label}</h4>
            <ul>{group.chats.map(chatItem)}</ul>
          </section>
        ))}
        {!groups.length && (
          <p className="ai-nav-empty">
            {search
              ? "Nenhuma conversa encontrada."
              : showArchived
                ? "Nada arquivado."
                : "Nenhuma conversa ainda."}
          </p>
        )}
        <button
          type="button"
          className="link-button ai-archived-toggle"
          onClick={() => setShowArchived((value) => !value)}
          aria-pressed={showArchived}
        >
          {showArchived ? "Voltar às conversas" : "Ver arquivadas"}
        </button>
        <section aria-label="Artifacts">
          <h4>Artifacts</h4>
          <ul>
            {artifacts.map((item) => (
              <li key={item.id} className={cn("ai-nav-item", artifactId === item.id && "active")}>
                <button
                  type="button"
                  className="ai-nav-title"
                  onClick={() => setArtifactId(item.id)}
                  title={item.title}
                >
                  <Code2 /> {item.title}
                </button>
              </li>
            ))}
            {!artifacts.length && (
              <li className="ai-nav-empty">Código, HTML e SVG da conversa aparecem aqui.</li>
            )}
          </ul>
        </section>
      </div>
      <button
        type="button"
        className="ai-persona-button"
        onClick={() => setPersona(library?.persona.instructions ?? "")}
      >
        <SlidersHorizontal /> Personalização
        <small>Padrão: {model ? modelLabel(model) : "Automático"}</small>
      </button>
      <footer className="ai-key-status" data-state={hasKey ? "ok" : "missing"}>
        <span aria-hidden="true" />
        {hasKey
          ? keyState?.weakStorage
            ? "Chave Groq salva (proteção básica)"
            : "Chave Groq no cofre do sistema"
          : "Sem chave da Groq"}
      </footer>
    </nav>
  );

  const tabsStrip = hasKey && (
    <div className="ai-tabs" role="tablist" aria-label="Conversas abertas">
      {(library?.openIds ?? []).map((id) => {
        const chat = library?.chats.find((item) => item.id === id);
        if (!chat) return null;
        return (
          <div key={id} className={cn("ai-tab", id === activeId && "active")}>
            <button
              type="button"
              role="tab"
              aria-selected={id === activeId}
              onClick={() => selectChat(id)}
              title={chat.title}
            >
              {chat.title}
            </button>
            <button
              type="button"
              aria-label={`Fechar a guia ${chat.title}`}
              onClick={() => void act({ type: "chat-close", id })}
              disabled={Boolean(requestId) && id === pending?.chatId}
            >
              <X />
            </button>
          </div>
        );
      })}
      {!activeId && (
        <div className="ai-tab active">
          <button type="button" role="tab" aria-selected>
            Nova conversa
          </button>
        </div>
      )}
      <button
        type="button"
        className="ai-tab-new"
        aria-label="Nova conversa"
        onClick={newChat}
        disabled={Boolean(requestId)}
      >
        <Plus />
      </button>
    </div>
  );

  const keyForm = keyState && (
    <div className="ai-key-box">
      {!keyState.encryption ? (
        <p className="ai-error" role="alert">
          {aiErrorText("insecure")}
        </p>
      ) : (
        <>
          {error && needsKey(error.error) && error.error !== "no-key" && (
            <p className="ai-error" role="alert">
              {aiErrorText(error.error)}
            </p>
          )}
          {keyState.weakStorage && (
            <p className="ai-warning">
              Este sistema não tem chaveiro: a chave fica cifrada só com a proteção básica do
              Chromium.
            </p>
          )}
          <AiKeyForm
            desktop={desktop}
            replacing={replacing && hasKey}
            onOpenUrl={onOpenUrl}
            onCancel={replacing && hasKey ? () => setReplacing(false) : undefined}
            onSaved={(list) => {
              setKeyState({ ...keyState, hasKey: true });
              setReplacing(false);
              setError(null);
              setModels(list);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
          />
        </>
      )}
    </div>
  );

  const projectName = projects.find((project) => project.id === chatProjectId)?.name ?? null;

  return (
    <aside
      className={cn("ai-sidebar", "ai-studio", sidebar && "with-nav", artifact && "with-artifact")}
      aria-label="Agzos AI"
    >
      {nav}
      <div className="ai-main">
        {heading}
        {replacing && hasKey && !askKey && keyForm}
        {tabsStrip}
        <div className="ai-body ai-chat" ref={logRef} aria-live="polite">
          {!keyState ? (
            <div className="ai-empty">
              <Loader2 className="spin" />
            </div>
          ) : askKey ? (
            <div className="ai-welcome">
              <div className="summary-label">
                <KeyRound /> CONFIGURAR A IA
              </div>
              <h3>Conecte sua chave da Groq</h3>
              <p>
                O Agzos AI responde com os modelos da Groq. Informe a GROQ_API_KEY abaixo para
                começar; ela não sai do cofre do sistema.
              </p>
            </div>
          ) : (
            !shown.length && (
              <div className="ai-empty ai-welcome">
                <Sparkles />
                <h3>{projectName ? `Nova conversa em ${projectName}` : "Como posso ajudar?"}</h3>
                <p>
                  Pergunte qualquer coisa. Para falar desta página, marque “Enviar contexto da aba”
                  antes de enviar.
                </p>
              </div>
            )
          )}
          {!askKey &&
            shown.map((item, index) => (
              <div
                key={`${item.at}-${index}`}
                className={cn("chat-bubble", item.role === "user" && "mine")}
                data-role={item.role}
              >
                {item.context && (
                  <small className="ai-context-chip" title={item.context.url}>
                    Contexto: {item.context.title || item.context.url}
                    {item.context.selection ? " + seleção" : ""}
                  </small>
                )}
                {item.role === "assistant" ? (
                  item.text ? (
                    <>
                      <Markdown
                        text={item.text}
                        artifactPrefix={item.streaming ? null : `${item.at}-${index}`}
                        onLink={(href) => onOpenUrl(href)}
                        onArtifact={setArtifactId}
                      />
                      {item.streaming && <span className="ai-caret" aria-hidden="true" />}
                    </>
                  ) : (
                    <Loader2 className="spin" aria-label="Respondendo" />
                  )
                ) : (
                  <p>{item.text}</p>
                )}
              </div>
            ))}
          {notice && <p className="ai-warning">{notice}</p>}
          {error && !needsKey(error.error) && (
            <p className="ai-error" role="alert">
              {aiErrorText(error.error, error.retryAfter)}
            </p>
          )}
        </div>
        {askKey ? (
          <div className="ai-composer ai-composer-key">{keyForm}</div>
        ) : (
          <form className="ai-composer" onSubmit={(event) => void send(event)}>
            <div className="ai-composer-box">
              <textarea
                ref={inputRef}
                rows={2}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Pergunte ao Agzos AI…"
                aria-label="Mensagem para Agzos AI"
                disabled={!keyState}
              />
              <div className="ai-composer-row">
                <label className={cn("ai-context-toggle", !contextAllowed && "disabled")}>
                  <input
                    type="checkbox"
                    checked={withContext && contextAllowed}
                    disabled={!contextAllowed || Boolean(requestId)}
                    onChange={(event) => setWithContext(event.target.checked)}
                  />
                  <span
                    title={
                      contextAllowed
                        ? "endereço, título e texto selecionado, só nesta mensagem"
                        : tab.private
                          ? "indisponível na guia anônima"
                          : "abra uma página para enviar o contexto"
                    }
                  >
                    Enviar contexto da aba
                    <small>só nesta mensagem</small>
                  </span>
                </label>
                <label className="ai-project-chip" title="Projeto da conversa">
                  <FolderOpen />
                  <select
                    aria-label="Projeto da conversa"
                    value={chatProjectId ?? ""}
                    disabled={Boolean(requestId)}
                    onChange={(event) => {
                      const value = event.target.value || null;
                      if (activeId)
                        void act({ type: "chat-update", id: activeId, projectId: value });
                      else setDraftProject(value);
                    }}
                  >
                    <option value="">Sem projeto</option>
                    {projects
                      .filter((project) => !project.archived || project.id === chatProjectId)
                      .map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                  </select>
                </label>
                {requestId ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label="Parar resposta"
                    onClick={() => void desktop.aiAbort(requestId)}
                  >
                    <Square />
                  </Button>
                ) : (
                  <Button
                    type="submit"
                    size="icon"
                    aria-label="Enviar mensagem"
                    disabled={!text.trim()}
                  >
                    <Send />
                  </Button>
                )}
              </div>
            </div>
          </form>
        )}
        <p className="ai-disclaimer">A IA pode cometer erros. Verifique informações importantes.</p>
      </div>
      {artifact && <ArtifactView artifact={artifact} onClose={() => setArtifactId(null)} />}
      {persona !== null && (
        <PersonaDialog
          instructions={persona}
          model={model}
          models={models}
          onCancel={() => setPersona(null)}
          onSave={(instructions, defaultModel) => {
            void act({ type: "persona", instructions });
            onModel(defaultModel);
            setPersona(null);
          }}
        />
      )}
    </aside>
  );
}

/** Personalização: instruções que vão em toda conversa e o modelo padrão. */
function PersonaDialog({
  instructions,
  model,
  models,
  onSave,
  onCancel,
}: {
  instructions: string;
  model: string;
  models: string[];
  onSave: (instructions: string, model: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(instructions);
  const [choice, setChoice] = useState(model);
  return (
    <div className="ai-persona" role="dialog" aria-label="Personalização do Agzos AI">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSave(text, choice);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      >
        <h3>Personalização</h3>
        <label htmlFor="ai-persona-text">Instruções para todas as conversas</label>
        <textarea
          id="ai-persona-text"
          rows={6}
          maxLength={4000}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Ex.: responda curto, com exemplos em TypeScript."
        />
        <label htmlFor="ai-persona-model">Modelo padrão</label>
        <select
          id="ai-persona-model"
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
        >
          <option value="">Automático{models[0] ? ` (${modelLabel(models[0])})` : ""}</option>
          {choice && !models.includes(choice) && (
            <option value={choice}>{modelLabel(choice)} (indisponível)</option>
          )}
          {models.map((id) => (
            <option key={id} value={id}>
              {modelLabel(id)}
            </option>
          ))}
        </select>
        <div className="ai-key-actions">
          <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" size="sm">
            Salvar
          </Button>
        </div>
      </form>
    </div>
  );
}
