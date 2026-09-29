// Sugestões do motor de busca para a omnibox (feitas pelo main: o renderer não tem CORS
// para esses endpoints). Os dois respondem no formato OpenSearch: ["texto", ["a", "b"]].

const SUGGEST_URLS = {
  duckduckgo: (text) => `https://duckduckgo.com/ac/?q=${encodeURIComponent(text)}&type=list`,
  yandex: (text) =>
    `https://suggest.yandex.com/suggest-ff.cgi?part=${encodeURIComponent(text)}&uil=pt`,
};
const MAX_SUGGESTIONS = 6;
const TIMEOUT_MS = 1500;

function suggestUrl(engine, text) {
  const build = SUGGEST_URLS[engine];
  const clean = typeof text === "string" ? text.trim().slice(0, 200) : "";
  return build && clean ? build(clean) : null;
}

function parseSuggestions(body) {
  if (!Array.isArray(body) || !Array.isArray(body[1])) return [];
  const seen = new Set();
  const out = [];
  for (const item of body[1]) {
    const phrase = typeof item === "string" ? item : Array.isArray(item) ? item[0] : null;
    if (typeof phrase !== "string") continue;
    const clean = phrase.trim().slice(0, 200);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

async function fetchSuggestions(fetchImpl, engine, text) {
  const url = suggestUrl(engine, text);
  if (!url) return [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, credentials: "omit" });
    if (!response.ok) return [];
    return parseSuggestions(JSON.parse(await response.text()));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { suggestUrl, parseSuggestions, fetchSuggestions };
