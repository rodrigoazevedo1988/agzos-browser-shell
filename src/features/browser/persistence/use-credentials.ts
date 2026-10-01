import type { Credential } from "../types";

/**
 * Credenciais de demonstração do cofre Agzos Key. Usadas só na versão web (preview, sem
 * backend); no desktop o cofre real vem do Agzos Key via `useVault`.
 */
export const defaultCredentials: Credential[] = [
  { domain: "github.com", user: "mrcatofic", password: "agz-Gh8x2mK93" },
  { domain: "figma.com", user: "design@agzos.com", password: "fg-4Wn9Kp17" },
  { domain: "notion.so", user: "equipe@agzos.com", password: "nt-7Ra5Ls26" },
];
