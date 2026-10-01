import type { Credential, VaultEntry } from "../types";

/**
 * Credenciais de demonstração do cofre Agzos Key. Usadas só na versão web (preview, sem
 * backend); no desktop o cofre real vem do Agzos Key via `useVault`.
 */
export const defaultCredentials: Credential[] = [
  { domain: "github.com", user: "mrcatofic", password: "agz-Gh8x2mK93" },
  { domain: "figma.com", user: "design@agzos.com", password: "fg-4Wn9Kp17" },
  { domain: "notion.so", user: "equipe@agzos.com", password: "nt-7Ra5Ls26" },
];

/**
 * Entradas completas de demonstração (2.2): já com categorias e um exemplo de MFA/TOTP,
 * para mostrar o agrupamento e a geração de código na versão web. O segredo TOTP abaixo é
 * um Base32 de exemplo, não vinculado a nenhuma conta real.
 */
export const defaultVaultEntries: VaultEntry[] = [
  {
    id: "web-github.com",
    type: "login",
    title: "github.com",
    url: "https://github.com",
    username: "mrcatofic",
    password: "agz-Gh8x2mK93",
    category: "Trabalho",
    totpSecret: "JBSWY3DPEHPK3PXP",
    updatedAt: Date.now(),
  },
  {
    id: "web-figma.com",
    type: "login",
    title: "figma.com",
    url: "https://figma.com",
    username: "design@agzos.com",
    password: "fg-4Wn9Kp17",
    category: "Trabalho",
    updatedAt: Date.now(),
  },
  {
    id: "web-notion.so",
    type: "login",
    title: "notion.so",
    url: "https://notion.so",
    username: "equipe@agzos.com",
    password: "nt-7Ra5Ls26",
    category: "Pessoal",
    updatedAt: Date.now(),
  },
];
