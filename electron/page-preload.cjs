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

const { contextBridge, ipcRenderer } = require("electron");

const PANEL = Array.isArray(process.argv) && process.argv.includes("--agzos-surface=panel");

// Só o quadro de cima cuida de gestos, PiP, tela cheia, PWA e visualizador de imagem. O
// Agzos Key (login e formulários) roda em todo frame (nodeIntegrationInSubFrames nas
// guias): logins em iframes, inclusive de outra origem como o HTML do Google Apps Script
// (script.google.com → *.script.googleusercontent.com → userHtmlFrame). O main só aceita
// o que vem de frame do mesmo site da guia ou de um embutido confiável (form-intel.cjs).
const TOP = window === window.top;

// Motor semântico (electron/form-intel.cjs). O preload em sandbox não dá require em
// arquivo local: pede o fonte ao main uma vez por frame e monta aqui, no mundo isolado.
let intel = null;
function engine() {
  if (intel !== null) return intel;
  try {
    const source = ipcRenderer.sendSync("agzos:form-intel-source");
    intel =
      typeof source === "string" && source.startsWith("function formIntelFactory")
        ? new Function(`return (${source})();`)()
        : false;
  } catch {
    intel = false;
  }
  return intel;
}

const TEXT_TYPES = new Set(["text", "email", "tel", "number", ""]);

function send(channel, payload) {
  try {
    ipcRenderer.send(channel, payload);
  } catch {
    /* o main pode não estar ouvindo nesta janela: ignora */
  }
}

// --- Chromecast (6.0): window.agzosCast ---------------------------------------------------
// Ponte pequena para sites da lista (prefs.castOrigins, só https, só o quadro de cima). O
// main confere tudo de novo a cada chamada (origem, permissão, limite, entradas); aqui só
// se repassa. A página nunca recebe endereço de rede nem socket: só id, nome e modelo.
// Contrato completo em docs/cast-bridge.md.
(function installCastBridge() {
  if (!TOP || PANEL || location.protocol !== "https:") return;
  let allowed = false;
  try {
    allowed = ipcRenderer.sendSync("agzos:cast-allowed") === true;
  } catch {
    allowed = false;
  }
  if (!allowed) return;

  const call = async (op, args) => {
    const reply = await ipcRenderer.invoke("agzos:cast", { op, args });
    if (!reply || reply.ok !== true) {
      const error = new Error(
        reply && typeof reply.error === "string" ? reply.error : "cast_error",
      );
      error.code = error.message;
      throw error;
    }
    return reply.value;
  };
  const deviceCallbacks = new Set();
  const statusCallbacks = new Set();
  const fire = (set, value) => {
    for (const callback of [...set]) {
      try {
        callback(value);
      } catch {
        /* callback da página quebrou: não derruba os outros */
      }
    }
  };
  ipcRenderer.on("agzos:cast-devices", (_event, list) => fire(deviceCallbacks, list));
  ipcRenderer.on("agzos:cast-status", (_event, status) => fire(statusCallbacks, status));

  contextBridge.exposeInMainWorld("agzosCast", {
    version: 1,
    getDevices: () => call("devices"),
    onDevices: (callback) => {
      if (typeof callback !== "function") throw new TypeError("callback");
      deviceCallbacks.add(callback);
      call("subscribe")
        .then((list) => {
          if (deviceCallbacks.has(callback)) callback(list);
        })
        .catch(() => {});
      return () => {
        deviceCallbacks.delete(callback);
        if (deviceCallbacks.size === 0) call("unsubscribe").catch(() => {});
      };
    },
    load: (request) => call("load", request),
    control: (sessionId, command) => call("control", { sessionId, command }),
    onStatus: (callback) => {
      if (typeof callback !== "function") throw new TypeError("callback");
      statusCallbacks.add(callback);
      return () => {
        statusCallbacks.delete(callback);
      };
    },
    stop: (sessionId) => call("stop", { sessionId }),
    getSessions: () => call("sessions"),
  });
})();

// --- Vídeo em Picture-in-Picture (avisa o main por evento, nunca por sondagem) ---

// O main precisa saber se a guia está em PiP para não hiberná-la (a janela flutuante
// fecharia). Antes isso era conferido sondando a página com executeJavaScript a cada
// verificação de hibernação: um round-trip por frame, a cada minuto, segurando o
// processo principal — o que travava a barra lateral e a navegação. O preload escuta os
// eventos do próprio navegador e avisa na hora, o que também cobre o PiP iniciado pelo
// player da página (o botão do site), e não só pelo nosso atalho.
for (const type of TOP ? ["enterpictureinpicture", "leavepictureinpicture"] : []) {
  document.addEventListener(type, (event) => {
    const video = event.target;
    if (!video || video.tagName !== "VIDEO") return;
    send("agzos:pip", { active: type === "enterpictureinpicture", url: location.href });
    // O vídeo saindo da tela cheia direto para o PiP (macOS) nem sempre gera o
    // leave-html-full-screen; o main confere e só age se tinha ficado preso.
    if (window === window.top && !document.fullscreenElement) {
      send("agzos:page-fullscreen", { active: false });
    }
  });
}

// --- Tela cheia da página (rede de segurança do leave-html-full-screen) ---

// Só o quadro de cima fala pela guia: um iframe sem elemento em tela cheia não diz nada
// sobre a página toda.
if (window === window.top) {
  document.addEventListener("fullscreenchange", () => {
    if (!document.fullscreenElement) send("agzos:page-fullscreen", { active: false });
  });
}

// --- Agzos Key: formulários de login e de dados (todo frame) ---------------------------

// Cada documento observado: o deste frame e os filhos do mesmo site sem preload próprio
// (iframe about:blank escrito por document.write, como o userHtmlFrame do Apps Script).
// A marca (não enumerável, no mundo isolado) diz quem já cuida de um documento.
const WATCH_MARK = "__agzosFormWatch";
const WATCH_TOKEN = Math.random().toString(36).slice(2);
const watched = new Map();

/** Código MFA dividido em caixinhas de 1 dígito (comum em bancos e SaaS). */
function splitOtpBoxes(doc) {
  const boxes = Array.from(doc.querySelectorAll("input")).filter(
    (input) =>
      input.maxLength === 1 && TEXT_TYPES.has(input.type) && engine() && engine().isVisible(input),
  );
  return boxes.length >= 4 && boxes.length <= 8 ? boxes : [];
}

/** Campo de verdade por trás do evento (web components chegam com o host como alvo). */
function fieldOf(event) {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  const first = path[0] && path[0].nodeType === 1 ? path[0] : event.target;
  return first && first.nodeType === 1 ? first : null;
}

/** Papel do campo para o Agzos Key: { role: password|username|otp|form, type, kind }. */
function inspect(el) {
  const intel = engine();
  if (!intel || !el || !intel.isFieldElement(el) || !intel.isVisible(el)) return null;
  const doc = el.ownerDocument;
  if (el.tagName === "INPUT" && el.maxLength === 1 && splitOtpBoxes(doc).includes(el)) {
    return { role: "otp", type: "otp", kind: "otp" };
  }
  try {
    const groups = intel.analyze(doc, { focus: el });
    const found = intel.fieldRole(el, groups);
    return found
      ? { role: found.role, type: found.type, kind: found.kind, fillable: found.fillable || 0 }
      : null;
  } catch {
    return null;
  }
}

function frameUrl() {
  return location.href;
}

// --- Aviso passivo: formulário de login à vista ---

function scanDoc(doc, state) {
  const intel = engine();
  if (!intel || !doc.documentElement) return;
  const count = doc.querySelectorAll("input").length;
  let field = null;
  if (count > 0) {
    try {
      // Páginas enormes (planilhas, feeds): só o campo de senha conta, sem análise.
      if (count > 150) {
        const pass = Array.from(doc.querySelectorAll('input[type="password"]')).some(
          intel.isVisible,
        );
        field = pass ? "password" : null;
      } else {
        const groups = intel.analyze(doc, { shallow: true });
        if (groups.some((group) => group.fields.some((item) => item.password))) field = "password";
        else if (groups.some((group) => group.form.kind === "otp") || splitOtpBoxes(doc).length > 0)
          field = "otp";
        else if (groups.some((group) => group.form.kind === "login-step")) field = "username";
      }
    } catch {
      field = null;
    }
  }
  checkPending();
  const key = `${frameUrl()}|${field}`;
  if (key === state.lastScan) return;
  state.lastScan = key;
  if (!field) return;
  send("agzos:login-form", { url: frameUrl(), focused: false, field });
}

let scanTimer = null;
function scanSoon() {
  if (scanTimer || document.hidden) return;
  scanTimer = setTimeout(() => {
    scanTimer = null;
    for (const [doc, state] of watched) scanDoc(doc, state);
  }, 600);
}

// --- Foco num campo (aviso explícito) ---

// Foco que vale como "o usuário clicou no campo": logo depois de um clique, toque ou Tab.
// Foco por script (autofocus, o próprio preenchimento do Agzos Key) não abre a sugestão.
let lastUserAt = 0;
function userActed(event) {
  if (event.type !== "keydown" || event.key === "Tab") lastUserAt = Date.now();
}

let lastFocus = { el: null, at: 0 };
function onFocus(event) {
  if (Date.now() - lastUserAt > 1000) return;
  const target = fieldOf(event);
  const found = inspect(target);
  if (!found) return;
  // O mesmo campo focado de novo em seguida (clique depois do foco): um aviso só.
  const now = Date.now();
  if (lastFocus.el === target && now - lastFocus.at < 400) return;
  lastFocus = { el: target, at: now };
  if (found.role === "form") {
    send("agzos:form-field", {
      url: frameUrl(),
      focused: true,
      kind: found.kind,
      type: found.type,
      fillable: found.fillable,
    });
    return;
  }
  send("agzos:login-form", { url: frameUrl(), focused: true, field: found.role });
}

/** Clique num campo que já tinha o foco (o usuário fechou a sugestão e clicou de novo). */
function onPointerDown(event) {
  userActed(event);
  const doc = event.target && event.target.ownerDocument;
  if (!doc || !engine()) return;
  const active = engine().activeIn(doc);
  if (fieldOf(event) === active) onFocus(event);
}

// --- Envio do login (salvar no Agzos Key) ---

// Login em etapas (e-mail numa tela, senha na outra, na mesma página): guarda o último
// usuário digitado para juntar com a senha no envio.
let lastUsername = "";
// Senha digitada ainda não enviada: se o campo some (login por JS, google.script.run,
// troca de tela sem submit) ou a página sai, o login vale como enviado.
let pending = null;
let pendingTimer = null;

function onTyping(event) {
  const target = fieldOf(event);
  if (!target || target.tagName !== "INPUT" || !engine()) return;
  watchCorrection(target, event);
  const found = inspect(target);
  if (!found) return;
  if (found.role === "username" && target.value) lastUsername = target.value;
  if (found.role === "password" && target.value) {
    const doc = target.ownerDocument;
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      const login = engine().readLogin(doc);
      if (login.password) {
        pending = {
          el: target,
          username: login.username || lastUsername,
          password: login.password,
          at: Date.now(),
        };
      }
    }, 300);
  }
}

/** O campo de senha com valor sumiu da tela: o login foi enviado por script. */
function checkPending() {
  if (!pending || Date.now() - pending.at > 120_000) {
    pending = null;
    return;
  }
  const intel = engine();
  if (!pending.el.isConnected || !(intel && intel.isVisible(pending.el))) {
    const { username, password } = pending;
    pending = null;
    report(username, password);
  }
}

let lastSent = "";
function report(username, password) {
  if (!password) return;
  // Submit + clique no botão disparam juntos: um aviso só.
  const key = `${username}\u0000${password}`;
  if (key === lastSent) return;
  lastSent = key;
  setTimeout(() => {
    if (lastSent === key) lastSent = "";
  }, 4000);
  pending = null;
  send("agzos:page-login", { url: frameUrl(), username, password });
}

function capture(doc) {
  const intel = engine();
  if (!intel || !doc) return;
  let login = { username: "", password: "" };
  try {
    login = intel.readLogin(doc);
  } catch {
    return;
  }
  if (!login.password) return;
  report(login.username || lastUsername, login.password);
}

/** Elemento clicável com cara de "enviar": botão, link, role=button, onclick, cursor de mão. */
function clickable(target) {
  if (!target || target.nodeType !== 1) return null;
  const el = target.closest(
    "button, input[type=submit], input[type=button], input[type=image], [role=button], a, [onclick]",
  );
  if (el) return el;
  // Div/span com listener de clique (Apps Script, apps sem <form>): cursor de mão por perto.
  let node = target;
  for (let depth = 0; node && depth < 3; depth++, node = node.parentElement) {
    const view = node.ownerDocument && node.ownerDocument.defaultView;
    if (view && view.getComputedStyle(node).cursor === "pointer") return node;
  }
  return null;
}

function labelOf(el) {
  return `${el.innerText || el.value || ""} ${el.getAttribute("aria-label") || ""} ${el.id || ""} ${el.getAttribute("title") || ""}`;
}

function onSubmit(event) {
  const target = event.target;
  if (target && target.tagName === "FORM") capture(target.ownerDocument);
}

function onKeyDown(event) {
  userActed(event);
  if (event.key !== "Enter") return;
  const target = fieldOf(event);
  if (target && target.tagName === "INPUT") capture(target.ownerDocument);
}

function onClick(event) {
  const el = clickable(fieldOf(event));
  if (!el || !engine()) return;
  if (engine().isFieldElement(el)) return;
  const doc = el.ownerDocument;
  // Botão de entrar/continuar, ou o único botão de um formulário com senha preenchida.
  if (engine().isSubmitLabel(labelOf(el))) {
    capture(doc);
    return;
  }
  const scope = el.closest("form") || doc;
  if (engine().buttonsOf(scope).length === 1) capture(doc);
}

function onPageHide() {
  if (!pending) return;
  const { username, password } = pending;
  report(username, password);
}

// --- Preencher (pedido do main, só a frames permitidos) ---

// Preenchido com perfil: se o usuário trocar o valor, o Agzos aprende (se ligado).
let filledByProfile = null;

function watchCorrection(target, event) {
  if (!filledByProfile || event.type !== "change" || !event.isTrusted) return;
  if (Date.now() > filledByProfile.until) {
    filledByProfile = null;
    return;
  }
  const item = filledByProfile.elements.find((entry) => entry.el === target);
  if (!item || target.value === item.value) return;
  const value = String(target.value || "").trim();
  const to = value ? engine().typeForValue(filledByProfile.values, value) : "ignore";
  if (!to || to === item.type) return;
  item.value = target.value;
  send("agzos:form-correction", {
    signature: item.signature,
    label: item.label || "",
    from: item.type,
    to,
  });
}

/** Documentos na ordem de preferência: o que tem o foco primeiro. */
function docsByFocus() {
  const docs = [...watched.keys()].filter((doc) => doc.defaultView);
  return docs.sort((a, b) => Number(b.hasFocus()) - Number(a.hasFocus()));
}

function fillRequest(request) {
  const intel = engine();
  if (!intel || !request || typeof request !== "object") return { filled: false };
  const docs = docsByFocus();
  if (request.mode === "login") {
    const data = {
      username: typeof request.username === "string" ? request.username : "",
      password: typeof request.password === "string" ? request.password : "",
    };
    for (const doc of docs) {
      const result = intel.fillLogin(doc, data);
      if (result.filled) return { filled: true, focused: doc.hasFocus() };
    }
    return { filled: false };
  }
  if (request.mode === "profile") {
    const values = request.values && typeof request.values === "object" ? request.values : {};
    const mappings =
      request.mappings && typeof request.mappings === "object" ? request.mappings : {};
    for (const doc of docs) {
      const result = intel.fillProfile(doc, { values, mappings });
      if (result.filled > 0) {
        filledByProfile = request.learn
          ? {
              values,
              elements: result.elements.map((item, index) => ({
                ...item,
                label: (result.fields[index] && result.fields[index].label) || "",
              })),
              until: Date.now() + 180_000,
            }
          : null;
        return { filled: true, count: result.filled, focused: doc.hasFocus() };
      }
    }
    return { filled: false };
  }
  if (request.mode === "read") {
    for (const doc of docs) {
      const login = intel.readLogin(doc);
      if (login.password)
        return { username: login.username || lastUsername, password: login.password };
    }
    return { username: "", password: "" };
  }
  return { filled: false };
}

// --- Observação dos documentos (este frame e filhos sem preload) ---

function arm(doc) {
  if (!doc || !doc.defaultView) return;
  let state = watched.get(doc);
  if (state && state.root === doc.documentElement) return;
  if (!state) {
    if (doc[WATCH_MARK] && doc[WATCH_MARK] !== WATCH_TOKEN) return;
    try {
      Object.defineProperty(doc, WATCH_MARK, { value: WATCH_TOKEN, configurable: true });
    } catch {
      return;
    }
    state = { root: null, observer: null, lastScan: "" };
    watched.set(doc, state);
  }
  // document.open() (o Apps Script escreve o HTML do usuário assim) apaga os listeners da
  // janela e troca o <html>: arma de novo. As mesmas funções não duplicam o listener.
  const win = doc.defaultView;
  win.addEventListener("submit", onSubmit, true);
  win.addEventListener("keydown", onKeyDown, true);
  win.addEventListener("click", onClick, true);
  win.addEventListener("pointerdown", onPointerDown, true);
  win.addEventListener("focusin", onFocus, true);
  win.addEventListener("input", onTyping, true);
  win.addEventListener("change", onTyping, true);
  win.addEventListener("pagehide", onPageHide, true);
  if (state.observer) state.observer.disconnect();
  state.root = doc.documentElement;
  if (state.root) {
    // SPAs montam o formulário depois (e trocam de etapa sem navegar): reavalia em lote.
    state.observer = new win.MutationObserver(scanSoon);
    state.observer.observe(state.root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["type", "hidden", "style", "class"],
    });
  }
  scanSoon();
}

/** Filhos do mesmo site sem preload próprio (about:blank) e documentos reescritos. */
function rearm() {
  for (const [doc, state] of watched) {
    if (!doc.defaultView) {
      watched.delete(doc);
      continue;
    }
    if (state.root !== doc.documentElement) arm(doc);
    for (const frame of doc.querySelectorAll("iframe, frame")) {
      let child = null;
      try {
        child = frame.contentDocument;
      } catch {
        child = null;
      }
      if (child && child.defaultView) arm(child);
    }
  }
}

function installLoginWatch() {
  ipcRenderer.on("agzos:fill", (_event, request) => {
    let result = { filled: false };
    try {
      result = fillRequest(request);
    } catch {
      result = { filled: false };
    }
    send("agzos:fill-result", { nonce: request && request.nonce, result });
  });
  const start = () => {
    arm(document);
    window.addEventListener("popstate", scanSoon);
    window.addEventListener("hashchange", scanSoon);
    document.addEventListener("visibilitychange", scanSoon);
    setInterval(rearm, 1000);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}

// Painéis laterais (WhatsApp, Discord…) carregam este preload só pelos gestos: o Agzos Key
// não observa login neles.
if (!PANEL) installLoginWatch();
if (TOP) installGestures();

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
        // Ctrl+roda de mouse (passos inteiros, de qualquer tamanho) é do Chromium, que avisa
        // zoom-changed; pinça vem em deltas fracionários. Assim cada passo sai de um lugar só.
        if (Number.isInteger(event.deltaY)) return;
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

// --- 4.1.1: PWA, arquivos locais e visualizador de imagem -------------------------

if (!PANEL && TOP) {
  installPwaWatch();
  installFileActions();
  installImageViewer();
}

/**
 * Avisa o main quando a página tem manifesto (e se há service worker). Apps de página única
 * (Gemini, Grok, Canva) põem ou trocam o <link rel=manifest> depois da carga: um observador
 * do <head> e novas checagens pegam isso (4.1.3).
 */
function installPwaWatch() {
  if (!/^https?:$/.test(location.protocol)) return;
  let last = "";
  const check = async () => {
    const link = document.querySelector('link[rel~="manifest"]');
    if (!link || !link.href) return;
    let serviceWorker = false;
    try {
      const container = navigator.serviceWorker;
      serviceWorker = Boolean(
        container && (container.controller || (await container.getRegistration())),
      );
    } catch {
      serviceWorker = false;
    }
    const key = `${link.href}|${serviceWorker}`;
    if (key === last) return;
    last = key;
    send("agzos:pwa-detect", { manifestUrl: link.href, serviceWorker });
  };
  let timer = 0;
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(check, 400);
  };
  const soon = () => {
    setTimeout(check, 600);
    setTimeout(check, 4000);
    setTimeout(check, 12000);
    try {
      // Só o <head> (e filhos diretos): mudanças no corpo da página não custam nada aqui.
      new MutationObserver((records) => {
        if (
          records.some((record) =>
            [...record.addedNodes, record.target].some(
              (node) => node instanceof Element && node.matches?.('link[rel~="manifest"]'),
            ),
          )
        ) {
          later();
        }
      }).observe(document.head ?? document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["href", "rel"],
      });
    } catch {
      // Sem <head>: as checagens com tempo bastam.
    }
  };
  if (document.readyState === "complete") soon();
  else window.addEventListener("load", soon, { once: true });
  try {
    navigator.serviceWorker?.addEventListener("controllerchange", () => void check());
  } catch {
    // Sem service worker nesta página.
  }
}

/** Botão "Abrir no app do sistema" das páginas de arquivo (agzos-file). */
function installFileActions() {
  if (location.protocol !== "agzos-file:") return;
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (event.isTrusted && target?.closest("[data-agzos-open-external]")) {
        send("agzos:file-open-external", {});
      }
    },
    true,
  );
}

/**
 * Visualizador de imagem (4.1.1): imagem aberta direto numa guia (http ou arquivo local)
 * ganha zoom no cursor, arrastar, girar, espelhar, ajustes de cor, fundo, informações,
 * tela cheia e o modo canvas (desenhar, retângulo, seta, texto, desfazer, exportar PNG).
 */
function installImageViewer() {
  const start = () => {
    const type = document.contentType || "";
    if (!type.startsWith("image/") || type === "image/svg+xml") return;
    const original = document.querySelector("body > img");
    if (!original) return;
    const image = new Image();
    image.onload = () => buildImageViewer(image, original, type);
    image.src = original.currentSrc || original.src;
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else start();
}

function buildImageViewer(image, original, type) {
  const name = decodeURIComponent(location.pathname.split("/").pop() || "imagem");
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647";
  const root = host.attachShadow({ mode: "closed" });
  original.style.display = "none";
  document.body.style.margin = "0";
  document.body.style.overflow = "hidden";
  document.body.appendChild(host);

  root.innerHTML = `
<style>
:host { all: initial; }
* { box-sizing: border-box; font: 13px/1.3 system-ui, sans-serif; }
.stage { position: absolute; inset: 0; cursor: grab; background: #111; }
.stage[data-bg="light"] { background: #f4f2ef; }
.stage[data-bg="checker"] { background: repeating-conic-gradient(#3a3a3a 0% 25%, #2a2a2a 0% 50%) 0 0 / 24px 24px; }
.stage.drag { cursor: grabbing; }
.stage.draw { cursor: crosshair; }
canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
.bar { position: absolute; left: 50%; top: 12px; transform: translateX(-50%); display: flex; gap: 2px; align-items: center; padding: 4px; border-radius: 12px; background: rgba(24,23,22,.88); color: #eee; box-shadow: 0 6px 24px rgba(0,0,0,.35); transition: opacity .2s; max-width: calc(100% - 24px); overflow-x: auto; }
.bar.idle { opacity: 0; pointer-events: none; }
.bar.canvas-bar { top: auto; bottom: 12px; }
button, select { color: inherit; background: transparent; border: 0; border-radius: 8px; padding: 6px 8px; cursor: pointer; white-space: nowrap; }
button:hover, button.on { background: rgba(255,255,255,.14); }
button.on { color: #ff8a73; }
.sep { width: 1px; height: 20px; background: rgba(255,255,255,.18); margin: 0 4px; }
.zoom { min-width: 52px; text-align: center; font-variant-numeric: tabular-nums; }
.panel { position: absolute; right: 12px; top: 64px; width: 240px; padding: 12px; border-radius: 12px; background: rgba(24,23,22,.94); color: #eee; display: grid; gap: 10px; }
.panel[hidden] { display: none; }
.panel label { display: grid; gap: 4px; }
.panel input[type=range] { width: 100%; }
.panel dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; margin: 0; }
.panel dt { color: #aaa; }
.panel dd { margin: 0; word-break: break-all; }
input[type=color] { width: 28px; height: 28px; border: 0; background: none; padding: 0; cursor: pointer; }
</style>
<div class="stage" data-bg="dark"><canvas></canvas></div>
<div class="bar" role="toolbar" aria-label="Visualizador de imagem">
  <button data-act="out" title="Diminuir (−)">−</button>
  <button data-act="fit" class="zoom" title="Ajustar à tela (0)">100%</button>
  <button data-act="in" title="Aumentar (+)">+</button>
  <button data-act="actual" title="Tamanho real (1)">1:1</button>
  <span class="sep"></span>
  <button data-act="rotl" title="Girar à esquerda (Shift+R)">⟲</button>
  <button data-act="rotr" title="Girar à direita (R)">⟳</button>
  <button data-act="fliph" title="Espelhar na horizontal (H)">⇋</button>
  <button data-act="flipv" title="Espelhar na vertical (V)">⇵</button>
  <span class="sep"></span>
  <button data-act="adjust" title="Ajustes de cor">Ajustes</button>
  <button data-act="bg" title="Fundo: escuro, claro ou xadrez (B)">Fundo</button>
  <button data-act="info" title="Informações (I)">Info</button>
  <button data-act="canvas" title="Modo canvas: desenhar e anotar (C)">Canvas</button>
  <button data-act="edit" title="Editar no Agzos Imagem">Editar</button>
  <button data-act="full" title="Tela cheia (F)">⛶</button>
  <button data-act="reset" title="Desfazer giros, zoom e ajustes">Restaurar</button>
</div>
<div class="bar canvas-bar" role="toolbar" aria-label="Canvas" hidden>
  <button data-tool="pen" class="on" title="Caneta">Caneta</button>
  <button data-tool="marker" title="Marca-texto">Marca-texto</button>
  <button data-tool="rect" title="Retângulo">Retângulo</button>
  <button data-tool="arrow" title="Seta">Seta</button>
  <button data-tool="text" title="Texto">Texto</button>
  <span class="sep"></span>
  <input type="color" value="#ff3b30" title="Cor" />
  <select title="Espessura"><option value="2">Fina</option><option value="5" selected>Média</option><option value="10">Grossa</option></select>
  <span class="sep"></span>
  <button data-act="undo" title="Desfazer (Ctrl+Z)">Desfazer</button>
  <button data-act="clear" title="Apagar as anotações">Limpar</button>
  <button data-act="export" title="Salvar a imagem com as anotações (PNG)">Exportar PNG</button>
  <button data-act="canvas" title="Sair do canvas (Esc)">Sair</button>
</div>
<div class="panel" data-panel="adjust" hidden>
  <label>Brilho <input type="range" data-filter="brightness" min="0" max="200" value="100" /></label>
  <label>Contraste <input type="range" data-filter="contrast" min="0" max="200" value="100" /></label>
  <label>Saturação <input type="range" data-filter="saturate" min="0" max="200" value="100" /></label>
  <label>Tons de cinza <input type="range" data-filter="grayscale" min="0" max="100" value="0" /></label>
  <label>Inverter <input type="range" data-filter="invert" min="0" max="100" value="0" /></label>
</div>
<div class="panel" data-panel="info" hidden><dl></dl></div>`;

  const stage = root.querySelector(".stage");
  const canvas = root.querySelector("canvas");
  const bar = root.querySelector(".bar");
  const canvasBar = root.querySelector(".canvas-bar");
  const zoomLabel = root.querySelector(".zoom");
  const color = root.querySelector("input[type=color]");
  const width = root.querySelector("select");
  const g = canvas.getContext("2d");
  const W = image.naturalWidth;
  const H = image.naturalHeight;
  const filters = { brightness: 100, contrast: 100, saturate: 100, grayscale: 0, invert: 0 };
  const view = { scale: 1, x: 0, y: 0, rot: 0, fx: 1, fy: 1 };
  const shapes = [];
  let mode = "view";
  let tool = "pen";
  let backgrounds = ["dark", "light", "checker"];

  const filterText = () =>
    `brightness(${filters.brightness}%) contrast(${filters.contrast}%) saturate(${filters.saturate}%) grayscale(${filters.grayscale}%) invert(${filters.invert}%)`;
  const rotated = () => view.rot % 180 !== 0;
  const size = () => ({ w: stage.clientWidth, h: stage.clientHeight });

  function fitScale(upscale) {
    const { w, h } = size();
    const iw = rotated() ? H : W;
    const ih = rotated() ? W : H;
    const scale = Math.min((w - 32) / iw, (h - 32) / ih);
    return upscale ? scale : Math.min(1, scale);
  }
  function center(scale) {
    const { w, h } = size();
    view.scale = scale;
    view.x = w / 2;
    view.y = h / 2;
    draw();
  }
  const matrix = () =>
    new DOMMatrix()
      .translate(view.x, view.y)
      .rotate(view.rot)
      .scale(view.scale * view.fx, view.scale * view.fy);
  function toImage(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const point = matrix()
      .inverse()
      .transformPoint(new DOMPoint(clientX - rect.left, clientY - rect.top));
    return { x: point.x + W / 2, y: point.y + H / 2 };
  }

  function drawShapes(context) {
    for (const shape of shapes) {
      context.save();
      context.strokeStyle = shape.color;
      context.fillStyle = shape.color;
      context.lineWidth = shape.width;
      context.lineCap = "round";
      context.lineJoin = "round";
      if (shape.tool === "marker") {
        context.globalAlpha = 0.35;
        context.lineWidth = shape.width * 4;
      }
      if (shape.tool === "pen" || shape.tool === "marker") {
        context.beginPath();
        shape.points.forEach((p, i) => (i ? context.lineTo(p.x, p.y) : context.moveTo(p.x, p.y)));
        context.stroke();
      } else if (shape.tool === "rect") {
        const [a, b] = shape.points;
        context.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      } else if (shape.tool === "arrow") {
        const [a, b] = shape.points;
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const head = Math.max(10, shape.width * 4);
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.moveTo(b.x, b.y);
        context.lineTo(b.x - head * Math.cos(angle - 0.45), b.y - head * Math.sin(angle - 0.45));
        context.moveTo(b.x, b.y);
        context.lineTo(b.x - head * Math.cos(angle + 0.45), b.y - head * Math.sin(angle + 0.45));
        context.stroke();
      } else if (shape.tool === "text") {
        context.font = `${Math.max(14, shape.width * 6)}px system-ui, sans-serif`;
        context.textBaseline = "top";
        context.fillText(shape.text, shape.points[0].x, shape.points[0].y);
      }
      context.restore();
    }
  }

  function draw() {
    const ratio = window.devicePixelRatio || 1;
    const { w, h } = size();
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, canvas.width, canvas.height);
    const m = matrix();
    g.setTransform(new DOMMatrix().scale(ratio, ratio).multiply(m));
    g.imageSmoothingQuality = "high";
    g.imageSmoothingEnabled = view.scale < 3;
    g.filter = filterText();
    g.drawImage(image, -W / 2, -H / 2);
    g.filter = "none";
    g.translate(-W / 2, -H / 2);
    drawShapes(g);
    zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
  }

  function zoomAt(factor, clientX, clientY) {
    const next = Math.min(40, Math.max(0.02, view.scale * factor));
    const rect = canvas.getBoundingClientRect();
    const px = (clientX ?? rect.left + rect.width / 2) - rect.left;
    const py = (clientY ?? rect.top + rect.height / 2) - rect.top;
    view.x = px - ((px - view.x) * next) / view.scale;
    view.y = py - ((py - view.y) * next) / view.scale;
    view.scale = next;
    draw();
  }

  function showInfo() {
    const dl = root.querySelector('[data-panel="info"] dl');
    const rows = [
      ["Nome", name],
      ["Dimensões", `${W} × ${H} px`],
      ["Tipo", type.replace("image/", "").toUpperCase()],
      ["Endereço", location.href.split("?")[0]],
    ];
    dl.textContent = "";
    for (const [term, value] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = value;
      dl.append(dt, dd);
    }
  }

  async function exportPng() {
    const out = document.createElement("canvas");
    out.width = rotated() ? H : W;
    out.height = rotated() ? W : H;
    const context = out.getContext("2d");
    context.translate(out.width / 2, out.height / 2);
    context.rotate((view.rot * Math.PI) / 180);
    context.scale(view.fx, view.fy);
    let source = image;
    const paint = () => {
      context.filter = filterText();
      context.drawImage(source, -W / 2, -H / 2);
      context.filter = "none";
      context.translate(-W / 2, -H / 2);
      drawShapes(context);
    };
    paint();
    let blob = await new Promise((resolve) => {
      try {
        out.toBlob(resolve, "image/png");
      } catch {
        resolve(null);
      }
    });
    if (!blob) {
      // Imagem de outra origem (file://): o main entrega os bytes desta própria página.
      const bytes = await ipcRenderer.invoke("agzos:image-bytes").catch(() => null);
      if (!bytes) return;
      source = await createImageBitmap(new Blob([bytes]));
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, out.width, out.height);
      context.translate(out.width / 2, out.height / 2);
      context.rotate((view.rot * Math.PI) / 180);
      context.scale(view.fx, view.fy);
      paint();
      blob = await new Promise((resolve) => out.toBlob(resolve, "image/png"));
    }
    if (!blob) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${name.replace(/\.[^.]+$/, "")}-editada.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  }

  function toggleCanvas() {
    mode = mode === "canvas" ? "view" : "canvas";
    canvasBar.hidden = mode !== "canvas";
    stage.classList.toggle("draw", mode === "canvas");
    root.querySelector('[data-act="canvas"]').classList.toggle("on", mode === "canvas");
  }

  function togglePanel(nameOf) {
    for (const panel of root.querySelectorAll(".panel")) {
      panel.hidden = panel.dataset.panel !== nameOf || !panel.hidden;
    }
    if (nameOf === "info") showInfo();
  }

  const actions = {
    in: () => zoomAt(1.25),
    out: () => zoomAt(0.8),
    fit: () => center(fitScale(true)),
    actual: () => center(1),
    rotl: () => {
      view.rot = (view.rot + 270) % 360;
      center(fitScale(false));
    },
    rotr: () => {
      view.rot = (view.rot + 90) % 360;
      center(fitScale(false));
    },
    fliph: () => {
      view.fx *= -1;
      draw();
    },
    flipv: () => {
      view.fy *= -1;
      draw();
    },
    adjust: () => togglePanel("adjust"),
    info: () => togglePanel("info"),
    bg: () => {
      backgrounds = [...backgrounds.slice(1), backgrounds[0]];
      stage.dataset.bg = backgrounds[0];
    },
    canvas: toggleCanvas,
    full: () =>
      document.fullscreenElement ? void document.exitFullscreen() : void host.requestFullscreen(),
    reset: () => {
      Object.assign(filters, {
        brightness: 100,
        contrast: 100,
        saturate: 100,
        grayscale: 0,
        invert: 0,
      });
      for (const input of root.querySelectorAll("[data-filter]"))
        input.value = filters[input.dataset.filter];
      view.rot = 0;
      view.fx = 1;
      view.fy = 1;
      center(fitScale(false));
    },
    undo: () => {
      shapes.pop();
      draw();
    },
    clear: () => {
      shapes.length = 0;
      draw();
    },
    export: () => void exportPng(),
    // 5.0.3: abre o arquivo no Agzos Imagem (o main confere que é a página de um arquivo).
    edit: () => void ipcRenderer.invoke("imagem:edit-file").catch(() => false),
  };

  root.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button) return;
    if (button.dataset.act) actions[button.dataset.act]?.();
    if (button.dataset.tool) {
      tool = button.dataset.tool;
      for (const item of root.querySelectorAll("[data-tool]"))
        item.classList.toggle("on", item === button);
    }
  });
  root.addEventListener("input", (event) => {
    const input = event.target;
    if (input?.dataset?.filter) {
      filters[input.dataset.filter] = Number(input.value);
      draw();
    }
  });

  let drag = null;
  stage.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    stage.setPointerCapture(event.pointerId);
    if (mode === "canvas") {
      const point = toImage(event.clientX, event.clientY);
      if (tool === "text") {
        const text = window.prompt("Texto da anotação:");
        if (text)
          shapes.push({
            tool,
            color: color.value,
            width: Number(width.value),
            points: [point],
            text,
          });
        draw();
        return;
      }
      drag = {
        shape: { tool, color: color.value, width: Number(width.value), points: [point, point] },
      };
      shapes.push(drag.shape);
      return;
    }
    drag = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
    stage.classList.add("drag");
  });
  stage.addEventListener("pointermove", (event) => {
    wake();
    if (!drag) return;
    if (drag.shape) {
      const point = toImage(event.clientX, event.clientY);
      if (drag.shape.tool === "pen" || drag.shape.tool === "marker") drag.shape.points.push(point);
      else drag.shape.points[1] = point;
    } else {
      view.x = drag.vx + event.clientX - drag.x;
      view.y = drag.vy + event.clientY - drag.y;
    }
    draw();
  });
  const end = () => {
    drag = null;
    stage.classList.remove("drag");
  };
  stage.addEventListener("pointerup", end);
  stage.addEventListener("pointercancel", end);
  stage.addEventListener("dblclick", () => {
    if (mode !== "view") return;
    const fit = fitScale(false);
    center(Math.abs(view.scale - fit) < 0.01 ? 1 : fit);
  });
  stage.addEventListener(
    "wheel",
    (event) => {
      if (event.ctrlKey || event.metaKey) return; // Zoom da página continua do navegador.
      event.preventDefault();
      zoomAt(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
    },
    { passive: false },
  );

  let idleTimer = null;
  function wake() {
    bar.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (mode === "view" && !bar.matches(":hover")) bar.classList.add("idle");
    }, 2500);
  }

  window.addEventListener("keydown", (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "z" &&
        mode === "canvas"
      ) {
        event.preventDefault();
        actions.undo();
      }
      return;
    }
    const keys = {
      "+": "in",
      "=": "in",
      "-": "out",
      0: "fit",
      1: "actual",
      r: "rotr",
      R: "rotl",
      h: "fliph",
      v: "flipv",
      b: "bg",
      i: "info",
      c: "canvas",
      f: "full",
    };
    if (event.key === "Escape" && mode === "canvas") {
      toggleCanvas();
      return;
    }
    const act = keys[event.key];
    if (act) {
      event.preventDefault();
      actions[act]();
    }
  });
  new ResizeObserver(() => draw()).observe(stage);
  document.title = `${name} (${W}×${H})`;
  center(fitScale(false));
  wake();
}
