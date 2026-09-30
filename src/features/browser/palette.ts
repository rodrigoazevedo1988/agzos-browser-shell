/**
 * Busca de comandos (Ctrl+K), como o Quick Commands do Vivaldi: comandos do navegador,
 * guias abertas, workspaces e favoritos numa lista só, filtrada pelo que se digita.
 */
export type PaletteGroup = "Guias" | "Workspaces" | "Comandos" | "Favoritos";

export type PaletteItem = {
  /** "cmd:<CommandId>", "tab:<id>", "ws:<id>" ou "url:<endereço>". */
  id: string;
  group: PaletteGroup;
  label: string;
  detail?: string | undefined;
  shortcut?: string | undefined;
  icon?: string | undefined;
  /** Palavras extras que também encontram o item (sem aparecer). */
  keywords?: string | undefined;
};

const GROUP_ORDER: PaletteGroup[] = ["Guias", "Workspaces", "Comandos", "Favoritos"];
/** Sem texto digitado: só os primeiros de cada grupo. */
const IDLE_PER_GROUP = 6;
const MAX_RESULTS = 60;

/** Minúsculas e sem acento ("Configurações" encontra "configuracoes"). */
export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** Pontuação do item para a busca (null = não casa). Todas as palavras precisam aparecer. */
export function scoreItem(item: PaletteItem, query: string): number | null {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const label = normalize(item.label);
  const haystack = `${label} ${normalize(item.detail ?? "")} ${normalize(item.keywords ?? "")}`;
  let score = 0;
  for (const word of words) {
    const at = haystack.indexOf(word);
    if (at < 0) return null;
    if (label.startsWith(word)) score += 30;
    else if (new RegExp(`(^|[\\s/.:-])${escapeRegExp(word)}`).test(label)) score += 20;
    else if (at < label.length) score += 10;
    else score += 2;
  }
  return score;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Itens em ordem de exibição: agrupados, e dentro do grupo pelos que casam melhor. */
export function filterPalette(items: PaletteItem[], query: string): PaletteItem[] {
  const text = query.trim();
  if (!text) {
    return GROUP_ORDER.flatMap((group) =>
      items.filter((item) => item.group === group).slice(0, IDLE_PER_GROUP),
    );
  }
  const scored = items
    .map((item, index) => ({ item, index, score: scoreItem(item, text) }))
    .filter(
      (entry): entry is { item: PaletteItem; index: number; score: number } => entry.score !== null,
    );
  // Melhor resultado primeiro; empate fica na ordem dos grupos e da lista.
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      GROUP_ORDER.indexOf(a.item.group) - GROUP_ORDER.indexOf(b.item.group) ||
      a.index - b.index,
  );
  return scored.slice(0, MAX_RESULTS).map((entry) => entry.item);
}
