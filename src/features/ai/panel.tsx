import { Eraser, KeyRound, Loader2, Send, Sparkles, Square, X } from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import type { AiError, AiHistoryItem, AiState, DesktopBridge } from "@/features/browser/desktop";
import { cn } from "@/lib/utils";
import {
  type AiMessage,
  aiErrorText,
  answerBlocks,
  modelLabel,
  needsKey,
  nextRequestId,
} from "./model";

export const GROQ_KEYS_URL = "https://console.groq.com/keys";

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

function Answer({ text }: { text: string }) {
  return (
    <>
      {answerBlocks(text).map((block, index) =>
        block.kind === "code" ? (
          <pre key={index} className="ai-code">
            <code>{block.text}</code>
          </pre>
        ) : (
          <p key={index}>{block.text}</p>
        ),
      )}
    </>
  );
}

/** Agzos AI (4.0): conversa com a Groq em streaming, no espaço ao lado da página. */
export function AiPanel({
  desktop,
  tab,
  model,
  onModel,
  onClose,
  onOpenUrl,
}: {
  desktop: DesktopBridge | null;
  tab: AiTab;
  /** "" = automático (o primeiro disponível). */
  model: string;
  onModel: (model: string) => void;
  onClose: () => void;
  onOpenUrl: (url: string) => void;
}) {
  const [keyState, setKeyState] = useState<AiState | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [history, setHistory] = useState<AiHistoryItem[]>([]);
  const [pending, setPending] = useState<AiMessage[] | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [error, setError] = useState<{ error: AiError; retryAfter?: number | null } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [withContext, setWithContext] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const currentRequest = useRef<string | null>(null);

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
    void desktop.aiHistory().then((list) => alive && setHistory(list));
    const offHistory = desktop.onAiHistory((list) => setHistory(list));
    const offDelta = desktop.onAiDelta(({ requestId: id, delta }) => {
      if (id !== currentRequest.current) return;
      setPending((list) => {
        if (!list) return list;
        const last = list[list.length - 1]!;
        return [...list.slice(0, -1), { ...last, text: last.text + delta }];
      });
    });
    return () => {
      alive = false;
      offHistory();
      offDelta();
    };
  }, [desktop, loadModels]);

  // A guia mudou: o consentimento era para a outra.
  useEffect(() => setWithContext(false), [tab.id, tab.url]);

  const shown: AiMessage[] = pending ? [...history, ...pending] : history;
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [shown.length, pending]);

  const contextAllowed = tab.page && !tab.private;

  async function send(event?: FormEvent) {
    event?.preventDefault();
    const question = text.trim();
    if (!desktop || !question || requestId) return;
    const id = nextRequestId();
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
    setPending([
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
    ]);
    const result = await desktop.aiChat({
      requestId: id,
      model: model || null,
      text: question,
      context,
    });
    currentRequest.current = null;
    setRequestId(null);
    if (result.ok) {
      // O histórico novo chega por onAiHistory; a resposta some do "pendente" quando chega.
      const list = await desktop.aiHistory();
      setHistory(list);
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
      setPending((list) => (list ? list.map((item) => ({ ...item, streaming: false })) : list));
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

  async function clear() {
    if (!desktop) return;
    await desktop.aiClearHistory();
    setHistory([]);
    setPending(null);
    setError(null);
    setNotice(null);
  }

  const heading = (
    <div className="panel-heading">
      <div className="panel-title">
        <span className="ai-mark">
          <Sparkles />
        </span>
        <div>
          <strong>Agzos AI</strong>
          <small>
            Groq{models.length && keyState?.hasKey ? ` · ${modelLabel(model || models[0]!)}` : ""}
          </small>
        </div>
      </div>
      <div className="panel-heading-actions">
        {desktop && keyState?.hasKey && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => void clear()}
            title="Apagar conversa"
            aria-label="Apagar conversa"
            disabled={Boolean(requestId) || !history.length}
          >
            <Eraser />
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar Agzos AI">
          <X />
        </Button>
      </div>
    </div>
  );

  if (!desktop) {
    return (
      <aside className="ai-sidebar" aria-label="Agzos AI">
        {heading}
        <div className="ai-body ai-empty">
          <Sparkles />
          <p>
            O Agzos AI conversa com a Groq só no app desktop: a chave fica no cofre do sistema e as
            chamadas saem do processo principal, nunca da página.
          </p>
        </div>
      </aside>
    );
  }

  if (!keyState) {
    return (
      <aside className="ai-sidebar" aria-label="Agzos AI">
        {heading}
        <div className="ai-body ai-empty">
          <Loader2 className="spin" />
        </div>
      </aside>
    );
  }

  const askKey = !keyState.hasKey || replacing || (error !== null && needsKey(error.error));
  if (askKey) {
    return (
      <aside className="ai-sidebar" aria-label="Agzos AI">
        {heading}
        <div className="ai-body">
          <div className="summary-label">
            <KeyRound /> CONFIGURAR A IA
          </div>
          <h3>Conecte sua chave da Groq</h3>
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
                replacing={keyState.hasKey}
                onOpenUrl={onOpenUrl}
                onCancel={keyState.hasKey ? () => setReplacing(false) : undefined}
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
      </aside>
    );
  }

  return (
    <aside className="ai-sidebar" aria-label="Agzos AI">
      {heading}
      <div className="ai-model-row">
        <label htmlFor="ai-model">Modelo</label>
        <select
          id="ai-model"
          value={model}
          onChange={(event) => onModel(event.target.value)}
          disabled={Boolean(requestId)}
        >
          <option value="">Automático{models[0] ? ` (${modelLabel(models[0])})` : ""}</option>
          {model && !models.includes(model) && (
            <option value={model}>{modelLabel(model)} (indisponível)</option>
          )}
          {models.map((id) => (
            <option key={id} value={id}>
              {modelLabel(id)}
            </option>
          ))}
        </select>
        <button type="button" className="link-button" onClick={() => setReplacing(true)}>
          Trocar chave
        </button>
      </div>
      <div className="ai-body ai-chat" ref={logRef} aria-live="polite">
        {!shown.length && (
          <div className="ai-empty">
            <Sparkles />
            <p>
              Pergunte qualquer coisa. Para falar desta página, marque “Enviar contexto da aba”
              antes de enviar.
            </p>
          </div>
        )}
        {shown.map((item, index) => (
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
                <Answer text={item.text} />
              ) : (
                <Loader2 className="spin" aria-label="Respondendo" />
              )
            ) : (
              <p>{item.text}</p>
            )}
          </div>
        ))}
        {notice && <p className="ai-warning">{notice}</p>}
        {error && (
          <p className="ai-error" role="alert">
            {aiErrorText(error.error, error.retryAfter)}
          </p>
        )}
      </div>
      <form className="ai-composer" onSubmit={(event) => void send(event)}>
        <label className={cn("ai-context-toggle", !contextAllowed && "disabled")}>
          <input
            type="checkbox"
            checked={withContext && contextAllowed}
            disabled={!contextAllowed || Boolean(requestId)}
            onChange={(event) => setWithContext(event.target.checked)}
          />
          <span>
            Enviar contexto da aba
            <small>
              {contextAllowed
                ? "endereço, título e texto selecionado, só nesta mensagem"
                : tab.private
                  ? "indisponível na guia anônima"
                  : "abra uma página para enviar o contexto"}
            </small>
          </span>
        </label>
        <div className="chat-input">
          <textarea
            ref={inputRef}
            rows={1}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Pergunte ao Agzos AI…"
            aria-label="Mensagem para Agzos AI"
          />
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
            <Button type="submit" size="icon" aria-label="Enviar mensagem" disabled={!text.trim()}>
              <Send />
            </Button>
          )}
        </div>
      </form>
      <p className="ai-disclaimer">A IA pode cometer erros. Verifique informações importantes.</p>
    </aside>
  );
}
