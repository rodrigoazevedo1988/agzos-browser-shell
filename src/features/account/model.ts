// Regras puras da Conta Agzos na casca (as mesmas do servidor, para avisar antes).

/** Página da conta (entrar, criar conta, área logada). */
export const ACCOUNT_URL = "agzos://conta";
export const PASSWORD_MIN = 10;
/** Cores dos perfis Google (iguais às de electron/google-profiles.cjs). */
export const PROFILE_COLORS = [
  "#d10a11",
  "#2563eb",
  "#16a34a",
  "#d97706",
  "#7c3aed",
  "#db2777",
  "#0891b2",
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function emailProblem(email: string): string | null {
  return EMAIL_RE.test(email.trim()) ? null : "Informe um e-mail válido.";
}

/** Mesma política do servidor: pelo menos 10 caracteres, não repetido, não o e-mail. */
export function passwordProblem(password: string, email = ""): string | null {
  if (password.length < PASSWORD_MIN) {
    return `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`;
  }
  if (password.length > 256) return "A senha pode ter no máximo 256 caracteres.";
  if (/^(.)\1+$/.test(password)) return "A senha não pode ser um caractere repetido.";
  if (email && password.trim().toLowerCase() === email.trim().toLowerCase()) {
    return "A senha não pode ser o seu e-mail.";
  }
  return null;
}

/** Força aproximada (0 a 4) para a barrinha do formulário. */
export function passwordStrength(password: string): number {
  if (password.length < PASSWORD_MIN) return password ? 1 : 0;
  let score = 1;
  if (password.length >= 14) score += 1;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^\w\s]/].filter((re) => re.test(password)).length;
  if (kinds >= 2) score += 1;
  if (kinds >= 3 && password.length >= 12) score += 1;
  return Math.min(score, 4);
}

/** Conteúdo do .txt dos códigos de recuperação. */
export function recoveryCodesText(codes: string[], email: string, date = new Date()): string {
  const day = date.toISOString().slice(0, 10);
  return [
    "Agzos Browser — códigos de recuperação da Conta Agzos",
    `Conta: ${email}`,
    `Gerados em: ${day}`,
    "",
    "Cada código vale uma vez para redefinir a senha (Conta Agzos → Recuperar senha).",
    "Guarde este arquivo num lugar seguro: quem tiver um código pode trocar a sua senha.",
    "",
    ...codes.map((code, index) => `${String(index + 1).padStart(2, " ")}. ${code}`),
    "",
  ].join("\n");
}

/** Nome do arquivo baixado: agzos-codigos-de-recuperacao-<data>.txt */
export function recoveryCodesFileName(date = new Date()): string {
  return `agzos-codigos-de-recuperacao-${date.toISOString().slice(0, 10)}.txt`;
}

/** Iniciais para o avatar sem foto ("Ana Souza" → "AS", "ana@x.com" → "A"). */
export function initialsOf(label: string): string {
  const clean = label.trim();
  if (!clean) return "?";
  const base = clean.includes("@") ? (clean.split("@")[0] ?? clean) : clean;
  const words = base.split(/[\s._-]+/).filter(Boolean);
  const letters =
    words.length >= 2 ? `${words[0]![0]}${words[words.length - 1]![0]}` : (words[0]?.[0] ?? "?");
  return letters.toUpperCase();
}

/** Foto da conta vinda do main: só data: de imagem PNG, JPEG ou WebP (nunca URL externa). */
const PHOTO_URL_RE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
export function isPhotoUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length <= 720_000 && PHOTO_URL_RE.test(value);
}

export function planLabel(plan: string): string {
  return plan === "premium" ? "Premium" : "Gratuito";
}
