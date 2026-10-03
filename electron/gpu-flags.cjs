// Aceleração de hardware (4.0): flags do Chromium que forçam a GPU (inclusive integradas
// como a Intel UHD 620, que a blocklist às vezes derruba para software) e o decode de
// vídeo por hardware. Precisam entrar antes do app.whenReady(): depois disso o processo da
// GPU já subiu com a configuração padrão.
//
// Rede de segurança: se o processo da GPU cair várias vezes numa execução, o próximo
// início sobe sem as flags forçadas (blocklist e zero-copy de volta ao padrão) até a
// próxima versão do app. O usuário também pode desligar em Configurações → Desempenho.

const fs = require("node:fs");
const path = require("node:path");

const STATE_FILE = "gpu-acceleration.json";
/** Quedas do processo da GPU numa execução antes de cair para o modo padrão. */
const CRASH_LIMIT = 3;

/** Switches e features por plataforma. Feature desconhecida numa plataforma é ignorada. */
function gpuSwitches(platform) {
  const enable = ["VaapiVideoDecoder", "CanvasOopRasterization"];
  // Windows: sem VAAPI, o decode vai pela pilha nativa (D3D11/DXVA).
  if (platform === "win32") enable.push("D3D11VideoDecoder");
  // Linux: o VAAPI só entra com o caminho GL do decode acelerado.
  if (platform === "linux") enable.push("AcceleratedVideoDecodeLinuxGL", "VaapiVideoDecodeLinuxGL");
  return {
    switches: [
      "ignore-gpu-blocklist",
      "enable-gpu-rasterization",
      "enable-zero-copy",
      "enable-accelerated-video-decode",
    ],
    enable,
    disable: ["UseChromeOSDirectVideoDecoder"],
  };
}

/** Junta a lista nova com a que já veio na linha de comando ("A,B" + ["B","C"] → "A,B,C"). */
function mergeFeatures(current, extra) {
  const list = String(current ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  for (const item of extra) if (!list.includes(item)) list.push(item);
  return list.join(",");
}

function readState(userDataDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(userDataDir, STATE_FILE), "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writeState(userDataDir, state) {
  try {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(path.join(userDataDir, STATE_FILE), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

/**
 * Decide o modo desta execução. `env`: "off" desliga, "forced" ignora a queda anterior.
 * Queda gravada por outra versão não vale mais (o motivo pode ter sido corrigido).
 */
function gpuMode(state, version, env) {
  if (env === "off") return { forced: false, reason: "env" };
  if (env === "forced") return { forced: true, reason: null };
  if (state.enabled === false) return { forced: false, reason: "user" };
  if (state.fallback && state.fallback.version === version) {
    return { forced: false, reason: "crash" };
  }
  return { forced: true, reason: null };
}

/** Aplica as flags no app.commandLine (antes do ready). Devolve o modo escolhido. */
function applyGpuFlags(app, { platform = process.platform, env = process.env.AGZOS_GPU } = {}) {
  const userDataDir = app.getPath("userData");
  const mode = gpuMode(readState(userDataDir), app.getVersion(), env);
  if (!mode.forced) return mode;
  const { switches, enable, disable } = gpuSwitches(platform);
  for (const name of switches) app.commandLine.appendSwitch(name);
  const line = app.commandLine;
  line.appendSwitch(
    "enable-features",
    mergeFeatures(line.getSwitchValue("enable-features"), enable),
  );
  line.appendSwitch(
    "disable-features",
    mergeFeatures(line.getSwitchValue("disable-features"), disable),
  );
  return mode;
}

/**
 * Conta as quedas do processo da GPU (evento child-process-gone). Na terceira, grava a
 * queda: o próximo início sobe no modo padrão do Chromium.
 */
function watchGpuCrashes(app, mode) {
  let crashes = 0;
  app.on("child-process-gone", (_event, details) => {
    if (details?.type !== "GPU" || details.reason === "clean-exit" || !mode.forced) return;
    crashes += 1;
    if (crashes !== CRASH_LIMIT) return;
    const userDataDir = app.getPath("userData");
    const state = readState(userDataDir);
    writeState(userDataDir, {
      ...state,
      fallback: { version: app.getVersion(), reason: details.reason, at: Date.now() },
    });
    console.error(
      "Agzos: o processo da GPU caiu várias vezes; o próximo início usa o modo padrão.",
    );
  });
}

/** Liga/desliga a aceleração forçada (vale no próximo início). Ligar limpa a queda. */
function setGpuEnabled(app, enabled) {
  const userDataDir = app.getPath("userData");
  const state = readState(userDataDir);
  const next = { ...state, enabled: Boolean(enabled) };
  if (enabled) delete next.fallback;
  return writeState(userDataDir, next);
}

/** Estado para as Configurações: o pedido, o modo desta execução e o status do Chromium. */
function gpuStatus(app, mode) {
  const state = readState(app.getPath("userData"));
  let features = {};
  try {
    features = app.getGPUFeatureStatus() ?? {};
  } catch {
    features = {};
  }
  return {
    enabled: state.enabled !== false,
    forced: mode.forced,
    reason: mode.reason,
    videoDecode: typeof features.video_decode === "string" ? features.video_decode : null,
    rasterization: typeof features.rasterization === "string" ? features.rasterization : null,
  };
}

module.exports = {
  CRASH_LIMIT,
  STATE_FILE,
  gpuSwitches,
  mergeFeatures,
  gpuMode,
  applyGpuFlags,
  watchGpuCrashes,
  setGpuEnabled,
  gpuStatus,
};
