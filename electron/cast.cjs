// Chromecast / Android TV (6.0): transmissão nativa para aparelhos da rede local. O
// Google Cast Web Sender SDK não funciona no Electron (não há Media Router); aqui o main
// fala o protocolo Cast v2 (TLS na porta 8009, CastMessage em protobuf) e a página usa só
// a pequena ponte `window.agzosCast` (page-preload.cjs). Sem módulo nativo e sem
// dependência: o mDNS e o protobuf são nossos (cast-proto.cjs).
//
// Segurança: só origens https da lista (prefs.castOrigins) e com permissão "cast" do site;
// os endereços dos aparelhos nunca chegam à página (só id, nome e modelo); o certificado
// autoassinado do aparelho só é aceito no socket TLS de cada conexão, e só para IPv4 de
// rede local.

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const proto = require("./cast-proto.cjs");

const CAST_PORT_TIMEOUT_MS = 8000;
const REQUEST_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 5000;
const HEARTBEAT_DEAD_MS = 15_000;
const MAX_SESSIONS_PER_OWNER = 4;
const MAX_SESSIONS = 8;
const DISCOVERY_IDLE_MS = 90_000;

class CastError extends Error {
  constructor(code, detail) {
    super(code);
    this.code = code;
    this.detail = detail;
  }
}

/** Conexão padrão: TLS que aceita o certificado autoassinado só deste socket. */
function defaultConnect(tls) {
  return (address, port) =>
    new Promise((resolve, reject) => {
      const socket = tls.connect({
        host: address,
        port,
        rejectUnauthorized: false,
        checkServerIdentity: () => undefined,
      });
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new CastError("cast_connect_failed", "tempo esgotado"));
      }, CAST_PORT_TIMEOUT_MS);
      socket.once("secureConnect", () => {
        clearTimeout(timer);
        socket.setNoDelay(true);
        resolve(socket);
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(new CastError("cast_connect_failed", error.message));
      });
    });
}

/** Um canal Cast com um aparelho: quadros, batimento e pedido/resposta por requestId. */
class CastLink extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.reader = new proto.FrameReader();
    this.pending = new Map();
    this.nextId = 1;
    this.closed = false;
    this.lastSeen = Date.now();
    socket.on("data", (chunk) => this.onData(chunk));
    socket.on("error", () => this.close("cast_connection_lost"));
    socket.on("close", () => this.close("cast_connection_lost"));
    this.beat = setInterval(() => {
      if (Date.now() - this.lastSeen > HEARTBEAT_DEAD_MS) this.close("cast_connection_lost");
      else this.send(proto.buildPing());
    }, HEARTBEAT_MS);
    this.beat.unref?.();
  }

  onData(chunk) {
    this.lastSeen = Date.now();
    let messages;
    try {
      messages = this.reader.push(chunk);
    } catch {
      this.close("cast_protocol_error");
      return;
    }
    for (const message of messages) {
      if (message.namespace === proto.NS.heartbeat) {
        if (message.payload.includes('"PING"')) this.send(proto.buildPong());
        continue;
      }
      let payload = null;
      try {
        payload = JSON.parse(message.payload);
      } catch {
        continue;
      }
      if (!payload || typeof payload !== "object") continue;
      const waiting = Number.isInteger(payload.requestId)
        ? this.pending.get(payload.requestId)
        : null;
      if (waiting && waiting.accept(message, payload)) {
        clearTimeout(waiting.timer);
        this.pending.delete(payload.requestId);
        waiting.resolve({ message, payload });
      }
      this.emit("message", message, payload);
    }
  }

  send(message) {
    if (this.closed) return false;
    try {
      this.socket.write(proto.frame(proto.encodeCastMessage(message)));
      return true;
    } catch {
      this.close("cast_connection_lost");
      return false;
    }
  }

  /** Envia `build(requestId)` e espera a resposta desse requestId (accept filtra o tipo). */
  request(build, accept = () => true, timeoutMs = REQUEST_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new CastError("cast_connection_lost"));
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new CastError("cast_timeout"));
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, accept });
      if (!this.send(build(id))) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new CastError("cast_connection_lost"));
      }
    });
  }

  /** Fecha o canal. O app no aparelho segue tocando (só o receiver STOP encerra). */
  close(reason = null, { polite = false } = {}) {
    if (this.closed) return;
    if (polite) {
      this.send(proto.buildClose(this.transportId));
      this.send(proto.buildClose());
    }
    this.closed = true;
    clearInterval(this.beat);
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(new CastError(reason ?? "cast_connection_lost"));
    }
    this.pending.clear();
    try {
      if (polite) {
        // end() descarrega o que ainda está na fila (STOP, CLOSE) antes de fechar.
        this.socket.end();
        const socket = this.socket;
        setTimeout(() => socket.destroy(), 500).unref?.();
      } else {
        this.socket.destroy();
      }
    } catch {
      /* já fechado */
    }
    this.emit("close", reason);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function createCastService({
  dgram,
  os,
  tls,
  connect = null,
  addressOk = proto.isPrivateIPv4,
  mdnsPort = 5353,
  pollMs = 1000,
  log = () => {},
} = {}) {
  const connectFn = connect ?? defaultConnect(tls);
  const table = new proto.DeviceTable({ addressOk });
  const sessions = new Map();
  const deviceListeners = new Set();
  let sockets = [];
  let queryTimers = [];
  let lastUse = 0;
  let idleTimer = null;
  let lastPublic = "[]";

  // ------------------------------------------------------------ descoberta

  const publicDevices = () =>
    table
      .devices()
      .map(({ id, name, model }) => ({ id, name, model }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  function publishDevices() {
    const list = publicDevices();
    const key = JSON.stringify(list);
    if (key === lastPublic) return;
    lastPublic = key;
    for (const listener of deviceListeners) {
      try {
        listener(list);
      } catch {
        /* um ouvinte quebrado não derruba os outros */
      }
    }
  }

  function onPacket(buf, rinfo) {
    if (!addressOk(rinfo.address)) return;
    let parsed;
    try {
      parsed = proto.parseDnsMessage(buf);
    } catch {
      return;
    }
    if (!parsed.response) return;
    const records = parsed.records;
    // Resposta sem registro A: o endereço de quem respondeu vale para o host do SRV.
    const hasAddress = new Set(
      records.filter((r) => r.type === 1).map((r) => r.name.toLowerCase()),
    );
    for (const record of [...records]) {
      if (record.type === 33 && !hasAddress.has(record.data.target.toLowerCase())) {
        records.push({ name: record.data.target, type: 1, ttl: record.ttl, data: rinfo.address });
      }
    }
    table.ingest(records);
    publishDevices();
  }

  function query() {
    const packet = proto.buildMdnsQuery();
    for (const socket of sockets) {
      try {
        socket.send(packet, mdnsPort, "224.0.0.251");
      } catch {
        /* interface sem rota: tenta na próxima rodada */
      }
    }
    table.prune();
    publishDevices();
  }

  function startDiscovery() {
    lastUse = Date.now();
    if (sockets.length || !dgram || !os) return;
    const interfaces = Object.values(os.networkInterfaces())
      .flat()
      .filter(
        (item) => item && item.family === "IPv4" && !item.internal && addressOk(item.address),
      );
    for (const item of interfaces) {
      try {
        const socket = dgram.createSocket({ type: "udp4", reuseAddr: false });
        socket.on("message", onPacket);
        socket.on("error", () => {});
        // Porta efêmera: o aparelho responde por unicast a quem não usa a 5353.
        socket.bind(0, item.address, () => {
          try {
            socket.setMulticastInterface(item.address);
            socket.setMulticastTTL(255);
          } catch {
            /* sem multicast nesta interface */
          }
        });
        sockets.push(socket);
      } catch (error) {
        log("cast: mDNS não abriu em", item.address, error.message);
      }
    }
    queryTimers = [setTimeout(query, 150), setTimeout(query, 1500), setTimeout(query, 4000)];
    const every = setInterval(query, 20_000);
    queryTimers.push(every);
    for (const timer of queryTimers) timer.unref?.();
    idleTimer = setInterval(() => {
      if (
        deviceListeners.size === 0 &&
        sessions.size === 0 &&
        Date.now() - lastUse > DISCOVERY_IDLE_MS
      ) {
        stopDiscovery();
      }
    }, 15_000);
    idleTimer.unref?.();
  }

  function stopDiscovery() {
    for (const timer of queryTimers) {
      clearTimeout(timer);
      clearInterval(timer);
    }
    queryTimers = [];
    clearInterval(idleTimer);
    idleTimer = null;
    for (const socket of sockets) {
      try {
        socket.close();
      } catch {
        /* já fechado */
      }
    }
    sockets = [];
  }

  /** Lista atual; se a descoberta acabou de abrir e ainda está vazia, espera um pouco. */
  async function devices({ wait = true } = {}) {
    const fresh = sockets.length === 0;
    startDiscovery();
    if (wait && fresh && publicDevices().length === 0) {
      for (let i = 0; i < 8 && publicDevices().length === 0; i++) await sleep(250);
    }
    return publicDevices();
  }

  function subscribeDevices(listener) {
    startDiscovery();
    deviceListeners.add(listener);
    return () => deviceListeners.delete(listener);
  }

  // ------------------------------------------------------------ sessões

  const summary = (session) => ({
    sessionId: session.id,
    deviceName: session.deviceName,
    state: session.state,
    currentTime: session.currentTime,
    duration: session.duration,
    volume: session.volume,
    ...(session.error ? { error: session.error } : {}),
  });

  function emit(session, force = false) {
    const next = JSON.stringify(summary(session), (key, value) =>
      key === "currentTime" ? Math.floor(value) : value,
    );
    if (!force && next === session.lastEmitted) return;
    session.lastEmitted = next;
    try {
      session.owner.notify(summary(session), { title: session.title });
    } catch {
      /* o dono pode ter sumido */
    }
  }

  function finish(session, state, error) {
    if (session.ended) return;
    session.ended = true;
    clearTimeout(session.poll);
    session.state = state;
    if (error) session.error = error;
    emit(session, true);
    sessions.delete(session.id);
    session.link?.close(null, { polite: true });
  }

  function applyMediaStatus(session, status) {
    if (!status || status.empty) return;
    if (status.mediaSessionId !== undefined) session.mediaSessionId = status.mediaSessionId;
    session.state = status.state;
    session.currentTime = status.currentTime;
    if (status.duration !== undefined) session.duration = status.duration;
    if (status.volume !== undefined && session.volume === undefined) session.volume = status.volume;
    if (status.error) session.error = status.error;
    else if (status.state !== "error") delete session.error;
    emit(session);
  }

  function onSessionMessage(session, message, payload) {
    if (message.namespace === proto.NS.media) {
      if (payload.type === "MEDIA_STATUS")
        applyMediaStatus(session, proto.parseMediaStatus(payload));
      else {
        const failure = proto.parseCommandError(payload);
        if (failure) {
          session.state = "error";
          session.error = "O aparelho recusou esta mídia.";
          emit(session);
        }
      }
    } else if (message.namespace === proto.NS.receiver && payload.type === "RECEIVER_STATUS") {
      const status = proto.parseReceiverStatus(payload);
      if (!status) return;
      if (status.volume !== null) {
        session.volume = status.volume;
        emit(session);
      }
      // Outro app tomou a tela (ou o app foi encerrado pelo controle remoto).
      if (session.transportId && !status.app && !session.opening) {
        finish(session, "idle");
      }
    } else if (message.namespace === proto.NS.connection && payload.type === "CLOSE") {
      if (message.source === session.transportId) finish(session, "idle");
    }
  }

  function schedulePoll(session) {
    clearTimeout(session.poll);
    if (session.ended) return;
    session.poll = setTimeout(
      () => {
        if (session.ended || !session.link || session.link.closed) return;
        session.link
          .request(
            (id) => proto.buildMediaStatus(session.transportId, id),
            (_m, payload) => payload.type === "MEDIA_STATUS",
            4000,
          )
          .then(({ payload }) => applyMediaStatus(session, proto.parseMediaStatus(payload)))
          .catch(() => {})
          .finally(() => schedulePoll(session));
      },
      session.state === "playing" ? pollMs : pollMs * 4,
    );
    session.poll.unref?.();
  }

  async function open(session, device, media, queue) {
    const link = new CastLink(await connectFn(device.address, device.port));
    session.link = link;
    link.on("message", (message, payload) => onSessionMessage(session, message, payload));
    link.on("close", (reason) => {
      if (!session.ended)
        finish(session, "error", reason ? "A conexão com o aparelho caiu." : undefined);
    });
    link.send(proto.buildConnect());

    const readStatus = async (build) => {
      const { payload } = await link.request(build, (_m, p) => p.type === "RECEIVER_STATUS");
      return proto.parseReceiverStatus(payload);
    };
    let status = await readStatus((id) => proto.buildReceiverStatus(id));
    if (status?.volume !== null && status?.volume !== undefined) session.volume = status.volume;
    if (!status?.app) {
      status = await readStatus((id) => proto.buildLaunch(id));
      for (let i = 0; i < 20 && !status?.app?.transportId; i++) {
        await sleep(500);
        status = await readStatus((id) => proto.buildReceiverStatus(id));
      }
    }
    if (!status?.app?.transportId) throw new CastError("cast_launch_failed");
    session.transportId = status.app.transportId;
    session.receiverSessionId = status.app.sessionId;
    link.transportId = session.transportId;
    link.send(proto.buildConnect(session.transportId));

    const reply = await link.request(
      (id) =>
        queue
          ? proto.buildQueueLoad(session.transportId, id, session.receiverSessionId, queue)
          : proto.buildLoad(session.transportId, id, session.receiverSessionId, media),
      (_m, payload) => payload.type === "MEDIA_STATUS" || proto.parseCommandError(payload) !== null,
      20_000,
    );
    if (proto.parseCommandError(reply.payload)) throw new CastError("cast_load_failed");
    session.opening = false;
    applyMediaStatus(session, proto.parseMediaStatus(reply.payload));
    session.state = session.state === "idle" ? "buffering" : session.state;
    emit(session, true);
    schedulePoll(session);
  }

  /**
   * Abre uma sessão para `owner` ({ key, notify(status, extra) }). Devolve o sessionId já;
   * o estado chega por notify (buffering → playing…). Erros de conexão chegam como
   * state "error" depois do id; erros de validação são lançados.
   */
  function load(owner, args) {
    const checked = proto.validateLoad(args);
    if (!checked.ok) throw new CastError("cast_invalid", checked.error);
    const { deviceId, media, queue } = checked.value;
    const device = table.devices().find((item) => item.id === deviceId);
    if (!device) throw new CastError("cast_device_not_found");
    if (!addressOk(device.address)) throw new CastError("cast_device_not_found");
    const mine = [...sessions.values()].filter((item) => item.owner.key === owner.key);
    // Recarregar no mesmo aparelho troca a sessão anterior (o app no aparelho segue).
    for (const old of mine.filter((item) => item.deviceId === deviceId)) finish(old, "idle");
    if (mine.length >= MAX_SESSIONS_PER_OWNER || sessions.size >= MAX_SESSIONS) {
      throw new CastError("cast_too_many_sessions");
    }
    startDiscovery();
    const session = {
      id: crypto.randomBytes(8).toString("hex"),
      owner,
      deviceId,
      deviceName: device.name,
      title: media.title,
      state: "buffering",
      currentTime: media.startTime ?? 0,
      duration: media.duration,
      volume: undefined,
      hasQueue: Boolean(queue),
      tracks: media.tracks ?? [],
      opening: true,
      ended: false,
    };
    sessions.set(session.id, session);
    emit(session, true);
    open(session, device, media, queue).catch((error) => {
      log("cast: sessão falhou", error.message);
      finish(
        session,
        "error",
        error.code === "cast_load_failed"
          ? "O aparelho recusou esta mídia."
          : "Não foi possível conectar ao aparelho.",
      );
    });
    return session.id;
  }

  function sessionOf(ownerKey, sessionId) {
    const session = sessions.get(sessionId);
    if (!session || (ownerKey !== null && session.owner.key !== ownerKey)) {
      throw new CastError("cast_no_session");
    }
    return session;
  }

  /** Comando validado. ownerKey null = a casca (controle da barra), que vale para qualquer sessão da janela. */
  async function control(ownerKey, sessionId, raw) {
    const checked = proto.validateControl(sessionId, raw);
    if (!checked.ok) throw new CastError("cast_invalid", checked.error);
    const { action, value } = checked.value;
    const session = sessionOf(ownerKey, sessionId);
    if (action === "stop") return stop(ownerKey, sessionId);
    const link = session.link;
    if (!link || link.closed || session.opening) throw new CastError("cast_not_ready");
    const to = session.transportId;
    const mediaId = session.mediaSessionId;
    const needsMedia = ["play", "pause", "seek", "next", "prev", "track"].includes(action);
    if (needsMedia && mediaId === undefined) throw new CastError("cast_not_ready");
    switch (action) {
      case "play":
        link.send(proto.buildPlay(to, link.nextId++, mediaId));
        break;
      case "pause":
        link.send(proto.buildPause(to, link.nextId++, mediaId));
        break;
      case "seek":
        link.send(proto.buildSeek(to, link.nextId++, mediaId, value));
        session.currentTime = value;
        break;
      case "volume":
        link.send(proto.buildSetVolume(link.nextId++, value));
        session.volume = value;
        break;
      case "next":
      case "prev":
        if (!session.hasQueue) throw new CastError("cast_invalid", "sem fila");
        link.send(proto.buildQueueJump(to, link.nextId++, mediaId, action === "next" ? 1 : -1));
        break;
      case "track":
        if (value !== null && !session.hasQueue && !session.tracks.some((t) => t.id === value)) {
          throw new CastError("cast_invalid", "faixa");
        }
        link.send(proto.buildEditTracks(to, link.nextId++, mediaId, value === null ? [] : [value]));
        break;
      default:
        break;
    }
    emit(session);
    // Pede o estado novo logo, sem esperar a próxima sondagem.
    schedulePoll(session);
    return true;
  }

  /** Para a transmissão no aparelho e encerra a sessão. */
  function stop(ownerKey, sessionId) {
    const session = sessionOf(ownerKey, sessionId);
    const link = session.link;
    if (link && !link.closed && session.transportId) {
      if (session.mediaSessionId !== undefined) {
        link.send(proto.buildStopMedia(session.transportId, link.nextId++, session.mediaSessionId));
      }
      if (session.receiverSessionId) {
        link.send(proto.buildStopApp(link.nextId++, session.receiverSessionId));
      }
    }
    finish(session, "idle");
    return true;
  }

  /** A aba fechou ou saiu da origem: solta o controle e deixa tocando no aparelho. */
  function dropOwner(ownerKey) {
    for (const session of [...sessions.values()]) {
      if (session.owner.key !== ownerKey) continue;
      session.ended = true;
      clearTimeout(session.poll);
      sessions.delete(session.id);
      session.link?.close(null, { polite: true });
    }
  }

  const sessionsOf = (ownerKey) =>
    [...sessions.values()]
      .filter((session) => ownerKey === null || session.owner.key === ownerKey)
      .map((session) => ({
        ...summary(session),
        title: session.title,
        ownerKey: session.owner.key,
      }));

  function shutdown() {
    for (const session of [...sessions.values()]) {
      session.ended = true;
      clearTimeout(session.poll);
      session.link?.close(null, { polite: true });
    }
    sessions.clear();
    stopDiscovery();
  }

  return {
    table,
    devices,
    subscribeDevices,
    load,
    control,
    stop,
    dropOwner,
    sessionsOf,
    ownerKeyOf: (sessionId) => sessions.get(sessionId)?.owner.key ?? null,
    shutdown,
    stopDiscovery,
  };
}

// ---------------------------------------------------------------- ponte da página

/**
 * Regras do que a página pode pedir. `deps`: service, flagOn(), origins(), isPrivate(contents),
 * ensurePermission(contents, origin) → Promise<boolean>, onSessions(contents), limiter.
 * Cada op devolve { ok:true, value } ou { ok:false, error:"cast_…" }; nunca lança.
 */
function createCastBridge(deps) {
  const { service, flagOn, origins, ensurePermission, onSessions, limiter } = deps;
  const wired = new WeakSet();
  const subs = new Map(); // contents.id → cancelar

  function wire(contents, origin) {
    if (wired.has(contents)) return;
    wired.add(contents);
    const key = contents.id;
    const drop = () => {
      service.dropOwner(key);
      subs.get(key)?.();
      subs.delete(key);
      limiter.forget(key);
      onSessions(contents, true);
    };
    contents.on("destroyed", drop);
    contents.on("render-process-gone", drop);
    contents.on("did-start-navigation", (details) => {
      const info =
        details && "isMainFrame" in details ? details : { isMainFrame: true, url: details };
      if (!info.isMainFrame || info.isSameDocument) return;
      const next = proto.originOfUrl(info.url);
      if (next !== contents.__castOrigin) drop();
    });
    contents.__castOrigin = origin;
  }

  /** Origem da página que chamou, só se for o quadro principal e estiver na lista. */
  function callerOrigin(event) {
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame) return null;
    return proto.originAllowed(frame.url, origins()) ? proto.originOfUrl(frame.url) : null;
  }

  function allowedSync(event) {
    return flagOn() && callerOrigin(event) !== null;
  }

  async function handle(event, op, args) {
    try {
      if (!flagOn()) return fail("cast_disabled");
      const contents = event.sender;
      const origin = callerOrigin(event);
      if (!origin) return fail("cast_forbidden_origin");
      if (!limiter.take(contents.id)) return fail("cast_rate_limited");
      wire(contents, origin);
      if (!(await ensurePermission(contents, origin))) return fail("cast_denied");
      // A página pode ter saído da origem durante a pergunta.
      if (callerOrigin(event) !== origin) return fail("cast_forbidden_origin");
      const owner = {
        key: contents.id,
        notify: (status, extra) => {
          if (!contents.isDestroyed()) contents.send("agzos:cast-status", status);
          onSessions(contents, false, extra);
        },
      };
      switch (op) {
        case "devices":
          return ok(await service.devices());
        case "subscribe":
          if (!subs.has(contents.id)) {
            subs.set(
              contents.id,
              service.subscribeDevices((list) => {
                if (!contents.isDestroyed()) contents.send("agzos:cast-devices", list);
              }),
            );
          }
          return ok(await service.devices({ wait: false }));
        case "unsubscribe":
          subs.get(contents.id)?.();
          subs.delete(contents.id);
          return ok(true);
        case "load": {
          const id = service.load(owner, args);
          onSessions(contents, false);
          return ok(id);
        }
        case "control":
          return ok(await service.control(contents.id, args?.sessionId, args?.command));
        case "stop":
          return ok(
            await service.stop(contents.id, typeof args === "string" ? args : args?.sessionId),
          );
        case "sessions":
          return ok(
            service.sessionsOf(contents.id).map(({ ownerKey: _o, title: _t, ...rest }) => rest),
          );
        default:
          return fail("cast_invalid");
      }
    } catch (error) {
      return fail(error instanceof CastError ? error.code : "cast_error", error.detail);
    }
  }

  const ok = (value) => ({ ok: true, value });
  const fail = (error, detail) => ({ ok: false, error, ...(detail ? { detail } : {}) });

  return { handle, allowedSync, callerOrigin };
}

module.exports = { createCastService, createCastBridge, CastLink, CastError, defaultConnect };
