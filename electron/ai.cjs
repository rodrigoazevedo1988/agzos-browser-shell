// Agzos AI com Groq (4.0). Tudo que toca a chave roda aqui, no processo principal:
// - a GROQ_API_KEY chega uma vez pelo campo mascarado da casca, é validada e fica só
//   cifrada pelo safeStorage (DPAPI no Windows, Keychain no macOS) em <userData>/ai-key.bin;
// - a casca nunca recebe a chave de volta, só "tem chave" ou não;
// - nenhuma mensagem de erro ou log leva a chave (os erros viram códigos curtos).
// A conversa (histórico local, apagável) fica no SQLite do app (meta aiHistory).

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
const KEY_FILE = "ai-key.bin";
/** Ordem de preferência; o primeiro disponível na conta é o padrão. */
const PREFERRED_MODELS = [
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-120b",
  "llama-3.1-8b-instant",
  "openai/gpt-oss-20b",
];
/** Modelos da lista que não conversam (áudio, moderação). */
const NON_CHAT_MODEL = /whisper|tts|guard|orpheus|playai|distil/i;
const HISTORY_LIMIT = 200;
/** Mensagens anteriores que vão junto com a pergunta (contexto da conversa). */
const CONTEXT_MESSAGES = 20;
const SELECTION_LIMIT = 8000;
const MESSAGE_LIMIT = 16000;
const KEY_RE = /^[\x21-\x7e]{16,256}$/;
/** Modo voz do terminal (4.1): Whisper da Groq. */
const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";
/** Limite de upload da Groq para áudio. */
const AUDIO_LIMIT = 25 * 1024 * 1024;
const AUDIO_TYPES = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

/** Corpo multipart/form-data do /audio/transcriptions (sem depender de FormData no main). */
function transcriptionBody(audio, mime, language, boundary) {
  const type = String(mime ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const extension = AUDIO_TYPES[type] ?? "webm";
  const field = (name, value) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
  const fields = [
    field("model", TRANSCRIBE_MODEL),
    field("response_format", "json"),
    field("temperature", "0"),
    ...(language ? [field("language", language)] : []),
  ].join("");
  const head =
    `${fields}--${boundary}\r\nContent-Disposition: form-data; name="file"; ` +
    `filename="voz.${extension}"\r\nContent-Type: ${type || "audio/webm"}\r\n\r\n`;
  return Buffer.concat([
    Buffer.from(head, "utf8"),
    Buffer.from(audio),
    Buffer.from(`\r\n--${boundary}--\r\n`, "utf8"),
  ]);
}

const SYSTEM_PROMPT =
  "Você é o Agzos AI, o assistente do navegador Agzos. Responda em português do Brasil, " +
  "de forma direta e correta. Quando não souber, diga que não sabe.";

/** Lista de /models → ids de modelos de conversa, ordenados com os preferidos na frente. */
function chatModelsOf(body) {
  const data = Array.isArray(body?.data) ? body.data : [];
  const ids = data
    .filter((item) => item && typeof item.id === "string" && item.active !== false)
    .map((item) => item.id)
    .filter((id) => !NON_CHAT_MODEL.test(id));
  const preferred = PREFERRED_MODELS.filter((id) => ids.includes(id));
  return [...preferred, ...ids.filter((id) => !preferred.includes(id)).sort()];
}

/** O modelo pedido se existe; senão o primeiro da lista (que já vem com os preferidos). */
function pickModel(requested, available) {
  if (requested && available.includes(requested)) return requested;
  return available[0] ?? PREFERRED_MODELS[0];
}

/** Código curto para a casca (nunca texto do servidor com dados da conta). */
function errorOfStatus(status, body) {
  const code = String(body?.error?.code ?? "");
  if (status === 401 || status === 403 || code === "invalid_api_key") return "invalid-key";
  if (status === 429) return "rate-limit";
  if (status === 404 || /model_not_found|model_decommissioned/.test(code)) {
    return "model-unavailable";
  }
  if (status === 400 && /model/i.test(String(body?.error?.message ?? ""))) {
    return "model-unavailable";
  }
  if (status >= 500) return "server";
  return "request";
}

function retryAfterOf(headers) {
  const value = Number(headers?.get?.("retry-after"));
  return Number.isFinite(value) && value > 0 ? Math.ceil(value) : null;
}

/** Linhas "data: {...}" do SSE → pedaços de texto. Devolve o que sobrou da última linha. */
function parseSse(buffer, onDelta) {
  const lines = buffer.split("\n");
  const rest = lines.pop() ?? "";
  let done = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") {
      done = true;
      continue;
    }
    try {
      const chunk = JSON.parse(data);
      const delta = chunk?.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta) onDelta(delta);
    } catch {
      // Linha cortada ou keep-alive: ignora.
    }
  }
  return { rest, done };
}

/** Contexto da aba que o usuário marcou para mandar nesta pergunta (e só nela). */
function contextOf(value) {
  if (!value || typeof value !== "object") return null;
  const url = typeof value.url === "string" ? value.url.slice(0, 2000) : "";
  const title = typeof value.title === "string" ? value.title.slice(0, 300) : "";
  const selection =
    typeof value.selection === "string" ? value.selection.slice(0, SELECTION_LIMIT) : "";
  if (!url && !title && !selection) return null;
  return { url, title, selection };
}

function contextText(context) {
  const lines = ["Contexto da aba, enviado pelo usuário junto com esta pergunta:"];
  if (context.url) lines.push(`URL: ${context.url}`);
  if (context.title) lines.push(`Título: ${context.title}`);
  if (context.selection) lines.push(`Texto selecionado:\n"""\n${context.selection}\n"""`);
  return lines.join("\n");
}

/** Mensagens para a API: sistema, as últimas da conversa e a pergunta (com o contexto). */
function buildMessages(history, question, context) {
  const previous = history.slice(-CONTEXT_MESSAGES).map((item) => ({
    role: item.role === "user" ? "user" : "assistant",
    content: item.text,
  }));
  const content = context ? `${contextText(context)}\n\nPergunta: ${question}` : question;
  return [{ role: "system", content: SYSTEM_PROMPT }, ...previous, { role: "user", content }];
}

function parseHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item) =>
        item &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.text === "string",
    )
    .map((item) => ({
      role: item.role,
      text: item.text,
      at: Number(item.at) || 0,
      ...(item.context && typeof item.context === "object"
        ? {
            context: {
              url: String(item.context.url ?? ""),
              title: String(item.context.title ?? ""),
              selection: Boolean(item.context.selection),
            },
          }
        : {}),
      ...(typeof item.model === "string" ? { model: item.model } : {}),
    }))
    .slice(-HISTORY_LIMIT);
}

function createAi({ userDataDir, safeStorage, fetch, baseUrl = DEFAULT_BASE_URL, database }) {
  const keyFile = path.join(userDataDir, KEY_FILE);
  const running = new Map();
  let models = null;

  const encryptionAvailable = () => {
    try {
      return Boolean(safeStorage?.isEncryptionAvailable());
    } catch {
      return false;
    }
  };
  // Linux sem chaveiro: o Chromium cifra com uma senha fixa (melhor que texto puro, mas
  // fraco). Windows e macOS usam o cofre do sistema.
  const weakStorage = () => {
    try {
      return safeStorage?.getSelectedStorageBackend?.() === "basic_text";
    } catch {
      return false;
    }
  };

  function readKey() {
    if (!encryptionAvailable()) return null;
    try {
      return safeStorage.decryptString(fs.readFileSync(keyFile));
    } catch {
      return null;
    }
  }

  function writeKey(key) {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(keyFile, safeStorage.encryptString(key), { mode: 0o600 });
  }

  async function request(key, pathName, init = {}) {
    return fetch(`${baseUrl}${pathName}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
    });
  }

  async function readJson(response) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  async function listModels(key) {
    let response;
    try {
      response = await request(key, "/models");
    } catch {
      return { ok: false, error: "network" };
    }
    const body = await readJson(response);
    if (!response.ok) {
      return {
        ok: false,
        error: errorOfStatus(response.status, body),
        retryAfter: retryAfterOf(response.headers),
      };
    }
    return { ok: true, models: chatModelsOf(body) };
  }

  // Banco fechado (saída do app) ou indisponível: a conversa segue só na tela.
  const history = () => {
    try {
      return parseHistory(database?.getMeta("aiHistory"));
    } catch {
      return [];
    }
  };
  const saveHistory = (list) => {
    try {
      database?.setMeta("aiHistory", list.slice(-HISTORY_LIMIT));
    } catch {
      // Ver acima.
    }
  };

  const api = {
    state() {
      return {
        hasKey: fs.existsSync(keyFile) && readKey() !== null,
        encryption: encryptionAvailable(),
        weakStorage: weakStorage(),
      };
    },

    /** Valida a chave na API e grava cifrada. A chave nunca volta para a casca. */
    async setKey(value) {
      const key = typeof value === "string" ? value.trim() : "";
      if (!KEY_RE.test(key)) return { ok: false, error: "invalid-key" };
      if (!encryptionAvailable()) return { ok: false, error: "insecure" };
      const result = await listModels(key);
      // Limite de uso também prova que a chave existe.
      if (!result.ok && result.error !== "rate-limit") return { ok: false, error: result.error };
      try {
        writeKey(key);
      } catch {
        return { ok: false, error: "storage" };
      }
      models = result.ok ? result.models : null;
      return { ok: true, models: models ?? [] };
    },

    removeKey() {
      models = null;
      for (const controller of running.values()) controller.abort();
      try {
        fs.rmSync(keyFile, { force: true });
      } catch {
        return { ok: false };
      }
      return { ok: true };
    },

    async models({ refresh = false } = {}) {
      const key = readKey();
      if (!key) return { ok: false, error: "no-key" };
      if (models && !refresh) return { ok: true, models };
      const result = await listModels(key);
      if (result.ok) models = result.models;
      return result;
    },

    history,

    clearHistory() {
      saveHistory([]);
      return { ok: true };
    },

    /**
     * Pergunta com streaming. `onDelta` recebe cada pedaço; a promessa resolve com a
     * resposta inteira (ou o código do erro). O modelo indisponível cai no próximo da
     * lista uma vez (`fallbackFrom` avisa a casca).
     */
    async chat({ requestId, model, text, context }, onDelta) {
      const key = readKey();
      if (!key) return { ok: false, error: "no-key" };
      const question = typeof text === "string" ? text.trim().slice(0, MESSAGE_LIMIT) : "";
      if (!question) return { ok: false, error: "request" };
      const pageContext = contextOf(context);
      const previous = history();
      const messages = buildMessages(previous, question, pageContext);
      const controller = new AbortController();
      running.set(requestId, controller);
      let chosen = typeof model === "string" && model ? model : null;
      let fallbackFrom = null;
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (!chosen || attempt > 0) {
            const list = await api.models({ refresh: attempt > 0 });
            if (!list.ok) return list;
            chosen = pickModel(
              null,
              list.models.filter((id) => id !== fallbackFrom),
            );
          }
          let response;
          try {
            response = await request(key, "/chat/completions", {
              method: "POST",
              body: JSON.stringify({ model: chosen, messages, stream: true }),
              signal: controller.signal,
            });
          } catch {
            return { ok: false, error: controller.signal.aborted ? "aborted" : "network" };
          }
          if (!response.ok) {
            const body = await readJson(response);
            const error = errorOfStatus(response.status, body);
            if (error === "model-unavailable" && attempt === 0) {
              fallbackFrom = chosen;
              continue;
            }
            return { ok: false, error, retryAfter: retryAfterOf(response.headers) };
          }
          let answer = "";
          try {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const parsed = parseSse(buffer, (delta) => {
                answer += delta;
                onDelta(delta);
              });
              buffer = parsed.rest;
              if (parsed.done) break;
            }
            parseSse(`${buffer}\n`, (delta) => {
              answer += delta;
              onDelta(delta);
            });
          } catch {
            if (!controller.signal.aborted) return { ok: false, error: "network", partial: answer };
          }
          const now = Date.now();
          const entry = { role: "user", text: question, at: now };
          if (pageContext) {
            entry.context = {
              url: pageContext.url,
              title: pageContext.title,
              selection: Boolean(pageContext.selection),
            };
          }
          const reply = { role: "assistant", text: answer, at: now, model: chosen };
          if (answer) saveHistory([...previous, entry, reply]);
          return {
            ok: true,
            text: answer,
            model: chosen,
            fallbackFrom,
            aborted: controller.signal.aborted,
          };
        }
        return { ok: false, error: "model-unavailable" };
      } finally {
        running.delete(requestId);
      }
    },

    abort(requestId) {
      running.get(requestId)?.abort();
      return { ok: true };
    },

    /**
     * Modo voz do terminal: áudio gravado na casca → texto (Whisper). `language` é o código
     * ISO (pt, en…) ou vazio para detectar. Sem chave, nada sai do computador.
     */
    async transcribe({ audio, mime, language }) {
      const key = readKey();
      if (!key) return { ok: false, error: "no-key" };
      const bytes = audio instanceof Uint8Array ? audio : null;
      if (!bytes || !bytes.length || bytes.length > AUDIO_LIMIT)
        return { ok: false, error: "request" };
      const lang = typeof language === "string" && /^[a-z]{2}$/.test(language) ? language : "";
      const boundary = `agzos${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`;
      let response;
      try {
        response = await fetch(`${baseUrl}/audio/transcriptions`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
          },
          body: transcriptionBody(bytes, mime, lang, boundary),
        });
      } catch {
        return { ok: false, error: "network" };
      }
      const body = await readJson(response);
      if (!response.ok) {
        return {
          ok: false,
          error: errorOfStatus(response.status, body),
          retryAfter: retryAfterOf(response.headers),
        };
      }
      const text = typeof body?.text === "string" ? body.text.trim() : "";
      return { ok: true, text };
    },

    /** A chave da Groq para o ambiente dos terminais (opção do usuário); nunca para a casca. */
    keyForTerminal() {
      return readKey();
    },
  };
  return api;
}

module.exports = {
  TRANSCRIBE_MODEL,
  transcriptionBody,
  DEFAULT_BASE_URL,
  PREFERRED_MODELS,
  createAi,
  chatModelsOf,
  pickModel,
  errorOfStatus,
  parseSse,
  buildMessages,
  parseHistory,
};
