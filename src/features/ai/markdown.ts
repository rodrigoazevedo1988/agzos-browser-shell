/**
 * Markdown das respostas (4.1.3), no estilo do Claude Code: títulos, listas, citações,
 * tabelas, blocos de código e texto com **negrito**, *itálico*, `código` e links. Vira
 * elementos React (nunca HTML cru). Um bloco de código ainda aberto (streaming) vale até
 * o fim do texto.
 */

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; children: Inline[] }
  | { kind: "em"; children: Inline[] }
  | { kind: "del"; children: Inline[] }
  | { kind: "code"; text: string }
  | { kind: "link"; href: string; children: Inline[] };

export type Block =
  | { kind: "heading"; level: number; children: Inline[] }
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "code"; lang: string; text: string; open: boolean }
  | { kind: "quote"; children: Block[] }
  | { kind: "list"; ordered: boolean; start: number; items: Block[][] }
  | { kind: "table"; head: Inline[][]; rows: Inline[][][] }
  | { kind: "rule" };

/** Só links da web e e-mail abrem; o resto vira texto. */
export function safeHref(href: string): string | null {
  const value = href.trim();
  return /^(https?:\/\/|mailto:)/i.test(value) ? value : null;
}

const INLINE_RE =
  /(`+)([\s\S]*?[^`])\1(?!`)|\*\*([\s\S]+?)\*\*|__([\s\S]+?)__|~~([\s\S]+?)~~|\*([^\s*][\s\S]*?)\*|(?<![\w])_([^\s_][\s\S]*?)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/;

export function parseInline(text: string): Inline[] {
  const result: Inline[] = [];
  let rest = text;
  while (rest) {
    const match = INLINE_RE.exec(rest);
    if (!match) {
      result.push({ kind: "text", text: rest });
      break;
    }
    if (match.index > 0) result.push({ kind: "text", text: rest.slice(0, match.index) });
    const [whole, , code, strong, strong2, del, em, em2, label, href, bare] = match;
    if (code !== undefined) result.push({ kind: "code", text: code.replace(/^ (.*) $/, "$1") });
    else if (strong !== undefined || strong2 !== undefined)
      result.push({ kind: "strong", children: parseInline(strong ?? strong2 ?? "") });
    else if (del !== undefined) result.push({ kind: "del", children: parseInline(del) });
    else if (em !== undefined || em2 !== undefined)
      result.push({ kind: "em", children: parseInline(em ?? em2 ?? "") });
    else if (label !== undefined && href !== undefined) {
      const safe = safeHref(href);
      result.push(
        safe
          ? { kind: "link", href: safe, children: parseInline(label) }
          : { kind: "text", text: label },
      );
    } else if (bare !== undefined) {
      result.push({ kind: "link", href: bare, children: [{ kind: "text", text: bare }] });
    }
    rest = rest.slice(match.index + whole.length);
  }
  return result;
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const HEADING_RE = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE_RE = /^ {0,3}([-*_])(\s*\1){2,}\s*$/;
const ITEM_RE = /^(\s*)([-*+]|(\d{1,9})[.)])\s+(.*)$/;
const QUOTE_RE = /^ {0,3}>\s?(.*)$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const cells = (line: string) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => parseInline(cell.trim().replace(/\\\|/g, "|")));

const startsBlock = (line: string) =>
  FENCE_RE.test(line) ||
  HEADING_RE.test(line) ||
  RULE_RE.test(line) ||
  QUOTE_RE.test(line) ||
  ITEM_RE.test(line);

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1]!;
      const body: string[] = [];
      index += 1;
      let open = true;
      while (index < lines.length) {
        const next = lines[index]!;
        if (
          next.trim().startsWith(marker[0]!.repeat(marker.length)) &&
          /^\s*[`~]+\s*$/.test(next)
        ) {
          open = false;
          index += 1;
          break;
        }
        body.push(next);
        index += 1;
      }
      blocks.push({
        kind: "code",
        lang: (fence[2] ?? "").toLowerCase(),
        text: body.join("\n"),
        open,
      });
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1]!.length,
        children: parseInline(heading[2]!),
      });
      index += 1;
      continue;
    }
    if (RULE_RE.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }
    if (QUOTE_RE.test(line)) {
      const body: string[] = [];
      while (index < lines.length && QUOTE_RE.test(lines[index]!)) {
        body.push(QUOTE_RE.exec(lines[index]!)![1]!);
        index += 1;
      }
      blocks.push({ kind: "quote", children: parseMarkdown(body.join("\n")) });
      continue;
    }
    const item = ITEM_RE.exec(line);
    if (item) {
      const ordered = item[3] !== undefined;
      const indent = item[1]!.length;
      const items: string[][] = [];
      while (index < lines.length) {
        const current = lines[index]!;
        const match = ITEM_RE.exec(current);
        if (match && match[1]!.length <= indent && (match[3] !== undefined) === ordered) {
          items.push([match[4]!]);
          index += 1;
          continue;
        }
        if (match && match[1]!.length <= indent) break;
        // Continuação: linha recuada (inclusive sublistas) ou texto colado no item.
        if (!current.trim()) {
          const next = lines[index + 1];
          if (next !== undefined && /^\s{2,}\S/.test(next) && items.length) {
            items[items.length - 1]!.push("");
            index += 1;
            continue;
          }
          break;
        }
        if (/^\s{2,}/.test(current) || !startsBlock(current)) {
          items[items.length - 1]!.push(current.replace(/^\s{1,4}/, ""));
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({
        kind: "list",
        ordered,
        start: ordered ? Number(item[3]) : 1,
        items: items.map((body) => parseMarkdown(body.join("\n"))),
      });
      continue;
    }
    if (line.includes("|") && TABLE_SEP_RE.test(lines[index + 1] ?? "")) {
      const head = cells(line);
      index += 2;
      const rows: Inline[][][] = [];
      while (index < lines.length && lines[index]!.includes("|") && lines[index]!.trim()) {
        rows.push(cells(lines[index]!));
        index += 1;
      }
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    const body: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index]!.trim() && !startsBlock(lines[index]!)) {
      body.push(lines[index]!);
      index += 1;
    }
    blocks.push({ kind: "paragraph", children: parseInline(body.join("\n")) });
  }
  return blocks;
}

/** Artifact: bloco de código que abre ao lado do chat (código, HTML ou SVG). */
export type Artifact = {
  id: string;
  kind: "html" | "svg" | "code";
  lang: string;
  title: string;
  text: string;
};

const HTML_LANGS = new Set(["html", "htm", "xhtml"]);

export function artifactKind(lang: string, text: string): Artifact["kind"] {
  if (lang === "svg" || (lang === "xml" && /^\s*<svg[\s>]/i.test(text))) return "svg";
  if (HTML_LANGS.has(lang)) return "html";
  if (!lang && /^\s*<svg[\s>]/i.test(text)) return "svg";
  if (!lang && /^\s*<!doctype html|^\s*<html[\s>]/i.test(text)) return "html";
  return "code";
}

/** Vira artifact: HTML, SVG ou código com pelo menos 4 linhas. */
export function isArtifact(lang: string, text: string) {
  return artifactKind(lang, text) !== "code" || text.split("\n").length >= 4;
}

function artifactTitle(kind: Artifact["kind"], lang: string, text: string) {
  if (kind === "html") {
    const title = /<title>([^<]{1,80})<\/title>/i.exec(text)?.[1]?.trim();
    return title || "Página HTML";
  }
  if (kind === "svg") return "Imagem SVG";
  const first = text
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !/^[{}()[\];]+$/.test(line));
  const label = lang ? lang.toUpperCase() : "Código";
  return first ? `${label} · ${first.slice(0, 48)}` : label;
}

/** Artifacts de uma conversa, na ordem em que apareceram. */
export function artifactsOf(messages: { role: string; text: string; at: number }[]) {
  const list: Artifact[] = [];
  messages.forEach((message, messageIndex) => {
    if (message.role !== "assistant") return;
    let blockIndex = 0;
    const visit = (blocks: Block[]) => {
      for (const block of blocks) {
        if (block.kind === "code") {
          const index = blockIndex;
          blockIndex += 1;
          if (block.open || !isArtifact(block.lang, block.text)) continue;
          const kind = artifactKind(block.lang, block.text);
          list.push({
            id: `${message.at}-${messageIndex}-${index}`,
            kind,
            lang: block.lang,
            title: artifactTitle(kind, block.lang, block.text),
            text: block.text,
          });
        } else if (block.kind === "quote") visit(block.children);
        else if (block.kind === "list") block.items.forEach(visit);
      }
    };
    visit(parseMarkdown(message.text));
  });
  return list;
}

/** Documento da prévia: HTML como veio; SVG centralizado numa página sem script. */
export function previewDocument(artifact: Pick<Artifact, "kind" | "text">) {
  if (artifact.kind === "svg") {
    return (
      "<!doctype html><meta charset=utf-8>" +
      "<meta http-equiv=Content-Security-Policy content=\"default-src 'none'; img-src data:; style-src 'unsafe-inline'\">" +
      "<style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#fff}" +
      "svg{max-width:100%;max-height:100vh}</style>" +
      artifact.text
    );
  }
  return artifact.text;
}
