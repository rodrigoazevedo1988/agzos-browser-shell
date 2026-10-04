// Session Tabs (4.5): cada uma guarda cookies e storage numa partição persistente própria
// ("persist:agzos-session-<id>", pasta <userData>/Partitions/agzos-session-<id>). Regras
// puras: quais sessões as janelas salvas ainda usam e quais pastas sobraram de guias
// fechadas (o main apaga essas na abertura, antes de qualquer sessão existir).

const SESSION_ID_RE = /^[a-z0-9-]{4,40}$/;
const DIR_PREFIX = "agzos-session-";

/** Ids de sessão das guias de todas as janelas salvas (windows.cjs). */
function sessionIdsOf(records) {
  const ids = new Set();
  for (const record of Array.isArray(records) ? records : []) {
    const tabs = record?.session?.tabs;
    if (!Array.isArray(tabs)) continue;
    for (const tab of tabs) {
      const id = tab?.session?.id;
      if (typeof id === "string" && SESSION_ID_RE.test(id)) ids.add(id);
    }
  }
  return ids;
}

/** Pastas de Session Tabs que nenhuma guia salva usa mais. */
function orphanPartitionDirs(names, keep) {
  return (Array.isArray(names) ? names : []).filter((name) => {
    if (typeof name !== "string" || !name.startsWith(DIR_PREFIX)) return false;
    const id = name.slice(DIR_PREFIX.length);
    return SESSION_ID_RE.test(id) && !keep.has(id);
  });
}

module.exports = { DIR_PREFIX, SESSION_ID_RE, orphanPartitionDirs, sessionIdsOf };
