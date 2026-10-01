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

/** O host da entrada bate com o host do site? (igual ou subdomínio.) */
export function entryMatchesHost(entry: VaultEntry, host: string): boolean {
  const entryHost = hostOf(entry.url) ?? hostOf(entry.title);
  if (!entryHost) return false;
  return entryHost === host || host.endsWith(`.${entryHost}`) || entryHost.endsWith(`.${host}`);
}

/** Entradas do cofre que servem para o site aberto (para o popup de autofill). */
export function matchesForUrl(entries: VaultEntry[], url: string | undefined | null): VaultEntry[] {
  const host = hostOf(url);
  if (!host) return [];
  return entries
    .filter((entry) => !entry.deletedAt && entryMatchesHost(entry, host))
    .sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) || b.updatedAt - a.updatedAt);
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
