import type { VaultEntry } from "./types";

/** Categorias sugeridas (como as pastas do cofre do Agzos Key). */
export const DEFAULT_CATEGORIES = ["Pessoal", "Trabalho", "Finanças", "Social"] as const;

/** Host de uma URL, sem `www.` e em minúsculas; null quando não dá para ler. */
export function hostOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const withScheme = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

// Sufixos de 2 níveis comuns (com.br, co.uk…): o site é o rótulo antes deles.
const SECOND_LEVEL = new Set([
  "com",
  "net",
  "org",
  "gov",
  "edu",
  "co",
  "ac",
  "app",
  "art",
  "blog",
  "eng",
  "ind",
  "inf",
  "jus",
  "leg",
  "mil",
  "adv",
  "arq",
  "med",
  "srv",
  "tv",
]);

// Hospedagens compartilhadas: cada subdomínio é um site diferente (contas distintas).
const SHARED_HOSTS = new Set([
  "github.io",
  "vercel.app",
  "netlify.app",
  "pages.dev",
  "web.app",
  "firebaseapp.com",
  "herokuapp.com",
  "blogspot.com",
  "azurewebsites.net",
  "cloudfront.net",
  "amazonaws.com",
  "onrender.com",
]);

/** Domínio registrável aproximado (mail.google.com -> google.com; a.b.com.br -> b.com.br). */
export function siteOf(host: string): string {
  const labels = host.split(".");
  if (labels.length <= 2 || /^\d+$/.test(labels[labels.length - 1] ?? "")) return host;
  const tld = labels[labels.length - 1]!;
  const second = labels[labels.length - 2]!;
  const shared = SHARED_HOSTS.has(`${second}.${tld}`);
  const take = shared || (tld.length === 2 && SECOND_LEVEL.has(second)) ? 3 : 2;
  return labels.slice(-take).join(".");
}

/** Nome do site, sem sufixo (mail.google.com -> "google"; itau.com.br -> "itau"). */
function siteLabel(host: string): string {
  return siteOf(host).split(".")[0] ?? host;
}

/** Texto comparável: minúsculas, sem acento nem pontuação. */
function plain(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// Domínios de login único: irmãos (mail.google.com × accounts.google.com) são o mesmo login.
const SSO_SITES = new Set([
  "google.com",
  "microsoft.com",
  "live.com",
  "microsoftonline.com",
  "apple.com",
  "amazon.com",
]);

/** Quão uma entrada serve para o host aberto: `exact` preenche sozinha, `related` pede confirmação. */
export type MatchLevel = "exact" | "related";

/**
 * Quanto a entrada serve para o host aberto. `exact`: host igual, um subdomínio do outro, ou
 * irmãos de um domínio de login único (SSO_SITES). `related`: outro subdomínio do mesmo site
 * (vps.x.com × office.x.com) ou entrada sem URL que cita o site no nome. null: não serve.
 */
export function matchLevel(entry: VaultEntry, host: string): MatchLevel | null {
  const entryHost = hostOf(entry.url) ?? (entry.url ? null : titleHost(entry.title));
  if (!entryHost) return entryNamesHost(entry, host) ? "related" : null;
  if (entryHost === host || host.endsWith(`.${entryHost}`) || entryHost.endsWith(`.${host}`)) {
    return "exact";
  }
  const site = siteOf(host);
  if (siteOf(entryHost) !== site) return null;
  return SSO_SITES.has(site) ? "exact" : "related";
}

/** A entrada serve para o host como login exato (preenche e sugere sozinha). */
export function entryMatchesHost(entry: VaultEntry, host: string): boolean {
  return matchLevel(entry, host) === "exact";
}

/** Título com cara de endereço ("github.com"), não um nome ("Conta Google"). */
function titleHost(title: string | undefined): string | null {
  const text = title?.trim() ?? "";
  return /^[^\s/]+\.[a-z]{2,}(\/.*)?$/i.test(text) ? hostOf(text) : null;
}

/**
 * Entrada sem URL cujo nome cita o site ("Google", "Conta Itaú"): serve de sugestão e,
 * ao ser usada, ganha a URL do login (o navegador coleta e sincroniza com o cofre).
 */
export function entryNamesHost(entry: VaultEntry, host: string): boolean {
  if (entry.url?.trim()) return false;
  const label = siteLabel(host);
  if (label.length < 3) return false;
  const words = plain(`${entry.title} ${entry.username ?? ""}`).split(" ");
  return words.includes(label) || plain(entry.title).replace(/ /g, "") === label;
}

const isLogin = (entry: VaultEntry) => !entry.type || entry.type === "login";

/**
 * App do Google Apps Script (script.google.com/macros/s/<id>): cada app é um site à parte,
 * com o login dele. null para qualquer outra URL.
 */
export function appsScriptApp(url: string | undefined | null): string | null {
  try {
    const parsed = new URL(url ?? "");
    if (parsed.hostname !== "script.google.com") return null;
    const match = /^\/(?:a\/macros\/[^/]+|macros)\/s\/([^/]+)/.exec(parsed.pathname);
    return match ? match[1]! : null;
  } catch {
    return null;
  }
}

/** Login de app do Apps Script só serve para o mesmo app (e vice-versa). */
function sameAppScope(entry: VaultEntry, pageApp: string | null): boolean {
  const entryApp = appsScriptApp(entry.url);
  if (pageApp) return entryApp === pageApp;
  return entryApp === null;
}

/** Entradas do cofre com o nível de correspondência com a URL aberta (sem as apagadas). */
function levelsForUrl(
  entries: VaultEntry[],
  url: string | undefined | null,
): { entry: VaultEntry; level: MatchLevel }[] {
  const host = hostOf(url);
  if (!host || !/^https?:/i.test(url ?? "https:")) return [];
  const app = appsScriptApp(url);
  return entries.flatMap((entry) => {
    if (entry.deletedAt || !isLogin(entry) || !sameAppScope(entry, app)) return [];
    const level = matchLevel(entry, host);
    return level ? [{ entry, level }] : [];
  });
}

/** Favorita primeiro, depois a mais recente. */
const byFavoriteThenRecent = (a: VaultEntry, b: VaultEntry) =>
  (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || b.updatedAt - a.updatedAt;

/** Entradas do cofre que servem para o site aberto (para o popup de autofill e o TOTP). */
export function matchesForUrl(entries: VaultEntry[], url: string | undefined | null): VaultEntry[] {
  return levelsForUrl(entries, url)
    .filter((match) => match.level === "exact")
    .map((match) => match.entry)
    .sort(byFavoriteThenRecent);
}

/** Logins de outros subdomínios do mesmo site (o popup os lista à parte, com confirmação). */
export function relatedForUrl(entries: VaultEntry[], url: string | undefined | null): VaultEntry[] {
  return levelsForUrl(entries, url)
    .filter((match) => match.level === "related")
    .map((match) => match.entry)
    .sort(byFavoriteThenRecent);
}

/** Logins do cofre para a busca do popup (tudo que não é nota/cartão/wi-fi). */
export function searchLogins(entries: VaultEntry[], query: string, limit = 30): VaultEntry[] {
  const words = plain(query).split(" ").filter(Boolean);
  return entries
    .filter((entry) => !entry.deletedAt && isLogin(entry))
    .filter((entry) => {
      const text = plain(`${entry.title} ${entry.username ?? ""} ${entry.url ?? ""}`);
      return words.every((word) => text.includes(word));
    })
    .sort((a, b) => a.title.localeCompare(b.title, "pt-BR"))
    .slice(0, limit);
}

/** URL do login que vai para o cofre: origem + caminho da página, sem query nem hash. */
export function loginUrlOf(pageUrl: string): string | null {
  try {
    const url = new URL(pageUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return `${url.origin}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Entrada usada num site e que ainda não tem a URL dele: devolve a entrada com a URL do
 * login, para salvar no cofre. null quando já tem URL (não troca a de outro site).
 */
export function withLoginUrl(entry: VaultEntry, pageUrl: string): VaultEntry | null {
  if (entry.url?.trim()) return null;
  const url = loginUrlOf(pageUrl);
  return url ? { ...entry, url, updatedAt: Date.now() } : null;
}

/** Nome da categoria da entrada, sempre com um valor (cai em "Pessoal"). */
export function categoryOf(entry: VaultEntry): string {
  return entry.category?.trim() || "Pessoal";
}

/** Agrupa as entradas por categoria, em ordem alfabética (favoritas primeiro dentro). */
export function groupByCategory(
  entries: VaultEntry[],
): { category: string; items: VaultEntry[] }[] {
  const map = new Map<string, VaultEntry[]>();
  for (const entry of entries) {
    const key = categoryOf(entry);
    const list = map.get(key) ?? [];
    list.push(entry);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([category, items]) => ({
      category,
      items: items.sort(
        (a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || b.updatedAt - a.updatedAt,
      ),
    }))
    .sort((a, b) => a.category.localeCompare(b.category, "pt-BR"));
}

/** Lista única de categorias existentes + as padrão, para o seletor do formulário. */
export function knownCategories(entries: VaultEntry[]): string[] {
  const set = new Set<string>(DEFAULT_CATEGORIES);
  for (const entry of entries) set.add(categoryOf(entry));
  return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
}
