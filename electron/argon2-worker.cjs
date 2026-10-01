// Worker thread do Argon2id do Agzos Key. Com os parâmetros do cofre (64 MiB, 3 passes,
// paralelismo 4) o Argon2id em JS puro leva alguns segundos; no main process isso
// congelaria todas as janelas durante o desbloqueio.
const { parentPort, workerData } = require("node:worker_threads");

let argon2id;
try {
  argon2id = require("./argon2.vendor.cjs").argon2id;
} catch {
  argon2id = require("@noble/hashes/argon2").argon2id;
}

try {
  const { password, salt, t, m, p } = workerData;
  const out = argon2id(password, Buffer.from(salt, "base64"), { t, m, p, dkLen: 32 });
  parentPort.postMessage({ key: Buffer.from(out).toString("base64") });
} catch (err) {
  parentPort.postMessage({ error: String((err && err.message) || err) });
}
