// Modo leitura (4.5): extrai título e corpo do artigo da guia (num mundo isolado, sem
// mexer na página) e devolve blocos estruturados. A casca desenha esses blocos com
// tipografia larga, sem o menu do site; sair só tira a capa e a página original volta.
// Nada de HTML cru: só texto, links http(s) e imagens http(s)/data.

const READER_WORLD = 4133;
const LIMITS = { blocks: 1500, text: 20_000, title: 300 };

/** Blocos vindos da página → só o formato esperado (a página pode ter sido adulterada). */
function cleanArticle(value) {
  if (!value || typeof value !== "object") return null;
  const text = (item, max = LIMITS.text) => (typeof item === "string" ? item.slice(0, max) : "");
  const safeUrl = (url, images = false) => {
    const href = text(url, 4000);
    if (/^https?:\/\//i.test(href)) return href;
    if (images && /^data:image\/(png|jpe?g|gif|webp|avif);base64,/i.test(href)) return href;
    return null;
  };
  const inline = (list) =>
    (Array.isArray(list) ? list : [])
      .slice(0, 400)
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const content = text(item.text);
        if (!content) return null;
        const kind = ["text", "strong", "em", "code", "link"].includes(item.kind)
          ? item.kind
          : "text";
        if (kind === "link") {
          const href = safeUrl(item.href);
          return href ? { kind, text: content, href } : { kind: "text", text: content };
        }
        return { kind, text: content };
      })
      .filter(Boolean);
  const blocks = [];
  for (const block of Array.isArray(value.blocks) ? value.blocks : []) {
    if (!block || typeof block !== "object") continue;
    if (block.kind === "heading") {
      const level = Math.min(6, Math.max(2, Number(block.level) || 2));
      const children = inline(block.children);
      if (children.length) blocks.push({ kind: "heading", level, children });
    } else if (block.kind === "paragraph" || block.kind === "quote") {
      const children = inline(block.children);
      if (children.length) blocks.push({ kind: block.kind, children });
    } else if (block.kind === "list") {
      const items = (Array.isArray(block.items) ? block.items : [])
        .slice(0, 200)
        .map(inline)
        .filter((item) => item.length);
      if (items.length) blocks.push({ kind: "list", ordered: Boolean(block.ordered), items });
    } else if (block.kind === "code") {
      const content = text(block.text);
      if (content.trim()) blocks.push({ kind: "code", text: content });
    } else if (block.kind === "image") {
      const src = safeUrl(block.src, true);
      if (src)
        blocks.push({
          kind: "image",
          src,
          alt: text(block.alt, 300),
          caption: text(block.caption, 600),
        });
    }
    if (blocks.length >= LIMITS.blocks) break;
  }
  const title = text(value.title, LIMITS.title).trim();
  if (!blocks.length) return null;
  const words = blocks
    .flatMap((block) =>
      block.kind === "list"
        ? block.items.flat()
        : (block.children ?? (block.kind === "code" ? [{ text: block.text }] : [])),
    )
    .reduce((sum, item) => sum + (item.text.match(/\S+/g)?.length ?? 0), 0);
  return {
    title: title || "Artigo",
    byline: text(value.byline, 200).trim(),
    site: text(value.site, 120).trim(),
    lang: /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(String(value.lang ?? "")) ? value.lang : "",
    url: safeUrl(value.url) ?? "",
    words,
    minutes: Math.max(1, Math.round(words / 220)),
    blocks,
  };
}

/** Roda na página (mundo isolado): acha o corpo do artigo e devolve os blocos. */
function readerPageScript() {
  const UNLIKELY =
    /(^|[\s_-])(nav|menu|header|footer|sidebar|aside|comment|share|social|related|promo|advert|ads?|banner|cookie|newsletter|subscribe|breadcrumb|popup|modal|widget|sponsor)([\s_-]|$)/i;
  const SKIP_TAGS = new Set([
    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "TEMPLATE",
    "IFRAME",
    "FORM",
    "BUTTON",
    "INPUT",
    "SELECT",
    "TEXTAREA",
    "NAV",
    "FOOTER",
    "ASIDE",
    "SVG",
    "CANVAS",
    "VIDEO",
    "AUDIO",
    "OBJECT",
    "EMBED",
  ]);
  const hidden = (node) => {
    if (node.hidden || node.getAttribute("aria-hidden") === "true") return true;
    const style = getComputedStyle(node);
    return style.display === "none" || style.visibility === "hidden";
  };
  const unlikely = (node) => {
    if (node.matches("article, main, [role=main], [itemprop=articleBody]")) return false;
    const role = node.getAttribute("role") ?? "";
    if (/navigation|banner|contentinfo|complementary|dialog/.test(role)) return true;
    return UNLIKELY.test(
      `${node.className && typeof node.className === "string" ? node.className : ""} ${node.id}`,
    );
  };

  // Raiz: o <article> com mais texto, senão a pontuação dos parágrafos (estilo Readability).
  const textLength = (node) => (node.innerText || "").trim().length;
  let root = null;
  const articles = [...document.querySelectorAll("article, [itemprop=articleBody], main article")]
    .filter((node) => !hidden(node))
    .sort((a, b) => textLength(b) - textLength(a));
  if (articles[0] && textLength(articles[0]) > 400) root = articles[0];
  if (!root) {
    const scores = new Map();
    for (const paragraph of document.querySelectorAll("p, pre, blockquote")) {
      const length = (paragraph.innerText || "").trim().length;
      if (length < 40) continue;
      const score =
        1 +
        (paragraph.innerText.match(/[,;]/g)?.length ?? 0) +
        Math.min(3, Math.floor(length / 100));
      let parent = paragraph.parentElement;
      for (let depth = 0; parent && depth < 3; depth += 1) {
        if (unlikely(parent)) break;
        scores.set(parent, (scores.get(parent) ?? 0) + score / (depth + 1));
        parent = parent.parentElement;
      }
    }
    let best = 0;
    for (const [node, score] of scores) {
      if (score > best) {
        best = score;
        root = node;
      }
    }
  }
  root ??= document.querySelector("main, [role=main]") ?? document.body;

  const absolute = (url) => {
    try {
      return new URL(url, document.baseURI).href;
    } catch {
      return "";
    }
  };
  const inlineOf = (node) => {
    const out = [];
    const push = (kind, text, href) => {
      const clean = text.replace(/\s+/g, " ");
      if (!clean) return;
      const last = out[out.length - 1];
      if (last && last.kind === kind && kind === "text") last.text += clean;
      else out.push(href ? { kind, text: clean, href } : { kind, text: clean });
    };
    const walk = (current, mark) => {
      for (const child of current.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) push(mark, child.textContent ?? "");
        else if (child.nodeType === Node.ELEMENT_NODE) {
          if (SKIP_TAGS.has(child.tagName) || hidden(child)) continue;
          if (child.tagName === "BR") push("text", " ");
          else if (child.tagName === "A" && child.getAttribute("href")) {
            push(
              "link",
              child.innerText || child.textContent || "",
              absolute(child.getAttribute("href")),
            );
          } else if (child.tagName === "STRONG" || child.tagName === "B") walk(child, "strong");
          else if (child.tagName === "EM" || child.tagName === "I") walk(child, "em");
          else if (child.tagName === "CODE") push("code", child.textContent ?? "");
          else walk(child, mark);
        }
      }
    };
    walk(node, "text");
    if (out[0]) out[0].text = out[0].text.replace(/^\s+/, "");
    const last = out[out.length - 1];
    if (last) last.text = last.text.replace(/\s+$/, "");
    return out.filter((item) => item.text);
  };

  const blocks = [];
  const title =
    document.querySelector('meta[property="og:title"]')?.getAttribute("content") ||
    root.querySelector("h1")?.innerText ||
    document.querySelector("h1")?.innerText ||
    document.title;
  const normalizedTitle = (title || "").trim().toLowerCase();
  const imageOf = (img, caption = "") => {
    const src = img.currentSrc || img.src || img.getAttribute("data-src") || "";
    const width = img.naturalWidth || img.width || 0;
    if (!src || (width && width < 80)) return;
    blocks.push({ kind: "image", src: absolute(src), alt: img.alt || "", caption });
  };
  const visit = (node) => {
    for (const child of node.children) {
      if (blocks.length >= 1500) return;
      if (SKIP_TAGS.has(child.tagName) || hidden(child) || unlikely(child)) continue;
      const tag = child.tagName;
      if (/^H[1-6]$/.test(tag)) {
        const children = inlineOf(child);
        const text = children
          .map((item) => item.text)
          .join("")
          .trim()
          .toLowerCase();
        // O título já vai no topo; o h1 repetido some.
        if (children.length && text !== normalizedTitle) {
          blocks.push({ kind: "heading", level: Math.max(2, Number(tag[1])), children });
        }
      } else if (tag === "P") {
        const children = inlineOf(child);
        if (children.length) blocks.push({ kind: "paragraph", children });
        for (const img of child.querySelectorAll("img")) imageOf(img);
      } else if (tag === "UL" || tag === "OL") {
        const items = [...child.children]
          .filter((item) => item.tagName === "LI" && !hidden(item))
          .map((item) => inlineOf(item))
          .filter((item) => item.length);
        if (items.length) blocks.push({ kind: "list", ordered: tag === "OL", items });
      } else if (tag === "BLOCKQUOTE") {
        const children = inlineOf(child);
        if (children.length) blocks.push({ kind: "quote", children });
      } else if (tag === "PRE") {
        blocks.push({ kind: "code", text: child.innerText || child.textContent || "" });
      } else if (tag === "FIGURE") {
        const caption = child.querySelector("figcaption")?.innerText ?? "";
        const img = child.querySelector("img");
        if (img) imageOf(img, caption);
      } else if (tag === "IMG") {
        imageOf(child);
      } else {
        // Contêiner (div, section…): texto solto vira parágrafo; o resto desce.
        const hasBlocks = child.querySelector(
          "p, h1, h2, h3, h4, h5, h6, ul, ol, pre, blockquote, figure, img, div, section",
        );
        if (hasBlocks) visit(child);
        else {
          const children = inlineOf(child);
          if (
            children
              .map((item) => item.text)
              .join("")
              .trim().length > 30
          ) {
            blocks.push({ kind: "paragraph", children });
          }
        }
      }
    }
  };
  visit(root);
  return {
    title,
    byline:
      document.querySelector('meta[name="author"]')?.getAttribute("content") ||
      root.querySelector('[rel="author"], .byline, .author, [itemprop="author"]')?.innerText ||
      "",
    site:
      document.querySelector('meta[property="og:site_name"]')?.getAttribute("content") ||
      location.hostname,
    lang: document.documentElement.lang || "",
    url: location.href,
    blocks,
  };
}

/**
 * Teste rápido (4.6): a página tem um artigo para ler? Parágrafos de verdade (texto
 * longo, fora de menus) dentro de <article>/<main> ou soltos. Decide se o caderno do modo
 * leitura aparece na barra de URL.
 */
function readerProbeScript() {
  if (!/^https?:$/.test(location.protocol) || !document.body) return false;
  const root =
    document.querySelector("article, [itemprop=articleBody], main, [role=main]") ?? document.body;
  let paragraphs = 0;
  let chars = 0;
  for (const paragraph of root.querySelectorAll("p")) {
    if (paragraph.closest("nav, header, footer, aside, form, [role=navigation]")) continue;
    const length = (paragraph.textContent || "").trim().length;
    if (length < 80) continue;
    paragraphs += 1;
    chars += length;
    if (paragraphs >= 3 && chars >= 450) return true;
  }
  return false;
}

function readerProbeSource() {
  return `(${readerProbeScript.toString()})()`;
}

function readerSource() {
  return `(${readerPageScript.toString()})()`;
}

module.exports = { READER_WORLD, cleanArticle, readerProbeSource, readerSource };
