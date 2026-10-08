// 4.8 (Fase 0): o que o Electron publicado suporta de verdade para o Print Engine e o
// DevTools, medido numa webContents fora da tela e não presumido pela versão. O
// resultado vai para <userData>/capabilities.json e só é medido de novo quando o
// Electron, o Chromium ou o esquema mudam.
//
// O que já se sabe medindo o Electron 44 (Chromium 152):
// - webContents.printToPDF aceita generateTaggedPDF e generateDocumentOutline;
// - Page.printToPDF NÃO existe no CDP do webContents.debugger ("wasn't found"), então
//   transferMode: ReturnAsStream não está disponível e o PDF sai inteiro em Buffer;
// - Page.captureScreenshot com captureBeyondViewport só responde numa webContents que
//   pinta. A sonda do início NÃO mede isso: offscreen derrubou o main (SIGSEGV) com a
//   camada dos menus aberta, e a janela oculta respondeu de forma instável. O teto real
//   sai da guia na tela (probeCaptureHeight, Fase 3); até lá vale CAPTURE_SAFE_CAP.

const CAPABILITY_SCHEMA = 1;

/** Alturas testadas no captureBeyondViewport, da menor para a maior. */
const CAPTURE_CANDIDATES = [16384, 32767, 65535];
/** Teto usado pelo Print Engine mesmo se a medição passar dele (PRD: conservador). */
const CAPTURE_SAFE_CAP = 32767;
/** Largura da sonda: só a altura interessa, e assim o bitmap fica pequeno. */
const PROBE_WIDTH = 16;
const PROBE_TIMEOUT_MS = 8000;

/** Página da sonda: um título (para o outline) e um bloco de algumas páginas. */
function probePage(height = 4000) {
  const html =
    '<!doctype html><meta charset="utf-8"><title>Agzos capabilities</title>' +
    '<body style="margin:0"><h1>Agzos</h1><p>Sonda de capacidades.</p>' +
    `<div style="height:${height}px;background:linear-gradient(#fff,#000)"></div></body>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function versionKey(versions = {}) {
  return `${CAPABILITY_SCHEMA}:${versions.electron ?? "?"}:${versions.chrome ?? "?"}`;
}

/** O PDF gerado é PDF, tem árvore de tags e tem outline? */
function pdfFeatures(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) {
    return { pdf: false, tagged: false, outline: false };
  }
  const text = buffer.toString("latin1");
  return {
    pdf: text.startsWith("%PDF-"),
    tagged: text.includes("/StructTreeRoot"),
    outline: text.includes("/Outlines"),
  };
}

/** Largura e altura de um PNG pelo cabeçalho IHDR; null se não for PNG. */
function pngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) return null;
  if (buffer.toString("latin1", 12, 16) !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/** Maior altura que passou, contando só a sequência sem falha a partir da menor. */
function captureLimit(results) {
  let limit = 0;
  for (const { height, ok } of [...results].sort((a, b) => a.height - b.height)) {
    if (!ok) break;
    limit = height;
  }
  return limit;
}

/** Altura que o Print Engine pode pedir de uma vez; acima disso ele fatia. */
function effectiveCaptureHeight(capabilities) {
  const measured = capabilities?.capture?.maxHeight;
  return typeof measured === "number" && measured > 0
    ? Math.min(measured, CAPTURE_SAFE_CAP)
    : CAPTURE_SAFE_CAP;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Maior altura do captureBeyondViewport numa webContents que já pinta (a guia na tela).
 * Para na primeira altura que falha: as maiores também falhariam e cada uma custa um
 * timeout.
 */
async function probeCaptureHeight(debug, { timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const tried = [];
  for (const height of CAPTURE_CANDIDATES) {
    let ok = false;
    try {
      const shot = await withTimeout(
        debug.sendCommand("Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width: PROBE_WIDTH, height, scale: 1 },
        }),
        timeoutMs,
      );
      const size = pngSize(Buffer.from(String(shot?.data ?? ""), "base64"));
      ok = size?.height === height;
    } catch {
      ok = false;
    }
    tried.push({ height, ok });
    if (!ok) break;
  }
  return { maxHeight: captureLimit(tried), tried };
}

/**
 * Mede numa webContents que `open()` entrega já carregada (não precisa pintar). Cada
 * sonda tem o próprio try: uma falha vira `false`/`error` e não derruba as outras.
 */
async function probeCapabilities({ open, versions, now = () => new Date(), timeoutMs }) {
  const limit = timeoutMs ?? PROBE_TIMEOUT_MS;
  const result = {
    schema: CAPABILITY_SCHEMA,
    key: versionKey(versions),
    measuredAt: now().toISOString(),
    versions: {
      electron: versions.electron ?? null,
      chrome: versions.chrome ?? null,
      node: versions.node ?? null,
      v8: versions.v8 ?? null,
    },
    cdp: { attached: false, runtimeEvaluate: false },
    printToPdf: { available: false, taggedPdf: false, documentOutline: false, error: null },
    cdpPrintToPdf: { available: false, returnAsStream: false, error: null },
    // Medido depois, na guia (probeCaptureHeight); maxHeight 0 = usar safeCap.
    capture: { measured: false, maxHeight: 0, safeCap: CAPTURE_SAFE_CAP },
  };
  let handle = null;
  try {
    handle = await withTimeout(open(probePage()), limit);
    const { contents } = handle;

    try {
      const pdf = await withTimeout(
        contents.printToPDF({ generateTaggedPDF: true, generateDocumentOutline: true }),
        limit,
      );
      const features = pdfFeatures(pdf);
      result.printToPdf.available = features.pdf;
      result.printToPdf.taggedPdf = features.tagged;
      result.printToPdf.documentOutline = features.outline;
    } catch (error) {
      result.printToPdf.error = String(error?.message ?? error);
    }

    const debug = contents.debugger;
    try {
      if (!debug.isAttached()) debug.attach("1.3");
      result.cdp.attached = debug.isAttached();
      const evaluated = await withTimeout(
        debug.sendCommand("Runtime.evaluate", { expression: "6 * 7", returnByValue: true }),
        limit,
      );
      result.cdp.runtimeEvaluate = evaluated?.result?.value === 42;
    } catch {
      // Sem CDP as sondas abaixo também falham e ficam registradas como tal.
    }

    try {
      const printed = await withTimeout(
        debug.sendCommand("Page.printToPDF", { transferMode: "ReturnAsStream" }),
        limit,
      );
      result.cdpPrintToPdf.available = true;
      result.cdpPrintToPdf.returnAsStream = typeof printed?.stream === "string";
      if (printed?.stream) {
        await debug.sendCommand("IO.close", { handle: printed.stream }).catch(() => {});
      }
    } catch (error) {
      result.cdpPrintToPdf.error = String(error?.message ?? error);
    }
  } finally {
    try {
      handle?.dispose();
    } catch {
      // A sonda já foi fechada.
    }
  }
  return result;
}

module.exports = {
  CAPABILITY_SCHEMA,
  CAPTURE_CANDIDATES,
  CAPTURE_SAFE_CAP,
  captureLimit,
  effectiveCaptureHeight,
  pdfFeatures,
  pngSize,
  probeCapabilities,
  probeCaptureHeight,
  probePage,
  versionKey,
};
