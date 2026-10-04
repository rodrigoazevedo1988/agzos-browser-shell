// Downloads de todas as sessions: registra, gera nome único, emite progresso e
// persiste no SQLite (menos os das abas anônimas, que ficam só em memória).
const fs = require("node:fs");
const path = require("node:path");

const { cleanTags, fileTypeOf, routeDownload } = require("./download-rules.cjs");

const PROGRESS_INTERVAL_MS = 250;

/** "arquivo.pdf" → "arquivo (1).pdf" enquanto o nome existir na pasta ou estiver reservado. */
function uniquePath(dir, filename, taken = new Set()) {
  const safe = path.basename(filename || "download").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_");
  const name = safe && safe !== "." && safe !== ".." ? safe : "download";
  const ext = path.extname(name);
  const stem = ext ? name.slice(0, -ext.length) : name;
  for (let index = 0; ; index++) {
    const candidate = path.join(dir, index === 0 ? name : `${stem} (${index})${ext}`);
    if (!taken.has(candidate) && !fs.existsSync(candidate)) return candidate;
  }
}

/** Move o arquivo (rename; entre discos, copia e apaga). Devolve o caminho novo. */
function moveFile(from, dir) {
  fs.mkdirSync(dir, { recursive: true });
  const target = uniquePath(dir, path.basename(from));
  try {
    fs.renameSync(from, target);
  } catch (error) {
    if (error?.code !== "EXDEV") throw error;
    fs.copyFileSync(from, target);
    fs.rmSync(from, { force: true });
  }
  return target;
}

/**
 * `config()` devolve a configuração do gerenciador (download-rules.cjs) e
 * `defaultSession()` a session para reiniciar downloads que não estão mais ativos.
 */
function createDownloadManager({
  database,
  downloadsDir,
  emit,
  isPrivateSession,
  config = () => null,
  defaultSession = () => null,
}) {
  // id → { item, record, lastEmit, private, session, moveTo }
  const active = new Map();
  const privateRecords = new Map();
  const saveAsNext = new WeakSet();
  // URL reiniciada → etiquetas e pasta do download antigo (a próxima com essa URL herda).
  const restarts = new Map();
  let privateSeq = 0;
  // App saindo: o banco fecha no will-quit e os "done" dos cancelamentos chegam depois.
  let closing = false;

  function reservedPaths() {
    return new Set([...active.values()].map((entry) => entry.record.path).filter(Boolean));
  }

  function snapshot(entry) {
    const { item, record } = entry;
    return {
      ...record,
      type: fileTypeOf(record.filename, record.mime),
      private: entry.private,
      // Interrompido mas retomável (a rede caiu): aparece como pausado, com "Retomar".
      paused: item ? item.isPaused() || Boolean(entry.interrupted) : false,
      canResume: item ? item.canResume() : false,
      moveTo: entry.moveTo ?? null,
    };
  }

  function send(entry) {
    entry.lastEmit = Date.now();
    emit(snapshot(entry));
  }

  function persist(entry) {
    if (entry.private || !database || closing) return;
    try {
      database.updateDownload(entry.record.id, entry.record);
    } catch (error) {
      // Erro no processo principal abriria um diálogo e seguraria o app aberto.
      console.error("Agzos: não foi possível gravar o download.", error);
    }
  }

  function track(event, item, contents) {
    const ses = contents?.session ?? null;
    const isPrivate = Boolean(ses && isPrivateSession(ses));
    const askUser = Boolean(contents && saveAsNext.has(contents));
    if (askUser) saveAsNext.delete(contents);
    const restart = restarts.get(item.getURL()) ?? null;
    if (restart) restarts.delete(item.getURL());
    // 4.7: pasta global, do tipo e das regras (etiqueta por domínio, subpasta por nome).
    const route = routeDownload(
      config() ?? { dir: "", byTypeOn: false, byType: {}, rules: [] },
      { filename: item.getFilename(), mime: item.getMimeType(), url: item.getURL() },
      downloadsDir(),
    );
    let dir = restart?.dir || route.dir;
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      dir = downloadsDir();
    }
    // Sem setSavePath o Electron mostra o diálogo nativo de "Salvar como".
    if (!askUser) item.setSavePath(uniquePath(dir, item.getFilename(), reservedPaths()));

    const record = {
      id: 0,
      url: item.getURL(),
      filename: item.getFilename(),
      path: item.getSavePath(),
      mime: item.getMimeType(),
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: "progressing",
      startedAt: Date.now(),
      endedAt: null,
      tags: cleanTags([...(restart?.tags ?? []), ...route.tags]),
      etag: "",
      lastModified: "",
      urlChain: item.getURLChain(),
    };
    if (isPrivate || !database) record.id = -++privateSeq;
    else record.id = database.addDownload(record);
    const entry = { item, record, lastEmit: 0, private: isPrivate, session: ses, moveTo: null };
    if (record.tags.length) persist(entry);
    active.set(record.id, entry);
    if (isPrivate) privateRecords.set(record.id, entry);

    item.on("updated", (_event, state) => {
      record.receivedBytes = item.getReceivedBytes();
      record.totalBytes = item.getTotalBytes();
      const savePath = item.getSavePath();
      if (savePath && savePath !== record.path) {
        record.path = savePath;
        record.filename = path.basename(savePath);
      }
      record.state = state === "interrupted" && !item.canResume() ? "interrupted" : "progressing";
      entry.interrupted = state === "interrupted";
      // O que o Chromium manda no Range ao retomar (If-Range com ETag ou data).
      record.etag = item.getETag() || record.etag;
      record.lastModified = item.getLastModifiedTime() || record.lastModified;
      if (Date.now() - entry.lastEmit >= PROGRESS_INTERVAL_MS) send(entry);
    });
    item.once("done", (_event, state) => {
      if (closing) return;
      record.receivedBytes = item.getReceivedBytes();
      record.totalBytes = item.getTotalBytes() || record.receivedBytes;
      const savePath = item.getSavePath();
      if (savePath) {
        record.path = savePath;
        record.filename = path.basename(savePath);
      }
      record.state = state;
      record.endedAt = Date.now();
      entry.item = null;
      active.delete(record.id);
      // "Mudar destino" pedido durante o download: move ao terminar.
      if (state === "completed" && entry.moveTo && record.path) {
        try {
          record.path = moveFile(record.path, entry.moveTo);
          record.filename = path.basename(record.path);
        } catch (error) {
          console.error("Agzos: não foi possível mover o download.", error);
        }
      }
      entry.moveTo = null;
      // Diálogo "Salvar como" cancelado: nada foi baixado, não entra na lista.
      // (Ou "reiniciar" de um em andamento: a linha nova substitui esta.)
      if ((state === "cancelled" && !savePath) || entry.removeOnDone) {
        privateRecords.delete(record.id);
        if (!entry.private && database) database.removeDownload(record.id);
        emit({ ...snapshot(entry), removed: true });
        return;
      }
      persist(entry);
      send(entry);
    });
    send(entry);
    void event;
  }

  function entryOf(id) {
    return active.get(id) ?? privateRecords.get(id) ?? null;
  }

  function storedRecord(id) {
    const entry = entryOf(id);
    if (entry) return entry.record;
    if (!database || id <= 0) return null;
    return database.listDownloads().find((row) => row.id === id) ?? null;
  }

  /** Linha do banco sem download ativo → entrada para alterar e gravar. */
  function storedEntry(id) {
    const entry = entryOf(id);
    if (entry) return entry;
    const record = storedRecord(id);
    return record
      ? { item: null, record, lastEmit: 0, private: false, session: null, moveTo: null }
      : null;
  }

  function list() {
    const stored = database ? database.listDownloads() : [];
    const live = new Map([...active.values()].map((entry) => [entry.record.id, snapshot(entry)]));
    const rows = stored.map(
      (row) =>
        live.get(row.id) ?? {
          ...row,
          type: fileTypeOf(row.filename, row.mime),
          private: false,
          paused: false,
          canResume: false,
          moveTo: null,
        },
    );
    const privateRows = [...privateRecords.values()].map(snapshot);
    return [...privateRows, ...rows].sort((a, b) => b.startedAt - a.startedAt);
  }

  return {
    track,
    /** O próximo download iniciado por este webContents abre o diálogo "Salvar como". */
    askNext(contents) {
      saveAsNext.add(contents);
    },
    list,
    pause(id) {
      active.get(id)?.item?.pause();
      const entry = active.get(id);
      if (entry) send(entry);
    },
    resume(id) {
      const entry = active.get(id);
      if (entry?.item?.canResume()) {
        entry.interrupted = false;
        entry.item.resume();
      }
      if (entry) send(entry);
    },
    cancel(id) {
      active.get(id)?.item?.cancel();
    },
    /**
     * Baixa de novo (falhou, cancelado ou concluído). A linha antiga sai da lista e a nova
     * herda as etiquetas e a pasta. Em andamento: cancela e recomeça.
     */
    restart(id) {
      const entry = storedEntry(id);
      if (!entry || !/^https?:/i.test(entry.record.url)) return false;
      const ses = entry.session ?? defaultSession();
      if (!ses) return false;
      restarts.set(entry.record.url, {
        tags: entry.record.tags ?? [],
        dir: entry.record.path ? path.dirname(entry.record.path) : "",
      });
      if (entry.item) {
        entry.removeOnDone = true;
        entry.item.cancel();
      } else {
        privateRecords.delete(id);
        if (database && id > 0) database.removeDownload(id);
        emit({ ...snapshot(entry), removed: true });
      }
      ses.downloadURL(entry.record.url);
      return true;
    },
    /**
     * Outra pasta para este item: concluído move o arquivo agora, em andamento move ao
     * terminar. Devolve o caminho (ou a pasta pendente).
     */
    setDestination(id, dir) {
      const entry = storedEntry(id);
      if (!entry || typeof dir !== "string" || !path.isAbsolute(dir)) return { ok: false };
      if (entry.item) {
        entry.moveTo = dir;
        send(entry);
        return { ok: true, pending: true };
      }
      const { record } = entry;
      if (record.state !== "completed" || !record.path || !fs.existsSync(record.path)) {
        return { ok: false, error: "missing" };
      }
      try {
        record.path = moveFile(record.path, dir);
        record.filename = path.basename(record.path);
      } catch {
        return { ok: false, error: "move" };
      }
      persist(entry);
      send(entry);
      return { ok: true, path: record.path };
    },
    /** Troca as etiquetas do item (a casca manda a lista inteira). */
    setTags(id, tags) {
      const entry = storedEntry(id);
      if (!entry) return false;
      entry.record.tags = cleanTags(tags);
      persist(entry);
      send(entry);
      return true;
    },
    /** Linhas para exportar (as pedidas, na ordem da lista). */
    rows(ids) {
      const wanted = new Set(Array.isArray(ids) ? ids : []);
      return list().filter((row) => wanted.has(row.id));
    },
    /** Caminho de um download concluído, só se foi registrado aqui. */
    completedPath(id) {
      const record = storedRecord(id);
      if (!record || record.state !== "completed" || !record.path) return null;
      return fs.existsSync(record.path) ? record.path : null;
    },
    anyPath(id) {
      const record = storedRecord(id);
      return record?.path || null;
    },
    /** Saída do app: download em andamento segura o quit do Electron; cancela todos. */
    cancelAll() {
      // Grava "cancelado" já (o banco ainda está aberto) e só depois cancela.
      const now = Date.now();
      for (const entry of active.values()) {
        entry.record.state = "cancelled";
        entry.record.endedAt = now;
        persist(entry);
      }
      closing = true;
      for (const entry of active.values()) entry.item?.cancel();
    },
    remove(id) {
      if (active.has(id)) return false;
      const record = storedRecord(id);
      privateRecords.delete(id);
      if (database && id > 0) database.removeDownload(id);
      // 4.7: todas as janelas tiram da lista (gerenciador e painel).
      if (record) emit({ ...record, removed: true });
      return true;
    },
    clear() {
      const gone = list().filter((row) => row.state !== "progressing");
      for (const [id, entry] of privateRecords)
        if (!active.has(id) && !entry.item) privateRecords.delete(id);
      database?.clearDownloads();
      for (const row of gone) emit({ ...row, removed: true });
    },
  };
}

module.exports = { createDownloadManager, moveFile, uniquePath, PROGRESS_INTERVAL_MS };
