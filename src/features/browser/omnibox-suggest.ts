import { engineOf } from "./engines";
import { resolveInput } from "./omnibox-input";
import { entryOf, hostOf, normalizeUrlKey } from "./store/selectors";
import type { BookmarkNode, EngineId, HistoryUrl, Tab } from "./types";

export type SuggestionKind = "go" | "search" | "history" | "bookmark" | "tab" | "remote";

export type Suggestion = {
  kind: SuggestionKind;
  /** Texto principal (título da página ou termo de busca). */
  title: string;
  /** URL a abrir (nas buscas, a URL do buscador). */
  url: string;
  /** Linha de apoio: endereço, "Mudar para esta guia", "Pesquisar no …". */
  detail: string;
  tabId?: number;
  icon?: string | null | undefined;
  /** Pode sair do histórico (Shift+Delete). */
  removable?: boolean;
};

export const MAX_SUGGESTIONS = 8;
const MAX_REMOTE = 4;
const DAY = 24 * 60 * 60 * 1000;

/** URL como o usuário digitaria: sem esquema, sem "www." e sem a barra final. */
export function displayUrl(url: string): string {
  return url
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/$/, "");
}

function matchBonus(url: string, title: string, input: string, terms: string[]): number | null {
  const lowerUrl = url.toLowerCase();
  const lowerTitle = title.toLowerCase();
  if (!terms.every((term) => lowerUrl.includes(term) || lowerTitle.includes(term))) return null;
  const host = hostOf(url) ?? "";
  const bare = displayUrl(url).toLowerCase();
  // O começo do domínio pesa mais que qualquer frequência (máx. 80): "you" → youtube.com.
  if (host.startsWith(input)) return 100;
  if (bare.startsWith(input)) return 70;
  if (lowerTitle.startsWith(input)) return 20;
  if (host.split(".").some((part) => part.startsWith(terms[0]!))) return 10;
  return 0;
}

function recency(lastVisit: number, now: number): number {
  const age = now - lastVisit;
  if (age < 4 * DAY) return 1;
  if (age < 14 * DAY) return 0.7;
  if (age < 31 * DAY) return 0.5;
  return 0.3;
}

export type SuggestInput = {
  input: string;
  engine: EngineId;
  history: HistoryUrl[];
  bookmarks: BookmarkNode[];
  /** Abas abertas (as anônimas e a ativa ficam de fora). */
  tabs: Tab[];
  remote: string[];
  now: number;
};

/**
 * Lista da omnibox: o que foi digitado primeiro (abrir ou pesquisar), depois abas abertas,
 * favoritos e histórico por relevância (prefixo do domínio, frequência, recência), e por
 * fim as sugestões do buscador.
 */
export function buildSuggestions({
  input: raw,
  engine,
  history,
  bookmarks,
  tabs,
  remote,
  now,
}: SuggestInput): Suggestion[] {
  const input = raw.trim().toLowerCase();
  if (!input) return [];
  const terms = input.split(/\s+/).filter(Boolean);
  const engineName = engineOf(engine).name;
  const typed = resolveInput(raw, engine);
  const out: Suggestion[] = [];
  const seen = new Set<string>();

  if (typed) {
    const isSearch = typed.url === engineOf(engine).search(raw.trim());
    out.push(
      isSearch
        ? {
            kind: "search",
            title: raw.trim(),
            url: typed.url,
            detail: `Pesquisar no ${engineName}`,
          }
        : { kind: "go", title: displayUrl(typed.url), url: typed.url, detail: "Abrir endereço" },
    );
    if (!isSearch) seen.add(normalizeUrlKey(typed.url));
  }

  type Candidate = Suggestion & { score: number };
  const candidates: Candidate[] = [];
  for (const tab of tabs) {
    const entry = entryOf(tab);
    if (entry.kind !== "page") continue;
    const bonus = matchBonus(entry.url, entry.title, input, terms);
    if (bonus === null) continue;
    candidates.push({
      kind: "tab",
      title: entry.title || displayUrl(entry.url),
      url: entry.url,
      detail: "Mudar para esta guia",
      tabId: tab.id,
      icon: tab.favicon,
      score: 30 + bonus,
    });
  }
  for (const node of bookmarks) {
    if (node.kind !== "url" || !node.url) continue;
    const bonus = matchBonus(node.url, node.title, input, terms);
    if (bonus === null) continue;
    candidates.push({
      kind: "bookmark",
      title: node.title || displayUrl(node.url),
      url: node.url,
      detail: displayUrl(node.url),
      icon: node.icon,
      score: 45 + bonus,
    });
  }
  for (const page of history) {
    const bonus = matchBonus(page.url, page.title, input, terms);
    if (bonus === null) continue;
    candidates.push({
      kind: "history",
      title: page.title || displayUrl(page.url),
      url: page.url,
      detail: displayUrl(page.url),
      icon: page.icon,
      removable: true,
      score: bonus + Math.min(page.visitCount, 20) * 4 * recency(page.lastVisit, now),
    });
  }
  // Mesmo endereço em mais de uma fonte: fica a maior nota, mas a aba aberta sempre ganha
  // (mudar para ela em vez de abrir de novo).
  const best = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const key = normalizeUrlKey(candidate.url);
    if (seen.has(key)) continue;
    const found = best.get(key);
    if (!found) {
      best.set(key, candidate);
      continue;
    }
    const score = Math.max(found.score, candidate.score);
    const winner =
      found.kind === "tab"
        ? found
        : candidate.kind === "tab" || candidate.score > found.score
          ? candidate
          : found;
    best.set(key, { ...winner, score });
  }
  const ranked = [...best.values()].sort((a, b) => b.score - a.score);
  for (const { score: _score, ...candidate } of ranked) {
    out.push(candidate);
    if (out.length >= MAX_SUGGESTIONS - Math.min(MAX_REMOTE, remote.length)) break;
  }

  const phrases = new Set([input]);
  for (const phrase of remote) {
    const key = phrase.toLowerCase();
    if (phrases.has(key)) continue;
    phrases.add(key);
    out.push({
      kind: "remote",
      title: phrase,
      url: engineOf(engine).search(phrase),
      detail: `Pesquisar no ${engineName}`,
    });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

/**
 * Autocompletar na própria barra (como no Chrome): digitando "you" com youtube.com no
 * histórico, a barra mostra "youtube.com" com "tube.com" selecionado. Só completa
 * domínio (ou o caminho, se já digitou uma "/") de sugestão que começa com o texto.
 */
export function inlineCompletion(input: string, suggestions: Suggestion[]): string | null {
  const typed = input.trim();
  if (!typed || /\s/.test(typed) || typed !== input) return null;
  const lower = typed.toLowerCase();
  for (const suggestion of suggestions) {
    if (
      suggestion.kind !== "history" &&
      suggestion.kind !== "bookmark" &&
      suggestion.kind !== "tab"
    )
      continue;
    const bare = displayUrl(suggestion.url);
    const candidate = lower.includes("/") ? bare : (hostOf(suggestion.url) ?? "");
    if (candidate.toLowerCase().startsWith(lower) && candidate.length > typed.length) {
      return typed + candidate.slice(typed.length);
    }
  }
  return null;
}
