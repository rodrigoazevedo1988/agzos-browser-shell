// API Scratchpad (4.5): requisições da guia capturadas pelo CDP (Network) e reenviadas com
// método, URL, headers e body editados. Não substitui o DevTools: é o "repetir com outro
// body" rápido. O envio sai pela sessão da guia (cookies dela), só http(s).

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
// O Chromium monta estes sozinho (ou recusa): não vão do editor para a rede.
const FORBIDDEN_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "te",
  "trailer",
  "expect",
  "proxy-connection",
]);
const LIMITS = { captured: 120, body: 1_000_000, response: 2_000_000, headers: 100 };
const CAPTURED_TYPES = new Set(["XHR", "Fetch", "Document", "Other", "EventSource", "Ping"]);

function headerPairs(value) {
  if (Array.isArray(value)) {
    return value
      .filter((pair) => Array.isArray(pair) && typeof pair[0] === "string")
      .map(([name, item]) => [name.trim(), String(item ?? "")]);
  }
  if (value && typeof value === "object") {
    return Object.entries(value).map(([name, item]) => [name, String(item ?? "")]);
  }
  return [];
}

/** Evento Network.requestWillBeSent → requisição capturada (ou null se não interessa). */
function capturedOf(params, now = Date.now()) {
  const request = params?.request;
  if (!request || typeof request.url !== "string" || !/^https?:\/\//i.test(request.url))
    return null;
  if (params.type && !CAPTURED_TYPES.has(params.type)) return null;
  return {
    id: String(params.requestId ?? "").slice(0, 80),
    method: String(request.method ?? "GET")
      .toUpperCase()
      .slice(0, 12),
    url: request.url.slice(0, 8000),
    headers: headerPairs(request.headers).slice(0, LIMITS.headers),
    body: typeof request.postData === "string" ? request.postData.slice(0, LIMITS.body) : "",
    type: String(params.type ?? "Other"),
    at: now,
    status: null,
  };
}

/** O que veio do editor → requisição válida para enviar, ou { error }. */
function sanitizeRequest(input) {
  const method = String(input?.method ?? "GET").toUpperCase();
  if (!METHODS.has(method)) return { error: "method" };
  let url;
  try {
    url = new URL(String(input?.url ?? "").trim());
  } catch {
    return { error: "url" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "url" };
  const headers = [];
  for (const [name, value] of headerPairs(input?.headers).slice(0, LIMITS.headers)) {
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name)) continue;
    // Pseudo-headers do HTTP/2 (":authority") e os que o Chromium controla ficam de fora.
    if (FORBIDDEN_HEADERS.has(name.toLowerCase())) continue;
    if (/[\r\n]/.test(value)) continue;
    headers.push([name, value]);
  }
  const body = typeof input?.body === "string" ? input.body.slice(0, LIMITS.body) : "";
  return {
    method,
    url: url.href,
    headers,
    body: method === "GET" || method === "HEAD" ? "" : body,
  };
}

/** Envia e resume a resposta (status, headers, corpo em texto até 2 MB). */
async function sendRequest(fetchFn, request, now = () => Date.now()) {
  const clean = sanitizeRequest(request);
  if (clean.error) return { ok: false, error: clean.error };
  const started = now();
  let response;
  try {
    response = await fetchFn(clean.url, {
      method: clean.method,
      headers: clean.headers,
      body: clean.body || undefined,
      redirect: "manual",
      credentials: "include",
    });
  } catch (error) {
    return { ok: false, error: "network", message: String(error?.message ?? "").slice(0, 300) };
  }
  const buffer = Buffer.from(await response.arrayBuffer().catch(() => new ArrayBuffer(0)));
  const type = response.headers.get("content-type") ?? "";
  const textual =
    !type ||
    /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|graphql)|[^;]*\+(json|xml))/i.test(
      type,
    );
  const truncated = buffer.length > LIMITS.response;
  const slice = buffer.subarray(0, LIMITS.response);
  return {
    ok: true,
    status: response.status,
    statusText: response.statusText ?? "",
    headers: [...response.headers.entries()].slice(0, LIMITS.headers),
    body: textual ? slice.toString("utf8") : "",
    binary: !textual,
    size: buffer.length,
    truncated,
    ms: Math.max(0, now() - started),
  };
}

/**
 * Captura por guia: liga o domínio Network no debugger que a guia já tem e guarda as
 * últimas requisições. `emit(owner, payload)` avisa a casca.
 */
function createNetCapture({ emit }) {
  const active = new Map();

  function stop(contents) {
    const entry = active.get(contents);
    if (!entry) return;
    active.delete(contents);
    if (contents.isDestroyed()) return;
    contents.debugger.off("message", entry.listener);
    contents.debugger.sendCommand("Network.disable").catch(() => {});
  }

  function start(contents, { tabId, owner }) {
    if (active.has(contents)) return { ok: true, requests: active.get(contents).requests };
    try {
      if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
    } catch {
      return { ok: false, error: "debugger" };
    }
    const entry = { tabId, owner, requests: [], listener: null };
    active.set(contents, entry);
    entry.listener = (_event, method, params) => {
      if (method === "Network.requestWillBeSent") {
        const item = capturedOf(params);
        if (!item) return;
        entry.requests.push(item);
        if (entry.requests.length > LIMITS.captured) entry.requests.shift();
        emit(owner, { tabId, type: "request", request: item });
      } else if (method === "Network.responseReceived") {
        const item = entry.requests.find((request) => request.id === params?.requestId);
        if (!item) return;
        item.status = Number(params.response?.status) || null;
        emit(owner, { tabId, type: "status", id: item.id, status: item.status });
      }
    };
    contents.debugger.on("message", entry.listener);
    contents.debugger
      .sendCommand("Network.enable", { maxPostDataSize: LIMITS.body })
      .catch(() => {});
    contents.once("destroyed", () => active.delete(contents));
    return { ok: true, requests: [] };
  }

  return {
    start,
    stop,
    requests: (contents) => active.get(contents)?.requests ?? [],
    capturing: (contents) => active.has(contents),
  };
}

module.exports = { capturedOf, createNetCapture, sanitizeRequest, sendRequest };
