// Worker thread: compila as listas de filtros fora do processo principal (~0,6 s de CPU)
// e devolve os motores serializados.
const { parentPort, workerData } = require("node:worker_threads");
const path = require("node:path");

const { FiltersEngine } = require(path.join(__dirname, "adblocker.vendor.cjs"));

const engines = {};
for (const [category, texts] of Object.entries(workerData.lists)) {
  const engine = FiltersEngine.parse(texts.join("\n"), {
    loadCosmeticFilters: category === "ads",
    loadGenericCosmeticsFilters: category === "ads",
    enableHtmlFiltering: false,
    loadExtendedSelectors: false,
    loadCSPFilters: false,
  });
  // Scriptlets (+js) e redirecionamentos ($redirect) usam o código do resources.json.
  if (category === "ads" && workerData.resources) {
    engine.updateResources(workerData.resources, String(workerData.resources.length));
  }
  engines[category] = engine.serialize();
}
parentPort.postMessage(
  engines,
  Object.values(engines).map((buffer) => buffer.buffer),
);
