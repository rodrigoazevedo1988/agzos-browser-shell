// GX Control (3.0): uso de CPU/RAM por guia, limites de memória, CPU e rede, teste de
// velocidade e limpeza de cache. As regras são funções puras (testadas em
// main-services.test.ts); o controle (createGxControl) recebe do main o que precisa.

// Mesmos intervalos de src/features/browser/control/limits.ts.
const LIMIT_RANGES = {
  ramLimitMB: { min: 512, max: 16384, fallback: 2048 },
  cpuLimitPercent: { min: 10, max: 100, fallback: 50 },
  netDownKbps: { min: 256, max: 100000, fallback: 10000 },
  netUpKbps: { min: 128, max: 50000, fallback: 2000 },
};
const CHECK_INTERVAL_MS = 5000;
/** No máximo tantas guias hibernadas por rodada (a memória demora a baixar). */
const HIBERNATE_PER_TICK = 2;
/** Desaceleração das guias em segundo plano com a CPU acima do teto (CDP). */
const THROTTLE_RATE = 4;
/** Abaixo desta fração do teto, as guias desaceleradas voltam ao normal. */
const THROTTLE_RELEASE = 0.7;

const SPEED_BASE = process.env.AGZOS_SPEEDTEST_URL || "https://speed.cloudflare.com";
const SPEED_DOWN_BYTES = 25 * 1000 * 1000;
const SPEED_UP_BYTES = 6 * 1000 * 1000;
const SPEED_STEP_MS = 8000;

function clampLimit(key, value) {
  const range = LIMIT_RANGES[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return range.fallback;
  return Math.round(Math.min(range.max, Math.max(range.min, value)));
}

/** Preferências da casca → limites em vigor. */
function limitsOf(prefs) {
  const raw = prefs && typeof prefs === "object" ? prefs : {};
  return {
    ram: { on: raw.ramLimitOn === true, mb: clampLimit("ramLimitMB", raw.ramLimitMB) },
    cpu: {
      on: raw.cpuLimitOn === true,
      percent: clampLimit("cpuLimitPercent", raw.cpuLimitPercent),
    },
    net: {
      on: raw.netLimitOn === true,
      downKbps: clampLimit("netDownKbps", raw.netDownKbps),
      upKbps: clampLimit("netUpKbps", raw.netUpKbps),
    },
  };
}

/** Limite de rede → condições do session.enableNetworkEmulation (bytes/s), ou null. */
function networkConditionsOf(limits) {
  if (!limits?.net?.on) return null;
  return {
    offline: false,
    latency: 0,
    downloadThroughput: Math.round((limits.net.downKbps * 1000) / 8),
    uploadThroughput: Math.round((limits.net.upKbps * 1000) / 8),
  };
}

/** KB de memória de uma métrica do app.getAppMetrics (no Windows, os bytes privados). */
function memoryKBOf(metric) {
  return metric?.memory?.privateBytes ?? metric?.memory?.workingSetSize ?? 0;
}

/**
 * Soma do navegador inteiro. `percentCPUUsage` conta 100 % por núcleo: o total é dividido
 * pelos núcleos para caber no medidor de 0 a 100 %.
 */
function totalsOf(metrics, cores) {
  let memoryKB = 0;
  let cpu = 0;
  for (const metric of metrics ?? []) {
    memoryKB += memoryKBOf(metric);
    cpu += metric?.cpu?.percentCPUUsage ?? 0;
  }
  const count = Math.max(1, cores || 1);
  return {
    memoryMB: Math.round(memoryKB / 1024),
    cpuPercent: Math.min(100, Math.round((cpu / count) * 10) / 10),
    processes: (metrics ?? []).length,
  };
}

/**
 * Uso de cada guia: o processo da página dividido pelas guias que o compartilham (sites
 * iguais podem usar o mesmo processo). `tabs`: { key, pid }.
 */
function tabUsage(tabs, metrics, cores) {
  const byPid = new Map((metrics ?? []).map((metric) => [metric.pid, metric]));
  const sharing = new Map();
  for (const tab of tabs) sharing.set(tab.pid, (sharing.get(tab.pid) ?? 0) + 1);
  const count = Math.max(1, cores || 1);
  return tabs.map((tab) => {
    const metric = byPid.get(tab.pid);
    const shared = Math.max(1, sharing.get(tab.pid) ?? 1);
    return {
      ...tab,
      shared,
      memoryMB: metric ? Math.round(memoryKBOf(metric) / 1024 / shared) : 0,
      cpuPercent: metric
        ? Math.round(((metric.cpu?.percentCPUUsage ?? 0) / count / shared) * 10) / 10
        : 0,
    };
  });
}

/**
 * Acima do teto de memória: as guias que podem hibernar, da mais pesada para a mais leve,
 * até liberar o excesso (no máximo `max` por rodada).
 */
function pickTabsToHibernate(tabs, { totalMB, limitMB, max = HIBERNATE_PER_TICK }) {
  let over = totalMB - limitMB;
  if (over <= 0) return [];
  const picked = [];
  const heaviest = tabs
    .filter((tab) => tab.eligible && tab.memoryMB > 0)
    .sort((a, b) => b.memoryMB - a.memoryMB);
  for (const tab of heaviest) {
    if (over <= 0 || picked.length >= max) break;
    picked.push(tab.key);
    over -= tab.memoryMB;
  }
  return picked;
}

/**
 * Teto de CPU: acima dele, as guias em segundo plano que gastam CPU são desaceleradas;
 * abaixo de 70 % do teto todas voltam. Retorna o conjunto de chaves desaceleradas.
 */
function throttlePlan(tabs, { totalPercent, limitPercent, throttled }) {
  if (totalPercent < limitPercent * THROTTLE_RELEASE) return new Set();
  const next = new Set();
  for (const tab of tabs) {
    if (tab.visible) continue;
    if (throttled.has(tab.key) || (totalPercent > limitPercent && tab.cpuPercent >= 1)) {
      next.add(tab.key);
    }
  }
  return next;
}

/** Mbit/s de `bytes` transferidos em `ms`. */
function mbpsOf(bytes, ms) {
  if (!(ms > 0) || !(bytes > 0)) return 0;
  return Math.round(((bytes * 8) / (ms / 1000) / 1e6) * 10) / 10;
}

function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Baixa até `bytes` (ou `SPEED_STEP_MS`) e devolve Mbit/s. */
async function measureDownload(fetchImpl, bytes = SPEED_DOWN_BYTES) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SPEED_STEP_MS);
  const start = Date.now();
  let received = 0;
  try {
    const response = await fetchImpl(`${SPEED_BASE}/__down?bytes=${bytes}`, {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
    }
  } catch (error) {
    if (!controller.signal.aborted || received === 0) throw error;
  } finally {
    clearTimeout(timer);
  }
  return mbpsOf(received, Date.now() - start);
}

async function measureUpload(fetchImpl, bytes = SPEED_UP_BYTES) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SPEED_STEP_MS);
  const body = new Uint8Array(bytes);
  const start = Date.now();
  try {
    const response = await fetchImpl(`${SPEED_BASE}/__up`, {
      method: "POST",
      body,
      signal: controller.signal,
      headers: { "content-type": "application/octet-stream" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await response.arrayBuffer().catch(() => null);
  } finally {
    clearTimeout(timer);
  }
  return mbpsOf(bytes, Date.now() - start);
}

async function measureLatency(fetchImpl, rounds = 5) {
  const samples = [];
  for (let index = 0; index < rounds; index += 1) {
    const start = Date.now();
    try {
      const response = await fetchImpl(`${SPEED_BASE}/__down?bytes=0`, { cache: "no-store" });
      await response.arrayBuffer().catch(() => null);
      samples.push(Date.now() - start);
    } catch {
      // Uma falha não derruba o teste.
    }
  }
  const value = median(samples);
  return value === null ? null : Math.round(value);
}

/** Teste completo: latência, download e upload (o upload pode falhar sozinho). */
async function runSpeedTest(fetchImpl) {
  const pingMs = await measureLatency(fetchImpl);
  const downMbps = await measureDownload(fetchImpl);
  const upMbps = await measureUpload(fetchImpl).catch(() => null);
  return { pingMs, downMbps, upMbps, at: Date.now() };
}

/**
 * Controle em execução no main. `deps`:
 * - metrics(): app.getAppMetrics(); cores: número de núcleos;
 * - tabs(): guias abertas { key, ctx, id, contents, visible, eligible };
 * - hibernate(ctx, id): hiberna a guia;
 * - sessions(): sessões das páginas (padrão e privada).
 */
function createGxControl(deps) {
  let limits = limitsOf(null);
  let timer = null;
  let busy = false;
  const throttled = new Map();
  let lastAction = null;

  function liveTabs() {
    const metrics = deps.metrics();
    const raw = [];
    for (const tab of deps.tabs()) {
      if (!tab.contents || tab.contents.isDestroyed()) continue;
      let pid = 0;
      try {
        pid = tab.contents.getOSProcessId();
      } catch {
        continue;
      }
      raw.push({ ...tab, pid });
    }
    return { metrics, tabs: tabUsage(raw, metrics, deps.cores) };
  }

  // O depurador das guias já fica ligado (identidade de Chrome e scriptlets, main.cjs):
  // aqui só se muda a taxa, nunca se desliga.
  async function setThrottle(tab, on) {
    const debug = tab.contents.debugger;
    try {
      if (on) {
        if (!debug.isAttached()) return;
        await debug.sendCommand("Emulation.setCPUThrottlingRate", { rate: THROTTLE_RATE });
        throttled.set(tab.key, tab.contents);
      } else {
        throttled.delete(tab.key);
        if (!debug.isAttached()) return;
        await debug.sendCommand("Emulation.setCPUThrottlingRate", { rate: 1 });
      }
    } catch {
      if (on) throttled.delete(tab.key);
    }
  }

  async function releaseAll() {
    for (const [key, contents] of [...throttled]) {
      if (contents.isDestroyed()) throttled.delete(key);
      else await setThrottle({ key, contents }, false);
    }
  }

  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const { metrics, tabs } = liveTabs();
      const totals = totalsOf(metrics, deps.cores);
      for (const [key, contents] of [...throttled]) {
        if (contents.isDestroyed()) throttled.delete(key);
      }
      if (limits.ram.on) {
        const keys = pickTabsToHibernate(tabs, {
          totalMB: totals.memoryMB,
          limitMB: limits.ram.mb,
        });
        for (const key of keys) {
          const tab = tabs.find((item) => item.key === key);
          if (tab && (await deps.hibernate(tab.ctx, tab.id))) {
            lastAction = { type: "hibernated", title: tab.title ?? "", at: Date.now() };
          }
        }
      }
      if (limits.cpu.on) {
        const plan = throttlePlan(tabs, {
          totalPercent: totals.cpuPercent,
          limitPercent: limits.cpu.percent,
          throttled: new Set(throttled.keys()),
        });
        for (const tab of tabs) {
          const on = plan.has(tab.key);
          if (on !== throttled.has(tab.key) && !tab.devtools) await setThrottle(tab, on);
        }
      } else if (throttled.size) {
        await releaseAll();
      }
    } finally {
      busy = false;
    }
  }

  function schedule() {
    const needed = limits.ram.on || limits.cpu.on || throttled.size > 0;
    if (needed && !timer) {
      timer = setInterval(() => void tick(), CHECK_INTERVAL_MS);
      timer.unref?.();
    } else if (!needed && timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function applyNetwork() {
    const conditions = networkConditionsOf(limits);
    for (const ses of deps.sessions()) {
      try {
        if (conditions) ses.enableNetworkEmulation(conditions);
        else ses.disableNetworkEmulation();
      } catch {
        // Sessão destruída.
      }
    }
  }

  return {
    configure(prefs) {
      const next = limitsOf(prefs);
      const netChanged = JSON.stringify(next.net) !== JSON.stringify(limits.net);
      limits = next;
      if (netChanged) applyNetwork();
      if (!limits.cpu.on && throttled.size) void releaseAll().then(schedule);
      schedule();
    },
    /** Guia que ficou à vista: volta à velocidade normal. */
    visible(key) {
      const contents = throttled.get(key);
      if (contents && !contents.isDestroyed()) void setThrottle({ key, contents }, false);
    },
    /** Retrato para o painel: totais do app e as guias de uma janela (`ctx`). */
    stats(ctx, os) {
      const { metrics, tabs } = liveTabs();
      const totals = totalsOf(metrics, deps.cores);
      return {
        cpuPercent: totals.cpuPercent,
        memoryMB: totals.memoryMB,
        processes: totals.processes,
        cores: deps.cores,
        systemMemoryMB: Math.round(os.totalmem() / 1024 / 1024),
        freeMemoryMB: Math.round(os.freemem() / 1024 / 1024),
        tabs: tabs
          .filter((tab) => tab.ctx === ctx)
          .map((tab) => ({
            id: tab.id,
            memoryMB: tab.memoryMB,
            cpuPercent: tab.cpuPercent,
            shared: tab.shared,
            throttled: throttled.has(tab.key),
          })),
        lastAction,
      };
    },
    tick,
    dispose() {
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = {
  LIMIT_RANGES,
  CHECK_INTERVAL_MS,
  limitsOf,
  networkConditionsOf,
  totalsOf,
  tabUsage,
  pickTabsToHibernate,
  throttlePlan,
  mbpsOf,
  median,
  runSpeedTest,
  createGxControl,
};
