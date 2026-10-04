// Tema da página por domínio (4.7): Lightning (original), Dark ou Auto (segue o
// prefers-color-scheme do sistema). O escuro é CSS do próprio Chromium (insertCSS): a
// página inteira passa por invert + hue-rotate (luminância invertida, matiz e saturação
// preservados) e mídia, canvas, iframes e logos voltam ao original. Nada de script de
// terceiro; o ajuste fino (logos, fundos com imagem, contraste WCAG AA) roda no mundo
// isolado PAGE_THEME_WORLD, só lendo estilos e marcando atributos.

const PAGE_THEME_WORLD = 4134;
const MODES = ["lightning", "dark", "auto"];

// Sufixos de dois níveis mais comuns (sem a lista pública inteira): "a.b.com.br" →
// "b.com.br". Hosts fora daqui usam os dois últimos rótulos.
const SECOND_LEVEL = new Set([
  "com.br",
  "net.br",
  "org.br",
  "gov.br",
  "edu.br",
  "art.br",
  "blog.br",
  "eco.br",
  "app.br",
  "co.uk",
  "org.uk",
  "ac.uk",
  "gov.uk",
  "me.uk",
  "ltd.uk",
  "plc.uk",
  "com.au",
  "net.au",
  "org.au",
  "edu.au",
  "gov.au",
  "co.jp",
  "ne.jp",
  "or.jp",
  "ac.jp",
  "go.jp",
  "co.nz",
  "org.nz",
  "co.za",
  "org.za",
  "co.in",
  "net.in",
  "org.in",
  "gov.in",
  "com.ar",
  "com.mx",
  "com.co",
  "com.pe",
  "com.uy",
  "com.py",
  "com.bo",
  "com.ec",
  "com.ve",
  "com.pt",
  "com.es",
  "com.tr",
  "com.cn",
  "com.hk",
  "com.tw",
  "com.sg",
  "com.my",
  "co.kr",
  "or.kr",
  "co.il",
  "co.id",
  "github.io",
  "gitlab.io",
  "blogspot.com",
  "herokuapp.com",
  "vercel.app",
  "netlify.app",
  "pages.dev",
  "web.app",
  "firebaseapp.com",
  "appspot.com",
  "azurewebsites.net",
  "cloudfront.net",
  "s3.amazonaws.com",
  "workers.dev",
  "fly.dev",
  "onrender.com",
]);

/** Domínio registrável ("www.a.example.com" → "example.com"); null sem domínio. */
function registrableDomain(host) {
  const value = String(host || "")
    .toLowerCase()
    .replace(/\.$/, "");
  if (!value || value.length > 253) return null;
  // IP (v4/v6) e localhost: o próprio host.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value) || value.includes(":") || !value.includes(".")) {
    return value || null;
  }
  const labels = value.split(".");
  if (labels.some((label) => !label)) return null;
  const lastTwo = labels.slice(-2).join(".");
  if (labels.length >= 3 && SECOND_LEVEL.has(lastTwo)) return labels.slice(-3).join(".");
  return lastTwo;
}

/** Domínio da URL de uma página com tema (http/https); null para o resto. */
function themeDomainOf(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return registrableDomain(parsed.hostname);
  } catch {
    return null;
  }
}

function cleanMode(value) {
  return MODES.includes(value) ? value : null;
}

/** Mapa gravado → só domínios válidos com modo diferente do padrão. */
function parseThemeMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [domain, mode] of Object.entries(raw).slice(0, 5000)) {
    const clean = registrableDomain(domain);
    const value = cleanMode(mode);
    if (clean && value && value !== "lightning") out[clean] = value;
  }
  return out;
}

function modeOf(map, domain) {
  return (domain && map[domain]) || "lightning";
}

/** O CSS escuro vale agora? Auto segue o sistema. */
function isDarkMode(mode, systemDark) {
  return mode === "dark" || (mode === "auto" && Boolean(systemDark));
}

/** Clique no botão: Lightning ↔ Dark (Auto vira o oposto do que está na tela). */
function nextMode(mode, systemDark) {
  return isDarkMode(mode, systemDark) ? "lightning" : "dark";
}

const FILTER = "invert(1) hue-rotate(180deg)";
// O que volta ao original: mídia, canvas, iframes (inclusive os de outro site), o que a
// página marcar com data-agzos-no-theme e o que o ajuste marcou (logos, fundos com
// imagem, trechos que perderiam contraste). Dentro de algo que já voltou, não inverte de
// novo. Em tela cheia o vídeo fica fora do filtro da página.
const KEEP = [
  "img",
  "video",
  "canvas",
  "picture",
  "iframe",
  "embed",
  "object",
  "svg image",
  "[data-agzos-no-theme]",
  "[data-agzos-keep]",
].join(", ");

const DARK_CSS = `html { filter: ${FILTER} !important; }
:is(${KEEP}):not(:is(picture, [data-agzos-no-theme], [data-agzos-keep]) *) { filter: ${FILTER} !important; }
:fullscreen, :fullscreen * { filter: none !important; }`;

// Origem "user", sem !important: só vale quando a página não pinta o fundo (senão o
// fundo transparente continuaria branco por fora do filtro).
const BASE_CSS = "html { background-color: #ffffff; }";

/**
 * Script do mundo isolado (só lê estilos e marca atributos). Marca logos e fundos com
 * imagem para voltarem ao original e confere o contraste dos textos depois da inversão:
 * se ficar abaixo do WCAG AA (4,5:1) e antes não ficava, o bloco volta ao original.
 * Devolve quantos blocos voltaram por contraste.
 */
function pageThemeAdjustSource() {
  return `(() => {
  const MAX_NODES = 2500;
  const keep = (el) => el.setAttribute("data-agzos-keep", "");
  const parse = (value) => {
    const m = /rgba?\\(([\\d.]+)[ ,]+([\\d.]+)[ ,]+([\\d.]+)(?:[ ,/]+([\\d.]+%?))?\\)/.exec(value || "");
    if (!m) return null;
    let a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (m[4] && m[4].endsWith("%")) a = a / 100;
    return { r: +m[1], g: +m[2], b: +m[3], a };
  };
  // invert(1) seguido de hue-rotate(180deg) (matrizes do Filter Effects).
  const H = [
    [-0.574, 1.43, 0.144],
    [0.426, 0.43, 0.144],
    [0.426, 1.43, -0.856],
  ];
  const clamp = (v) => Math.min(255, Math.max(0, v));
  const filtered = (c) => {
    const i = [255 - c.r, 255 - c.g, 255 - c.b];
    return {
      r: clamp(H[0][0] * i[0] + H[0][1] * i[1] + H[0][2] * i[2]),
      g: clamp(H[1][0] * i[0] + H[1][1] * i[1] + H[1][2] * i[2]),
      b: clamp(H[2][0] * i[0] + H[2][1] * i[1] + H[2][2] * i[2]),
    };
  };
  const lum = (c) => {
    const ch = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  };
  const ratio = (a, b) => {
    const x = lum(a), y = lum(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const bgOf = (el) => {
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0.5) return { color: c, owner: node };
    }
    return { color: { r: 255, g: 255, b: 255, a: 1 }, owner: null };
  };
  const all = document.body ? document.body.getElementsByTagName("*") : [];
  let seen = 0;
  let reverted = 0;
  const owners = new Set();
  for (const el of all) {
    if (++seen > MAX_NODES) break;
    if (el.closest("[data-agzos-keep], [data-agzos-no-theme]")) continue;
    const style = getComputedStyle(el);
    // Fundo com imagem (foto, banner): volta ao original.
    if (/url\\(/.test(style.backgroundImage) && !/gradient/.test(style.backgroundImage)) {
      const rect = el.getBoundingClientRect();
      if (rect.width * rect.height > 24 * 24) {
        keep(el);
        continue;
      }
    }
    // Logo em SVG colorido (duas ou mais cores com saturação): volta ao original.
    if (el.tagName === "svg") {
      const colors = new Set();
      for (const part of el.querySelectorAll("[fill], path, circle, rect, polygon")) {
        const c = parse(getComputedStyle(part).fill);
        if (!c) continue;
        const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b);
        if (max - min > 60) colors.add(c.r + "," + c.g + "," + c.b);
        if (colors.size >= 2) break;
      }
      if (colors.size >= 2) keep(el);
      continue;
    }
    // Contraste: só elementos com texto próprio.
    let text = false;
    for (const child of el.childNodes) {
      if (child.nodeType === 3 && child.textContent.trim()) {
        text = true;
        break;
      }
    }
    if (!text) continue;
    const fg = parse(style.color);
    if (!fg || fg.a < 0.5) continue;
    const { color: bg, owner } = bgOf(el);
    const before = ratio(fg, bg);
    const after = ratio(filtered(fg), filtered(bg));
    if (after < 4.5 && before >= 4.5) {
      const target = owner && owner !== document.body && owner !== document.documentElement ? owner : el;
      if (!owners.has(target)) {
        owners.add(target);
        keep(target);
        reverted += 1;
      }
    }
  }
  return reverted;
})()`;
}

/** Tira as marcas do ajuste (voltar ao Lightning). */
function pageThemeResetSource() {
  return `(() => { for (const el of document.querySelectorAll("[data-agzos-keep]")) el.removeAttribute("data-agzos-keep"); return true; })()`;
}

module.exports = {
  BASE_CSS,
  DARK_CSS,
  MODES,
  PAGE_THEME_WORLD,
  cleanMode,
  isDarkMode,
  modeOf,
  nextMode,
  pageThemeAdjustSource,
  pageThemeResetSource,
  parseThemeMap,
  registrableDomain,
  themeDomainOf,
};
