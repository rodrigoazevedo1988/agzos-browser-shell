// Conversas do Agzos AI (4.1.3), no estilo do Claude Desktop: várias conversas, projetos,
// guias abertas e personalização. Regras puras; o ai.cjs grava tudo no SQLite (meta
// aiChats). Nada aqui toca a chave da Groq.

const LIMITS = {
  chats: 200,
  messages: 200,
  projects: 50,
  open: 12,
  title: 80,
  instructions: 4000,
  text: 64000,
};

const ID_RE = /^[a-z0-9-]{4,40}$/i;

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const cleanTitle = (value) =>
  typeof value === "string"
    ? value
        .replace(/[\r\n\t]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, LIMITS.title)
    : "";
const time = (value) => (Number.isFinite(value) && value > 0 ? value : 0);

function emptyLibrary() {
  return { projects: [], chats: [], openIds: [], activeId: null, persona: { instructions: "" } };
}

function parseMessage(item) {
  if (!isObject(item) || (item.role !== "user" && item.role !== "assistant")) return null;
  if (typeof item.text !== "string") return null;
  return {
    role: item.role,
    text: item.text.slice(0, LIMITS.text),
    at: time(Number(item.at)),
    ...(isObject(item.context)
      ? {
          context: {
            url: String(item.context.url ?? "").slice(0, 2000),
            title: String(item.context.title ?? "").slice(0, 300),
            selection: Boolean(item.context.selection),
          },
        }
      : {}),
    ...(typeof item.model === "string" ? { model: item.model.slice(0, 120) } : {}),
  };
}

const parseMessages = (value) =>
  (Array.isArray(value) ? value : []).map(parseMessage).filter(Boolean).slice(-LIMITS.messages);

/** Título automático: o começo da primeira pergunta. */
function titleOf(text) {
  const clean = cleanTitle(text);
  if (clean.length <= 48) return clean || "Nova conversa";
  return `${clean.slice(0, 47).replace(/\s+\S*$/, "")}…`;
}

/** Valor salvo (ou o histórico único da 4.0) → biblioteca válida. */
function parseLibrary(value, legacyHistory = null) {
  const library = emptyLibrary();
  if (!isObject(value)) {
    const messages = parseMessages(legacyHistory);
    if (messages.length) {
      const first = messages.find((item) => item.role === "user");
      const chat = {
        id: "conversa-anterior",
        title: first ? titleOf(first.text) : "Conversa anterior",
        titled: false,
        projectId: null,
        archived: false,
        createdAt: messages[0].at,
        updatedAt: messages[messages.length - 1].at,
        messages,
      };
      library.chats.push(chat);
      library.openIds.push(chat.id);
      library.activeId = chat.id;
    }
    return library;
  }
  const projectIds = new Set();
  for (const item of Array.isArray(value.projects) ? value.projects : []) {
    if (!isObject(item) || !ID_RE.test(item.id) || projectIds.has(item.id)) continue;
    const name = cleanTitle(item.name);
    if (!name) continue;
    projectIds.add(item.id);
    library.projects.push({
      id: item.id,
      name,
      archived: Boolean(item.archived),
      createdAt: time(item.createdAt),
    });
    if (library.projects.length >= LIMITS.projects) break;
  }
  const chatIds = new Set();
  for (const item of Array.isArray(value.chats) ? value.chats : []) {
    if (!isObject(item) || !ID_RE.test(item.id) || chatIds.has(item.id)) continue;
    chatIds.add(item.id);
    const messages = parseMessages(item.messages);
    library.chats.push({
      id: item.id,
      title: cleanTitle(item.title) || "Nova conversa",
      titled: Boolean(item.titled),
      projectId: projectIds.has(item.projectId) ? item.projectId : null,
      archived: Boolean(item.archived),
      createdAt: time(item.createdAt),
      updatedAt: time(item.updatedAt),
      messages,
    });
    if (library.chats.length >= LIMITS.chats) break;
  }
  library.openIds = [
    ...new Set((Array.isArray(value.openIds) ? value.openIds : []).filter((id) => chatIds.has(id))),
  ].slice(0, LIMITS.open);
  library.activeId = chatIds.has(value.activeId) ? value.activeId : null;
  if (library.activeId && !library.openIds.includes(library.activeId)) {
    library.openIds = [...library.openIds, library.activeId].slice(-LIMITS.open);
  }
  library.persona = {
    instructions:
      typeof value.persona?.instructions === "string"
        ? value.persona.instructions.slice(0, LIMITS.instructions)
        : "",
  };
  return library;
}

/** O que a casca vê: conversas sem as mensagens (só a contagem), mais recentes primeiro. */
function summaryOf(library) {
  return {
    projects: library.projects.map((project) => ({ ...project })),
    chats: [...library.chats]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ messages, ...chat }) => ({ ...chat, count: messages.length })),
    openIds: [...library.openIds],
    activeId: library.activeId,
    persona: { ...library.persona },
  };
}

/** Abre a conversa numa guia (a mais antiga sai quando passa do limite) e ativa. */
function openChat(library, id) {
  const openIds = library.openIds.includes(id) ? library.openIds : [...library.openIds, id];
  return { ...library, openIds: openIds.slice(-LIMITS.open), activeId: id };
}

function newChat(library, { id, projectId = null, now }) {
  const chat = {
    id,
    title: "Nova conversa",
    titled: false,
    projectId: library.projects.some((project) => project.id === projectId) ? projectId : null,
    archived: false,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  // Passou do limite: some a conversa parada há mais tempo (que não esteja aberta).
  let chats = [...library.chats, chat];
  while (chats.length > LIMITS.chats) {
    const oldest = chats
      .filter((item) => item.id !== id && !library.openIds.includes(item.id))
      .sort((a, b) => a.updatedAt - b.updatedAt)[0];
    if (!oldest) break;
    chats = chats.filter((item) => item !== oldest);
  }
  return openChat({ ...library, chats }, id);
}

function updateChat(library, id, patch) {
  if (!library.chats.some((chat) => chat.id === id)) return library;
  const chats = library.chats.map((chat) => {
    if (chat.id !== id) return chat;
    const next = { ...chat };
    if (typeof patch.title === "string") {
      const title = cleanTitle(patch.title);
      if (title) {
        next.title = title;
        next.titled = true;
      }
    }
    if (patch.projectId !== undefined) {
      next.projectId = library.projects.some((project) => project.id === patch.projectId)
        ? patch.projectId
        : null;
    }
    if (typeof patch.archived === "boolean") next.archived = patch.archived;
    return next;
  });
  let next = { ...library, chats };
  // Conversa arquivada sai das guias.
  if (patch.archived === true) next = closeChat(next, id);
  return next;
}

function closeChat(library, id) {
  const index = library.openIds.indexOf(id);
  if (index < 0) return library;
  const openIds = library.openIds.filter((item) => item !== id);
  const activeId =
    library.activeId === id
      ? (openIds[Math.min(index, openIds.length - 1)] ?? null)
      : library.activeId;
  return { ...library, openIds, activeId };
}

function deleteChat(library, id) {
  const closed = closeChat(library, id);
  return { ...closed, chats: closed.chats.filter((chat) => chat.id !== id) };
}

function newProject(library, { id, name, now }) {
  const clean = cleanTitle(name);
  if (!clean || library.projects.length >= LIMITS.projects) return library;
  return {
    ...library,
    projects: [...library.projects, { id, name: clean, archived: false, createdAt: now }],
  };
}

function updateProject(library, id, patch) {
  return {
    ...library,
    projects: library.projects.map((project) => {
      if (project.id !== id) return project;
      const name = cleanTitle(patch.name);
      return {
        ...project,
        ...(name ? { name } : {}),
        ...(typeof patch.archived === "boolean" ? { archived: patch.archived } : {}),
      };
    }),
  };
}

/** Guias abertas e a ativa (null = conversa nova, ainda sem mensagem). */
function setTabs(library, { openIds, activeId }) {
  const known = new Set(library.chats.map((chat) => chat.id));
  const ids = [...new Set((Array.isArray(openIds) ? openIds : []).filter((id) => known.has(id)))];
  const active = known.has(activeId) ? activeId : null;
  return {
    ...library,
    openIds: (active && !ids.includes(active) ? [...ids, active] : ids).slice(-LIMITS.open),
    activeId: active,
  };
}

function setPersona(library, { instructions }) {
  return {
    ...library,
    persona: {
      instructions:
        typeof instructions === "string" ? instructions.slice(0, LIMITS.instructions) : "",
    },
  };
}

/** Pergunta e resposta entram no fim da conversa; a primeira dá o título. */
function appendExchange(library, id, entries, now) {
  return {
    ...library,
    chats: library.chats.map((chat) => {
      if (chat.id !== id) return chat;
      const messages = parseMessages([...chat.messages, ...entries]);
      const first = messages.find((item) => item.role === "user");
      return {
        ...chat,
        messages,
        updatedAt: now,
        archived: false,
        title: chat.titled || !first ? chat.title : titleOf(first.text),
      };
    }),
  };
}

const messagesOf = (library, id) => library.chats.find((chat) => chat.id === id)?.messages ?? [];

/** Ação vinda da casca (dados validados aqui). `newId()` gera ids novos; `now` é o relógio. */
function applyAction(library, action, { newId, now }) {
  if (!isObject(action)) return { library };
  switch (action.type) {
    case "chat-new": {
      const id = newId();
      return { library: newChat(library, { id, projectId: action.projectId ?? null, now }), id };
    }
    case "chat-open":
      return library.chats.some((chat) => chat.id === action.id)
        ? { library: openChat(library, action.id) }
        : { library };
    case "chat-close":
      return { library: closeChat(library, action.id) };
    case "chat-update":
      return { library: updateChat(library, action.id, action) };
    case "chat-delete":
      return { library: deleteChat(library, action.id) };
    case "project-new": {
      const id = newId();
      const next = newProject(library, { id, name: action.name, now });
      return { library: next, ...(next !== library ? { id } : {}) };
    }
    case "project-update":
      return { library: updateProject(library, action.id, action) };
    case "tabs":
      return { library: setTabs(library, action) };
    case "persona":
      return { library: setPersona(library, action) };
    default:
      return { library };
  }
}

module.exports = {
  LIMITS,
  appendExchange,
  applyAction,
  closeChat,
  emptyLibrary,
  messagesOf,
  newChat,
  parseLibrary,
  summaryOf,
  titleOf,
};
