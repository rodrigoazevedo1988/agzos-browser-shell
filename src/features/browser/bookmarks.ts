import { normalizeUrlKey } from "./store/selectors";
import { BOOKMARK_BAR, BOOKMARK_OTHER, type BookmarkNode, type QuickLink } from "./types";

export const ROOT_TITLES: Record<string, string> = {
  [BOOKMARK_BAR]: "Barra de favoritos",
  [BOOKMARK_OTHER]: "Outros favoritos",
};
export const BOOKMARK_ROOTS = [BOOKMARK_BAR, BOOKMARK_OTHER] as const;
export const isRoot = (id: string) => id === BOOKMARK_BAR || id === BOOKMARK_OTHER;

/** Limite de segurança (importar um HTML gigante não pode travar a casca). */
export const BOOKMARKS_LIMIT = 5000;

let sequence = 0;
/** Id novo de favorito ou pasta (gerado fora do reducer, que continua puro). */
export function newBookmarkId(): string {
  sequence = (sequence + 1) % 1_000_000;
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `b${Date.now().toString(36)}${sequence.toString(36)}${random}`;
}

export function childrenOf(nodes: BookmarkNode[], parentId: string): BookmarkNode[] {
  return nodes.filter((node) => node.parentId === parentId);
}

/** O próprio nó e tudo que está dentro dele (pastas aninhadas). */
export function subtreeIds(nodes: BookmarkNode[], id: string): Set<string> {
  const ids = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (!ids.has(node.id) && ids.has(node.parentId)) {
        ids.add(node.id);
        grew = true;
      }
    }
  }
  return ids;
}

export function bookmarkForUrl(nodes: BookmarkNode[], url: string): BookmarkNode | undefined {
  const key = normalizeUrlKey(url);
  return nodes.find((node) => node.kind === "url" && node.url && normalizeUrlKey(node.url) === key);
}

export function titleOfFolder(nodes: BookmarkNode[], id: string): string {
  return ROOT_TITLES[id] ?? nodes.find((node) => node.id === id)?.title ?? "Favoritos";
}

/** Pastas em ordem de árvore, com a profundidade (para o seletor de pasta). */
export function folderOptions(
  nodes: BookmarkNode[],
): { id: string; title: string; depth: number }[] {
  const options: { id: string; title: string; depth: number }[] = [];
  const walk = (parentId: string, depth: number) => {
    for (const node of childrenOf(nodes, parentId)) {
      if (node.kind !== "folder") continue;
      options.push({ id: node.id, title: node.title, depth });
      walk(node.id, depth + 1);
    }
  };
  for (const root of BOOKMARK_ROOTS) {
    options.push({ id: root, title: ROOT_TITLES[root]!, depth: 0 });
    walk(root, 1);
  }
  return options;
}

/** Caminho da pasta até a raiz ("Barra de favoritos › Trabalho"). */
export function folderPath(nodes: BookmarkNode[], id: string): string[] {
  const path: string[] = [];
  let current: string | undefined = id;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    path.unshift(titleOfFolder(nodes, current));
    if (isRoot(current)) break;
    current = nodes.find((node) => node.id === current)?.parentId;
  }
  return path;
}

/**
 * Move o nó para `parentId`, na posição `index` entre os irmãos (fim quando omitido).
 * Pasta não entra nela mesma nem numa subpasta dela.
 */
export function moveNode(
  nodes: BookmarkNode[],
  id: string,
  parentId: string,
  index?: number,
): BookmarkNode[] {
  const node = nodes.find((item) => item.id === id);
  if (!node) return nodes;
  if (!isRoot(parentId) && !nodes.some((item) => item.id === parentId && item.kind === "folder")) {
    return nodes;
  }
  if (node.kind === "folder" && subtreeIds(nodes, id).has(parentId)) return nodes;
  const rest = nodes.filter((item) => item.id !== id);
  const moved = node.parentId === parentId ? node : { ...node, parentId };
  const siblings = rest.filter((item) => item.parentId === parentId);
  const at = index === undefined ? siblings.length : Math.max(0, Math.min(index, siblings.length));
  if (at >= siblings.length) {
    const last = siblings[siblings.length - 1];
    const position = last ? rest.indexOf(last) + 1 : rest.length;
    return [...rest.slice(0, position), moved, ...rest.slice(position)];
  }
  const position = rest.indexOf(siblings[at]!);
  const next = [...rest.slice(0, position), moved, ...rest.slice(position)];
  return next.length === nodes.length && next.every((item, i) => item === nodes[i]) ? nodes : next;
}

/** URL de favorito sempre com esquema (o usuário pode digitar "site.com"). */
export function normalizeBookmarkUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Primeira execução da 1.6: os atalhos que a estrela salvava viram favoritos da barra. */
export function seedFromLinks(
  links: QuickLink[],
  defaults: QuickLink[],
  now: number,
): BookmarkNode[] {
  const defaultKeys = new Set(defaults.map((link) => normalizeUrlKey(link.url)));
  const seen = new Set<string>();
  const nodes: BookmarkNode[] = [];
  links.forEach((link, index) => {
    const key = normalizeUrlKey(link.url);
    const url = normalizeBookmarkUrl(link.url);
    if (!url || defaultKeys.has(key) || seen.has(key)) return;
    seen.add(key);
    nodes.push({
      id: `seed-${index}`,
      parentId: BOOKMARK_BAR,
      kind: "url",
      title: link.name || link.url,
      url,
      createdAt: now,
    });
  });
  return nodes;
}

// --- Importar/exportar no formato HTML do Netscape (Chrome, Firefox, Edge, Safari). ---

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  "#39": "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return ENTITIES[lower] ?? match;
  });
}

function encodeEntities(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const stripTags = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, "")).trim();

/**
 * Lê o HTML de favoritos exportado por outro navegador e devolve os nós, dentro de
 * `parentId`. A pasta "Barra de favoritos" do Chrome (PERSONAL_TOOLBAR_FOLDER) é aberta
 * direto na barra do Agzos quando `parentId` é a barra.
 */
export function parseNetscapeBookmarks(
  html: string,
  parentId: string,
  makeId: () => string = newBookmarkId,
  now = Date.now(),
): BookmarkNode[] {
  const nodes: BookmarkNode[] = [];
  const stack: string[] = [];
  // Pasta aberta pelo último <H3>, que vale para o próximo <DL>.
  let pendingFolder: string | null = null;
  let depth = 0;
  const token = /<dl[^>]*>|<\/dl>|<h3([^>]*)>([\s\S]*?)<\/h3>|<a\s([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(token)) {
    if (nodes.length >= BOOKMARKS_LIMIT) break;
    const tag = match[0].slice(0, 3).toLowerCase();
    const current = stack[stack.length - 1] ?? parentId;
    if (tag === "<dl") {
      depth++;
      // O <DL> de fora de tudo é a raiz do arquivo.
      if (depth > 1) stack.push(pendingFolder ?? current);
      pendingFolder = null;
    } else if (tag === "</d") {
      if (depth > 1) stack.pop();
      depth = Math.max(0, depth - 1);
    } else if (tag === "<h3") {
      const attributes = match[1] ?? "";
      if (/PERSONAL_TOOLBAR_FOLDER/i.test(attributes) && current === parentId) {
        pendingFolder = parentId;
        continue;
      }
      const id = makeId();
      nodes.push({
        id,
        parentId: current,
        kind: "folder",
        title: stripTags(match[2] ?? "") || "Pasta",
        createdAt: now,
      });
      pendingFolder = id;
    } else {
      const attributes = match[3] ?? "";
      const href = /href\s*=\s*"([^"]*)"/i.exec(attributes)?.[1];
      const url = href ? normalizeBookmarkUrl(decodeEntities(href)) : null;
      if (!url) continue;
      const added = Number(/add_date\s*=\s*"(\d+)"/i.exec(attributes)?.[1]);
      nodes.push({
        id: makeId(),
        parentId: current,
        kind: "url",
        title: stripTags(match[4] ?? "") || url,
        url,
        createdAt: Number.isFinite(added) && added > 0 ? added * 1000 : now,
      });
    }
  }
  return nodes;
}

export function exportNetscapeBookmarks(nodes: BookmarkNode[]): string {
  const lines = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
    "<DL><p>",
  ];
  const walk = (parentId: string, indent: string) => {
    for (const node of childrenOf(nodes, parentId)) {
      const date = Math.floor(node.createdAt / 1000);
      if (node.kind === "folder") {
        lines.push(`${indent}<DT><H3 ADD_DATE="${date}">${encodeEntities(node.title)}</H3>`);
        lines.push(`${indent}<DL><p>`);
        walk(node.id, `${indent}    `);
        lines.push(`${indent}</DL><p>`);
      } else if (node.url) {
        lines.push(
          `${indent}<DT><A HREF="${encodeEntities(node.url)}" ADD_DATE="${date}">${encodeEntities(node.title)}</A>`,
        );
      }
    }
  };
  lines.push(`    <DT><H3 PERSONAL_TOOLBAR_FOLDER="true">${ROOT_TITLES[BOOKMARK_BAR]}</H3>`);
  lines.push("    <DL><p>");
  walk(BOOKMARK_BAR, "        ");
  lines.push("    </DL><p>");
  walk(BOOKMARK_OTHER, "    ");
  lines.push("</DL><p>");
  return `${lines.join("\n")}\n`;
}

/** Aceita qualquer coisa vinda do disco; nós inválidos ou órfãos são descartados. */
export function parseBookmarks(value: unknown): BookmarkNode[] | null {
  if (!Array.isArray(value)) return null;
  const nodes: BookmarkNode[] = [];
  const ids = new Set<string>();
  for (const item of value.slice(0, BOOKMARKS_LIMIT)) {
    if (typeof item !== "object" || item === null) continue;
    const raw = item as Record<string, unknown>;
    const { id, parentId, kind, title } = raw;
    if (typeof id !== "string" || !id || isRoot(id) || ids.has(id)) continue;
    if (typeof parentId !== "string" || (kind !== "url" && kind !== "folder")) continue;
    if (typeof title !== "string") continue;
    const node: BookmarkNode = {
      id,
      parentId,
      kind,
      title,
      createdAt: typeof raw["createdAt"] === "number" ? raw["createdAt"] : 0,
    };
    if (kind === "url") {
      const url = typeof raw["url"] === "string" ? normalizeBookmarkUrl(raw["url"]) : null;
      if (!url) continue;
      node.url = url;
      if (typeof raw["icon"] === "string" && /^(https?:|data:image\/)/.test(raw["icon"])) {
        node.icon = raw["icon"];
      }
    }
    ids.add(id);
    nodes.push(node);
  }
  // Órfãos (pasta-mãe sumiu, pai que não é pasta ou ciclo) vão para "Outros favoritos"
  // em vez de sumir.
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const reachesRoot = (node: BookmarkNode) => {
    let parentId = node.parentId;
    for (let steps = 0; steps <= nodes.length; steps++) {
      if (isRoot(parentId)) return true;
      const parent = byId.get(parentId);
      if (!parent || parent.kind !== "folder") return false;
      parentId = parent.parentId;
    }
    return false;
  };
  return nodes.map((node) => (reachesRoot(node) ? node : { ...node, parentId: BOOKMARK_OTHER }));
}
