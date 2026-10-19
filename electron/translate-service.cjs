// Tradução no main (4.9.x): trabalhos por guia, lotes para a Groq, cache e IPC.
//
// - O texto sai da página pelo mundo isolado 4137 (electron/translate.cjs) e só vai para a
//   Groq aqui, pelo ai.cjs (a chave nunca sai do main).
// - Guia anônima: nada é enviado sem `consent` (a casca pergunta antes) e nada entra no
//   cache gravado.
// - Cache: memória + LRU pequeno no SQLite (meta translateCache), por (texto, origem,
//   destino, tom, termos). "Limpar cache" apaga os dois.
// - Novos conteúdos (SPA, rolagem no modo "área visível"): o script marca "sujo" e o main
//   pergunta a cada POLL_MS enquanto a guia está traduzida (o mundo isolado não tem IPC).

const tr = require("./translate.cjs");

const POLL_MS = 1500;
const CONCURRENCY = 2;
const SAVE_DELAY = 3000;
const MAX_RETRY_WAIT = 30;

function createTranslateService({ getAi, database, isPrivate, emit }) {
  const tabs = new Map(); // contents.id → estado
  let cache = null;
  let saveTimer = null;
  let menuTarget = { code: "pt-BR", label: "Português" };

  const loadCache = () => {
    if (cache) return cache;
    let saved = null;
    try {
      saved = database?.getMeta("translateCache") ?? null;
    } catch {
      saved = null;
    }
    cache = tr.createLru(tr.LIMITS.cacheEntries, saved);
    return cache;
  };
  const saveCache = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      try {
        database?.setMeta("translateCache", loadCache().toJSON());
      } catch {
        // Banco fechado (saída do app): fica só na memória.
      }
    }, SAVE_DELAY);
    saveTimer.unref?.();
  };

  const exec = (contents, method, ...args) =>
    contents.executeJavaScriptInIsolatedWorld(
      tr.TRANSLATE_WORLD,
      [{ code: tr.pageCall(method, ...args) }],
      false,
    );

  const stateOf = (contents) => {
    let state = tabs.get(contents.id);
    if (!state) {
      state = {
        contents,
        status: "idle",
        done: 0,
        total: 0,
        options: null,
        detected: "",
        job: null,
        poll: null,
        running: false,
        stored: false,
        error: null,
        retryAfter: null,
      };
      tabs.set(contents.id, state);
      contents.once("destroyed", () => {
        clearInterval(state.poll);
        if (state.job) state.job.cancelled = true;
        tabs.delete(contents.id);
      });
    }
    return state;
  };

  const snapshot = (state) => ({
    state: state.status,
    done: state.done,
    total: state.total,
    mode: state.options?.mode ?? "replace",
    target: state.options?.target ?? "",
    source: state.options?.source ?? "auto",
    detected: state.detected,
    error: state.error,
    retryAfter: state.retryAfter,
  });

  const notify = (state) => {
    if (state.contents.isDestroyed()) return;
    emit(state.contents, { type: "translate", url: state.contents.getURL(), ...snapshot(state) });
  };

  const stopPoll = (state) => {
    clearInterval(state.poll);
    state.poll = null;
  };

  const wait = (seconds) =>
    new Promise((resolve) => setTimeout(resolve, Math.min(MAX_RETRY_WAIT, seconds) * 1000));

  /** Um lote: cache primeiro, o resto para a Groq; devolve [{ id, parts }] ou o erro. */
  async function translateBatch(segments, options, privateTab) {
    const terms = tr.termsSignature(options);
    const keyOf = (parts) =>
      tr.cacheKey(parts, {
        source: options.source,
        target: options.target,
        tone: options.tone,
        terms,
      });
    const out = [];
    const missing = [];
    for (const segment of segments) {
      const hit = options.cache ? loadCache().get(keyOf(segment.parts)) : undefined;
      if (hit && hit.length === segment.parts.length) out.push({ id: segment.id, parts: hit });
      else missing.push(segment);
    }
    if (!missing.length) return { ok: true, items: out, source: "" };
    const protectedSegments = missing.map((segment) => {
      const tokens = [];
      const parts = segment.parts.map((part) => {
        const result = tr.protectTokens(part, options.keep, tokens.length);
        tokens.push(...result.tokens);
        return result.text;
      });
      return { parts, tokens };
    });
    const ai = getAi();
    let result = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      result = await ai.translateSegments({
        segments: protectedSegments.map((item) => item.parts),
        source: options.source,
        target: options.target,
        tone: options.tone,
        glossary: options.glossary,
      });
      if (result.ok || result.error !== "rate-limit" || attempt > 0) break;
      await wait(result.retryAfter ?? 5);
    }
    if (!result.ok) return { ...result, items: out, failed: missing.map((item) => item.id) };
    const failed = [];
    missing.forEach((segment, index) => {
      const parts = result.translations[index];
      if (!parts) {
        failed.push(segment.id);
        return;
      }
      const restored = parts.map((part) => tr.restoreTokens(part, protectedSegments[index].tokens));
      if (options.cache && !privateTab) loadCache().set(keyOf(segment.parts), restored);
      out.push({ id: segment.id, parts: restored });
    });
    if (options.cache && !privateTab) saveCache();
    return { ok: true, items: out, failed, source: result.source };
  }

  /** Uma passada: coleta o que falta na página e traduz em lotes (visíveis primeiro). */
  async function pass(state, job) {
    const { contents } = state;
    const options = state.options;
    state.running = true;
    try {
      const segments = await exec(contents, "collect", { scope: options.scope });
      if (job.cancelled || !Array.isArray(segments)) return true;
      if (!segments.length) return true;
      state.total += segments.length;
      notify(state);
      const batches = tr.batchSegments(segments.map((segment) => segment.parts));
      const privateTab = isPrivate(contents);
      let next = 0;
      let failure = null;
      const worker = async () => {
        while (!job.cancelled && !failure && next < batches.length) {
          const batch = batches[next++].map((index) => segments[index]);
          const result = await translateBatch(batch, options, privateTab);
          if (job.cancelled || contents.isDestroyed()) return;
          if (result.items.length) {
            await exec(contents, "apply", result.items, options.mode).catch(() => 0);
            state.stored = true;
          }
          if (result.failed?.length) await exec(contents, "release", result.failed).catch(() => {});
          if (result.source && !state.detected) state.detected = result.source;
          state.done += result.items.length;
          if (!result.ok) {
            failure = result;
            return;
          }
          notify(state);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
      if (failure && !job.cancelled) {
        // O que não foi pedido volta a ficar livre (outra tentativa pega).
        const rest = batches
          .slice(next)
          .flat()
          .map((index) => segments[index].id);
        if (rest.length) await exec(contents, "release", rest).catch(() => {});
        state.status = "error";
        state.error = failure.error ?? "request";
        state.retryAfter = failure.retryAfter ?? null;
        notify(state);
        return false;
      }
      return true;
    } catch {
      // Página fechou ou navegou no meio.
      return false;
    } finally {
      state.running = false;
    }
  }

  async function run(state, job) {
    const ok = await pass(state, job);
    if (job.cancelled || state.contents.isDestroyed()) return;
    if (ok) {
      state.status = "done";
      state.error = null;
      notify(state);
    }
    if (!ok || !state.options.observe) return;
    stopPoll(state);
    state.poll = setInterval(() => {
      if (job.cancelled || state.running || state.contents.isDestroyed()) return;
      exec(state.contents, "pending")
        .then((pending) => {
          if (!pending || job.cancelled || state.running) return;
          state.status = "running";
          return pass(state, job).then((done) => {
            if (job.cancelled) return;
            if (done) state.status = "done";
            notify(state);
          });
        })
        .catch(() => {});
    }, POLL_MS);
    state.poll.unref?.();
  }

  const api = {
    /** Idioma da página (declarado no <html lang> ou adivinhado pelo texto). */
    async probe(contents) {
      if (!contents || contents.isDestroyed()) return null;
      const url = contents.getURL();
      if (!/^https?:/.test(url) && !url.startsWith("file:")) return null;
      try {
        const info = await exec(contents, "detect");
        if (contents.isDestroyed() || contents.getURL() !== url) return null;
        const declared = tr.normalizeLang(info?.lang);
        const lang = declared || tr.guessLanguage(info?.sample);
        const result = { url, lang, declared: Boolean(declared) };
        emit(contents, { type: "translate-lang", ...result });
        return result;
      } catch {
        return null;
      }
    },

    async translatePage(contents, raw) {
      if (!contents || contents.isDestroyed()) return { ok: false, error: "page" };
      const options = tr.cleanOptions(raw);
      if (isPrivate(contents) && !options.consent) return { ok: false, error: "private" };
      const ai = getAi();
      if (!ai.state().hasKey) return { ok: false, error: "no-key" };
      const state = stateOf(contents);
      if (state.job) state.job.cancelled = true;
      stopPoll(state);
      const previous = state.options;
      const job = { cancelled: false };
      state.job = job;
      // Destino, tom ou termos diferentes: as traduções guardadas na página não valem.
      const sameText =
        previous &&
        previous.target === options.target &&
        previous.source === options.source &&
        previous.tone === options.tone &&
        tr.termsSignature(previous) === tr.termsSignature(options);
      state.options = options;
      state.status = "running";
      state.error = null;
      state.retryAfter = null;
      try {
        if (state.stored && !sameText) {
          await exec(contents, "restore");
          // Reinstala do zero: um documento novo do mundo isolado não dá; limpa o estado.
          await contents.executeJavaScriptInIsolatedWorld(
            tr.TRANSLATE_WORLD,
            [{ code: "globalThis.__agzosTr = undefined;" }],
            false,
          );
          state.stored = false;
        }
        if (state.stored) {
          await exec(contents, "reapply", options.mode);
          await exec(contents, "setMode", options.mode);
        } else {
          state.done = 0;
          state.total = 0;
        }
        if (options.observe) await exec(contents, "observe", true);
      } catch {
        state.status = "error";
        state.error = "page";
        notify(state);
        return { ok: false, error: "page" };
      }
      notify(state);
      void run(state, job);
      return { ok: true };
    },

    cancel(contents) {
      const state = contents && tabs.get(contents.id);
      if (!state) return { ok: true };
      if (state.job) state.job.cancelled = true;
      stopPoll(state);
      state.status = state.done ? "done" : "idle";
      notify(state);
      return { ok: true };
    },

    /** Mostrar original: instantâneo (as traduções ficam na página para voltar). */
    async restore(contents) {
      const state = contents && tabs.get(contents.id);
      if (!state) return { ok: true };
      if (state.job) state.job.cancelled = true;
      stopPoll(state);
      try {
        await exec(contents, "restore");
      } catch {
        // Página fechou.
      }
      state.status = "original";
      notify(state);
      return { ok: true };
    },

    async setMode(contents, mode) {
      const state = contents && tabs.get(contents.id);
      if (!state?.options || !["replace", "bilingual", "hover"].includes(mode))
        return { ok: false };
      state.options = { ...state.options, mode };
      if (state.status !== "original") {
        try {
          await exec(contents, "setMode", mode);
        } catch {
          return { ok: false };
        }
      }
      notify(state);
      return { ok: true };
    },

    state(contents) {
      const state = contents && tabs.get(contents.id);
      return state ? snapshot(state) : { state: "idle", done: 0, total: 0 };
    },

    /** Documento novo na guia: o trabalho anterior acaba (o script some com a página). */
    reset(contents) {
      const state = contents && tabs.get(contents.id);
      if (!state) return;
      if (state.job) state.job.cancelled = true;
      stopPoll(state);
      tabs.delete(contents.id);
      emit(contents, {
        type: "translate",
        url: contents.getURL(),
        state: "idle",
        done: 0,
        total: 0,
      });
    },

    /** Trecho (bolha do menu de contexto): traduzir, explicar ou alternativas. */
    async translateText(contents, payload = {}) {
      const options = tr.cleanOptions(payload.options);
      const privateTab = Boolean(contents && isPrivate(contents));
      if (privateTab && !options.consent) return { ok: false, error: "private" };
      const text = typeof payload.text === "string" ? payload.text.trim() : "";
      if (!text) return { ok: false, error: "request" };
      const task = ["translate", "explain", "alternatives"].includes(payload.task)
        ? payload.task
        : "translate";
      const key = tr.cacheKey([task, text], {
        source: options.source,
        target: options.target,
        tone: options.tone,
        terms: tr.termsSignature(options),
      });
      if (options.cache && task === "translate") {
        const hit = loadCache().get(key);
        if (hit) return { ok: true, translation: hit[0], source: hit[1] ?? "", cached: true };
      }
      const prepared =
        task === "translate" ? tr.protectTokens(text, options.keep) : { text, tokens: [] };
      const result = await getAi().translateText({
        text: prepared.text,
        task,
        source: options.source,
        target: options.target,
        tone: options.tone,
        glossary: options.glossary,
      });
      if (!result.ok) return result;
      if (task === "translate") {
        const translation = tr.restoreTokens(result.translation, prepared.tokens);
        if (options.cache && !privateTab) {
          loadCache().set(key, [translation, result.source ?? ""]);
          saveCache();
        }
        return { ok: true, translation, source: result.source ?? "" };
      }
      return result;
    },

    /** "Traduzir o que escrevi": lê o campo, traduz e escreve de volta (Ctrl+Z desfaz). */
    async translateField(contents, payload = {}) {
      if (!contents || contents.isDestroyed()) return { ok: false, error: "page" };
      const options = tr.cleanOptions(payload.options);
      if (isPrivate(contents) && !options.consent) return { ok: false, error: "private" };
      let field;
      try {
        field = await exec(contents, "rememberField");
      } catch {
        return { ok: false, error: "field" };
      }
      if (!field?.ok || !String(field.text ?? "").trim()) return { ok: false, error: "field" };
      const result = await api.translateText(contents, {
        text: field.text,
        task: "translate",
        options: { ...payload.options, cache: false },
      });
      if (!result.ok) return result;
      try {
        // A seleção do campo mudou enquanto a Groq respondia: lemos de novo o campo lembrado.
        const written = await exec(contents, "writeField", result.translation);
        return written
          ? { ok: true, translation: result.translation }
          : { ok: false, error: "field" };
      } catch {
        return { ok: false, error: "field" };
      }
    },

    /** "Substituir" da bolha: troca a seleção do campo editável pelo texto dado. */
    async replaceSelection(contents, text) {
      if (!contents || contents.isDestroyed() || typeof text !== "string") return { ok: false };
      try {
        const field = await exec(contents, "rememberField");
        if (!field?.ok) return { ok: false, error: "field" };
        const written = await exec(contents, "writeField", text.slice(0, tr.LIMITS.selection * 2));
        return { ok: Boolean(written) };
      } catch {
        return { ok: false, error: "field" };
      }
    },

    clearCache() {
      loadCache().clear();
      clearTimeout(saveTimer);
      try {
        database?.setMeta("translateCache", {});
      } catch {
        // Ver saveCache.
      }
      return { ok: true, entries: 0 };
    },

    cacheInfo() {
      return { entries: loadCache().size };
    },

    /** Idioma de destino do menu de contexto (a casca avisa quando muda). */
    setMenuTarget(value) {
      const code = tr.normalizeLang(value?.code);
      const label = typeof value?.label === "string" ? value.label.trim().slice(0, 40) : "";
      if (code && label) menuTarget = { code, label };
      return menuTarget;
    },
    menuTarget: () => menuTarget,

    /** Grava o cache pendente (saída do app). */
    flush() {
      if (!saveTimer) return;
      clearTimeout(saveTimer);
      saveTimer = null;
      try {
        database?.setMeta("translateCache", loadCache().toJSON());
      } catch {
        // Ver saveCache.
      }
    },
  };
  return api;
}

/**
 * IPC da casca. `contentsOf(event, id)` acha a guia da janela que pediu (nunca de outra).
 */
function registerTranslateIpc(ipcMain, service, contentsOf) {
  ipcMain.handle("translate:page", (event, { id, options } = {}) =>
    service.translatePage(contentsOf(event, id), options),
  );
  ipcMain.handle("translate:cancel", (event, { id } = {}) => service.cancel(contentsOf(event, id)));
  ipcMain.handle("translate:restore", (event, { id } = {}) =>
    service.restore(contentsOf(event, id)),
  );
  ipcMain.handle("translate:mode", (event, { id, mode } = {}) =>
    service.setMode(contentsOf(event, id), mode),
  );
  ipcMain.handle("translate:state", (event, { id } = {}) => service.state(contentsOf(event, id)));
  ipcMain.handle("translate:probe", (event, { id } = {}) => service.probe(contentsOf(event, id)));
  ipcMain.handle("translate:text", (event, { id, text, task, options } = {}) =>
    service.translateText(id === null || id === undefined ? null : contentsOf(event, id), {
      text,
      task,
      options,
    }),
  );
  ipcMain.handle("translate:field", (event, { id, options } = {}) =>
    service.translateField(contentsOf(event, id), { options }),
  );
  ipcMain.handle("translate:replace", (event, { id, text } = {}) =>
    service.replaceSelection(contentsOf(event, id), text),
  );
  ipcMain.handle("translate:cache-clear", () => service.clearCache());
  ipcMain.handle("translate:cache-info", () => service.cacheInfo());
  ipcMain.handle("translate:menu-target", (_event, value) => service.setMenuTarget(value));
}

module.exports = { createTranslateService, registerTranslateIpc };
