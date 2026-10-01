/**
 * Geração de códigos TOTP (RFC 6238), igual ao Agzos Key: HMAC-SHA1 sobre o contador de
 * 30 s, códigos de 6 dígitos. O segredo é Base32 (padrão `otpauth`), com ou sem padding.
 *
 * Usa a Web Crypto (SubtleCrypto) do renderer — a mesma API do Agzos Key no navegador —
 * então nenhum segredo precisa sair para o processo principal só para mostrar o código.
 */

const DEFAULT_PERIOD = 30;
const DEFAULT_DIGITS = 6;
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Normaliza um segredo TOTP: aceita `otpauth://` ou Base32 cru, remove espaços e padding. */
export function normalizeTotpSecret(input: string): string {
  const raw = input.trim();
  if (!raw) return "";
  // otpauth://totp/Label?secret=XXXX&...  → extrai o parâmetro secret.
  if (/^otpauth:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      return (url.searchParams.get("secret") ?? "").replace(/\s+/g, "").toUpperCase();
    } catch {
      /* cai no tratamento cru abaixo */
    }
  }
  return raw.replace(/\s+/g, "").replace(/=+$/, "").toUpperCase();
}

/** Decodifica Base32 (RFC 4648, sem padding) para bytes. Lança em caractere inválido. */
function base32Decode(secret: string): ArrayBuffer {
  const clean = secret.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("invalid_base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out).buffer;
}

/** Vale como segredo TOTP? (Base32 não vazio e decodificável.) */
export function isValidTotpSecret(secret: string): boolean {
  const normalized = normalizeTotpSecret(secret);
  if (!normalized) return false;
  try {
    return base32Decode(normalized).byteLength > 0;
  } catch {
    return false;
  }
}

function counterBytes(counter: number): ArrayBuffer {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  // Contador de 64 bits big-endian; JS lida com 32 bits altos/baixos em separado.
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  return buffer;
}

/** Trunca dinamicamente o HMAC em um código de `digits` dígitos (RFC 4226). */
function truncate(hmac: Uint8Array, digits: number): string {
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);
  return (binary % 10 ** digits).toString().padStart(digits, "0");
}

export type TotpOptions = { period?: number; digits?: number; now?: number };

/** Código TOTP atual para o segredo (Base32 ou otpauth). Erro de segredo inválido vira "". */
export async function generateTotp(secret: string, options: TotpOptions = {}): Promise<string> {
  const normalized = normalizeTotpSecret(secret);
  if (!normalized) return "";
  const period = options.period ?? DEFAULT_PERIOD;
  const digits = options.digits ?? DEFAULT_DIGITS;
  const now = options.now ?? Date.now();
  let keyBytes: ArrayBuffer;
  try {
    keyBytes = base32Decode(normalized);
  } catch {
    return "";
  }
  if (keyBytes.byteLength === 0) return "";
  const counter = Math.floor(now / 1000 / period);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, counterBytes(counter));
  return truncate(new Uint8Array(signature), digits);
}

/** Segundos até o próximo código (0–period), para a barra de contagem regressiva. */
export function secondsRemaining(options: { period?: number; now?: number } = {}): number {
  const period = options.period ?? DEFAULT_PERIOD;
  const now = options.now ?? Date.now();
  return period - (Math.floor(now / 1000) % period);
}
