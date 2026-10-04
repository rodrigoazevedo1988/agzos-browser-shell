import { Circle, Pause, Send, SendToBack, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  CapturedRequest,
  DesktopBridge,
  ScratchpadRequest,
  ScratchpadResponse,
} from "@/features/browser/desktop";
import { cn } from "@/lib/utils";

import {
  SCRATCHPAD_METHODS,
  editorOf,
  formatSize,
  headersToText,
  prettyBody,
  shortUrl,
  textToHeaders,
} from "./model";

export type ScratchpadTab = { id: number; title: string; url: string };

// O editor e a captura sobrevivem à troca de guia (a página interna desmonta).
let memory: {
  tabId: number | null;
  capturing: boolean;
  requests: CapturedRequest[];
  editor: { method: string; url: string; headers: string; body: string };
  response: ScratchpadResponse | null;
} = {
  tabId: null,
  capturing: false,
  requests: [],
  editor: { method: "GET", url: "", headers: "", body: "" },
  response: null,
};

/**
 * API Scratchpad (4.5): captura as requisições de uma guia (CDP Network) e reenvia com
 * método, URL, headers e body editados, mostrando status e resposta. Não substitui o
 * DevTools; é o "repetir mudando uma coisa" sem sair do navegador.
 */
export function ScratchpadPage({
  desktop,
  tabs,
  target,
}: {
  desktop: DesktopBridge | null;
  tabs: ScratchpadTab[];
  /** Guia pedida por "Capturar requisições desta guia" (começa capturando). */
  target: number | null;
}) {
  const [tabId, setTabId] = useState<number | null>(target ?? memory.tabId ?? tabs[0]?.id ?? null);
  const [capturing, setCapturing] = useState(memory.capturing && memory.tabId === tabId);
  const [requests, setRequests] = useState<CapturedRequest[]>(memory.requests);
  const [editor, setEditor] = useState(memory.editor);
  const [response, setResponse] = useState<ScratchpadResponse | null>(memory.response);
  const [sending, setSending] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    memory = { tabId, capturing, requests, editor, response };
  }, [tabId, capturing, requests, editor, response]);

  // Pedido de captura vindo do menu da página.
  useEffect(() => {
    if (target === null) return;
    setTabId(target);
    void start(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  useEffect(() => {
    if (!desktop) return;
    return desktop.onNetCapture((event) => {
      if (event.tabId !== memory.tabId) return;
      if (event.type === "request") {
        setRequests((list) => [...list.slice(-119), event.request]);
      } else {
        setRequests((list) =>
          list.map((item) => (item.id === event.id ? { ...item, status: event.status } : item)),
        );
      }
    });
  }, [desktop]);

  async function start(id: number) {
    if (!desktop) return;
    memory.tabId = id;
    const result = await desktop.scratchpadCapture(id, true);
    setCapturing(result.ok);
    setRequests(result.requests);
  }

  const stop = () => {
    if (desktop && tabId !== null) void desktop.scratchpadCapture(tabId, false);
    setCapturing(false);
  };

  const load = (request: CapturedRequest) => {
    const next = editorOf(request);
    setEditor({
      method: next.method,
      url: next.url,
      headers: headersToText(next.headers),
      body: next.body,
    });
    setResponse(null);
  };

  const send = async () => {
    if (!desktop) return;
    const request: ScratchpadRequest = {
      method: editor.method,
      url: editor.url,
      headers: textToHeaders(editor.headers),
      body: editor.body,
    };
    setSending(true);
    setResponse(await desktop.scratchpadSend(request, tabId));
    setSending(false);
  };

  const page = tabs.find((tab) => tab.id === tabId);
  const shown = requests
    .filter((item) => !filter || item.url.toLowerCase().includes(filter.toLowerCase()))
    .slice()
    .reverse();
  const contentType =
    response?.ok === true
      ? (response.headers.find(([name]) => name.toLowerCase() === "content-type")?.[1] ?? "")
      : "";

  if (!desktop) {
    return (
      <div className="scratchpad">
        <p className="scratch-empty">O API Scratchpad funciona no app Agzos para computador.</p>
      </div>
    );
  }

  return (
    <div className="scratchpad" data-scratchpad>
      <section className="scratch-captured" aria-label="Requisições capturadas">
        <header>
          <h2>Requisições da guia</h2>
          <select
            aria-label="Guia capturada"
            value={tabId ?? ""}
            onChange={(event) => {
              stop();
              setRequests([]);
              setTabId(Number(event.target.value));
            }}
          >
            {tabs.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.title || tab.url}
              </option>
            ))}
          </select>
          {capturing ? (
            <Button variant="outline" size="sm" onClick={stop}>
              <Pause /> Parar
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={tabId === null}
              onClick={() => tabId !== null && void start(tabId)}
            >
              <Circle /> Capturar
            </Button>
          )}
        </header>
        <div className="scratch-tools">
          <input
            type="search"
            aria-label="Filtrar requisições"
            placeholder="Filtrar por URL"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label="Limpar lista"
            title="Limpar lista"
            onClick={() => setRequests([])}
          >
            <Trash2 />
          </Button>
        </div>
        {capturing && (
          <p className="scratch-live" role="status">
            Capturando: use a página e as requisições aparecem aqui.
          </p>
        )}
        <ul className="scratch-list">
          {shown.map((item) => (
            <li key={`${item.id}-${item.at}`}>
              <span className={cn("scratch-method", `m-${item.method.toLowerCase()}`)}>
                {item.method}
              </span>
              <span className="scratch-url" title={item.url}>
                {shortUrl(item.url, page?.url ?? item.url)}
              </span>
              <span className="scratch-status">{item.status ?? "…"}</span>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Mandar para o Scratchpad: ${item.method} ${item.url}`}
                onClick={() => load(item)}
              >
                <SendToBack /> Mandar para o Scratchpad
              </Button>
            </li>
          ))}
          {!shown.length && (
            <li className="scratch-empty">
              {capturing ? "Nenhuma requisição ainda." : "Escolha a guia e clique em Capturar."}
            </li>
          )}
        </ul>
      </section>

      <section className="scratch-editor" aria-label="Editor da requisição">
        <div className="scratch-line">
          <select
            aria-label="Método"
            value={editor.method}
            onChange={(event) => setEditor({ ...editor, method: event.target.value })}
          >
            {SCRATCHPAD_METHODS.map((method) => (
              <option key={method}>{method}</option>
            ))}
          </select>
          <input
            aria-label="URL da requisição"
            placeholder="https://api.exemplo.com/recurso"
            value={editor.url}
            onChange={(event) => setEditor({ ...editor, url: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") void send();
            }}
          />
          <Button disabled={sending || !editor.url.trim()} onClick={() => void send()}>
            <Send /> {sending ? "Enviando…" : "Enviar"}
          </Button>
        </div>
        <label>
          <span>Headers (um por linha, Nome: valor)</span>
          <textarea
            aria-label="Headers"
            rows={6}
            spellCheck={false}
            value={editor.headers}
            onChange={(event) => setEditor({ ...editor, headers: event.target.value })}
          />
        </label>
        <label>
          <span>Body</span>
          <textarea
            aria-label="Body"
            rows={7}
            spellCheck={false}
            disabled={editor.method === "GET" || editor.method === "HEAD"}
            value={editor.body}
            onChange={(event) => setEditor({ ...editor, body: event.target.value })}
          />
        </label>
        <p className="scratch-note">
          Sai pela sessão da guia escolhida (com os cookies dela). Host, Content-Length e afins o
          navegador monta sozinho.
        </p>

        {response && (
          <section className="scratch-response" aria-label="Resposta" role="region">
            {response.ok ? (
              <>
                <p className="scratch-status-line">
                  <strong
                    className={cn(
                      "scratch-code",
                      response.status >= 400 ? "bad" : response.status >= 300 ? "warn" : "good",
                    )}
                  >
                    {response.status} {response.statusText}
                  </strong>
                  <span>
                    {response.ms} ms · {formatSize(response.size)}
                    {response.truncated ? " (cortado em 2 MB)" : ""}
                  </span>
                </p>
                <details>
                  <summary>Headers da resposta ({response.headers.length})</summary>
                  <pre>{headersToText(response.headers)}</pre>
                </details>
                <pre className="scratch-body" aria-label="Corpo da resposta">
                  {response.binary
                    ? "(resposta binária; não mostrada)"
                    : prettyBody(response.body, contentType) || "(vazio)"}
                </pre>
              </>
            ) : (
              <p className="scratch-error" role="alert">
                {response.error === "url"
                  ? "URL inválida (só http e https)."
                  : response.error === "method"
                    ? "Método não suportado."
                    : `Falha de rede${response.message ? `: ${response.message}` : "."}`}
              </p>
            )}
          </section>
        )}
      </section>
    </div>
  );
}
