// Downloads de todas as sessions: registra, gera nome único, emite progresso e
// persiste no SQLite (menos os das abas anônimas, que ficam só em memória).
const fs = require("node:fs");
const path = require("node:path");

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

function createDownloadManager({ database, downloadsDir, emit, isPrivateSession }) {
  // id → { item, record, lastEmit, private }
  const active = new Map();
  const privateRecords = new Map();
  const saveAsNext = new WeakSet();
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
      private: entry.private,
      paused: item ? item.isPaused() : false,
      canResume: item ? item.canResume() : false,
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
    // Sem setSavePath o Electron mostra o diálogo nativo de "Salvar como".
    if (!askUser) item.setSavePath(uniquePath(downloadsDir(), item.getFilename(), reservedPaths()));

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
    };
    if (isPrivate || !database) record.id = -++privateSeq;
    else record.id = database.addDownload(record);
    const entry = { item, record, lastEmit: 0, private: isPrivate };
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
      // Diálogo "Salvar como" cancelado: nada foi baixado, não entra na lista.
      if (state === "cancelled" && !savePath) {
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

  return {
    track,
    /** O próximo download iniciado por este webContents abre o diálogo "Salvar como". */
    askNext(contents) {
      saveAsNext.add(contents);
    },
    list() {
      const stored = database ? database.listDownloads() : [];
      const live = new Map([...active.values()].map((entry) => [entry.record.id, snapshot(entry)]));
      const rows = stored.map(
        (row) => live.get(row.id) ?? { ...row, private: false, paused: false, canResume: false },
      );
      const privateRows = [...privateRecords.values()].map(snapshot);
      return [...privateRows, ...rows].sort((a, b) => b.startedAt - a.startedAt);
    },
    pause(id) {
      active.get(id)?.item?.pause();
      const entry = active.get(id);
      if (entry) send(entry);
    },
    resume(id) {
      const entry = active.get(id);
      if (entry?.item?.canResume()) entry.item.resume();
      if (entry) send(entry);
    },
    cancel(id) {
      active.get(id)?.item?.cancel();
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
      privateRecords.delete(id);
      if (database && id > 0) database.removeDownload(id);
      return true;
    },
    clear() {
      for (const [id, entry] of privateRecords)
        if (!active.has(id) && !entry.item) privateRecords.delete(id);
      database?.clearDownloads();
    },
  };
}

module.exports = { createDownloadManager, uniquePath, PROGRESS_INTERVAL_MS };
