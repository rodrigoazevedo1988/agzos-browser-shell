// Pacote da Chrome Web Store (4.5): .crx (versão 2 ou 3) = cabeçalho + zip. O Electron só
// carrega extensão descompactada, então o app tira o cabeçalho e descompacta o zip numa
// pasta própria. Sem módulo nativo: zlib do Node e leitura do diretório central do zip.

const crypto = require("node:crypto");
const zlib = require("node:zlib");

const LIMITS = { entries: 5000, total: 256 * 1024 * 1024 };

/** Id da Web Store (32 letras a–p) a partir do id ou de uma URL da loja. */
function storeIdOf(value) {
  const text = String(value ?? "").trim();
  const match = /(?:^|\/)([a-p]{32})(?:[/?#]|$)/.exec(text);
  return match ? match[1] : null;
}

/**
 * Consulta de atualização (protocolo gupdate do Chromium, o mesmo da update_url do
 * manifest): responde XML com a versão nova ou "noupdate".
 */
function updateCheckUrl(base, id, version, chromeVersion) {
  const url = new URL(base);
  url.searchParams.set("response", "updatecheck");
  url.searchParams.set("prodversion", chromeVersion);
  url.searchParams.set("acceptformat", "crx2,crx3");
  url.searchParams.set("x", `id=${id}&v=${version}&uc`);
  return url.toString();
}

/** XML do gupdate → versão oferecida para `id`, ou null. */
function parseUpdateCheck(xml, id) {
  const text = String(xml ?? "");
  for (const app of text.matchAll(/<app\b([^>]*)>([\s\S]*?)<\/app>/g)) {
    if (!new RegExp(`appid="${id}"`).test(app[1])) continue;
    const check = /<updatecheck\b([^>]*)\/?>/.exec(app[2]);
    if (!check || !/\bstatus="ok"/.test(check[1])) return null;
    const version = /\bversion="([\d.]{1,40})"/.exec(check[1]);
    return version ? version[1] : null;
  }
  return null;
}

/** Compara versões "1.2.10" (positivo: a é maior). */
function compareVersions(a, b) {
  const left = String(a).split(".").map(Number);
  const right = String(b).split(".").map(Number);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] || 0) - (right[index] || 0);
    if (diff) return diff;
  }
  return 0;
}

/** URL de download do .crx para a versão do Chromium do app. */
function crxDownloadUrl(id, chromeVersion) {
  const params = new URLSearchParams({
    response: "redirect",
    prodversion: chromeVersion,
    acceptformat: "crx2,crx3",
    x: `id=${id}&uc`,
  });
  return `https://clients2.google.com/service/update2/crx?${params}`;
}

function readVarint(buffer, offset) {
  let value = 0;
  let shift = 0;
  let index = offset;
  while (index < buffer.length) {
    const byte = buffer[index];
    index += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return { value, next: index };
    shift += 7;
    if (shift > 49) break;
  }
  throw new Error("varint");
}

/** Campos de uma mensagem protobuf: [{ field, wire, value }] (só os tipos 0 e 2). */
function protoFields(buffer) {
  const fields = [];
  let offset = 0;
  while (offset < buffer.length) {
    const key = readVarint(buffer, offset);
    const field = Math.floor(key.value / 8);
    const wire = key.value % 8;
    offset = key.next;
    if (wire === 0) {
      const item = readVarint(buffer, offset);
      fields.push({ field, wire, value: item.value });
      offset = item.next;
    } else if (wire === 2) {
      const length = readVarint(buffer, offset);
      const end = length.next + length.value;
      if (end > buffer.length) throw new Error("proto");
      fields.push({ field, wire, value: buffer.subarray(length.next, end) });
      offset = end;
    } else if (wire === 5) offset += 4;
    else if (wire === 1) offset += 8;
    else throw new Error("proto");
  }
  return fields;
}

/** Id de extensão de uma chave pública (DER): sha256, 16 bytes, cada nibble vira a–p. */
function extensionIdOfKey(key) {
  return [...crypto.createHash("sha256").update(key).digest().subarray(0, 16)]
    .map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
    .join("");
}

/**
 * .crx → { zip, publicKey }. A chave pública (base64) vai para o "key" do manifest: o id da
 * extensão fica o mesmo da loja (algumas dependem dele). O CRX3 da loja traz duas provas,
 * a do autor e a do próprio Google (igual em todas): vale a chave cujo id é `expectedId`.
 * Sem ela, erro "proof" (o CRX_REQUIRED_PROOF_MISSING do Chrome).
 */
function parseCrx(buffer, expectedId = null) {
  if (buffer.length < 16 || buffer.toString("latin1", 0, 4) !== "Cr24") throw new Error("crx");
  const version = buffer.readUInt32LE(4);
  if (version === 2) {
    const keyLength = buffer.readUInt32LE(8);
    const signatureLength = buffer.readUInt32LE(12);
    const start = 16 + keyLength + signatureLength;
    if (start > buffer.length) throw new Error("crx");
    const key = buffer.subarray(16, 16 + keyLength);
    if (expectedId && extensionIdOfKey(key) !== expectedId) throw new Error("proof");
    return { zip: buffer.subarray(start), publicKey: key.toString("base64") };
  }
  if (version !== 3) throw new Error("crx");
  const headerLength = buffer.readUInt32LE(8);
  const start = 12 + headerLength;
  if (start > buffer.length) throw new Error("crx");
  const keys = [];
  try {
    // CrxFileHeader: sha256_with_rsa = 2, sha256_with_ecdsa = 3 (AsymmetricKeyProof:
    // public_key = 1).
    const header = protoFields(buffer.subarray(12, start));
    for (const proof of header.filter((item) => [2, 3].includes(item.field) && item.wire === 2)) {
      const key = protoFields(proof.value).find((item) => item.field === 1 && item.wire === 2);
      if (key) keys.push(key.value);
    }
  } catch {
    keys.length = 0;
  }
  const key = expectedId ? keys.find((item) => extensionIdOfKey(item) === expectedId) : keys[0];
  if (expectedId && !key) throw new Error("proof");
  return { zip: buffer.subarray(start), publicKey: key ? key.toString("base64") : null };
}

/** Nome de arquivo do zip seguro para gravar (sem "..", sem caminho absoluto). */
function safeEntryName(name) {
  const clean = String(name).replace(/\\/g, "/");
  if (!clean || clean.startsWith("/") || /^[a-z]:/i.test(clean)) return null;
  const parts = clean.split("/");
  if (parts.some((part) => part === ".." || part.includes("\0"))) return null;
  return parts.filter((part) => part && part !== ".").join("/");
}

/** Zip → [{ name, data }] (pastas ficam de fora). Só "guardado" (0) e deflate (8). */
function unzip(buffer) {
  const min = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let index = buffer.length - 22; index >= min; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip");
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  if (count > LIMITS.entries) throw new Error("zip-size");
  const files = [];
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("zip");
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const local = buffer.readUInt32LE(offset + 42);
    const rawName = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (rawName.endsWith("/")) continue;
    const name = safeEntryName(rawName);
    if (!name) throw new Error("zip-path");
    if (buffer.readUInt32LE(local) !== 0x04034b50) throw new Error("zip");
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const raw = buffer.subarray(start, start + compressed);
    total += size;
    if (total > LIMITS.total) throw new Error("zip-size");
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
    else throw new Error("zip-method");
    files.push({ name, data });
  }
  return files;
}

module.exports = {
  compareVersions,
  crxDownloadUrl,
  extensionIdOfKey,
  parseCrx,
  parseUpdateCheck,
  safeEntryName,
  storeIdOf,
  unzip,
  updateCheckUrl,
};
