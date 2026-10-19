// Regras puras de segurança: normalização, política de senha, tokens e códigos de
// recuperação. Senhas e códigos usam Argon2id (Bun.password); tokens de sessão são
// aleatórios e só o sha256 deles vai para o banco.
import crypto from "node:crypto";

// Caracteres de controle (U+0000 a U+001F e U+007F), montados sem literal na regex.
const CONTROL_CHARS = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  "g",
);

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 256;
export const NAME_MAX = 80;
export const EMAIL_MAX = 254;
export const RECOVERY_CODE_COUNT = 8;
// Crockford base32 (sem I, L, O, U): fácil de ler e de digitar.
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 10;

export const ARGON2 = { algorithm: "argon2id", memoryCost: 19456, timeCost: 2 } as const;

const EMAIL_RE =
  /^[^\s@"<>()[\],;:\\]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]{1,63})+$/;

/** E-mail como chave: sem espaços, minúsculo, NFC. null quando não parece e-mail. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.normalize("NFC").trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) return null;
  return email;
}

/** Nome exibido: sem caracteres de controle, espaços colapsados, 1 a 80 caracteres. */
export function normalizeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.normalize("NFC").replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim();
  if (!name || name.length > NAME_MAX) return null;
  return name;
}

/** Motivo da recusa da senha, ou null quando ela passa. */
export function passwordProblem(password: unknown, email?: string | null): string | null {
  if (typeof password !== "string") return "A senha é obrigatória.";
  if (password.length < PASSWORD_MIN)
    return `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`;
  if (password.length > PASSWORD_MAX)
    return `A senha pode ter no máximo ${PASSWORD_MAX} caracteres.`;
  if (/^(.)\1+$/.test(password)) return "A senha não pode ser um caractere repetido.";
  if (email && password.trim().toLowerCase() === email) return "A senha não pode ser o seu e-mail.";
  return null;
}

export function hashSecret(secret: string): Promise<string> {
  return Bun.password.hash(secret, ARGON2);
}

export async function verifySecret(secret: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(secret, hash);
  } catch {
    return false;
  }
}

/** Hash de um valor qualquer, para gastar o mesmo tempo quando a conta não existe. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashSecret(crypto.randomBytes(24).toString("base64url"));
  return dummyHash;
}

export function newSessionToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** Comparação em tempo constante de dois textos (tamanhos diferentes: falso). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    crypto.timingSafeEqual(left, left);
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

/** Um código de recuperação: 10 símbolos base32 (50 bits), mostrado como XXXXX-XXXXX. */
export function newRecoveryCode(): string {
  const bytes = crypto.randomBytes(CODE_LENGTH);
  let code = "";
  for (const byte of bytes) code += CODE_ALPHABET[byte & 31];
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

export function newRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(newRecoveryCode());
  return [...codes];
}

/**
 * Código digitado → forma canônica (sem hífen nem espaço, maiúsculo, O→0, I/L→1).
 * null quando não tem o formato.
 */
export function normalizeRecoveryCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const code = value.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (code.length !== CODE_LENGTH) return null;
  for (const char of code) if (!CODE_ALPHABET.includes(char)) return null;
  return code;
}

/** Rótulo do aparelho guardado com a sessão: texto curto, sem controle. */
export function normalizeDevice(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(CONTROL_CHARS, "").trim().slice(0, 120);
}
