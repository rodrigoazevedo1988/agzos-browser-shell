// Preload das PÁGINAS (não da casca): roda no mundo isolado de cada guia, com acesso só a
// um canal de IPC. Faz duas coisas para o Agzos Key:
// - avisa o main quando a página tem um formulário de login (campo de senha, de usuário
//   ou de código MFA) e, principalmente, quando o usuário clica/foca num desses campos:
//   a casca busca no cofre e sugere o preenchimento na hora (como os navegadores
//   Chromium). Funciona em SPAs (campos que surgem depois) e em logins em etapas;
// - observa o envio do login (submit, Enter, botão "Entrar") e manda usuário/senha para
//   o main, que repassa para a casca oferecer "salvar no Agzos Key".
// Nenhuma senha fica guardada aqui: só é enviada uma vez, no envio, pelo IPC interno.

const { ipcRenderer } = require("electron");

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
  const hasPassword = visibleInputs().some(isPassword);
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
  const target = event.target;
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
    if (event.target === document.activeElement) onFocus(event);
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
