// Chromecast / Cast v2 (6.0): regras puras, sem rede e sem Electron, para poderem ser
// testadas sozinhas. Aqui ficam o protobuf do CastMessage (escrito à mão: são 7 campos),
// o enquadramento do socket, os montadores de mensagem, o leitor de status, o DNS do mDNS,
// a tabela de aparelhos, a validação das entradas da página e a lista de origens.
// Quem fala com a rede é electron/cast.cjs.

const NS = Object.freeze({
  connection: "urn:x-cast:com.google.cast.tp.connection",
  heartbeat: "urn:x-cast:com.google.cast.tp.heartbeat",
  receiver: "urn:x-cast:com.google.cast.receiver",
  media: "urn:x-cast:com.google.cast.media",
});
const DEFAULT_MEDIA_RECEIVER = "CC1AD845";
const SENDER_ID = "sender-agzos";
const PLATFORM_ID = "receiver-0";
const MAX_FRAME = 1024 * 1024; // um CastMessage maior que isso é lixo ou ataque
const DEFAULT_ORIGINS = Object.freeze(["https://flix.rsolutionsbr.com"]);

// ---------------------------------------------------------------- protobuf mínimo

function varint(value) {
  const bytes = [];
  let n = value >>> 0;
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  bytes.push(n);
  return Buffer.from(bytes);
}

function readVarint(buf, offset) {
  let result = 0;
  let shift = 0;
  for (let i = offset; i < buf.length && shift < 35; i++) {
    const byte = buf[i];
    result += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value: result, next: i + 1 };
    shift += 7;
  }
  throw new Error("varint inválido");
}

const stringField = (field, text) => {
  const data = Buffer.from(text, "utf8");
  return Buffer.concat([varint((field << 3) | 2), varint(data.length), data]);
};
const varintField = (field, value) => Buffer.concat([varint(field << 3), varint(value)]);

/**
 * CastMessage: 1 protocol_version, 2 source_id, 3 destination_id, 4 namespace,
 * 5 payload_type (0 texto, 1 binário), 6 payload_utf8, 7 payload_binary.
 */
function encodeCastMessage({ source, destination, namespace, payload }) {
  const json = typeof payload === "string" ? payload : JSON.stringify(payload);
  return Buffer.concat([
    varintField(1, 0),
    stringField(2, source),
    stringField(3, destination),
    stringField(4, namespace),
    varintField(5, 0),
    stringField(6, json),
  ]);
}

function decodeCastMessage(buf) {
  const message = {
    protocolVersion: 0,
    source: "",
    destination: "",
    namespace: "",
    payloadType: 0,
    payload: "",
    binary: null,
  };
  let offset = 0;
  while (offset < buf.length) {
    const tag = readVarint(buf, offset);
    offset = tag.next;
    const field = Math.floor(tag.value / 8);
    const wire = tag.value & 7;
    if (wire === 0) {
      const v = readVarint(buf, offset);
      offset = v.next;
      if (field === 1) message.protocolVersion = v.value;
      else if (field === 5) message.payloadType = v.value;
    } else if (wire === 2) {
      const len = readVarint(buf, offset);
      const start = len.next;
      const end = start + len.value;
      if (end > buf.length) throw new Error("campo truncado");
      const data = buf.subarray(start, end);
      offset = end;
      if (field === 2) message.source = data.toString("utf8");
      else if (field === 3) message.destination = data.toString("utf8");
      else if (field === 4) message.namespace = data.toString("utf8");
      else if (field === 6) message.payload = data.toString("utf8");
      else if (field === 7) message.binary = Buffer.from(data);
    } else if (wire === 1) {
      offset += 8;
    } else if (wire === 5) {
      offset += 4;
    } else {
      throw new Error("tipo de campo não suportado");
    }
  }
  return message;
}

/** Quadro do socket: 4 bytes big-endian com o tamanho + o protobuf. */
function frame(messageBuf) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(messageBuf.length, 0);
  return Buffer.concat([head, messageBuf]);
}

/** Remonta quadros de um fluxo TCP: push(chunk) devolve as mensagens completas. */
class FrameReader {
  constructor(maxFrame = MAX_FRAME) {
    this.buffer = Buffer.alloc(0);
    this.maxFrame = maxFrame;
  }
  push(chunk) {
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;
    const out = [];
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32BE(0);
      if (size > this.maxFrame) throw new Error("quadro grande demais");
      if (this.buffer.length < 4 + size) break;
      out.push(decodeCastMessage(this.buffer.subarray(4, 4 + size)));
      this.buffer = this.buffer.subarray(4 + size);
    }
    return out;
  }
}

// ---------------------------------------------------------------- mensagens

const message = (destination, namespace, payload) => ({
  source: SENDER_ID,
  destination,
  namespace,
  payload,
});

const buildConnect = (destination = PLATFORM_ID) =>
  message(destination, NS.connection, { type: "CONNECT" });
const buildClose = (destination = PLATFORM_ID) =>
  message(destination, NS.connection, { type: "CLOSE" });
const buildPing = () => message(PLATFORM_ID, NS.heartbeat, { type: "PING" });
const buildPong = () => message(PLATFORM_ID, NS.heartbeat, { type: "PONG" });
const buildLaunch = (requestId, appId = DEFAULT_MEDIA_RECEIVER) =>
  message(PLATFORM_ID, NS.receiver, { type: "LAUNCH", requestId, appId });
const buildReceiverStatus = (requestId) =>
  message(PLATFORM_ID, NS.receiver, { type: "GET_STATUS", requestId });
const buildSetVolume = (requestId, level) =>
  message(PLATFORM_ID, NS.receiver, {
    type: "SET_VOLUME",
    requestId,
    volume: { level: clamp01(level) },
  });
const buildStopApp = (requestId, sessionId) =>
  message(PLATFORM_ID, NS.receiver, { type: "STOP", requestId, sessionId });

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Mídia validada (ver validateMedia) → objeto `media` do protocolo. */
function toCastMedia(media) {
  const metadata = { metadataType: 0, title: media.title };
  if (media.subtitle) metadata.subtitle = media.subtitle;
  if (media.imageUrl) metadata.images = [{ url: media.imageUrl }];
  const out = {
    contentId: media.url,
    contentType: media.contentType,
    streamType: "BUFFERED",
    metadata,
  };
  if (media.duration !== undefined) out.duration = media.duration;
  if (media.tracks?.length) {
    out.tracks = media.tracks.map((track) => ({
      trackId: track.id,
      type: "TEXT",
      trackContentId: track.url,
      trackContentType: "text/vtt",
      subtype: "SUBTITLES",
      language: track.lang,
      name: track.label,
    }));
  }
  return out;
}

const activeIds = (media) =>
  media.activeTrackId !== undefined && media.activeTrackId !== null ? [media.activeTrackId] : [];

function buildLoad(destination, requestId, sessionId, media) {
  return message(destination, NS.media, {
    type: "LOAD",
    requestId,
    sessionId,
    media: toCastMedia(media),
    autoplay: true,
    currentTime: media.startTime ?? 0,
    activeTrackIds: activeIds(media),
  });
}

function buildQueueLoad(destination, requestId, sessionId, items) {
  return message(destination, NS.media, {
    type: "QUEUE_LOAD",
    requestId,
    sessionId,
    items: items.map((media) => ({
      media: toCastMedia(media),
      autoplay: true,
      preloadTime: 20,
      startTime: media.startTime ?? 0,
      activeTrackIds: activeIds(media),
    })),
    startIndex: 0,
    repeatMode: "REPEAT_OFF",
  });
}

const mediaCommand = (destination, requestId, mediaSessionId, type, extra = {}) =>
  message(destination, NS.media, { type, requestId, mediaSessionId, ...extra });
const buildPlay = (d, r, m) => mediaCommand(d, r, m, "PLAY");
const buildPause = (d, r, m) => mediaCommand(d, r, m, "PAUSE");
const buildStopMedia = (d, r, m) => mediaCommand(d, r, m, "STOP");
const buildSeek = (d, r, m, seconds) =>
  mediaCommand(d, r, m, "SEEK", {
    currentTime: Math.max(0, seconds),
    resumeState: "PLAYBACK_START",
  });
const buildQueueJump = (d, r, m, jump) => mediaCommand(d, r, m, "QUEUE_UPDATE", { jump });
const buildEditTracks = (d, r, m, activeTrackIds) =>
  mediaCommand(d, r, m, "EDIT_TRACKS_INFO", { activeTrackIds });
const buildMediaStatus = (destination, requestId) =>
  message(destination, NS.media, { type: "GET_STATUS", requestId });

// ---------------------------------------------------------------- status

function parseJson(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

/** RECEIVER_STATUS → { app: {appId, transportId, sessionId}|null, volume } | null. */
function parseReceiverStatus(payloadText) {
  const payload = typeof payloadText === "string" ? parseJson(payloadText) : payloadText;
  if (!payload || payload.type !== "RECEIVER_STATUS" || !payload.status) return null;
  const apps = Array.isArray(payload.status.applications) ? payload.status.applications : [];
  const app = apps.find((item) => item && item.appId === DEFAULT_MEDIA_RECEIVER) ?? null;
  const volume = payload.status.volume ?? {};
  return {
    requestId: payload.requestId,
    app: app ? { appId: app.appId, transportId: app.transportId, sessionId: app.sessionId } : null,
    otherApp: !app && apps.length > 0,
    volume: Number.isFinite(volume.level) ? clamp01(volume.level) : null,
    muted: Boolean(volume.muted),
  };
}

const PLAYER_STATES = {
  IDLE: "idle",
  BUFFERING: "buffering",
  PLAYING: "playing",
  PAUSED: "paused",
};

/**
 * MEDIA_STATUS → estado da API da página. idleReason FINISHED vira "ended", ERROR vira
 * "error"; CANCELLED/INTERRUPTED viram "idle".
 */
function parseMediaStatus(payloadText) {
  const payload = typeof payloadText === "string" ? parseJson(payloadText) : payloadText;
  if (!payload || payload.type !== "MEDIA_STATUS" || !Array.isArray(payload.status)) return null;
  const item = payload.status[0];
  if (!item) return { requestId: payload.requestId, empty: true };
  let state = PLAYER_STATES[item.playerState] ?? "idle";
  let error;
  if (state === "idle") {
    if (item.idleReason === "FINISHED") state = "ended";
    else if (item.idleReason === "ERROR") {
      state = "error";
      error = "O aparelho não conseguiu reproduzir esta mídia.";
    }
  }
  return {
    requestId: payload.requestId,
    mediaSessionId: item.mediaSessionId,
    state,
    currentTime: Number.isFinite(item.currentTime) ? item.currentTime : 0,
    duration: Number.isFinite(item.media?.duration) ? item.media.duration : undefined,
    volume: Number.isFinite(item.volume?.level) ? clamp01(item.volume.level) : undefined,
    currentItemId: item.currentItemId,
    activeTrackIds: Array.isArray(item.activeTrackIds) ? item.activeTrackIds : [],
    ...(error ? { error } : {}),
  };
}

/** Erros de comando (LOAD_FAILED, INVALID_REQUEST, LOAD_CANCELLED…). */
function parseCommandError(payloadText) {
  const payload = typeof payloadText === "string" ? parseJson(payloadText) : payloadText;
  if (!payload || typeof payload.type !== "string") return null;
  if (
    ["LOAD_FAILED", "INVALID_REQUEST", "INVALID_PLAYER_STATE", "LOAD_CANCELLED"].includes(
      payload.type,
    )
  ) {
    return { type: payload.type, requestId: payload.requestId, reason: payload.reason ?? null };
  }
  return null;
}

// ---------------------------------------------------------------- validação

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const isId = (value) => typeof value === "string" && ID.test(value);

/** IPv4 de rede local: 10/8, 172.16/12, 192.168/16 e link-local 169.254/16. */
function isPrivateIPv4(address) {
  if (typeof address !== "string") return false;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (!m) return false;
  const [a, b, c, d] = m.slice(1).map(Number);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
}

const MEDIA_TYPE = /^(video|audio|application|text)\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,80}$/;
const LANG = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8}){0,3}$/;
const MAX_URL = 2048;
const MAX_QUEUE = 200;
const MAX_TRACKS = 16;

function httpUrl(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_URL) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

const text = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");
const nonNeg = (value) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1e7;

/** Valida e normaliza uma mídia vinda da página; devolve {ok:true,value} ou {ok:false,error}. */
function validateMedia(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "media" };
  const url = httpUrl(raw.url);
  if (!url) return { ok: false, error: "media.url" };
  if (typeof raw.contentType !== "string" || !MEDIA_TYPE.test(raw.contentType)) {
    return { ok: false, error: "media.contentType" };
  }
  const value = {
    url,
    contentType: raw.contentType,
    title: text(raw.title, 200),
  };
  if (!value.title) return { ok: false, error: "media.title" };
  if (raw.subtitle !== undefined && raw.subtitle !== null) value.subtitle = text(raw.subtitle, 200);
  if (raw.imageUrl !== undefined && raw.imageUrl !== null) {
    const image = httpUrl(raw.imageUrl);
    if (!image) return { ok: false, error: "media.imageUrl" };
    value.imageUrl = image;
  }
  if (raw.duration !== undefined && raw.duration !== null) {
    if (!nonNeg(raw.duration)) return { ok: false, error: "media.duration" };
    value.duration = raw.duration;
  }
  if (raw.startTime !== undefined && raw.startTime !== null) {
    if (!nonNeg(raw.startTime)) return { ok: false, error: "media.startTime" };
    value.startTime = raw.startTime;
  }
  if (raw.tracks !== undefined && raw.tracks !== null) {
    if (!Array.isArray(raw.tracks) || raw.tracks.length > MAX_TRACKS) {
      return { ok: false, error: "media.tracks" };
    }
    const seen = new Set();
    value.tracks = [];
    for (const track of raw.tracks) {
      const trackUrl = httpUrl(track?.url);
      const idOk = Number.isInteger(track?.id) && track.id > 0 && track.id < 1e6;
      if (!trackUrl || !idOk || seen.has(track.id)) return { ok: false, error: "media.tracks" };
      if (typeof track.lang !== "string" || !LANG.test(track.lang)) {
        return { ok: false, error: "media.tracks" };
      }
      seen.add(track.id);
      value.tracks.push({
        id: track.id,
        url: trackUrl,
        lang: track.lang,
        label: text(track.label, 100) || track.lang,
      });
    }
    if (raw.activeTrackId !== undefined && raw.activeTrackId !== null) {
      if (!seen.has(raw.activeTrackId)) return { ok: false, error: "media.activeTrackId" };
      value.activeTrackId = raw.activeTrackId;
    }
  } else if (raw.activeTrackId !== undefined && raw.activeTrackId !== null) {
    return { ok: false, error: "media.activeTrackId" };
  }
  return { ok: true, value };
}

/** Argumento de load(): { deviceId, media, queue? }. */
function validateLoad(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "args" };
  if (!isId(raw.deviceId)) return { ok: false, error: "deviceId" };
  const media = validateMedia(raw.media);
  if (!media.ok) return media;
  let queue;
  if (raw.queue !== undefined && raw.queue !== null) {
    if (!Array.isArray(raw.queue) || raw.queue.length === 0 || raw.queue.length > MAX_QUEUE) {
      return { ok: false, error: "queue" };
    }
    queue = [];
    for (const item of raw.queue) {
      const checked = validateMedia(item);
      if (!checked.ok) return { ok: false, error: `queue.${checked.error}` };
      queue.push(checked.value);
    }
  }
  return { ok: true, value: { deviceId: raw.deviceId, media: media.value, queue } };
}

const ACTIONS = ["play", "pause", "seek", "stop", "volume", "next", "prev", "track"];

function validateControl(sessionId, raw) {
  if (!isId(sessionId)) return { ok: false, error: "sessionId" };
  if (!raw || typeof raw !== "object" || !ACTIONS.includes(raw.action)) {
    return { ok: false, error: "action" };
  }
  const { action, value } = raw;
  if (action === "seek" && !nonNeg(value)) return { ok: false, error: "value" };
  if (action === "volume" && !(typeof value === "number" && value >= 0 && value <= 1)) {
    return { ok: false, error: "value" };
  }
  if (action === "track") {
    const ok = value === null || (Number.isInteger(value) && value > 0 && value < 1e6);
    if (!ok) return { ok: false, error: "value" };
  }
  return { ok: true, value: { sessionId, action, value } };
}

// ---------------------------------------------------------------- origens

function originOfUrl(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Lista de origens https das prefs (castOrigins); inválido ou ausente = padrão. */
function cleanOrigins(value) {
  if (!Array.isArray(value)) return [...DEFAULT_ORIGINS];
  const out = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const origin = originOfUrl(item);
    if (
      origin &&
      origin.startsWith("https://") &&
      origin === item &&
      /^[a-z0-9.-]+(:\d+)?$/.test(origin.slice(8)) &&
      !out.includes(origin)
    ) {
      out.push(origin);
    }
  }
  return out.slice(0, 50);
}

/** A página pode usar a ponte? Só https e só origem da lista (sem curinga). */
function originAllowed(url, origins) {
  const origin = originOfUrl(url);
  return Boolean(origin && origin.startsWith("https://") && cleanOrigins(origins).includes(origin));
}

/** Limite de chamadas: no máximo `max` a cada `windowMs`, por chave. */
function createRateLimiter({ max = 40, windowMs = 5000, now = Date.now } = {}) {
  const hits = new Map();
  return {
    take(key) {
      const t = now();
      const list = (hits.get(key) ?? []).filter((time) => t - time < windowMs);
      if (list.length >= max) {
        hits.set(key, list);
        return false;
      }
      list.push(t);
      hits.set(key, list);
      return true;
    },
    forget(key) {
      hits.delete(key);
    },
  };
}

// ---------------------------------------------------------------- DNS / mDNS

const SERVICE = "_googlecast._tcp.local";

function encodeName(name) {
  const parts = [];
  for (const label of name.split(".")) {
    const data = Buffer.from(label, "utf8");
    parts.push(Buffer.from([data.length]), data);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

/** Consulta mDNS PTR do serviço do Cast. */
function buildMdnsQuery(name = SERVICE) {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(1, 4); // QDCOUNT
  const tail = Buffer.alloc(4);
  tail.writeUInt16BE(12, 0); // PTR
  tail.writeUInt16BE(1, 2); // IN
  return Buffer.concat([head, encodeName(name), tail]);
}

function readName(buf, offset) {
  const labels = [];
  let pos = offset;
  let next = -1;
  for (let hops = 0; hops < 32; hops++) {
    if (pos >= buf.length) throw new Error("nome truncado");
    const len = buf[pos];
    if (len === 0) {
      return { name: labels.join("."), next: next === -1 ? pos + 1 : next };
    }
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length) throw new Error("ponteiro truncado");
      if (next === -1) next = pos + 2;
      pos = ((len & 0x3f) << 8) | buf[pos + 1];
    } else {
      if (pos + 1 + len > buf.length) throw new Error("rótulo truncado");
      labels.push(buf.toString("utf8", pos + 1, pos + 1 + len));
      pos += 1 + len;
    }
  }
  throw new Error("nome com voltas demais");
}

function parseTxt(buf, start, end) {
  const out = {};
  let pos = start;
  while (pos < end) {
    const len = buf[pos++];
    if (pos + len > end) break;
    const entry = buf.toString("utf8", pos, pos + len);
    pos += len;
    const eq = entry.indexOf("=");
    if (eq > 0) out[entry.slice(0, eq).toLowerCase()] = entry.slice(eq + 1);
  }
  return out;
}

/** Registros (todas as seções) de um pacote DNS. Lança em pacote malformado. */
function parseDnsMessage(buf) {
  if (buf.length < 12) throw new Error("pacote curto");
  const flags = buf.readUInt16BE(2);
  const counts = [
    buf.readUInt16BE(4),
    buf.readUInt16BE(6),
    buf.readUInt16BE(8),
    buf.readUInt16BE(10),
  ];
  let pos = 12;
  for (let i = 0; i < counts[0]; i++) pos = readName(buf, pos).next + 4;
  const records = [];
  const total = counts[1] + counts[2] + counts[3];
  for (let i = 0; i < total; i++) {
    const nameInfo = readName(buf, pos);
    pos = nameInfo.next;
    if (pos + 10 > buf.length) throw new Error("registro truncado");
    const type = buf.readUInt16BE(pos);
    const ttl = buf.readUInt32BE(pos + 4);
    const rdlen = buf.readUInt16BE(pos + 8);
    const start = pos + 10;
    const end = start + rdlen;
    if (end > buf.length) throw new Error("dados truncados");
    pos = end;
    const record = { name: nameInfo.name, type, ttl };
    if (type === 12) record.data = readName(buf, start).name;
    else if (type === 16) record.data = parseTxt(buf, start, end);
    else if (type === 1 && rdlen === 4)
      record.data = `${buf[start]}.${buf[start + 1]}.${buf[start + 2]}.${buf[start + 3]}`;
    else if (type === 33 && rdlen >= 7) {
      record.data = { port: buf.readUInt16BE(start + 4), target: readName(buf, start + 6).name };
    } else continue;
    records.push(record);
  }
  return { response: (flags & 0x8000) !== 0, records };
}

const lower = (name) => name.toLowerCase();

/**
 * Tabela de aparelhos montada com as respostas mDNS. Só entra aparelho com id, nome e
 * endereço de rede local (IPv4 privado). `ttlMs` limita a vida de quem para de responder.
 */
class DeviceTable {
  constructor({ ttlMs = 120_000, addressOk = isPrivateIPv4 } = {}) {
    this.ttlMs = ttlMs;
    this.addressOk = addressOk;
    this.instances = new Map(); // instância → { seen }
    this.srv = new Map();
    this.txt = new Map();
    this.addr = new Map(); // host → ip
  }
  ingest(records, now = Date.now()) {
    for (const record of records) {
      const name = lower(record.name);
      if (record.type === 12 && lower(record.name) === SERVICE) {
        if (record.ttl === 0) this.instances.delete(lower(record.data));
        else this.instances.set(lower(record.data), { seen: now });
      } else if (record.type === 33) this.srv.set(name, record.data);
      else if (record.type === 16) this.txt.set(name, record.data);
      else if (record.type === 1) this.addr.set(name, record.data);
    }
  }
  prune(now = Date.now()) {
    for (const [name, info] of this.instances) {
      if (now - info.seen > this.ttlMs) this.instances.delete(name);
    }
  }
  /** [{ id, name, model, address, port }] — address/port nunca vão para a página. */
  devices() {
    const out = [];
    for (const instance of this.instances.keys()) {
      const srv = this.srv.get(instance);
      const txt = this.txt.get(instance);
      if (!srv || !txt) continue;
      const address = this.addr.get(lower(srv.target));
      const id = typeof txt.id === "string" ? txt.id.replace(/[^A-Za-z0-9_-]/g, "") : "";
      if (!address || !this.addressOk(address) || !isId(id)) continue;
      if (!Number.isInteger(srv.port) || srv.port < 1 || srv.port > 65535) continue;
      out.push({
        id,
        name: (txt.fn || instance.split("._googlecast")[0]).slice(0, 100),
        model: (txt.md || "").slice(0, 100),
        address,
        port: srv.port,
      });
    }
    return out;
  }
}

module.exports = {
  NS,
  DEFAULT_MEDIA_RECEIVER,
  SENDER_ID,
  PLATFORM_ID,
  DEFAULT_ORIGINS,
  MAX_FRAME,
  encodeCastMessage,
  decodeCastMessage,
  frame,
  FrameReader,
  buildConnect,
  buildClose,
  buildPing,
  buildPong,
  buildLaunch,
  buildReceiverStatus,
  buildSetVolume,
  buildStopApp,
  buildLoad,
  buildQueueLoad,
  buildPlay,
  buildPause,
  buildStopMedia,
  buildSeek,
  buildQueueJump,
  buildEditTracks,
  buildMediaStatus,
  parseReceiverStatus,
  parseMediaStatus,
  parseCommandError,
  isId,
  isPrivateIPv4,
  validateMedia,
  validateLoad,
  validateControl,
  httpUrl,
  originOfUrl,
  cleanOrigins,
  originAllowed,
  createRateLimiter,
  buildMdnsQuery,
  parseDnsMessage,
  encodeName,
  DeviceTable,
};
