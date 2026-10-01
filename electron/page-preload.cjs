// Preload das PÁGINAS (não da casca): roda no mundo isolado de cada guia, com acesso só a
// um canal de IPC. Observa o envio de formulários de login (campo de senha + usuário/e-mail)
// e manda os dados para o main, que repassa para a casca oferecer "salvar no Agzos Key".
// Nenhuma senha fica guardada aqui: só é enviada uma vez, no submit, pelo IPC interno.

const { ipcRenderer } = require("electron");

const EMAIL_RE = /email|login|user|usuario|usuário|e-mail|conta/i;

/** Melhor palpite para o campo de usuário perto de um campo de senha, no mesmo formulário. */
function findUsername(form, passwordField) {
  const inputs = Array.from(form.querySelectorAll("input"));
  // E-mail explícito ganha.
  const email = inputs.find((input) => input.type === "email" && input.value);
  if (email) return email.value;
  // Senão, o último campo de texto antes da senha com cara de login.
  const passIndex = inputs.indexOf(passwordField);
  for (let i = passIndex - 1; i >= 0; i--) {
    const input = inputs[i];
    if (input.type === "text" || input.type === "email" || input.type === "tel") {
      const hint = `${input.name} ${input.id} ${input.autocomplete} ${input.placeholder}`;
      if (input.value && (EMAIL_RE.test(hint) || i === passIndex - 1)) return input.value;
    }
  }
  const firstText = inputs.find(
    (input) => (input.type === "text" || input.type === "email") && input.value,
  );
  return firstText ? firstText.value : "";
}

function captureFrom(form) {
  if (!form) return;
  const password = form.querySelector('input[type="password"]');
  if (!password || !password.value) return;
  const username = findUsername(form, password);
  try {
    ipcRenderer.send("agzos:page-login", {
      url: location.href,
      username,
      password: password.value,
    });
  } catch {
    /* o main pode não estar ouvindo nesta janela: ignora */
  }
}

// Submit normal (inclui Enter dentro do form).
window.addEventListener(
  "submit",
  (event) => {
    const target = event.target;
    if (target && target.tagName === "FORM") captureFrom(target);
  },
  true,
);

// Botões de "entrar" em páginas que logam por JS (sem submit de form de verdade).
window.addEventListener(
  "click",
  (event) => {
    const el =
      event.target instanceof Element ? event.target.closest("button, [type=submit]") : null;
    if (!el) return;
    const label = `${el.innerText || ""} ${el.getAttribute("aria-label") || ""}`.toLowerCase();
    if (/entrar|login|log in|sign in|acessar|continuar/.test(label)) {
      const form = el.closest("form") || document.querySelector("form");
      if (form) captureFrom(form);
    }
  },
  true,
);
