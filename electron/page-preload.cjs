// Preload das PÁGINAS (não da casca): roda no mundo isolado de cada guia, com acesso só a
// um canal de IPC. Faz duas coisas para o Agzos Key:
// - avisa o main quando a página tem um formulário de login (campo de senha, de usuário
//   ou de código MFA) e, principalmente, quando o usuário clica/foca num desses campos:
//   a casca busca no cofre e sugere o preenchimento na hora (como os navegadores
//   Chromium). Funciona em SPAs (campos que surgem depois) e em logins em etapas;
// - observa o envio do login (submit, Enter, botão "Entrar") e manda usuário/senha para
//   o main, que repassa para a casca oferecer "salvar no Agzos Key".
// Nenhuma senha fica guardada aqui: só é enviada uma vez, no envio, pelo IPC interno.
// E os gestos (4.0): deslizar com dois dedos, pinça, botões laterais do mouse e gestos
// desenhados com o botão direito (regras iguais às de src/features/gestures/gestures.ts).

const { ipcRenderer } = require("electron");

const PANEL = Array.isArray(process.argv) && process.argv.includes("--agzos-surface=panel");

const USER_RE =
  /e-?mail|login|user|usu[aá]rio|conta|account|identifier|cpf|celular|phone|telefone|acesso/i;
const OTP_RE =
  /one-?time|otp|totp|2fa|mfa|two.?factor|verifica|verification|token|c[oó]digo|\bcode\b|authenticator|autentica/i;
const SUBMIT_RE =
  /entrar|login|log in|logon|sign in|signin|acessar|continuar|continue|pr[oó]ximo|next|avan[cç]ar|verificar|verify|enviar|submit|confirmar/i;
const TEXT_TYPES = new Set(["text", "email", "tel", "number", ""]);

function hint(input) {
  return [
    input.name,
    input.id,
    input.getAttribute("autocomplete"),
    input.placeholder,
    input.getAttribute("aria-label"),
  ]
    .filter(Boolean)
    .join(" ");
}

function visible(el) {
  if (!el || !el.isConnected || el.disabled) return false;
  if (el.offsetWidth === 0 && el.offsetHeight === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

function isPassword(input) {
  return input instanceof HTMLInputElement && input.type === "password";
}

function isOtp(input) {
  if (!(input instanceof HTMLInputElement) || isPassword(input)) return false;
  if (!TEXT_TYPES.has(input.type)) return false;
  const auto = (input.getAttribute("autocomplete") || "").toLowerCase();
  if (auto === "one-time-code") return true;
  const text = hint(input);
  if (USER_RE.test(text) && !OTP_RE.test(text)) return false;
  const short = input.maxLength > 0 && input.maxLength <= 8;
  const numeric = /numeric|decimal/.test(input.inputMode || "") || input.type === "number";
  return OTP_RE.test(text) && (short || numeric || /otp|totp|2fa|mfa/i.test(text));
}

function isUsername(input) {
  if (!(input instanceof HTMLInputElement) || isPassword(input) || isOtp(input)) return false;
  if (!TEXT_TYPES.has(input.type)) return false;
  const auto = (input.getAttribute("autocomplete") || "").toLowerCase();
  if (auto.includes("username") || input.type === "email") return true;
  return USER_RE.test(hint(input));
}

function visibleInputs(root) {
  return Array.from((root || document).querySelectorAll("input")).filter(visible);
}

/** Códigos MFA divididos em várias caixinhas de 1 dígito (comum em bancos e SaaS). */
function splitOtpBoxes() {
  const boxes = visibleInputs().filter(
    (input) => !isPassword(input) && TEXT_TYPES.has(input.type) && input.maxLength === 1,
  );
  return boxes.length >= 4 && boxes.length <= 8 ? boxes : [];
}

function fieldKind(target) {
  if (!(target instanceof HTMLInputElement) || !visible(target)) return null;
  if (isPassword(target)) return "password";
  if (isOtp(target) || splitOtpBoxes().includes(target)) return "otp";
  if (!isUsername(target)) return null;
  // Usuário só conta como login se a página tem senha à vista ou o campo é claramente o
  // primeiro passo de um login em etapas (autocomplete username / e-mail no formulário).
  const auto = (target.getAttribute("autocomplete") || "").toLowerCase();
  // Campo dentro de web component: a senha costuma estar na mesma shadow root.
  const root = target.getRootNode();
  const hasPassword =
    visibleInputs().some(isPassword) ||
    (root instanceof ShadowRoot && visibleInputs(root).some(isPassword));
  const form = target.form;
  const formText = form ? `${form.id} ${form.name} ${form.action} ${form.className}` : "";
  if (hasPassword || auto.includes("username") || /login|signin|sign-in|auth/i.test(formText))
    return "username";
  // Formulário pequeno com e-mail e um botão de "continuar/entrar".
  const scope = form || target.closest("div, section, main") || document.body;
  const buttons = Array.from(scope.querySelectorAll("button, [type=submit], [role=button]"));
  return buttons.some((button) => SUBMIT_RE.test(buttonLabel(button))) ? "username" : null;
}

function buttonLabel(el) {
  return `${el.innerText || el.value || ""} ${el.getAttribute("aria-label") || ""} ${el.id || ""}`;
}

function send(channel, payload) {
  try {
    ipcRenderer.send(channel, payload);
  } catch {
    /* o main pode não estar ouvindo nesta janela: ignora */
  }
}

// --- Formulário de login à vista (aviso passivo) e foco num campo (aviso explícito) ---

let lastScan = "";
function scan() {
  const inputs = visibleInputs();
  const password = inputs.some(isPassword);
  const otp = inputs.some(isOtp) || splitOtpBoxes().length > 0;
  const username = !password && inputs.some((input) => fieldKind(input) === "username");
  const key = `${location.href}|${password}|${otp}|${username}`;
  if (key === lastScan) return;
  lastScan = key;
  if (!password && !otp && !username) return;
  send("agzos:login-form", {
    url: location.href,
    focused: false,
    field: password ? "password" : otp ? "otp" : "username",
  });
}

let scanTimer = null;
function scanSoon() {
  if (scanTimer || document.hidden) return;
  scanTimer = setTimeout(() => {
    scanTimer = null;
    scan();
  }, 600);
}

// Foco que vale como "o usuário clicou no campo": logo depois de um clique, toque ou Tab.
// Foco por script (autofocus, o próprio preenchimento do Agzos Key) não abre a sugestão.
let lastUserAt = 0;
function userActed(event) {
  if (event.type !== "keydown" || event.key === "Tab") lastUserAt = Date.now();
}

let lastFocus = { el: null, at: 0 };
function onFocus(event) {
  if (Date.now() - lastUserAt > 1000) return;
  // Em web components (shadow DOM aberto) o evento chega com o host como alvo.
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  const target = path[0] instanceof HTMLInputElement ? path[0] : event.target;
  const kind = fieldKind(target);
  if (!kind) return;
  // O mesmo campo focado de novo em seguida (clique depois do foco): um aviso só.
  const now = Date.now();
  if (lastFocus.el === target && now - lastFocus.at < 400) return;
  lastFocus = { el: target, at: now };
  send("agzos:login-form", { url: location.href, focused: true, field: kind });
}

// --- Envio do login (salvar no Agzos Key) -------------------------------------

// Login em etapas (e-mail numa tela, senha na outra, na mesma página): guarda o último
// usuário digitado para juntar com a senha no envio.
let lastUsername = "";
function rememberUsername(event) {
  const target = event.target;
  if (target instanceof HTMLInputElement && isUsername(target) && target.value)
    lastUsername = target.value;
}

/** Melhor palpite para o campo de usuário perto de um campo de senha. */
function findUsername(scope, passwordField) {
  const inputs = Array.from(scope.querySelectorAll("input")).filter(
    (input) => visible(input) || input.value,
  );
  const explicit = inputs.find(
    (input) =>
      input.value &&
      !isPassword(input) &&
      /username|email/i.test(input.getAttribute("autocomplete") || ""),
  );
  if (explicit) return explicit.value;
  const email = inputs.find((input) => input.type === "email" && input.value);
  if (email) return email.value;
  // Senão, o último campo de texto antes da senha com cara de login.
  const passIndex = inputs.indexOf(passwordField);
  for (let i = passIndex - 1; i >= 0; i--) {
    const input = inputs[i];
    if (TEXT_TYPES.has(input.type) && input.value && !isOtp(input)) {
      if (USER_RE.test(hint(input)) || i === passIndex - 1) return input.value;
    }
  }
  return lastUsername;
}

let lastSent = "";
function capture(scope) {
  const root = scope || document;
  const password =
    Array.from(root.querySelectorAll('input[type="password"]')).find((input) => input.value) ||
    (root !== document &&
      Array.from(document.querySelectorAll('input[type="password"]')).find((input) => input.value));
  if (!password) return;
  const username = findUsername(password.form || root, password) || lastUsername;
  // Submit + clique no botão disparam juntos: um aviso só.
  const key = `${username}\u0000${password.value}`;
  if (key === lastSent) return;
  lastSent = key;
  setTimeout(() => {
    if (lastSent === key) lastSent = "";
  }, 4000);
  send("agzos:page-login", { url: location.href, username, password: password.value });
}

function installLoginWatch() {
  // Submit normal (inclui Enter dentro do form).
  window.addEventListener(
    "submit",
    (event) => {
      const target = event.target;
      if (target && target.tagName === "FORM") capture(target);
    },
    true,
  );

  // Enter num campo de senha fora de <form> (páginas que logam por JS).
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Enter" && isPassword(event.target)) capture(event.target.form || document);
    },
    true,
  );

  // Botões de "entrar" em páginas que logam por JS (sem submit de form de verdade).
  window.addEventListener(
    "click",
    (event) => {
      const el =
        event.target instanceof Element
          ? event.target.closest("button, [type=submit], [role=button], a")
          : null;
      if (!el || !SUBMIT_RE.test(buttonLabel(el))) return;
      capture(el.closest("form") || document);
    },
    true,
  );

  window.addEventListener("pointerdown", userActed, true);
  window.addEventListener("keydown", userActed, true);
  window.addEventListener("focusin", onFocus, true);
  // Clique num campo que já tinha o foco (o usuário fechou a sugestão e clicou de novo).
  window.addEventListener(
    "pointerdown",
    (event) => {
      let active = document.activeElement;
      while (active && active.shadowRoot && active.shadowRoot.activeElement)
        active = active.shadowRoot.activeElement;
      const path = typeof event.composedPath === "function" ? event.composedPath() : [];
      if ((path[0] || event.target) === active) onFocus(event);
    },
    true,
  );
  window.addEventListener("input", rememberUsername, true);
  window.addEventListener("change", rememberUsername, true);

  function watch() {
    scan();
    // SPAs montam o formulário depois (e trocam de etapa sem navegar): reavalia em lote.
    new MutationObserver(scanSoon).observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["type", "hidden"],
    });
    window.addEventListener("popstate", scanSoon);
    window.addEventListener("hashchange", scanSoon);
    document.addEventListener("visibilitychange", scanSoon);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watch, { once: true });
  } else {
    watch();
  }
}

// Painéis laterais (WhatsApp, Discord…) carregam este preload só pelos gestos: o Agzos Key
// não observa login neles.
if (!PANEL) installLoginWatch();
installGestures();

// --- Gestos (4.0) ---------------------------------------------------------------

function installGestures() {
  // Mesmos limites de src/features/gestures/gestures.ts.
  const SWIPE_DISTANCE = 160;
  const SWIPE_GAP_MS = 220;
  const PINCH_STEP = 45;
  const STROKE_SEGMENT = 36;
  const STROKES = {
    L: "draw-left",
    R: "draw-right",
    UD: "draw-up-down",
    D: "draw-down",
    DR: "draw-down-right",
  };
  let config = { swipe: true, pinch: true, draw: true, mouse: true };
  ipcRenderer
    .invoke("gestures:get")
    .then((value) => {
      if (value && typeof value === "object") config = { ...config, ...value };
    })
    .catch(() => {});
  ipcRenderer.on("agzos:gestures-config", (_event, value) => {
    if (value && typeof value === "object") config = { ...config, ...value };
  });

  const gesture = (name, extra) => send("agzos:gesture", { gesture: name, ...extra });

  // Digitando num campo (tecla há pouco) ou selecionando texto: nada de gesto.
  let lastKeyAt = 0;
  window.addEventListener("keydown", () => (lastKeyAt = Date.now()), true);
  function editable(el) {
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
    return (
      el instanceof HTMLInputElement &&
      !/^(button|checkbox|radio|range|submit|reset|file|color|image)$/.test(el.type)
    );
  }
  const typing = () => Date.now() - lastKeyAt < 1500 && editable(document.activeElement);
  const selecting = () => {
    const selection = window.getSelection ? window.getSelection() : null;
    return Boolean(selection && !selection.isCollapsed && String(selection).trim());
  };

  // Deslizar: só quando ninguém no caminho do cursor ainda rola para aquele lado.
  function scrollsHorizontally(target, deltaX) {
    for (let el = target instanceof Element ? target : null; el; el = el.parentElement) {
      if (el.scrollWidth <= el.clientWidth + 1) continue;
      const overflow = getComputedStyle(el).overflowX;
      const root = el === document.scrollingElement || el === document.documentElement;
      if (!root && overflow !== "auto" && overflow !== "scroll") continue;
      if (deltaX < 0 ? el.scrollLeft > 0 : el.scrollLeft + el.clientWidth < el.scrollWidth - 1) {
        return true;
      }
    }
    return false;
  }

  let swipeTotal = 0;
  let swipeLast = 0;
  let swipeFired = false;
  let pinchTotal = 0;
  window.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey) {
        if (!config.pinch || event.deltaMode !== 0) return;
        // Ctrl+roda de mouse (passos inteiros grandes) é do Chromium; pinça vem em deltas finos.
        if (Math.abs(event.deltaY) >= 50 && Number.isInteger(event.deltaY)) return;
        // Página que trata a pinça (mapas, editores) fica com ela.
        setTimeout(() => {
          if (event.defaultPrevented) return;
          pinchTotal += event.deltaY;
          if (Math.abs(pinchTotal) < PINCH_STEP) return;
          gesture("pinch", { direction: pinchTotal < 0 ? 1 : -1 });
          pinchTotal = 0;
        }, 0);
        return;
      }
      if (!config.swipe) return;
      const now = Date.now();
      if (now - swipeLast > SWIPE_GAP_MS) {
        swipeTotal = 0;
        swipeFired = false;
      }
      swipeLast = now;
      if (swipeFired) return;
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.5) {
        swipeTotal = 0;
        return;
      }
      if (typing() || scrollsHorizontally(event.target, event.deltaX)) {
        swipeTotal = 0;
        return;
      }
      setTimeout(() => {
        if (event.defaultPrevented || swipeFired) return;
        swipeTotal += event.deltaX;
        if (Math.abs(swipeTotal) < SWIPE_DISTANCE) return;
        swipeFired = true;
        gesture(swipeTotal < 0 ? "swipe-right" : "swipe-left");
      }, 0);
    },
    { capture: true, passive: true },
  );

  // Botões laterais (XButton1/XButton2 = button 3/4).
  window.addEventListener(
    "mouseup",
    (event) => {
      if (event.button !== 3 && event.button !== 4) return;
      if (!config.mouse) return;
      event.preventDefault();
      if (typing()) return;
      gesture(event.button === 3 ? "mouse-back" : "mouse-forward");
    },
    true,
  );

  // Gesto desenhado com o botão direito. O menu de contexto espera o botão subir: no
  // macOS e no Linux ele abriria no mousedown; sem gesto, o main repete o clique direito.
  let stroke = null;
  let suppressMenuUntil = 0;
  let replaying = false;
  window.addEventListener(
    "mousedown",
    (event) => {
      if (event.button !== 2) return;
      stroke = null;
      if (replaying || !config.draw || selecting() || typing()) return;
      stroke = { points: [{ x: event.clientX, y: event.clientY }], menu: null };
    },
    true,
  );
  window.addEventListener(
    "mousemove",
    (event) => {
      if (!stroke) return;
      if (!(event.buttons & 2)) {
        stroke = null;
        return;
      }
      stroke.points.push({ x: event.clientX, y: event.clientY });
    },
    true,
  );
  window.addEventListener(
    "contextmenu",
    (event) => {
      if (replaying) {
        replaying = false;
        return;
      }
      if (stroke) {
        event.preventDefault();
        event.stopImmediatePropagation();
        stroke.menu = { x: event.clientX, y: event.clientY };
      } else if (Date.now() < suppressMenuUntil) {
        event.preventDefault();
        event.stopImmediatePropagation();
        suppressMenuUntil = 0;
      }
    },
    true,
  );
  window.addEventListener(
    "mouseup",
    (event) => {
      if (event.button !== 2 || !stroke) return;
      const current = stroke;
      stroke = null;
      const name = STROKES[directionsOf(current.points, STROKE_SEGMENT)];
      if (name) {
        // Windows: o menu vem depois do mouseup; não deixa abrir.
        suppressMenuUntil = Date.now() + 400;
        gesture(name);
        return;
      }
      if (current.menu) {
        replaying = true;
        setTimeout(() => (replaying = false), 1000);
        send("agzos:context-menu-replay", current.menu);
      }
    },
    true,
  );
}

/** Pontos do traço → direções ("UD", "DR"…), juntando repetidas. */
function directionsOf(points, segment) {
  let result = "";
  let anchor = points[0];
  if (!anchor) return result;
  for (const point of points.slice(1)) {
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < segment) continue;
    const direction = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "R" : "L") : dy > 0 ? "D" : "U";
    if (!result.endsWith(direction)) result += direction;
    anchor = point;
  }
  return result;
}
