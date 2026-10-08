// Mira de elemento (4.5, Ctrl+Shift+C): sem abrir o DevTools, o clique num elemento mostra
// as cores em HEX, a fonte e uma sugestão de classes Tailwind para copiar. É sugestão a
// partir do estilo calculado (getComputedStyle), não o CSS original do site. Roda num
// mundo isolado da página: o site não vê nem mexe na mira.

const INSPECTOR_WORLD = 4132;

/** "rgb(209, 10, 17)" / "rgba(0, 0, 0, 0.5)" / "rgb(209 10 17 / 50%)" → "#D10A11" (+ alfa). */
function rgbToHex(value) {
  const match =
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(
      String(value ?? "").trim(),
    );
  if (!match) return null;
  const channel = (text) => Math.max(0, Math.min(255, Math.round(Number(text))));
  let alpha = 1;
  if (match[4] !== undefined) {
    alpha = match[4].endsWith("%") ? Number(match[4].slice(0, -1)) / 100 : Number(match[4]);
  }
  if (!Number.isFinite(alpha) || alpha <= 0) return null;
  const hex = [match[1], match[2], match[3]]
    .map((part) => channel(part).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
  return alpha >= 1
    ? `#${hex}`
    : `#${hex}${Math.round(alpha * 255)
        .toString(16)
        .padStart(2, "0")
        .toUpperCase()}`;
}

/**
 * Estilo calculado (só as propriedades usadas) → classes Tailwind. Valores da escala
 * padrão viram a classe da escala (text-sm, p-4, rounded-lg); o resto vira valor
 * arbitrário (text-[#d10a11], p-[13px]), que o Tailwind aceita como está.
 */
function tailwindFor(style) {
  const classes = [];
  const px = (value) => {
    const number = Number.parseFloat(String(value ?? ""));
    return Number.isFinite(number) ? number : null;
  };
  const color = (prefix, value) => {
    const hex = rgbToHex(value);
    if (!hex) return;
    if (hex === "#FFFFFF") classes.push(`${prefix}-white`);
    else if (hex === "#000000") classes.push(`${prefix}-black`);
    else classes.push(`${prefix}-[${hex.toLowerCase()}]`);
  };
  color("text", style.color);
  color("bg", style.backgroundColor);
  if (px(style.borderTopWidth)) color("border", style.borderTopColor);

  const sizes = {
    12: "xs",
    14: "sm",
    16: "base",
    18: "lg",
    20: "xl",
    24: "2xl",
    30: "3xl",
    36: "4xl",
    48: "5xl",
    60: "6xl",
    72: "7xl",
    96: "8xl",
    128: "9xl",
  };
  const fontSize = px(style.fontSize);
  if (fontSize) {
    const rounded = Math.round(fontSize * 100) / 100;
    classes.push(sizes[rounded] ? `text-${sizes[rounded]}` : `text-[${rounded}px]`);
  }
  const weights = {
    100: "thin",
    200: "extralight",
    300: "light",
    400: "normal",
    500: "medium",
    600: "semibold",
    700: "bold",
    800: "extrabold",
    900: "black",
  };
  const weight = Number(style.fontWeight);
  if (weights[weight] && weight !== 400) classes.push(`font-${weights[weight]}`);
  if (style.fontStyle === "italic") classes.push("italic");
  const family = String(style.fontFamily ?? "")
    .split(",")[0]
    ?.trim()
    .replace(/^["']|["']$/g, "");
  const generic = { "sans-serif": "font-sans", serif: "font-serif", monospace: "font-mono" };
  if (family && generic[family]) classes.push(generic[family]);
  else if (family && /^[\w -]{1,40}$/.test(family))
    classes.push(`font-['${family.replace(/ /g, "_")}']`);
  const align = { center: "text-center", right: "text-right", justify: "text-justify" };
  if (align[style.textAlign]) classes.push(align[style.textAlign]);
  if (style.textTransform === "uppercase") classes.push("uppercase");

  // Espaçamento: a escala do Tailwind anda de 4 em 4 px (p-1 = 4px).
  const spacing = (prefix, value) => {
    const number = px(value);
    if (number === null || number === 0) return null;
    const step = number / 4;
    return Number.isInteger(step) || step * 2 === Math.round(step * 2)
      ? step <= 96
        ? `${prefix}-${step}`
        : `${prefix}-[${number}px]`
      : `${prefix}-[${Math.round(number * 100) / 100}px]`;
  };
  const box = (prefix, top, right, bottom, left) => {
    if (top === bottom && left === right && top === left) {
      const item = spacing(prefix, top);
      if (item) classes.push(item);
      return;
    }
    if (top === bottom && left === right) {
      for (const item of [spacing(`${prefix}y`, top), spacing(`${prefix}x`, left)]) {
        if (item) classes.push(item);
      }
      return;
    }
    for (const [side, value] of [
      ["t", top],
      ["r", right],
      ["b", bottom],
      ["l", left],
    ]) {
      const item = spacing(`${prefix}${side}`, value);
      if (item) classes.push(item);
    }
  };
  box("p", style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft);
  box("m", style.marginTop, style.marginRight, style.marginBottom, style.marginLeft);

  const radius = px(style.borderTopLeftRadius);
  if (radius) {
    const radii = {
      2: "rounded-sm",
      4: "rounded",
      6: "rounded-md",
      8: "rounded-lg",
      12: "rounded-xl",
      16: "rounded-2xl",
      24: "rounded-3xl",
    };
    classes.push(radius >= 9999 ? "rounded-full" : (radii[radius] ?? `rounded-[${radius}px]`));
  }
  const display = {
    flex: "flex",
    grid: "grid",
    "inline-flex": "inline-flex",
    "inline-block": "inline-block",
    none: "hidden",
  };
  if (display[style.display]) classes.push(display[style.display]);
  return [...new Set(classes)];
}

/** Cores do elemento (texto, fundo, borda) em HEX, sem repetir e sem transparentes. */
function colorsOf(style) {
  const list = [];
  const add = (label, value) => {
    const hex = rgbToHex(value);
    if (hex && !list.some((item) => item.hex === hex && item.label === label))
      list.push({ label, hex });
  };
  add("Texto", style.color);
  add("Fundo", style.backgroundColor);
  if (Number.parseFloat(String(style.borderTopWidth ?? "")) > 0) add("Borda", style.borderTopColor);
  return list;
}

/**
 * Roda na página (mundo isolado). Liga a mira ou, se já estiver ligada, desliga.
 * Devolve true quando ficou ligada.
 */
function inspectorPageScript(rgbToHexFn, tailwindForFn, colorsOfFn, devtoolsToken) {
  const KEY = "__agzosInspector";
  if (window[KEY]) {
    window[KEY].stop();
    return false;
  }
  const host = document.createElement("agzos-inspector");
  host.style.cssText =
    "all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;";
  const root = host.attachShadow({ mode: "closed" });
  // DOM montado à mão (sem innerHTML): páginas com Trusted Types recusam HTML em texto.
  const el = (tag, attrs = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) {
      if (name === "text") node.textContent = value;
      else if (name === "style") node.style.cssText = value;
      else node.setAttribute(name, value);
    }
    for (const child of children) if (child) node.appendChild(child);
    return node;
  };
  root.appendChild(
    el("style", {
      text: `
      .box { position: fixed; pointer-events: none; border: 2px solid #D10A11; background: rgba(209,10,17,.08); border-radius: 2px; }
      .tag { position: fixed; pointer-events: none; font: 600 11px/1.6 ui-monospace, monospace; color: #fff; background: #D10A11; padding: 0 6px; border-radius: 3px; white-space: nowrap; }
      .hint { position: fixed; left: 50%; top: 10px; transform: translateX(-50%); pointer-events: none; font: 500 12px/1.4 system-ui, sans-serif; color: #fff; background: rgba(20,20,20,.92); padding: 6px 12px; border-radius: 999px; }
      .card { position: fixed; pointer-events: auto; width: 320px; max-width: calc(100vw - 16px); box-sizing: border-box; font: 13px/1.45 system-ui, sans-serif; color: #f5f5f5; background: #161616; border: 1px solid #333; border-radius: 10px; box-shadow: 0 12px 32px rgba(0,0,0,.45); padding: 12px; }
      .title { display: block; font: 600 12px/1.4 ui-monospace, monospace; color: #ff8a8f; margin-bottom: 8px; word-break: break-all; }
      .row { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
      .row code { flex: 1; }
      .sw { width: 18px; height: 18px; border-radius: 4px; border: 1px solid #555; flex: none; }
      .label { color: #aaa; min-width: 44px; }
      code { font: 12px/1.4 ui-monospace, monospace; color: #fff; }
      .tw { display: block; margin: 8px 0 6px; padding: 8px; background: #0d0d0d; border: 1px solid #2a2a2a; border-radius: 6px; word-break: break-word; }
      button { all: unset; cursor: pointer; font: 600 12px/1 system-ui, sans-serif; color: #fff; background: #D10A11; padding: 6px 10px; border-radius: 6px; }
      button.ghost { background: transparent; color: #ccc; border: 1px solid #444; }
      button:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
      .actions { display: flex; gap: 6px; justify-content: flex-end; margin-top: 8px; }
      small { display: block; color: #8a8a8a; font-size: 11px; margin-top: 6px; }`,
    }),
  );
  root.appendChild(el("div", { class: "box", hidden: "" }));
  root.appendChild(el("div", { class: "tag", hidden: "" }));
  root.appendChild(
    el("div", { class: "hint", text: "Mira ligada: clique num elemento · Esc sai" }),
  );
  const box = root.querySelector(".box");
  const tag = root.querySelector(".tag");
  let card = null;
  let current = null;

  const copy = (text, button) => {
    const done = () => {
      const label = button.textContent;
      button.textContent = "Copiado";
      setTimeout(() => (button.textContent = label), 1200);
    };
    const fallback = () => {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.cssText = "position:fixed;left:-9999px;top:0;";
      document.documentElement.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
        done();
      } finally {
        area.remove();
      }
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  };

  const label = (element) => {
    let text = element.tagName.toLowerCase();
    if (element.id) text += `#${element.id}`;
    const classes = [...element.classList].slice(0, 3);
    if (classes.length) text += `.${classes.join(".")}`;
    return text;
  };

  const highlight = (element) => {
    if (!element || element === host) return;
    const rect = element.getBoundingClientRect();
    box.hidden = false;
    tag.hidden = false;
    Object.assign(box.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    tag.textContent = `${label(element)}  ${Math.round(rect.width)}×${Math.round(rect.height)}`;
    tag.style.left = `${Math.max(4, rect.left)}px`;
    tag.style.top = `${rect.top > 24 ? rect.top - 22 : rect.bottom + 4}px`;
  };

  const show = (element, x, y) => {
    card?.remove();
    const style = getComputedStyle(element);
    const colors = colorsOfFn(style);
    const classes = tailwindForFn(style).join(" ");
    const family = style.fontFamily
      .split(",")[0]
      .trim()
      .replace(/^["']|["']$/g, "");
    const copyButton = (text, caption, ghost) => {
      const button = el("button", { type: "button", class: ghost ? "ghost" : "" });
      button.textContent = caption;
      button.addEventListener("click", () => copy(text, button));
      return button;
    };
    const close = el("button", { type: "button", class: "ghost", text: "Fechar" });
    close.addEventListener("click", () => {
      card?.remove();
      card = null;
    });
    const copyClasses = copyButton(classes, "Copiar classes", false);
    // 4.8: "Abrir no DevTools" sai da mira e pede ao main o DevTools neste elemento. O
    // aviso vai pelo console do mundo isolado com o token desta ligação (a página não o
    // vê nem consegue imitar).
    let inspectButton = null;
    if (devtoolsToken) {
      inspectButton = el("button", { type: "button", class: "ghost", text: "Abrir no DevTools" });
      inspectButton.addEventListener("click", () => {
        const rect = element.getBoundingClientRect();
        const point = {
          x: Math.round(rect.left + Math.min(rect.width / 2, 8)),
          y: Math.round(rect.top + Math.min(rect.height / 2, 8)),
        };
        stop();
        console.debug(`agzos-devtools:${devtoolsToken}:${JSON.stringify(point)}`);
      });
    }
    card = el("div", { class: "card", role: "dialog", "aria-label": "Mira de elemento" }, [
      el("span", { class: "title", text: label(element) }),
      ...colors.map((item) =>
        el("div", { class: "row" }, [
          el("span", { class: "sw", style: `background:${item.hex}` }),
          el("span", { class: "label", text: item.label }),
          el("code", { text: item.hex }),
          copyButton(item.hex, "Copiar", true),
        ]),
      ),
      el("div", { class: "row" }, [
        el("span", { class: "label", text: "Fonte" }),
        el("code", { text: `${family} · ${style.fontSize} · ${style.fontWeight}` }),
      ]),
      el("code", { class: "tw", text: classes || "(sem sugestão)" }),
      el("div", { class: "actions" }, [close, inspectButton, copyClasses]),
      el("small", { text: "Sugestão a partir do estilo calculado, não o CSS original do site." }),
    ]);
    root.appendChild(card);
    const width = 320;
    const left = Math.min(Math.max(8, x + 12), window.innerWidth - width - 8);
    const height = card.offsetHeight;
    const top = y + 12 + height > window.innerHeight ? Math.max(8, y - height - 12) : y + 12;
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    copyClasses.focus();
  };

  const inside = (event) => event.composedPath().includes(host);
  const onMove = (event) => {
    if (inside(event)) return;
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (element && element !== current) {
      current = element;
      highlight(element);
    }
  };
  const swallow = (event) => {
    if (inside(event)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const onClick = (event) => {
    if (inside(event)) return;
    swallow(event);
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (element && element !== host) show(element, event.clientX, event.clientY);
  };
  const onKey = (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (card) {
      card.remove();
      card = null;
    } else stop();
  };
  const onScroll = () => current && highlight(current);
  function stop() {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("mousedown", swallow, true);
    document.removeEventListener("mouseup", swallow, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", onScroll, true);
    host.remove();
    delete window[KEY];
  }
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("mousedown", swallow, true);
  document.addEventListener("mouseup", swallow, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", onScroll, true);
  document.documentElement.appendChild(host);
  // `root` só existe no mundo isolado (a página não vê): os testes leem o balão por ele.
  window[KEY] = { stop, root };
  return true;
}

/**
 * Código para executeJavaScriptInIsolatedWorld: liga/desliga a mira. Com `devtoolsToken`
 * (4.8, DevTools ligado), o cartão ganha "Abrir no DevTools".
 */
function inspectorSource({ devtoolsToken = null } = {}) {
  const token =
    typeof devtoolsToken === "string" && /^[a-f0-9]{16,64}$/.test(devtoolsToken)
      ? JSON.stringify(devtoolsToken)
      : "null";
  // As três funções puras entram como declarações (colorsOf e tailwindFor usam rgbToHex).
  return `(() => {
${rgbToHex.toString()}
${tailwindFor.toString()}
${colorsOf.toString()}
return (${inspectorPageScript.toString()})(rgbToHex, tailwindFor, colorsOf, ${token});
})()`;
}

module.exports = { INSPECTOR_WORLD, colorsOf, inspectorSource, rgbToHex, tailwindFor };
