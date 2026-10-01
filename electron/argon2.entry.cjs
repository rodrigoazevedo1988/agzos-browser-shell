// Entrada do bundle do Argon2id (puro JS, @noble/hashes). O `desktop:vendor` gera
// electron/argon2.vendor.cjs (sem node_modules), que vai no app. Usado pelo cliente do
// Agzos Key para cofres cujas contas usam Argon2id como KDF (deriveKey em agzos-key.cjs).
const { argon2id } = require("@noble/hashes/argon2");

module.exports = { argon2id };
