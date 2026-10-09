import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";

// Abre o app empacotado (dist/ + electron/) com um perfil temporário.
// Pré-requisito: `bun run desktop:build`. No Linux sem tela, rodar sob xvfb-run.

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let server: http.Server;
let origin = "";

const FILTERS: Record<string, string> = {
  "/filtros/anuncios.txt":
    "/anuncios/banner.js\n##.caixa-anuncio\n127.0.0.1##+js(agzos-teste)\n" +
    "localhost##+js(agzos-teste)\n" +
    "127.0.0.1##+js(agzos-rpnt)\n" +
    "/anuncios/substituto.js$script,redirect=noopjs\n",
  // Formato do resources.json do uBlock Origin (espelho do Ghostery).
  "/filtros/recursos.json": JSON.stringify({
    scriptlets: [
      {
        name: "agzos-teste.js",
        aliases: [],
        body: "function agzosTeste(){window.__agzosScriptlet = true;}",
        dependencies: [],
      },
      {
        // Como o replace-node-text do uBO: reescreve um <script> inline antes de ele rodar.
        // No mundo da página os Trusted Types barrariam; no mundo isolado passa.
        name: "agzos-rpnt.js",
        aliases: [],
        body:
          // Como o uBO: cria uma política de Trusted Types para poder trocar o texto.
          "function agzosRpnt(){var tt=self.trustedTypes;var f={createScript:function(s){return s;}};" +
          "if(tt&&tt.getPropertyType&&tt.getPropertyType('script','textContent')==='TrustedScript')" +
          "{f=tt.createPolicy('agzos-'+Math.random().toString(36).slice(2),f);}" +
          "new MutationObserver(function(ms){ms.forEach(function(m){" +
          "m.addedNodes.forEach(function(n){if(n.nodeName==='SCRIPT'&&n.textContent.indexOf('ANUNCIO')>=0)" +
          "{n.textContent=f.createScript(n.textContent.replace('ANUNCIO','LIMPO'));}});});})" +
          ".observe(document,{childList:true,subtree:true});}",
        dependencies: [],
        executionWorld: "ISOLATED",
      },
    ],
    redirects: [
      {
        name: "noop.js",
        aliases: ["noopjs"],
        body: "window.__agzosRedirect = true;",
        contentType: "application/javascript",
      },
    ],
  }),
  "/filtros/privacidade.txt": "/pixel/rastreio.gif\n",
};

const PAGES: Record<string, string> = {
  // Como o Discord: lê o token, tira do localStorage enquanto aberto e só grava de volta ao
  // descarregar a página. Sem descarregar ao sair, o login se perde.
  "/painel-sessao": `<!doctype html><title>Sessão</title><script>
    const token = localStorage.getItem("token");
    localStorage.removeItem("token");
    document.title = "token=" + (token || "nenhum");
    addEventListener("beforeunload", () => localStorage.setItem("token", "salvo"));
  </script>`,
  "/com-anuncio": `<!doctype html><title>Com anúncio</title>
    <h1>Notícia</h1><div class="caixa-anuncio">ANÚNCIO</div>
    <script src="/anuncios/banner.js"></script>
    <img src="/pixel/rastreio.gif" alt="">`,
  // CSP com nonce, como o YouTube: script inline sem nonce seria recusado.
  "/scriptlet": `<!doctype html><meta http-equiv="Content-Security-Policy"
    content="script-src 'nonce-agzos'"><title>Scriptlet</title>
    <script nonce="agzos">window.viuScriptlet = window.__agzosScriptlet === true;</script>`,
  // Página de login: mesmas regras casariam, mas o Agzos não pode tocar nela.
  "/login": `<!doctype html><title>Entrar</title>
    <div class="caixa-anuncio">caixa</div>
    <script>window.viuScriptlet = window.__agzosScriptlet === true;</script>`,
  "/com-link": `<!doctype html><title>Com link</title><a id="ir" href="LINK">ir</a>`,
  // Trusted Types + nonce, como o YouTube.
  "/tt": `<!doctype html><meta http-equiv="Content-Security-Policy"
    content="require-trusted-types-for 'script'; script-src 'nonce-agzos'"><title>TT</title>
    <script nonce="agzos">window.resultado = "ANUNCIO";</script>`,
  "/busca": `<!doctype html><title>Busca</title>
    <p>agzos um</p><p>outro texto</p><p>agzos dois</p><p>mais agzos três</p>`,
  "/baixar": `<!doctype html><title>Baixar</title><a href="/arquivo/relatorio.txt">relatório</a>`,
  "/formulario": `<!doctype html><title>Formulário</title><input id="nome" value="">`,
  // Player dentro de iframe (como um vídeo embutido do YouTube), com PiP desligado pelo site.
  "/player": `<!doctype html><title>Player</title><canvas id="c" width="320" height="180"></canvas>
    <video id="v" muted playsinline disablepictureinpicture width="320" height="180"></video>
    <script>const c = document.getElementById("c"), x = c.getContext("2d"); let t = 0;
    setInterval(() => { x.fillStyle = "hsl(" + (t++ % 360) + ",80%,50%)"; x.fillRect(0, 0, 320, 180); }, 50);
    const v = document.getElementById("v"); v.srcObject = c.captureStream(20); v.play();</script>`,
  // <video autoplay loop> tocando (fonte local, sem depender da internet) + contador de
  // quadros pintados (requestAnimationFrame para quando a guia sai de cena).
  "/video-vivo": `<!doctype html><title>Vídeo vivo</title>
    <canvas id="c" width="320" height="180" hidden></canvas>
    <video id="v" autoplay loop muted playsinline width="320" height="180"></video>
    <button id="b" style="position: fixed; left: 40px; bottom: 40px; width: 200px; height: 60px"
      onclick="window.cliques = (window.cliques || 0) + 1">clique</button>
    <div style="height: 4000px">rolar</div>
    <script>const c = document.getElementById("c"), x = c.getContext("2d"); let t = 0;
    setInterval(() => { x.fillStyle = "hsl(" + (t++ % 360) + ",80%,50%)"; x.fillRect(0, 0, 320, 180); }, 40);
    const v = document.getElementById("v"); v.srcObject = c.captureStream(25); v.play();
    window.painted = 0; const tick = () => { window.painted++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);</script>`,
  // Login com e-mail e senha (Agzos Key sugere ao clicar no campo) e a tela do código MFA.
  "/entrar-key": `<!doctype html><title>Entrar no site</title>
    <form id="f" onsubmit="event.preventDefault()">
      <input id="email" type="email" name="email" autocomplete="username">
      <input id="senha" type="password" name="senha" autocomplete="current-password">
      <button type="submit">Entrar</button>
    </form>`,
  "/codigo-key": `<!doctype html><title>Código de verificação</title>
    <input id="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6">`,
  "/entrar-shadow": `<!doctype html><title>Entrar com web component</title>
    <login-box></login-box>
    <script>
      customElements.define("login-box", class extends HTMLElement {
        connectedCallback() {
          this.attachShadow({ mode: "open" }).innerHTML =
            '<input id="u" type="email" autocomplete="username">' +
            '<input id="p" type="password" autocomplete="current-password">';
        }
      });
    </script>`,
  "/com-video": `<!doctype html><title>Com vídeo</title><h1>Vídeo</h1>
    <iframe src="/player" width="400" height="240"></iframe>`,
  // 4.5: artigo com menu, barra lateral e rodapé (o modo leitura tira tudo isso).
  "/artigo": `<!doctype html><html lang="pt-BR"><title>Artigo de teste</title>
    <meta name="author" content="Ana Autora">
    <nav class="menu"><a href="/a">Menu do site</a> · <a href="/b">Outro item</a></nav>
    <aside class="sidebar">Publicidade lateral</aside>
    <article><h1>Como o Agzos lê artigos</h1>
      <p>O modo leitura pega o título e o corpo, com tipografia larga, sem o menu do site.
      Este parágrafo tem texto suficiente, com vírgulas, frases e palavras, para contar como corpo.</p>
      <h2>Segunda parte</h2>
      <p>Mais um parágrafo longo do artigo, com <strong>negrito</strong>, um <a href="https://exemplo.com/x">link</a>
      e conteúdo bastante para o extrator, que soma pontos por vírgula, frase e tamanho.</p>
      <p>Terceiro parágrafo do artigo de teste, também longo, para o detector saber que há
      texto de verdade aqui, com frases completas, vírgulas e um pouco mais de conteúdo.</p>
      <ul><li>primeiro item</li><li>segundo item</li></ul>
    </article>
    <footer>Rodapé do site</footer></html>`,
  "/sessao": `<!doctype html><title>Sessão isolada</title><h1>sessão</h1>`,
  // 4.5: botão vermelho Agzos para a mira de elemento.
  "/mira": `<!doctype html><title>Mira</title><body style="margin:0;padding:40px">
    <button id="alvo" style="color:#fff;background:#D10A11;font:600 14px Inter, sans-serif;
      padding:8px 16px;border:0;border-radius:8px;width:200px;height:60px">Comprar</button></body>`,
  "/scratch": `<!doctype html><title>Scratch</title><h1>API</h1>`,
  // 4.8: página com três iframes para o seletor de contexto do DevTools.
  "/v48/quadros": `<!doctype html><title>Quadros</title><body style="margin:0;padding:40px">
    <button id="alvo" style="width:200px;height:60px">Alvo</button>
    <iframe srcdoc="<p>um</p>"></iframe><iframe srcdoc="<p>dois</p>"></iframe>
    <iframe srcdoc="<p>tres</p>"></iframe></body>`,
};

// /instavel derruba a conexão (ERR_EMPTY_RESPONSE) enquanto o "servidor" estiver fora.
let unstableDown = true;

// --- 4.7: rotas do gerenciador de downloads, tema, ColorTools e PDF Tools ---
let v47Pdf: Buffer = Buffer.alloc(0);
const v47Ranges: string[] = [];
const RESUMABLE = Buffer.alloc(1024 * 1024, 9);
const v47Files = new Map<string, Buffer>();
function v47Route(request: http.IncomingMessage, response: http.ServerResponse, url: string) {
  const file = v47Files.get(url);
  if (file) {
    response.writeHead(200, { "content-type": "application/pdf" });
    response.end(file);
    return true;
  }
  if (url === "/v47/doc.pdf") {
    response.writeHead(200, { "content-type": "application/pdf" });
    response.end(v47Pdf);
    return true;
  }
  if (url === "/v47/link-pdf") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end('<!doctype html><title>Link PDF</title><a id="pdf" href="/v47/doc.pdf">PDF</a>');
    return true;
  }
  if (url === "/v47/tema") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><title>Tema</title><body style="margin:0;background:#ffffff;color:#111111">
      <h1 id="t">Texto escuro em fundo claro</h1><img id="foto" src="/pwa/icon.png" width="40" height="40">
      <script>window.marcador = "sem-reload";</script></body>`);
    return true;
  }
  if (url === "/v47/cores") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><title>Cores</title><body style="margin:0;background:#ffffff">
      <div id="azul" style="position:fixed;left:0;top:0;width:400px;height:300px;background:#1c7ed6"></div>
      <p style="position:fixed;left:20px;top:340px;color:#d10a11">texto vermelho</p></body>`);
    return true;
  }
  if (url === "/v47/retomavel.bin") {
    const range = request.headers["range"];
    if (range) v47Ranges.push(String(range));
    const headers = {
      "content-type": "application/octet-stream",
      "content-disposition": 'attachment; filename="retomavel.bin"',
      "accept-ranges": "bytes",
      etag: '"agzos-v47"',
      "last-modified": "Wed, 01 Oct 2026 10:00:00 GMT",
    };
    const match = range ? /bytes=(\d+)-/.exec(String(range)) : null;
    if (match) {
      const start = Number(match[1]);
      response.writeHead(206, {
        ...headers,
        "content-range": `bytes ${start}-${RESUMABLE.length - 1}/${RESUMABLE.length}`,
        "content-length": String(RESUMABLE.length - start),
      });
      response.end(RESUMABLE.subarray(start));
      return true;
    }
    // Primeira vez: manda metade e derruba a conexão (download "interrompido", retomável).
    response.writeHead(200, { ...headers, "content-length": String(RESUMABLE.length) });
    response.write(RESUMABLE.subarray(0, RESUMABLE.length / 2), () =>
      setTimeout(() => request.socket.destroy(), 300),
    );
    return true;
  }
  return false;
}

// Agzos Key de mentira (AGZOS_KEY_URL): cofre Argon2id como o servidor real manda, sem
// t/m/p no authMeta. A chave é o vetor do argon2-browser do Agzos Key (64 MiB, t=3, p=4).
const KEY_PASSWORD = "senha-do-arnaldo";
const KEY_RAW = Buffer.from(
  "f43057afd6ec0bc0819d006d48f669eeb28b2625f6880a71159f8ad74982f465",
  "hex",
);
function keyEncrypt(text: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY_RAW, iv);
  const data = Buffer.concat([cipher.update(text, "utf8"), cipher.final(), cipher.getAuthTag()]);
  return { iv: iv.toString("base64"), data: data.toString("base64") };
}
const KEY_AUTH = keyEncrypt("agzos-key-auth-check-string-v1");
const KEY_META = {
  salt: Buffer.from("000102030405060708090a0b0c0d0e0f", "hex").toString("base64"),
  authCheckIv: KEY_AUTH.iv,
  authCheckData: KEY_AUTH.data,
  kdf: "argon2id",
};
function keyApi(url: string): unknown {
  if (url === "/api/integration/pair/claim") {
    return {
      deviceToken: "t",
      accountEmail: "arnaldo@agzos.com",
      hasVault: true,
      authMeta: KEY_META,
    };
  }
  if (url === "/api/integration/vault/status") {
    return { hasVault: true, accountEmail: "arnaldo@agzos.com", authMeta: KEY_META };
  }
  if (url === "/api/integration/vault/sync") {
    const entry = {
      id: "c1",
      title: "Login local",
      url: origin,
      username: "arnaldo@agzos.com",
      password: "segredo",
      totpSecret: "JBSWY3DPEHPK3PXP",
      updatedAt: 1,
    };
    return {
      entries: [{ id: "c1", ...keyEncrypt(JSON.stringify(entry)), version: 1 }],
      syncedAt: 1,
    };
  }
  return null;
}

// Groq de mentira (4.0): mesma API compatível com OpenAI, respostas em streaming lento.
const GROQ_KEY = "gsk_e2e_0123456789abcdefghijklmnopqrst";
// PNG 4×4 vermelho (ícone do PWA e imagem do visualizador).
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGO4YqIARwzEcQDsgxKBAWEG3AAAAABJRU5ErkJggg==",
  "base64",
);
const groqCalls: { url: string; auth: string; body: string }[] = [];
// Linux sem chaveiro (xvfb): o safeStorage só cifra com a senha básica do Chromium.
const GROQ_ENV = (_profile: string) => ({
  AGZOS_GROQ_BASE_URL: `${origin}/groq`,
  AGZOS_TEST_BASIC_KEYRING: "1",
});
function groq(request: http.IncomingMessage, response: http.ServerResponse, url: string) {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    const auth = String(request.headers.authorization ?? "");
    groqCalls.push({ url, auth, body });
    if (auth !== `Bearer ${GROQ_KEY}`) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { code: "invalid_api_key", message: "Invalid" } }));
      return;
    }
    // Modo voz (4.1): o Whisper de mentira devolve um comando.
    if (url === "/groq/audio/transcriptions") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          text: body.includes("whisper-large-v3-turbo") ? "echo VOZ-$((20+3))" : "?",
        }),
      );
      return;
    }
    if (url === "/groq/models") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          data: [{ id: "llama-3.3-70b-versatile" }, { id: "llama-3.1-8b-instant" }],
        }),
      );
      return;
    }
    // 4.1.1: modo agente (sem streaming): plano em JSON ou o resultado de uma etapa.
    let parsed: { stream?: boolean; response_format?: unknown; messages?: { content: string }[] } =
      {};
    try {
      parsed = JSON.parse(body);
    } catch {
      parsed = {};
    }
    if (url === "/groq/chat/completions" && !parsed.stream) {
      const last = parsed.messages?.at(-1)?.content ?? "";
      const content = parsed.response_format
        ? JSON.stringify({
            steps: [
              { id: "s1", title: "Pesquisar", tool: "groq", prompt: "pesquise o tema", after: [] },
              { id: "s2", title: "Resumir", tool: "groq", prompt: "resuma", after: ["s1"] },
            ],
          })
        : last.includes("RESULTADO-1")
          ? "RESULTADO-2 (recebeu a etapa anterior)"
          : "RESULTADO-1";
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    // 4.1.3: "HTML" na pergunta traz um artifact; o resto, markdown com negrito.
    const asked = parsed.messages?.at(-1)?.content ?? "";
    const parts = asked.includes("HTML")
      ? [
          "Olá do Groq em streaming.\n\n```html\n",
          "<!doctype html><title>Artifact de teste</title>\n",
          "<h1>Artifact de teste</h1>\n```",
        ]
      : asked.includes("Primeira") || asked.includes("De novo")
        ? ["Olá ", "do **Groq**", " em streaming."]
        : ["Olá ", "do Groq", " em streaming."];
    let index = 0;
    const timer = setInterval(() => {
      const text = parts[index++];
      if (text === undefined) {
        clearInterval(timer);
        response.end("data: [DONE]\n\n");
        return;
      }
      response.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
    }, 700);
    response.on("close", () => clearInterval(timer));
  });
}

test.beforeAll(async () => {
  server = http.createServer((request, response) => {
    const url = request.url ?? "/";
    if (v47Route(request, response, url)) return;
    if (url.startsWith("/groq/")) {
      groq(request, response, url);
      return;
    }
    if (url.startsWith("/api/integration/")) {
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(keyApi(url) ?? {}));
      });
      return;
    }
    if (FILTERS[url]) {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(FILTERS[url]);
      return;
    }
    if (url === "/anuncios/banner.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end("window.anuncioCarregou = true;");
      return;
    }
    if (url === "/pixel/rastreio.gif") {
      response.writeHead(200, { "content-type": "image/gif" });
      response.end();
      return;
    }
    if (url === "/arquivo/relatorio.txt") {
      response.writeHead(200, {
        "content-type": "text/plain",
        "content-disposition": 'attachment; filename="relatorio.txt"',
      });
      response.end("conteúdo do relatório agzos\n");
      return;
    }
    if (url === "/arquivo/lento.bin") {
      // 24 pedaços de 64 KB a cada 120 ms: dá tempo de pausar e retomar.
      const chunk = Buffer.alloc(64 * 1024, 7);
      response.writeHead(200, {
        "content-type": "application/octet-stream",
        "content-length": String(chunk.length * 24),
        "content-disposition": 'attachment; filename="lento.bin"',
      });
      let sent = 0;
      const timer = setInterval(() => {
        response.write(chunk);
        if (++sent === 24) {
          clearInterval(timer);
          response.end();
        }
      }, 120);
      request.on("close", () => clearInterval(timer));
      return;
    }
    // Latência de site real (a página nunca chega antes do CDP registrar os scriptlets).
    if (url === "/scriptlet") {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(PAGES[url]);
      }, 150);
      return;
    }
    if (url.startsWith("/com-link?para=")) {
      const target = decodeURIComponent(url.slice("/com-link?para=".length));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(PAGES["/com-link"]!.replace("LINK", target));
      return;
    }
    // 4.1.1: PWA instalável (manifesto + service worker em 127.0.0.1, que conta como seguro).
    if (url === "/pwa/" || url === "/pwa/index.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        '<!doctype html><title>App PWA</title><link rel="manifest" href="/pwa/manifest.json">' +
          "<h1>PWA</h1><script>navigator.serviceWorker.register('/pwa/sw.js', { scope: '/pwa/' })</script>",
      );
      return;
    }
    if (url === "/pwa/manifest.json") {
      response.writeHead(200, { "content-type": "application/manifest+json" });
      response.end(
        JSON.stringify({
          name: "Agzos Teste PWA",
          short_name: "Teste",
          start_url: "/pwa/",
          scope: "/pwa/",
          display: "standalone",
          theme_color: "#d43420",
          icons: [{ src: "/pwa/icon.png", sizes: "192x192", type: "image/png" }],
        }),
      );
      return;
    }
    // 4.1.3: app de página única sem service worker, com o manifesto posto depois da carga.
    if (url === "/pwa-spa/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(
        "<!doctype html><title>App SPA</title><h1>SPA</h1><script>setTimeout(() => {" +
          "const link = document.createElement('link'); link.rel = 'manifest';" +
          "link.href = '/pwa-spa/manifest.json'; document.head.append(link); }, 1500)</script>",
      );
      return;
    }
    if (url === "/pwa-spa/manifest.json") {
      response.writeHead(200, { "content-type": "application/manifest+json" });
      response.end(
        JSON.stringify({
          name: "Agzos SPA",
          start_url: "/pwa-spa/",
          display: "standalone",
          icons: [{ src: "/pwa/icon.png", sizes: "512x512", type: "image/png" }],
        }),
      );
      return;
    }
    if (url === "/pwa/sw.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end("self.addEventListener('fetch', () => {});");
      return;
    }
    if (url === "/pwa/icon.png") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(TINY_PNG);
      return;
    }
    // 4.5: eco do API Scratchpad (método e corpo de volta em JSON).
    if (url === "/api/eco") {
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        let parsed: unknown = body;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = body;
        }
        response.end(JSON.stringify({ metodo: request.method, corpo: parsed }));
      });
      return;
    }
    if (url === "/instavel" && unstableDown) {
      request.socket.destroy();
      return;
    }
    const html = PAGES[url] ?? (url.startsWith("/sessao?") ? PAGES["/sessao"] : undefined);
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    if (html) {
      response.end(html);
      return;
    }
    const name = url.slice(1) || "a";
    response.end(`<!doctype html><title>Página ${name.toUpperCase()}</title><h1>${name}</h1>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  v47Pdf = Buffer.from(await makeV47Pdf());
});

/** PDF de 3 páginas com texto grande (OCR) e um formulário. */
async function makeV47Pdf() {
  const { PDFDocument, StandardFonts, rgb } = await import("@cantoo/pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let index = 1; index <= 3; index++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`AGZOS PAGINA ${index}`, { x: 60, y: 700, size: 40, font, color: rgb(0, 0, 0) });
  }
  const form = doc.getForm();
  form.createTextField("nome").addToPage(doc.getPage(0), { x: 60, y: 600, width: 220, height: 26 });
  return doc.save();
}

test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

function tempProfile() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agzos-e2e-"));
}

async function launch(
  profile: string,
  extraEnv: Record<string, string> = {},
  extraArgs: string[] = [],
): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: ["--no-sandbox", ...extraArgs, root],
    cwd: root,
    env: {
      ...process.env,
      AGZOS_USER_DATA: profile,
      AGZOS_DOWNLOADS_DIR: path.join(profile, "Downloads"),
      // Listas locais: o teste não depende da internet nem das listas reais.
      AGZOS_FILTER_LISTS: JSON.stringify({
        ads: [`${origin}/filtros/anuncios.txt`],
        privacy: [`${origin}/filtros/privacidade.txt`],
        resources: `${origin}/filtros/recursos.json`,
      }),
      ...extraEnv,
    },
  });
  const window = await app.firstWindow();
  await window.locator('.browser-stage[data-ready="true"]').waitFor();
  return { app, window };
}

const tabs = (window: Page) => window.locator(".browser-tab");
const omnibox = (window: Page) => window.getByLabel("Pesquisar ou digitar endereço");

async function go(window: Page, url: string) {
  await omnibox(window).fill(url);
  await omnibox(window).press("Enter");
}

/** Roda JavaScript na aba cuja URL é `url` e devolve o resultado. */
async function inTab<T>(app: ElectronApplication, url: string, code: string): Promise<T> {
  return app.evaluate(
    ({ webContents }, [target, source]) =>
      webContents
        .getAllWebContents()
        .find((contents) => contents.getURL() === target)!
        .executeJavaScript(source!),
    [url, code] as const,
  ) as Promise<T>;
}

/** Tecla com o foco dentro da página (passa pelo before-input-event da aba). */
async function keyInTab(
  app: ElectronApplication,
  url: string,
  keyCode: string,
  modifiers: string[] = [],
) {
  await app.evaluate(
    ({ webContents }, [target, key, mods]) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === target)!;
      contents.focus();
      contents.sendInputEvent({
        type: "keyDown",
        keyCode: key as string,
        modifiers: mods as ("control" | "shift" | "alt")[],
      });
      contents.sendInputEvent({
        type: "keyUp",
        keyCode: key as string,
        modifiers: mods as ("control" | "shift" | "alt")[],
      });
    },
    [url, keyCode, modifiers] as const,
  );
}

const MOD = process.platform === "darwin" ? "Meta" : "Control";

/** Espera o motor de filtros ficar pronto (o rodapé do painel mostra a data das listas). */
async function waitForFilters(app: ElectronApplication, window: Page) {
  await window.getByRole("button", { name: /bloqueados/ }).click();
  // O painel abre na camada acima da página (dist/overlay.html).
  const layer = await overlayPage(app);
  await expect(layer.getByText(/atualizadas em/)).toBeVisible({ timeout: 20_000 });
  await layer.getByRole("button", { name: "Fechar proteção" }).click();
}

/** URLs de todos os WebContents de página (abas) vivos no main process. */
async function liveViews(app: ElectronApplication, needle: string) {
  return app.evaluate(
    ({ webContents }, text) =>
      webContents
        .getAllWebContents()
        .map((contents) => contents.getURL())
        .filter((url) => url.includes(text)),
    needle,
  );
}

/** Camada nativa pelo título da página (agzos-preview, agzos-switcher). */
async function layerState(app: ElectronApplication, title: string) {
  return app.evaluate(async ({ BrowserWindow }, wanted) => {
    for (const window of BrowserWindow.getAllWindows()) {
      const children = window.contentView.children;
      for (const child of children) {
        const contents = (child as { webContents?: Electron.WebContents }).webContents;
        if (!contents || contents.isDestroyed() || contents.getTitle() !== wanted) continue;
        const bounds = (child as Electron.WebContentsView).getBounds();
        const info = (await contents.executeJavaScript(`({
            text: document.body.innerText,
            cards: [...document.querySelectorAll("a.card")].map((card) => ({
              title: card.innerText.trim(),
              image: Boolean(card.querySelector(".shot img")),
              selected: card.classList.contains("selected"),
            })),
          })`)) as { text: string; cards: { title: string; image: boolean; selected: boolean }[] };
        return {
          visible: bounds.width > 0 && bounds.height > 0,
          onTop: children.at(-1) === child,
          ...info,
        };
      }
    }
    return { visible: false, onTop: false, text: "", cards: [] };
  }, title);
}

test("navega de verdade, sincroniza título e voltar/avançar", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, `${origin}/a`);
    await expect(tabs(window).first()).toContainText("Página A");
    await go(window, `${origin}/b`);
    await expect(tabs(window).first()).toContainText("Página B");

    await window.getByRole("button", { name: "Voltar" }).click();
    await expect(tabs(window).first()).toContainText("Página A");
    await expect(omnibox(window)).toHaveValue(`${origin}/a`);
    await window.getByRole("button", { name: "Avançar" }).click();
    await expect(omnibox(window)).toHaveValue(`${origin}/b`);
  } finally {
    await app.close();
  }
});

test("identidade de Chrome segue ativa nas abas", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, `${origin}/ua`);
    await expect(tabs(window).first()).toContainText("Página UA");
    const identity = await app.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === url);
      return contents?.executeJavaScript(
        `({ ua: navigator.userAgent, app: typeof window.chrome?.app, csi: typeof window.chrome?.csi,
            brands: navigator.userAgentData?.brands?.map((b) => b.brand) ?? [] })`,
      );
    }, `${origin}/ua`);
    expect(identity.ua).not.toMatch(/Electron|agzos/i);
    expect(identity.ua).toMatch(/Chrome\/\d+\.0\.0\.0/);
    expect(identity.app).toBe("object");
    expect(identity.csi).toBe("function");
    expect(identity.brands).toContain("Google Chrome");
  } finally {
    await app.close();
  }
});

test("fechar a aba destrói o WebContentsView", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();
    await go(window, `${origin}/fechar`);
    await expect(tabs(window).last()).toContainText("Página FECHAR");
    expect(await liveViews(app, "/fechar")).toHaveLength(1);
    await tabs(window)
      .last()
      .getByLabel(/^Fechar /)
      .click();
    await expect(tabs(window)).toHaveCount(1);
    await expect.poll(() => liveViews(app, "/fechar")).toHaveLength(0);
  } finally {
    await app.close();
  }
});

test("estado persiste no SQLite entre reinícios; aba anônima não", async () => {
  const profile = tempProfile();
  const first = await launch(profile);
  await go(first.window, `${origin}/salva`);
  await expect(tabs(first.window).first()).toContainText("Página SALVA");
  await first.window.getByRole("button", { name: "Nova aba anônima" }).click();
  await go(first.window, `${origin}/secreta`);
  // 4.5: o tema escuro é o padrão; trocar para o claro também persiste.
  await first.window.getByRole("button", { name: "Usar tema claro" }).click();
  // Deixa o debounce de gravação terminar antes de fechar.
  await first.window.waitForTimeout(800);
  await first.app.close();

  expect(fs.existsSync(path.join(profile, "agzos.db"))).toBe(true);

  const second = await launch(profile);
  try {
    await expect(tabs(second.window)).toHaveCount(1);
    await expect(tabs(second.window).first()).toContainText("Página SALVA");
    await expect(second.window.locator(".browser-stage")).not.toHaveClass(/dark/);
    const stored = await second.app.evaluate(
      async (_electron, file) => {
        const { DatabaseSync } = process.getBuiltinModule(
          "node:sqlite",
        ) as typeof import("node:sqlite");
        const db = new DatabaseSync(file, { readOnly: true });
        const rows = db.prepare("SELECT key, value FROM kv").all() as {
          key: string;
          value: string;
        }[];
        db.close();
        return Object.fromEntries(rows.map((row) => [row.key, row.value]));
      },
      path.join(profile, "agzos.db"),
    );
    expect(
      Object.keys(stored)
        .filter((key) => !key.startsWith("meta:"))
        .sort(),
    ).toEqual(["bookmarks", "closedTabs", "colors", "dial", "links", "notes", "prefs", "version"]);
    // 1.7: a sessão (guias) é de cada janela e fica no registro das janelas.
    expect(stored["meta:windows"]).toContain("/salva");
    expect(JSON.stringify(stored)).not.toContain("secreta");
  } finally {
    await second.app.close();
  }
});

test("migra o estado da 1.3 (localStorage) para o SQLite", async () => {
  const profile = tempProfile();
  const legacyTabs = [
    {
      id: 1727000000000,
      history: [{ title: "Legado", url: `${origin}/legado`, kind: "page" }],
      index: 0,
    },
  ];
  const first = await launch(profile);
  await first.window.evaluate((tabsJson) => {
    window.localStorage.setItem("agzos-tabs", tabsJson);
    window.localStorage.setItem("agzos-theme", "dark");
    window.localStorage.setItem("agzos-tab-orientation", "vertical");
  }, JSON.stringify(legacyTabs));
  await first.app.close();
  // Simula o primeiro boot da 1.4: sem banco ainda.
  for (const file of fs.readdirSync(profile)) {
    if (file.startsWith("agzos.db")) fs.rmSync(path.join(profile, file));
  }

  const second = await launch(profile);
  try {
    await expect(second.window.locator(".tabs-rail")).toBeVisible();
    await expect(tabs(second.window).first()).toContainText("Página LEGADO");
    await expect(second.window.locator(".browser-stage")).toHaveClass(/dark/);
    const leftovers = await second.window.evaluate(() =>
      Object.keys(window.localStorage).filter(
        (key) => key.startsWith("agzos-") && key !== "agzos-credentials",
      ),
    );
    expect(leftovers).toEqual([]);
  } finally {
    await second.app.close();
  }
});

test("adblock bloqueia de verdade, conta por página e pausa por site", async () => {
  const { app, window } = await launch(tempProfile());
  const url = `${origin}/com-anuncio`;
  try {
    await waitForFilters(app, window);
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Com anúncio");
    const pill = window.getByRole("button", { name: /bloqueados/ });
    await expect(pill.locator("strong")).toHaveText("2");
    await expect
      .poll(() =>
        inTab(
          app,
          url,
          `({ script: Boolean(window.anuncioCarregou),
              caixa: getComputedStyle(document.querySelector(".caixa-anuncio")).display })`,
        ),
      )
      .toEqual({ script: false, caixa: "none" });

    await pill.click();
    const layer = await overlayPage(app);
    const panel = layer.getByRole("complementary", { name: "Rastreadores bloqueados" });
    await expect(panel).toContainText("2 bloqueados nesta página");
    await expect(panel).toContainText("Anúncios");
    await expect(panel).toContainText("Rastreadores");
    await panel.getByText("Pausar neste site").click();
    await layer.getByRole("button", { name: "Fechar proteção" }).click();
    await window.getByRole("button", { name: "Recarregar" }).click();
    await expect.poll(() => inTab(app, url, "Boolean(window.anuncioCarregou)")).toBe(true);
    await expect(pill.locator("strong")).toHaveText("0");
  } finally {
    await app.close();
  }
});

test("downloads: salva na pasta, mostra progresso, pausa/retoma e persiste", async () => {
  const profile = tempProfile();
  const downloadsDir = path.join(profile, "Downloads");
  fs.mkdirSync(downloadsDir, { recursive: true });
  fs.writeFileSync(path.join(downloadsDir, "relatorio.txt"), "já existia");
  const first = await launch(profile);
  try {
    await go(first.window, `${origin}/arquivo/relatorio.txt`);
    const button = first.window.getByRole("button", { name: "Downloads", exact: true });
    await expect(button).toBeVisible();
    // 4.7: Ctrl+J abre o gerenciador; o botão da barra abre o painel rápido.
    await button.click();
    const panel = (await overlayPage(first.app)).getByRole("complementary", { name: "Downloads" });
    // Nome já existia na pasta: vira "relatorio (1).txt".
    await expect(panel).toContainText("relatorio (1).txt");
    await expect
      .poll(() => fs.readFileSync(path.join(downloadsDir, "relatorio (1).txt"), "utf8"))
      .toContain("relatório agzos");

    await button.click();
    await go(first.window, `${origin}/arquivo/lento.bin`);
    await button.click();
    await expect(panel.getByRole("progressbar")).toBeVisible();
    await panel.getByRole("button", { name: "Pausar lento.bin" }).click();
    await expect(panel).toContainText("Pausado");
    await panel.getByRole("button", { name: "Retomar lento.bin" }).click();
    await expect(panel.locator('[data-state="completed"]')).toHaveCount(2, { timeout: 15_000 });
    expect(fs.statSync(path.join(downloadsDir, "lento.bin")).size).toBe(24 * 64 * 1024);
  } finally {
    await first.app.close();
  }

  const second = await launch(profile);
  try {
    await second.window.getByRole("button", { name: "Downloads", exact: true }).click();
    const panel = (await overlayPage(second.app)).getByRole("complementary", { name: "Downloads" });
    await expect(panel).toContainText("relatorio (1).txt");
    await expect(panel).toContainText("lento.bin");
    await panel.getByRole("button", { name: "Remover lento.bin" }).click();
    await expect(panel).not.toContainText("lento.bin");
    await panel.getByRole("button", { name: "Limpar concluídos" }).click();
    await expect(panel).toContainText("Os arquivos que você baixar aparecem aqui.");
    await expect(second.window.getByRole("button", { name: "Downloads", exact: true })).toHaveCount(
      0,
    );
  } finally {
    await second.app.close();
  }
});

test("Ctrl+F busca na página, com o foco na casca ou na página", async () => {
  const { app, window } = await launch(tempProfile());
  const url = `${origin}/busca`;
  try {
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Busca");
    await keyInTab(app, url, "F", ["control"]);
    const input = window.getByRole("textbox", { name: "Buscar na página" });
    await expect(input).toBeFocused();
    await input.fill("agzos");
    const status = window.locator(".find-status");
    await expect(status).toHaveText("1 de 3");
    await input.press("Enter");
    await expect(status).toHaveText("2 de 3");
    await input.press("Shift+Enter");
    await expect(status).toHaveText("1 de 3");
    await input.fill("inexistente");
    await expect(status).toHaveText("Nenhum resultado");
    await input.press("Escape");
    await expect(input).toHaveCount(0);
    // Na página inicial não há o que buscar: Ctrl+F não abre a barra.
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();
    await window.keyboard.press(`${MOD}+f`);
    await expect(input).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("zoom por site com Ctrl +/−/0, indicador e persistência", async () => {
  const profile = tempProfile();
  const url = `${origin}/zoom`;
  const factor = (app: ElectronApplication) =>
    app.evaluate(
      ({ webContents }, target) =>
        webContents
          .getAllWebContents()
          .find((contents) => contents.getURL() === target)
          ?.getZoomFactor(),
      url,
    );
  const first = await launch(profile);
  try {
    await go(first.window, url);
    await expect(tabs(first.window).first()).toContainText("Página ZOOM");
    await first.window.keyboard.press(`${MOD}+=`);
    await keyInTab(first.app, url, "=", ["control"]);
    await expect(first.window.locator(".zoom-pill")).toHaveText("125%");
    await expect.poll(() => factor(first.app)).toBeCloseTo(1.25);
  } finally {
    await first.app.close();
  }

  const second = await launch(profile);
  try {
    await expect(tabs(second.window).first()).toContainText("Página ZOOM");
    await expect(second.window.locator(".zoom-pill")).toHaveText("125%");
    await expect.poll(() => factor(second.app)).toBeCloseTo(1.25);
    await second.window.locator(".zoom-pill").click();
    await expect(second.window.locator(".zoom-pill")).toHaveCount(0);
    await expect.poll(() => factor(second.app)).toBeCloseTo(1);
  } finally {
    await second.app.close();
  }
});

test("atalhos com o foco na página: Ctrl+Tab, Ctrl+1/9, Alt+←, Ctrl+T", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, `${origin}/um`);
    await expect(tabs(window).first()).toContainText("Página UM");
    await go(window, `${origin}/dois`);
    await expect(tabs(window).first()).toContainText("Página DOIS");
    await keyInTab(app, `${origin}/dois`, "Left", ["alt"]);
    await expect(omnibox(window)).toHaveValue(`${origin}/um`);

    await keyInTab(app, `${origin}/um`, "T", ["control"]);
    await expect(tabs(window)).toHaveCount(2);
    await go(window, `${origin}/tres`);
    await expect(tabs(window).last()).toContainText("Página TRES");

    // Ctrl+Tab: ordem de uso (volta para a UM), confirmado ao soltar o Ctrl.
    await keyInTab(app, `${origin}/tres`, "Tab", ["control"]);
    await keyInTab(app, `${origin}/tres`, "Control");
    await expect(window.locator(".browser-tab.active")).toContainText("Página UM");
    await keyInTab(app, `${origin}/um`, "9", ["control"]);
    await expect(window.locator(".browser-tab.active")).toContainText("Página TRES");
    await keyInTab(app, `${origin}/tres`, "1", ["control"]);
    await expect(window.locator(".browser-tab.active")).toContainText("Página UM");
  } finally {
    await app.close();
  }
});

test("fechar o app com download em andamento não trava e o registra como cancelado", async () => {
  const profile = tempProfile();
  const first = await launch(profile);
  await go(first.window, `${origin}/a`);
  await expect(tabs(first.window).first()).toContainText("Página A");
  await go(first.window, `${origin}/arquivo/lento.bin`);
  await expect(first.window.getByRole("button", { name: "Downloads", exact: true })).toBeVisible();
  const started = Date.now();
  await first.app.close();
  expect(Date.now() - started).toBeLessThan(5_000);

  const second = await launch(profile);
  try {
    await second.window.getByRole("button", { name: "Downloads", exact: true }).click();
    const panel = (await overlayPage(second.app)).getByRole("complementary", { name: "Downloads" });
    await expect(panel.locator('[data-state="cancelled"]')).toContainText("Cancelado");
  } finally {
    await second.app.close();
  }
});

test("seletor do Ctrl+Tab com miniaturas das páginas, confirmado ao soltar o Ctrl", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, `${origin}/um`);
    await expect(tabs(window).first()).toContainText("Página UM");
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();
    await go(window, `${origin}/dois`);
    await expect(tabs(window).last()).toContainText("Página DOIS");
    // Ctrl pressionado + Tab, sem soltar: o seletor aparece por cima da página (camada).
    await app.evaluate(({ webContents }, target) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === target)!;
      contents.focus();
      contents.sendInputEvent({ type: "keyDown", keyCode: "Control", modifiers: ["control"] });
      contents.sendInputEvent({ type: "keyDown", keyCode: "Tab", modifiers: ["control"] });
    }, `${origin}/dois`);
    await expect.poll(async () => (await layerState(app, "agzos-switcher")).visible).toBe(true);
    // A foto da guia ativa sai quando o seletor abre e chega logo depois.
    await expect
      .poll(async () => (await layerState(app, "agzos-switcher")).cards.every((card) => card.image))
      .toBe(true);
    const layer = await layerState(app, "agzos-switcher");
    expect(layer.onTop).toBe(true);
    expect(layer.cards.map((card) => card.title)).toEqual(["Página DOIS", "Página UM"]);
    expect(layer.cards.map((card) => card.selected)).toEqual([false, true]);
    // As duas abas já estiveram visíveis: as duas têm miniatura de verdade.
    expect(layer.cards.every((card) => card.image)).toBe(true);
    await keyInTab(app, `${origin}/dois`, "Control");
    await expect.poll(async () => (await layerState(app, "agzos-switcher")).visible).toBe(false);
    await expect(window.locator(".browser-tab.active")).toContainText("Página UM");
  } finally {
    await app.close();
  }
});

test("scriptlets (+js) rodam antes dos scripts da página, mesmo com CSP de nonce", async () => {
  const { app, window } = await launch(tempProfile());
  const url = `${origin}/scriptlet`;
  try {
    await waitForFilters(app, window);
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Scriptlet");
    // Já na primeira carga de uma guia nova (a guia passa antes por about:blank).
    await expect.poll(() => inTab(app, url, "window.viuScriptlet")).toBe(true);
    // O about:blank da preparação não fica no histórico.
    await expect(window.getByRole("button", { name: "Voltar" })).toBeDisabled();
    // E nas recargas.
    for (let i = 0; i < 2; i++) {
      await window.getByRole("button", { name: "Recarregar" }).click();
      await window.waitForTimeout(700);
      await expect.poll(() => inTab(app, url, "window.viuScriptlet")).toBe(true);
    }
  } finally {
    await app.close();
  }
});

test("sugestões da omnibox por cima da página mostram a foto dela no lugar (não fica preto)", async () => {
  // Os painéis da toolbar abrem na camada acima da página (1.5.4); a lista da omnibox
  // continua na casca: a guia sai da frente e uma foto entra no lugar.
  const { app, window } = await launch(tempProfile(), { AGZOS_DEBUG_OVERLAY: "1" });
  const url = `${origin}/foto`;
  try {
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Página FOTO");
    await window.waitForTimeout(400);
    await omnibox(window).fill("agzos foto");
    await expect(window.getByRole("listbox")).toBeVisible();
    const photo = window.locator(".view-snapshot");
    await expect(photo).toBeVisible();
    expect(await photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100);
    // O WebContentsView saiu da frente (senão cobriria a lista).
    await expect
      .poll(() =>
        app.evaluate(({ BrowserWindow }, target) => {
          const win = BrowserWindow.getAllWindows()[0]!;
          const view = win.contentView.children.find(
            (child) =>
              "webContents" in child &&
              (child as { webContents: Electron.WebContents }).webContents.getURL() === target,
          );
          return view?.getBounds().width ?? -1;
        }, url),
      )
      .toBe(0);
    expect(
      await app.evaluate(
        () => (globalThis as { __agzosOverlay?: Record<string, number> }).__agzosOverlay,
      ),
    ).toEqual({ "live-overlay": 0, "snapshot-fallback": 1 });
    await omnibox(window).press("Escape");
    await omnibox(window).blur();
    await expect(photo).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("páginas de login ficam intocadas: sem scriptlet, sem CSS de ocultação", async () => {
  const { app, window } = await launch(tempProfile());
  const url = `${origin}/login`;
  try {
    await waitForFilters(app, window);
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Entrar");
    await window.waitForTimeout(800);
    expect(
      await inTab(
        app,
        url,
        `({ scriptlet: window.viuScriptlet,
            caixa: getComputedStyle(document.querySelector(".caixa-anuncio")).display })`,
      ),
    ).toEqual({ scriptlet: false, caixa: "block" });
  } finally {
    await app.close();
  }
});

test("identidade de Chrome vale em toda carga da guia (recarga, mesma origem, outra origem)", async () => {
  // Regressão da 1.3.3–1.3.6: o shim só valia na primeira carga da guia; entrar pelo
  // "Fazer login" do google.com (navegação na mesma guia) chegava sem window.chrome.app
  // e o Google recusava o login.
  const { app, window } = await launch(tempProfile());
  const identity = (needle: string) =>
    app.evaluate(
      ({ webContents }, text) =>
        webContents
          .getAllWebContents()
          .find((contents) => contents.getURL().includes(text))!
          .executeJavaScript(
            "[typeof chrome.app, typeof chrome.csi, typeof chrome.loadTimes, " +
              "navigator.userAgentData.brands.some((b) => b.brand === 'Google Chrome')].join()",
          ),
      needle,
    );
  const expected = "object,function,function,true";
  try {
    await go(window, `${origin}/id1`);
    await expect(tabs(window).first()).toContainText("Página ID1");
    expect(await identity("/id1")).toBe(expected);

    await window.getByRole("button", { name: "Recarregar" }).click();
    await window.waitForTimeout(800);
    expect(await identity("/id1")).toBe(expected);

    await go(window, `${origin}/id2`);
    await expect(tabs(window).first()).toContainText("Página ID2");
    expect(await identity("/id2")).toBe(expected);

    const other = origin.replace("127.0.0.1", "localhost");
    await go(window, `${other}/id3`);
    await expect(tabs(window).first()).toContainText("Página ID3");
    expect(await identity("/id3")).toBe(expected);

    await window.getByRole("button", { name: "Voltar" }).click();
    await expect(tabs(window).first()).toContainText("Página ID2");
    expect(await identity("/id2")).toBe(expected);
  } finally {
    await app.close();
  }
});

test("scriptlets ao chegar por link (navegação iniciada pela página)", async () => {
  const { app, window } = await launch(tempProfile());
  const other = origin.replace("127.0.0.1", "localhost");
  const target = `${other}/scriptlet`;
  try {
    await waitForFilters(app, window);
    const start = `${origin}/com-link?para=${encodeURIComponent(target)}`;
    await go(window, start);
    await expect(tabs(window).first()).toContainText("Com link");
    await inTab(app, start, "document.getElementById('ir').click(), true");
    await expect(tabs(window).first()).toContainText("Scriptlet");
    const state = await inTab(
      app,
      target,
      "JSON.stringify({ antes: window.viuScriptlet, rodou: window.__agzosScriptlet === true })",
    );
    console.log("LINK", state);
    expect(JSON.parse(state as string).rodou).toBe(true);
  } finally {
    await app.close();
  }
});

test("scriptlet do mundo isolado reescreve script inline mesmo com Trusted Types (como no YouTube)", async () => {
  const { app, window } = await launch(tempProfile());
  const url = `${origin}/tt`;
  try {
    await waitForFilters(app, window);
    await go(window, url);
    await expect(tabs(window).first()).toContainText("TT");
    // Da carga seguinte em diante o registro vale antes de qualquer script da página.
    await window.getByRole("button", { name: "Recarregar" }).click();
    await expect.poll(() => inTab(app, url, "window.resultado")).toBe("LIMPO");
  } finally {
    await app.close();
  }
});

/** Roda JavaScript na aba como se viesse de um clique (pedidos de permissão). */
async function withGesture<T>(app: ElectronApplication, url: string, code: string): Promise<T> {
  return app.evaluate(
    ({ webContents }, [target, source]) =>
      webContents
        .getAllWebContents()
        .find((contents) => contents.getURL() === target)!
        .executeJavaScript(source!, true),
    [url, code] as const,
  ) as Promise<T>;
}

test("1.6: histórico das navegações reais (sem a anônima), sugestão na omnibox e reinício", async () => {
  const profile = tempProfile();
  const first = await launch(profile);
  await go(first.window, `${origin}/historia-um`);
  await expect(tabs(first.window).first()).toContainText("Página HISTORIA-UM");
  await go(first.window, `${origin}/historia-dois`);
  await expect(tabs(first.window).first()).toContainText("Página HISTORIA-DOIS");
  await first.window.getByRole("button", { name: "Nova aba anônima" }).click();
  await go(first.window, `${origin}/historia-secreta`);
  await expect(tabs(first.window).last()).toContainText("Página HISTORIA-SECRETA");
  await first.app.close();

  const second = await launch(profile);
  const { window } = second;
  try {
    // Omnibox: o histórico aparece como sugestão e o título veio da página.
    await omnibox(window).fill("");
    await omnibox(window).pressSequentially("historia");
    const list = window.getByRole("listbox", { name: "Sugestões" });
    await expect(list.getByRole("option", { name: /Página HISTORIA-UM/ })).toBeVisible();
    await expect(list.getByRole("option", { name: /SECRETA/ })).toHaveCount(0);
    await omnibox(window).press("Escape");

    await window.keyboard.press("Control+h");
    const page = window.locator(".library-page");
    await expect(page.getByRole("heading", { name: "Histórico", level: 1 })).toBeVisible();
    await expect(page.locator(".library-row")).toHaveCount(2);
    await expect(page.getByText("Página HISTORIA-DOIS")).toBeVisible();
    // Clicar abre o site na aba do histórico (vira página de verdade).
    await page.getByText("Página HISTORIA-UM").click();
    await expect(tabs(window).last()).toContainText("Página HISTORIA-UM");
    await expect.poll(() => liveViews(second.app, "/historia-um")).toHaveLength(1);
  } finally {
    await second.app.close();
  }
});

test("1.6: permissão lembrada vale depois de reiniciar; bloqueio vira 'denied'", async () => {
  const profile = tempProfile();
  const url = `${origin}/notificacoes`;
  const first = await launch(profile);
  try {
    await go(first.window, url);
    await expect(tabs(first.window).first()).toContainText("Página NOTIFICACOES");
    // Sem decisão, a página continua vendo "default" (identidade de Chrome intacta).
    expect(await inTab(first.app, url, "Notification.permission")).toBe("default");
    const asked = withGesture<string>(first.app, url, "Notification.requestPermission()");
    const bar = first.window.getByRole("alertdialog", { name: "Pedido de permissão" });
    await expect(bar).toContainText("quer mostrar notificações");
    // A faixa fica acima da página nativa (antes flutuava e ficava atrás dela).
    const barBox = (await bar.boundingBox())!;
    // O WebContentsView ocupa a caixa do .native-view (setBounds).
    const frame = (await first.window.locator(".native-view").boundingBox())!;
    expect(barBox.y + barBox.height).toBeLessThanOrEqual(frame.y + 1);
    await bar.getByRole("button", { name: "Permitir" }).click();
    expect(await asked).toBe("granted");
  } finally {
    await first.app.close();
  }

  const second = await launch(profile);
  const { window } = second;
  try {
    // A sessão volta com a página aberta.
    await expect(tabs(window).first()).toContainText("Página NOTIFICACOES");
    await expect
      .poll(() => inTab(second.app, url, "document.readyState").catch(() => ""))
      .toBe("complete");
    // Lembrado: responde sem perguntar.
    expect(await withGesture(second.app, url, "Notification.requestPermission()")).toBe("granted");
    await expect(window.getByRole("alertdialog", { name: "Pedido de permissão" })).toHaveCount(0);

    // Cadeado → Bloquear: a próxima carga vê "denied", como no Chrome.
    await window.getByRole("button", { name: "Informações do site" }).click();
    const panel = (await overlayPage(second.app)).getByRole("complementary", {
      name: "Informações do site",
    });
    await panel.getByLabel(/^Notificações em/).selectOption("block");
    await panel.getByRole("button", { name: "Fechar informações do site" }).click();
    await window.getByRole("button", { name: "Recarregar" }).click();
    await expect.poll(() => inTab(second.app, url, "Notification.permission")).toBe("denied");
    expect(await withGesture(second.app, url, "Notification.requestPermission()")).toBe("denied");

    // Configurações lista o site e volta para "Perguntar".
    await window.keyboard.press("Control+,");
    await window
      .getByRole("navigation", { name: "Seções das configurações" })
      .getByRole("button", { name: "Privacidade e segurança" })
      .click();
    const settings = window.locator(".settings-main");
    const select = settings.getByLabel(/^Notificações em 127\.0\.0\.1/);
    await expect(select).toHaveValue("block");
    await select.selectOption("ask");
    await expect(settings.getByText(/o site aparece aqui/)).toBeVisible();
  } finally {
    await second.app.close();
  }
});

test("1.6: favorito pela estrela persiste no SQLite e abre pela barra", async () => {
  const profile = tempProfile();
  const first = await launch(profile);
  await go(first.window, `${origin}/favorita`);
  await expect(tabs(first.window).first()).toContainText("Página FAVORITA");
  await first.window.keyboard.press("Control+d");
  const editor = (await overlayPage(first.app)).getByRole("complementary", {
    name: "Favorito adicionado",
  });
  await editor.getByLabel("Nome do favorito").fill("Minha favorita");
  await editor.getByRole("button", { name: "Concluído" }).click();
  await first.window.waitForTimeout(800);
  await first.app.close();

  const second = await launch(profile);
  try {
    await second.window.keyboard.press("Control+t");
    const bar = second.window.getByRole("navigation", { name: "Barra de favoritos" });
    await bar.getByRole("button", { name: "Minha favorita" }).click();
    await expect(tabs(second.window).last()).toContainText("Página FAVORITA");
    await expect(second.window.getByLabel("Favoritar página")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  } finally {
    await second.app.close();
  }
});

test("1.6: atualização encontra a versão nova, confere, baixa e instala ao reiniciar", async () => {
  // Pacote "99.0.0" (sempre acima do app) no formato do build-all.sh (tar.gz do Linux).
  const work = tempProfile();
  const install = path.join(work, "instalado");
  fs.mkdirSync(path.join(install, "resources", "app"), { recursive: true });
  fs.writeFileSync(path.join(install, "resources", "app", "package.json"), '{"version":"1.3.8"}');
  const pkg = path.join(work, "pacote");
  fs.mkdirSync(path.join(pkg, "resources", "app"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "resources", "app", "package.json"), '{"version":"99.0.0"}');
  // O app reaberto é o executável com o mesmo nome do atual (aqui, o "electron" do teste).
  fs.writeFileSync(
    path.join(pkg, "electron"),
    `#!/bin/sh\necho reaberto > "${work}/reaberto.txt"\n`,
    { mode: 0o755 },
  );
  const archive = path.join(work, "pacote.tar.gz");
  execFileSync("tar", ["-czf", archive, "-C", pkg, "."]);
  const bytes = fs.readFileSync(archive);
  const feed = http.createServer((request, response) => {
    if (request.url === "/browser/latest.json") {
      response.end(
        JSON.stringify({
          version: "99.0.0",
          notes: "teste",
          files: {
            "linux-x64": {
              url: "v99.0.0/Agzos-Browser-linux-x64.tar.gz",
              sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
              size: bytes.length,
            },
          },
        }),
      );
      return;
    }
    if (request.url === "/browser/v99.0.0/Agzos-Browser-linux-x64.tar.gz") {
      response.end(bytes);
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolve) => feed.listen(0, "127.0.0.1", resolve));
  const feedUrl = `http://127.0.0.1:${(feed.address() as AddressInfo).port}/browser/latest.json`;
  const { app, window } = await launch(path.join(work, "perfil"), {
    AGZOS_UPDATE_URL: feedUrl,
    AGZOS_UPDATE_INSTALL_DIR: install,
  });
  let closed = false;
  app.on("close", () => (closed = true));
  try {
    await window.keyboard.press("Control+,");
    await window
      .getByRole("navigation", { name: "Seções das configurações" })
      .getByRole("button", { name: "Sobre o Agzos" })
      .click();
    const settings = window.locator(".settings-main");
    await settings.getByRole("button", { name: "Verificar agora" }).click();
    await expect(settings.getByText(/Versão 99\.0\.0 pronta/)).toBeVisible({ timeout: 20_000 });
    // Botão na barra: reinicia e instala.
    await window.getByRole("button", { name: "Atualizar", exact: true }).click();
    await expect.poll(() => closed, { timeout: 15_000 }).toBe(true);
    const result = path.join(work, "perfil", "atualizacoes", "resultado.txt");
    await expect.poll(() => fs.existsSync(result), { timeout: 15_000 }).toBe(true);
    expect(fs.readFileSync(result, "utf8").trim()).toBe("ok 99.0.0");
    expect(
      fs.readFileSync(path.join(install, "resources", "app", "package.json"), "utf8"),
    ).toContain("99.0.0");
    await expect.poll(() => fs.existsSync(path.join(work, "reaberto.txt"))).toBe(true);
  } finally {
    if (!closed) await app.close();
    feed.closeAllConnections();
    feed.close();
  }
});

// --- 1.7: várias janelas, restauração após crash, telas de erro e hibernação. ---

/** Cascas (uma por janela), sem as páginas das guias. */
function shells(app: ElectronApplication) {
  return app.windows().filter((page) => page.url().includes("/dist/index.html"));
}

async function waitShells(app: ElectronApplication, count: number) {
  await expect.poll(() => shells(app).length, { timeout: 15_000 }).toBe(count);
  const pages = shells(app);
  for (const page of pages) await page.locator('.browser-stage[data-ready="true"]').waitFor();
  return pages;
}

/** Id da guia (data-tab-id) cujo título contém `text`. */
async function tabIdOf(window: Page, text: string) {
  return Number(await tabs(window).filter({ hasText: text }).first().getAttribute("data-tab-id"));
}

test("1.7: Ctrl+N abre janela nova, tema sincroniza e as janelas voltam depois de reiniciar", async () => {
  const profile = tempProfile();
  const first = await launch(profile);
  await go(first.window, `${origin}/janela-um`);
  await expect(tabs(first.window).first()).toContainText("Página JANELA-UM");
  await first.window.keyboard.press(`${MOD}+n`);
  const [, second] = await waitShells(first.app, 2);
  await go(second!, `${origin}/janela-dois`);
  await expect(tabs(second!).first()).toContainText("Página JANELA-DOIS");
  // Cada janela tem as suas guias.
  await expect(tabs(first.window)).toHaveCount(1);
  await expect(tabs(first.window).first()).toContainText("Página JANELA-UM");
  // Preferência mudada numa janela vale na outra.
  await first.window.getByRole("button", { name: "Usar tema claro" }).click();
  await expect(second!.locator(".browser-stage")).not.toHaveClass(/dark/);
  await first.window.waitForTimeout(900);
  await first.app.close();

  const again = await launch(profile);
  try {
    const pages = await waitShells(again.app, 2);
    // A guia ativa de cada janela recarrega ao abrir: o título volta quando a página carrega.
    const titles = async () =>
      (await Promise.all(pages.map((page) => tabs(page).first().textContent()))).join(" ");
    await expect.poll(titles).toContain("Página JANELA-UM");
    await expect.poll(titles).toContain("Página JANELA-DOIS");
    for (const page of pages) {
      await expect(page.locator(".browser-stage")).not.toHaveClass(/dark/);
    }
    // Fechar uma janela entre várias descarta as guias dela (como no Chrome).
    await again.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((window) => window.getTitle().includes("JANELA-DOIS"))
        ?.close();
    });
    const [remaining] = await waitShells(again.app, 1);
    await expect(tabs(remaining!).first()).toContainText("Página JANELA-UM");
    await remaining!.waitForTimeout(700);
  } finally {
    await again.app.close();
  }
  const last = await launch(profile);
  try {
    await last.window.waitForTimeout(800);
    expect(shells(last.app)).toHaveLength(1);
    await expect(tabs(last.window).first()).toContainText("Página JANELA-UM");
  } finally {
    await last.app.close();
  }
});

test("1.7: mover guia para nova janela leva a página viva (sem recarregar)", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, `${origin}/fica`);
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();
    await go(window, `${origin}/movida`);
    await expect(tabs(window).last()).toContainText("Página MOVIDA");
    await inTab(app, `${origin}/movida`, "window.marca = 42");
    const id = await tabIdOf(window, "Página MOVIDA");
    await app.evaluate(({ BrowserWindow }, tabId) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send("agzos:tabmenu-action", {
        action: "tab.move-to-window",
        tabId,
      });
    }, id);
    const [, moved] = await waitShells(app, 2);
    await expect(tabs(moved!)).toHaveCount(1);
    await expect(tabs(moved!).first()).toContainText("Página MOVIDA");
    await expect(tabs(window)).toHaveCount(1);
    await expect(tabs(window).first()).toContainText("Página FICA");
    // Mesma página (o valor da variável sobreviveu) e uma só.
    expect(await inTab(app, `${origin}/movida`, "window.marca")).toBe(42);
    expect(await liveViews(app, "/movida")).toHaveLength(1);
    // Não entra em "reabrir guia fechada".
    await expect(window.getByRole("button", { name: "Reabrir guia fechada" })).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("1.7: tela de erro quando a página não carrega, e 'Tentar novamente' recupera", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    unstableDown = true;
    await go(window, `${origin}/instavel`);
    const error = window.getByRole("alert", { name: "Erro ao carregar a página" });
    await expect(error).toBeVisible();
    await expect(error).toContainText("Este site não pode ser acessado");
    await expect(error).toContainText("ERR_EMPTY_RESPONSE");
    await expect(omnibox(window)).toHaveValue(`${origin}/instavel`);
    unstableDown = false;
    await error.getByRole("button", { name: "Tentar novamente" }).click();
    await expect(tabs(window).first()).toContainText("Página INSTAVEL");
    await expect(error).toHaveCount(0);
    // Endereço inexistente: tela própria, com a opção de pesquisar.
    await go(window, "http://nao-existe.invalid/");
    await expect(error).toBeVisible();
    await expect(error.getByRole("heading")).toHaveText(
      /Não foi possível encontrar este site|Este site não pode ser acessado|Sem conexão/,
    );
  } finally {
    await app.close();
  }
});

test("1.7: certificado inválido mostra o aviso e 'Continuar' abre a página", async () => {
  const dir = tempProfile();
  const key = path.join(dir, "k.pem");
  const cert = path.join(dir, "c.pem");
  try {
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-days",
        "2",
        "-subj",
        "/CN=localhost",
      ],
      { stdio: "ignore" },
    );
  } catch {
    test.skip(true, "openssl indisponível");
  }
  const https = await import("node:https");
  const secure = https.createServer(
    { key: fs.readFileSync(key), cert: fs.readFileSync(cert) },
    (_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>Página SEGURA</title>ok");
    },
  );
  await new Promise<void>((resolve) => secure.listen(0, "127.0.0.1", resolve));
  const url = `https://127.0.0.1:${(secure.address() as AddressInfo).port}/`;
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, url);
    const error = window.getByRole("alert", { name: "Erro ao carregar a página" });
    await expect(error).toContainText("Sua conexão não é particular");
    await expect(error).toContainText("ERR_CERT_AUTHORITY_INVALID");
    await error.getByRole("button", { name: "Avançado" }).click();
    await error.getByRole("button", { name: /Continuar para .* \(não seguro\)/ }).click();
    await expect(tabs(window).first()).toContainText("Página SEGURA");
    await expect(error).toHaveCount(0);
  } finally {
    await app.close();
    secure.close();
  }
});

test("1.7: página encerrada mostra a tela de travada e 'Recarregar' traz de volta", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, `${origin}/derrubada`);
    await expect(tabs(window).first()).toContainText("Página DERRUBADA");
    const id = await tabIdOf(window, "Página DERRUBADA");
    await window.evaluate(
      (tabId) =>
        (
          window as unknown as { agzosDesktop: { killTab(id: number): Promise<void> } }
        ).agzosDesktop.killTab(tabId),
      id,
    );
    const crashed = window.getByRole("alert", { name: "Guia travada" });
    await expect(crashed).toBeVisible();
    await crashed.getByRole("button", { name: "Recarregar" }).click();
    await expect(crashed).toHaveCount(0);
    await expect
      .poll(() => inTab(app, `${origin}/derrubada`, "document.title"))
      .toBe("Página DERRUBADA");
  } finally {
    await app.close();
  }
});

test("1.7: guia sem uso hiberna, volta com o histórico e formulário preenchido não hiberna", async () => {
  const { app, window } = await launch(tempProfile(), {
    AGZOS_HIBERNATE_AFTER_MS: "1200",
    AGZOS_HIBERNATE_CHECK_MS: "400",
    // Sem scriptlets no 127.0.0.1: site com scriptlets volta sem o histórico (ver
    // restoreHibernated em electron/main.cjs).
    AGZOS_FILTER_LISTS: JSON.stringify({ ads: [], privacy: [`${origin}/filtros/privacidade.txt`] }),
  });
  try {
    await go(window, `${origin}/hib-um`);
    await expect(tabs(window).first()).toContainText("Página HIB-UM");
    await go(window, `${origin}/hib-dois`);
    await expect(tabs(window).first()).toContainText("Página HIB-DOIS");
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();
    await go(window, `${origin}/formulario`);
    await expect(tabs(window).nth(1)).toContainText("Formulário");
    await inTab(app, `${origin}/formulario`, "document.getElementById('nome').value = 'Ana'");
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();

    await expect(tabs(window).first()).toHaveClass(/hibernated/, { timeout: 10_000 });
    await expect.poll(() => liveViews(app, "/hib-dois")).toHaveLength(0);
    // Formulário com texto digitado continua vivo.
    await window.waitForTimeout(1500);
    expect(await liveViews(app, "/formulario")).toHaveLength(1);
    await expect(tabs(window).nth(1)).not.toHaveClass(/hibernated/);

    // Voltar à guia recria a página, com o histórico de navegação.
    await tabs(window).first().click();
    await expect(tabs(window).first()).not.toHaveClass(/hibernated/);
    await expect.poll(() => liveViews(app, "/hib-dois")).toHaveLength(1);
    await expect(omnibox(window)).toHaveValue(`${origin}/hib-dois`);
    await window.getByRole("button", { name: "Voltar" }).click();
    await expect(omnibox(window)).toHaveValue(`${origin}/hib-um`);
  } finally {
    await app.close();
  }
});

test("1.7: depois de um crash as janelas voltam com aviso; crash logo ao abrir usa o modo seguro", async () => {
  const profile = tempProfile();
  // Execução "estável" (passou do tempo de início) que cai: restaura normalmente.
  const first = await launch(profile, { AGZOS_STABLE_AFTER_MS: "200" });
  await go(first.window, `${origin}/antes-do-crash`);
  await expect(tabs(first.window).first()).toContainText("Página ANTES-DO-CRASH");
  await first.window.waitForTimeout(1200);
  first.app.process().kill("SIGKILL");

  const second = await launch(profile);
  await expect(second.window.getByRole("status", { name: "Sessão restaurada" })).toContainText(
    "não foi fechado corretamente",
  );
  await expect(tabs(second.window).first()).toContainText("Página ANTES-DO-CRASH");
  await expect.poll(() => liveViews(second.app, "/antes-do-crash")).toHaveLength(1);
  // Cai de novo logo ao abrir: a próxima abre sem carregar as páginas.
  await second.window.waitForTimeout(900);
  second.app.process().kill("SIGKILL");

  const third = await launch(profile);
  try {
    await expect(third.window.getByRole("status", { name: "Sessão restaurada" })).toContainText(
      "fechou logo depois de abrir",
    );
    await expect(tabs(third.window)).toHaveCount(2);
    await expect(tabs(third.window).first()).toContainText("Página ANTES-DO-CRASH");
    await expect(tabs(third.window).first()).toHaveClass(/hibernated/);
    await expect(tabs(third.window).nth(1)).toHaveAttribute("aria-selected", "true");
    await third.window.waitForTimeout(800);
    expect(await liveViews(third.app, "/antes-do-crash")).toHaveLength(0);
  } finally {
    await third.app.close();
  }

  // Saída normal: sem aviso na próxima.
  const fourth = await launch(profile);
  try {
    await fourth.window.waitForTimeout(600);
    await expect(fourth.window.getByRole("status", { name: "Sessão restaurada" })).toHaveCount(0);
  } finally {
    await fourth.app.close();
  }
});

test("1.5.1: depois de atualizar, aviso com a versão, as novidades e confetes (uma vez só)", async () => {
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  const profile = tempProfile();
  const first = await launch(profile);
  await first.window.waitForTimeout(600);
  // Nenhum aviso num perfil novo.
  await expect(first.window.getByRole("dialog")).toHaveCount(0);
  // Simula o perfil de quem estava na 1.4.2.
  await first.app.evaluate(
    (_electron, file) => {
      const { DatabaseSync } = process.getBuiltinModule(
        "node:sqlite",
      ) as typeof import("node:sqlite");
      const db = new DatabaseSync(file);
      db.prepare("UPDATE kv SET value = ? WHERE key = 'meta:appVersion'").run('"1.4.2"');
      db.close();
    },
    path.join(profile, "agzos.db"),
  );
  await first.app.close();

  const second = await launch(profile);
  try {
    const dialog = second.window.getByRole("dialog", { name: "Atualizado com sucesso!" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(`Versão 1.4.2 → ${version}`);
    await expect(dialog.locator("li").first()).toBeVisible();
    await expect(second.window.locator("canvas.confetti")).toHaveCount(1);
    await dialog.getByRole("button", { name: "Continuar navegando" }).click();
    await expect(dialog).toHaveCount(0);
    // Pelas Configurações, as novidades da versão atual (sem confetes).
    await second.window.getByRole("button", { name: "Menu do Agzos" }).click();
    await (
      await overlayPage(second.app)
    )
      .getByRole("menuitem", { name: "Novidades desta versão" })
      .click();
    const again = second.window.getByRole("dialog", { name: "Novidades desta versão" });
    await expect(again).toContainText(`Agzos Browser ${version}`);
    await expect(second.window.locator("canvas.confetti")).toHaveCount(0);
    await second.window.keyboard.press("Escape");
    await expect(again).toHaveCount(0);
  } finally {
    await second.app.close();
  }

  const third = await launch(profile);
  try {
    await third.window.waitForTimeout(800);
    await expect(third.window.getByRole("dialog")).toHaveCount(0);
  } finally {
    await third.app.close();
  }
});

test("1.5.1: picture-in-picture pega o vídeo de qualquer player (até em iframe)", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, `${origin}/com-video`);
    await expect(tabs(window).first()).toContainText("Com vídeo");
    const pipOn = () =>
      app.evaluate(async ({ webContents }, url) => {
        const contents = webContents.getAllWebContents().find((item) => item.getURL() === url);
        for (const frame of contents?.mainFrame.framesInSubtree ?? []) {
          if (await frame.executeJavaScript("Boolean(document.pictureInPictureElement)")) {
            return true;
          }
        }
        return false;
      }, `${origin}/com-video`);
    // Vídeo tocando: o botão aparece na barra.
    const button = window.getByRole("button", { name: "Picture-in-picture" });
    await expect(button).toBeVisible({ timeout: 10_000 });
    await button.click();
    await expect.poll(pipOn).toBe(true);
    await expect(window.getByRole("button", { name: "Sair do picture-in-picture" })).toBeVisible();
    // Atalho com o foco na página desliga.
    await keyInTab(app, `${origin}/com-video`, "P", ["control", "shift"]);
    await expect.poll(pipOn).toBe(false);
    await expect(window.getByRole("button", { name: "Picture-in-picture" })).toBeVisible();
  } finally {
    await app.close();
  }
});

// --- 1.5.2: prévia da guia, Ctrl+Tab ao soltar, configurações. ---

/** Cartão de prévia (camada própria acima da página): texto e se está à vista. */
async function previewCard(app: ElectronApplication) {
  return app.evaluate(async ({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      for (const child of window.contentView.children) {
        const contents = (child as { webContents?: Electron.WebContents }).webContents;
        if (!contents || contents.getTitle() !== "agzos-preview") continue;
        const bounds = (child as Electron.WebContentsView).getBounds();
        const text = (await contents.executeJavaScript("document.body.innerText")) as string;
        const onTop = window.contentView.children.at(-1) === child;
        return { visible: bounds.width > 0 && bounds.height > 0, text, onTop };
      }
    }
    return { visible: false, text: "", onTop: false };
  });
}

test("1.5.2: pausar o mouse na guia mostra a prévia por cima da página, com RAM e CPU", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, `${origin}/previa-a`);
    await expect(tabs(window).first()).toContainText("Página PREVIA-A");
    await window.waitForTimeout(700);
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();
    await go(window, `${origin}/previa-b`);
    await expect(tabs(window).last()).toContainText("Página PREVIA-B");

    await tabs(window).first().hover();
    await expect.poll(async () => (await previewCard(app)).visible).toBe(true);
    const card = await previewCard(app);
    expect(card.onTop).toBe(true);
    expect(card.text).toContain("Página PREVIA-A");
    expect(card.text).toContain("127.0.0.1");
    expect(card.text).toMatch(/Memória \(RAM\)\s*\d+ MB/);
    expect(card.text).toContain("CPU");
    // Outra guia com o cartão aberto: troca na hora.
    await tabs(window).last().hover();
    await expect.poll(async () => (await previewCard(app)).text).toContain("Guia atual");
    // Mouse fora das guias: some.
    await window.mouse.move(700, 500);
    await expect.poll(async () => (await previewCard(app)).visible).toBe(false);
  } finally {
    await app.close();
  }
});

test("1.5.3: Ctrl+Tab com o foco na página: a página fica à vista e com o foco, e soltar o Ctrl confirma sempre", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, `${origin}/troca-a`);
    await expect(tabs(window).first()).toContainText("Página TROCA-A");
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();
    await go(window, `${origin}/troca-b`);
    await expect(tabs(window).last()).toContainText("Página TROCA-B");
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();
    await go(window, `${origin}/troca-c`);
    await expect(tabs(window).last()).toContainText("Página TROCA-C");
    const active = window.locator(".tabs .browser-tab.active");
    const switcher = () => layerState(app, "agzos-switcher");
    /** Tecla na página (o foco do sistema fica nela o tempo todo). */
    const key = (type: "keyDown" | "keyUp", keyCode: string, modifiers: string[] = []) =>
      app.evaluate(
        ({ webContents }, [kind, code, mods]) => {
          const contents = webContents.getFocusedWebContents()!;
          contents.sendInputEvent({
            type: kind as "keyDown" | "keyUp",
            keyCode: code as string,
            modifiers: mods as ("control" | "shift")[],
          });
        },
        [type, keyCode, modifiers] as const,
      );
    const focused = () =>
      app.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL() ?? "");
    const pageShown = (url: string) =>
      app.evaluate(({ BrowserWindow }, target) => {
        const child = BrowserWindow.getAllWindows()[0]!.contentView.children.find(
          (item) =>
            (item as { webContents?: Electron.WebContents }).webContents?.getURL() === target,
        ) as Electron.WebContentsView | undefined;
        return (child?.getBounds().width ?? 0) > 0;
      }, url);
    const focusPage = (url: string) =>
      app.evaluate(({ webContents }, target) => {
        webContents
          .getAllWebContents()
          .find((item) => item.getURL() === target)!
          .focus();
      }, url);

    // Várias vezes seguidas: segura o Ctrl, Tab, Tab, solta.
    for (let round = 0; round < 3; round++) {
      const from = (await active.textContent())!.match(/TROCA-[A-C]/)![0].toLowerCase();
      await focusPage(`${origin}/${from}`);
      await key("keyDown", "Control", ["control"]);
      await key("keyDown", "Tab", ["control"]);
      await key("keyUp", "Tab", ["control"]);
      await expect.poll(async () => (await switcher()).visible).toBe(true);
      await key("keyDown", "Tab", ["control"]);
      await key("keyUp", "Tab", ["control"]);
      await expect
        .poll(async () => (await switcher()).cards.findIndex((card) => card.selected))
        .toBe(2);
      // A página continua à vista e com o foco (o "soltar" chega nela).
      expect(await focused()).toContain(`/${from}`);
      expect(await pageShown(`${origin}/${from}`)).toBe(true);
      const target = (await switcher()).cards[2]!.title;
      await key("keyUp", "Control");
      await expect(active).toContainText(target);
      await expect.poll(async () => (await switcher()).visible).toBe(false);
    }

    // Enter confirma e não chega à página; clicar num cartão também confirma.
    const current = (await active.textContent())!.match(/TROCA-[A-C]/)![0].toLowerCase();
    await focusPage(`${origin}/${current}`);
    await inTab(
      app,
      `${origin}/${current}`,
      "window.enters = 0; addEventListener('keydown', (e) => { if (e.key === 'Enter') window.enters++; })",
    );
    await key("keyDown", "Control", ["control"]);
    await key("keyDown", "Tab", ["control"]);
    await expect.poll(async () => (await switcher()).visible).toBe(true);
    const chosen = (await switcher()).cards[1]!.title;
    await key("keyDown", "Enter", ["control"]);
    await expect(active).toContainText(chosen);
    expect(await inTab(app, `${origin}/${current}`, "window.enters")).toBe(0);
  } finally {
    await app.close();
  }
});

test("1.5.2: configurações completas em agzos://configuracoes (Ctrl+,) e menu do ⋯", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await window.getByRole("button", { name: "Menu do Agzos" }).click();
    const menu = (await overlayPage(app)).getByRole("menu", { name: "Menu do Agzos" });
    await expect(menu.getByRole("menuitem", { name: /Nova janela/ })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Sair" })).toBeVisible();
    await menu.getByRole("menuitem", { name: /Configurações/ }).click();
    await expect(omnibox(window)).toHaveValue("agzos://configuracoes");
    const nav = window.getByRole("navigation", { name: "Seções das configurações" });
    // Seções que só existem no app.
    await nav.getByRole("button", { name: "Desempenho" }).click();
    await expect(window.getByRole("switch", { name: "Hibernar guias sem uso" })).toBeVisible();
    await nav.getByRole("button", { name: "Downloads" }).click();
    // AGZOS_DOWNLOADS_DIR do teste: <perfil>/Downloads.
    await expect(window.locator(".settings-main")).toContainText(/agzos-e2e-.*Downloads/);
  } finally {
    await app.close();
  }
});

/** A camada dos painéis (dist/overlay.html), como página do Playwright. */
async function overlayPage(app: ElectronApplication) {
  let found: Page | undefined;
  await expect
    .poll(() => {
      found = app.windows().find((page) => page.url().endsWith("/overlay.html"));
      return Boolean(found);
    })
    .toBe(true);
  return found!;
}

/** A guia com `url` está à vista (bounds > 0) e a camada dos painéis por cima? */
async function layersOf(app: ElectronApplication, url: string) {
  return app.evaluate(({ BrowserWindow }, target) => {
    const children = BrowserWindow.getAllWindows()[0]!.contentView.children as (
      Electron.WebContentsView | Electron.View
    )[];
    const contentsOf = (child: Electron.View) =>
      (child as { webContents?: Electron.WebContents }).webContents;
    const page = children.find((child) => contentsOf(child)?.getURL() === target);
    const layer = children.find((child) => contentsOf(child)?.getURL().endsWith("/overlay.html"));
    return {
      pageWidth: page?.getBounds().width ?? 0,
      overlayVisible: Boolean(layer && layer.getVisible() && layer.getBounds().width > 0),
      overlayOnTop: Boolean(layer) && children.at(-1) === layer,
      counts: (globalThis as { __agzosOverlay?: Record<string, number> }).__agzosOverlay ?? null,
    };
  }, url);
}

test("1.5.4: menus da toolbar abrem na camada e a página (vídeo) segue pintando", async () => {
  const { app, window } = await launch(tempProfile(), { AGZOS_DEBUG_OVERLAY: "1" });
  const url = `${origin}/video-vivo`;
  try {
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Vídeo vivo");
    await expect
      .poll(() => inTab<number>(app, url, "document.getElementById('v').currentTime"))
      .toBeGreaterThan(0.2);

    await window.getByRole("button", { name: "Menu do Agzos" }).click();
    const overlay = await overlayPage(app);
    const menu = overlay.getByRole("menu", { name: "Menu do Agzos" });
    await expect(menu.getByRole("menuitem", { name: /Nova janela/ })).toBeVisible();
    await expect.poll(async () => (await layersOf(app, url)).overlayVisible).toBe(true);
    const layers = await layersOf(app, url);
    // A guia não saiu de cena e nenhuma foto foi tirada.
    expect(layers.pageWidth).toBeGreaterThan(0);
    expect(layers.overlayOnTop).toBe(true);
    expect(layers.counts).toEqual({ "live-overlay": 1, "snapshot-fallback": 0 });
    await expect(window.locator(".view-snapshot")).toHaveCount(0);
    // Com o menu aberto o vídeo anda e a página pinta quadros novos.
    const t0 = await inTab<number>(app, url, "document.getElementById('v').currentTime");
    const f0 = await inTab<number>(app, url, "window.painted");
    await expect
      .poll(() => inTab<number>(app, url, "document.getElementById('v').currentTime"), {
        intervals: [50],
        timeout: 3000,
      })
      .toBeGreaterThanOrEqual(t0 + 0.8);
    expect(await inTab<number>(app, url, "window.painted")).toBeGreaterThan(f0 + 10);
    await expect(window.getByRole("button", { name: "Menu do Agzos" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // Rolar fora do menu rola a página por baixo.
    await overlay.mouse.move(400, 600);
    await overlay.mouse.wheel(0, 600);
    await expect.poll(() => inTab<number>(app, url, "window.scrollY")).toBeGreaterThan(100);
    await expect(menu).toBeVisible();

    // Esc fecha; o foco não fica na camada escondida.
    await overlay.keyboard.press("Escape");
    await expect.poll(async () => (await layersOf(app, url)).overlayVisible).toBe(false);
    await expect(window.getByRole("button", { name: "Menu do Agzos" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      await app.evaluate(
        ({ webContents }) =>
          webContents.getFocusedWebContents()?.getURL().endsWith("/overlay.html") ?? false,
      ),
    ).toBe(false);

    // Downloads e proteção (adblock) também: camada, sem foto.
    await window.getByRole("button", { name: /bloqueados/ }).click();
    await expect(overlay.getByRole("button", { name: "Fechar proteção" })).toBeVisible();
    // Clique fora (como no Comet): fecha o painel e o clique vale para a página embaixo.
    const view = await app.evaluate(({ BrowserWindow }, target) => {
      const child = BrowserWindow.getAllWindows()[0]!.contentView.children.find(
        (item) => (item as { webContents?: Electron.WebContents }).webContents?.getURL() === target,
      )!;
      return child.getBounds();
    }, url);
    await overlay.mouse.click(view.x + 140, view.y + view.height - 70);
    await expect.poll(async () => (await layersOf(app, url)).overlayVisible).toBe(false);
    await expect.poll(() => inTab<number>(app, url, "window.cliques ?? 0")).toBe(1);
    expect(
      await app.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL()),
    ).toBe(url);

    // Clique fora num botão da barra: o outro painel abre direto.
    const menuButton = window.getByRole("button", { name: "Menu do Agzos" });
    await window.getByRole("button", { name: /bloqueados/ }).click();
    await expect(overlay.getByRole("button", { name: "Fechar proteção" })).toBeVisible();
    const menuBox = (await menuButton.boundingBox())!;
    await overlay.mouse.click(menuBox.x + menuBox.width / 2, menuBox.y + menuBox.height / 2);
    await expect(overlay.getByRole("menu", { name: "Menu do Agzos" })).toBeVisible();
    await expect(overlay.getByRole("button", { name: "Fechar proteção" })).toHaveCount(0);
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");
    // O próprio ⋯ com o menu aberto: só fecha (o clique repassado não reabre).
    await overlay.mouse.click(menuBox.x + menuBox.width / 2, menuBox.y + menuBox.height / 2);
    await expect.poll(async () => (await layersOf(app, url)).overlayVisible).toBe(false);
    await window.waitForTimeout(300);
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");

    // Menu aberto + Ctrl+T: guia nova e o menu fecha.
    await window.getByRole("button", { name: "Menu do Agzos" }).click();
    await expect(menu).toBeVisible();
    // Tecla de verdade na camada (passa pelo before-input-event, como um teclado físico).
    await app.evaluate(({ webContents }, mod) => {
      const layer = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().endsWith("/overlay.html"))!;
      const modifiers = [mod === "Meta" ? "meta" : "control"] as ("meta" | "control")[];
      layer.sendInputEvent({ type: "keyDown", keyCode: "T", modifiers });
      layer.sendInputEvent({ type: "keyUp", keyCode: "T", modifiers });
    }, MOD);
    await expect(tabs(window)).toHaveCount(2);
    await expect.poll(async () => (await layersOf(app, url)).overlayVisible).toBe(false);

    // Item do menu dispara o mesmo comando de hoje.
    await window.getByRole("button", { name: "Menu do Agzos" }).click();
    await menu.getByRole("menuitem", { name: /Nova guia anônima/ }).click();
    await expect(tabs(window)).toHaveCount(3);
    await expect.poll(async () => (await layersOf(app, url)).overlayVisible).toBe(false);

    // Clique fora numa guia: fecha o menu e troca de guia.
    await window.getByRole("button", { name: "Menu do Agzos" }).click();
    await expect(menu).toBeVisible();
    const tabBox = (await tabs(window).first().boundingBox())!;
    await overlay.mouse.click(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2);
    await expect(window.locator(".browser-tab.active")).toContainText("Vídeo vivo");
    await expect.poll(async () => (await layersOf(app, url)).overlayVisible).toBe(false);

    const counts = (await layersOf(app, url)).counts!;
    expect(counts["snapshot-fallback"]).toBe(0);
    expect(counts["live-overlay"]).toBe(7);

    // A camada caiu: a próxima abertura cria outra (sem cair na foto).
    await app.evaluate(({ webContents }) => {
      webContents
        .getAllWebContents()
        .find((contents) => contents.getURL().endsWith("/overlay.html"))!
        .forcefullyCrashRenderer();
    });
    await expect
      .poll(() => app.windows().filter((page) => page.url().endsWith("/overlay.html")).length)
      .toBe(0);
    await window.getByRole("button", { name: "Menu do Agzos" }).click();
    const reborn = await overlayPage(app);
    await expect(
      reborn.getByRole("menu", { name: "Menu do Agzos" }).getByRole("menuitem", { name: "Sair" }),
    ).toBeVisible();
    expect((await layersOf(app, url)).counts!["snapshot-fallback"]).toBe(0);
  } finally {
    await app.close();
  }
});

test("1.5.4: várias janelas: o painel abre só na janela clicada, cada uma com a sua camada", async () => {
  const { app, window } = await launch(tempProfile(), { AGZOS_DEBUG_OVERLAY: "1" });
  try {
    await window.keyboard.press(`${MOD}+n`);
    const [first, second] = await waitShells(app, 2);
    const openLayers = () =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().map((win) =>
          win.contentView.children.some((child) => {
            const contents = (child as { webContents?: Electron.WebContents }).webContents;
            return (
              Boolean(contents?.getURL().endsWith("/overlay.html")) &&
              child.getVisible() &&
              child.getBounds().width > 0
            );
          }),
        ),
      );
    await second!.getByRole("button", { name: "Menu do Agzos" }).click();
    await expect.poll(async () => (await openLayers()).filter(Boolean).length).toBe(1);
    await expect(second!.getByRole("button", { name: "Menu do Agzos" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(first!.getByRole("button", { name: "Menu do Agzos" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    // A outra janela abre o seu próprio painel (uma camada por janela).
    await first!.getByRole("button", { name: "Menu do Agzos" }).click();
    await expect.poll(async () => (await openLayers()).filter(Boolean).length).toBeGreaterThan(0);
    await expect(first!.getByRole("button", { name: "Menu do Agzos" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const layerCount = () =>
      app.evaluate(
        ({ webContents }) =>
          webContents
            .getAllWebContents()
            .filter((contents) => contents.getURL().endsWith("/overlay.html")).length,
      );
    await expect.poll(layerCount).toBe(2);
  } finally {
    await app.close();
  }
});

// --- 2.0: nível Opera/Vivaldi ---

/** Filhos nativos da 1ª janela com a URL e a área (bounds) de cada um. */
async function nativeChildren(app: ElectronApplication) {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.contentView.children.map((child) => {
      const contents = (child as { webContents?: Electron.WebContents }).webContents;
      return { url: contents?.getURL() ?? "", bounds: child.getBounds() };
    }),
  );
}

/** Tecla de verdade (passa pelo before-input-event) no webContents com foco. */
async function pressInFocused(app: ElectronApplication, keyCode: string, modifiers: string[]) {
  await app.evaluate(
    ({ webContents }, [code, mods]) => {
      const contents = webContents.getFocusedWebContents()!;
      const list = mods as ("control" | "shift" | "alt" | "meta")[];
      contents.sendInputEvent({ type: "keyDown", keyCode: code as string, modifiers: list });
      contents.sendInputEvent({ type: "keyUp", keyCode: code as string, modifiers: list });
    },
    [keyCode, modifiers] as const,
  );
}

test("2.0: barra de endereço seleciona tudo no 1º clique e copia o link pelo ícone", async () => {
  const { app, window } = await launch(tempProfile());
  const url = `${origin}/copiar-link`;
  try {
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Página COPIAR-LINK");
    await omnibox(window).evaluate((input: HTMLInputElement) => input.blur());
    await omnibox(window).click();
    expect(
      await omnibox(window).evaluate(
        (input: HTMLInputElement) =>
          input.selectionStart === 0 && input.selectionEnd === input.value.length,
      ),
    ).toBe(true);
    await omnibox(window).evaluate((input: HTMLInputElement) => input.blur());
    await window.getByRole("button", { name: "Copiar link" }).click();
    await expect(window.getByRole("button", { name: "Link copiado" })).toBeVisible();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(url);
  } finally {
    await app.close();
  }
});

test("2.0: Ctrl+K abre a busca de comandos na camada; Enter executa", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await window.keyboard.press(`${MOD}+k`);
    const layer = await overlayPage(app);
    const input = layer.getByRole("combobox", { name: "Buscar comandos" });
    await expect(input).toBeVisible();
    await input.fill("guia anonima");
    await expect(layer.getByRole("option").first()).toContainText("Nova guia anônima");
    await input.press("Enter");
    await expect(tabs(window)).toHaveCount(2);
    await expect(tabs(window).last()).toHaveAttribute("aria-label", /anônima/);
  } finally {
    await app.close();
  }
});

test("2.0: grupo de guias com nome e cor; recolher esconde as guias", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, `${origin}/grupo-a`);
    await expect(tabs(window).first()).toContainText("Página GRUPO-A");
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();
    await go(window, `${origin}/grupo-b`);
    await expect(tabs(window).last()).toContainText("Página GRUPO-B");
    // Clique direito na guia → "Adicionar guia a novo grupo" (atalho Ctrl+Shift+G).
    await window.keyboard.press(`${MOD}+Shift+g`);
    const layer = await overlayPage(app);
    const name = layer.getByRole("textbox", { name: "Nome do grupo" });
    await expect(name).toBeVisible();
    await name.fill("Trabalho");
    await layer.getByRole("radio", { name: "Verde" }).click();
    await name.press("Enter");
    const chip = window.locator(".tab-group-chip");
    await expect(chip).toHaveText("Trabalho");
    await expect(chip).toHaveAttribute("style", /#22c55e/);
    // Recolher: a guia ativa sai do grupo e as do grupo somem da barra.
    await window.getByRole("button", { name: "Nova aba", exact: true }).click();
    await chip.click();
    await expect(chip).toHaveAttribute("aria-expanded", "false");
    await expect(tabs(window).filter({ hasText: "GRUPO-B" })).toHaveCount(0);
    await chip.click();
    await expect(tabs(window).filter({ hasText: "GRUPO-B" })).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test("2.0: workspaces separam as guias e voltam depois de reiniciar", async () => {
  const profile = tempProfile();
  const first = await launch(profile);
  try {
    await go(first.window, `${origin}/pessoal`);
    await expect(tabs(first.window).first()).toContainText("Página PESSOAL");
    await first.window.getByRole("button", { name: /^Workspace / }).click();
    const layer = await overlayPage(first.app);
    await layer.getByRole("button", { name: "Novo workspace" }).click();
    await layer.getByRole("textbox", { name: "Nome do workspace" }).fill("Estudos");
    await layer.getByRole("button", { name: "Criar workspace" }).click();
    await expect(first.window.getByRole("button", { name: "Workspace Estudos" })).toBeVisible();
    await expect(tabs(first.window)).toHaveCount(1);
    await go(first.window, `${origin}/estudos`);
    await expect(tabs(first.window).first()).toContainText("Página ESTUDOS");
    // Ctrl+K também troca de workspace.
    await first.window.keyboard.press(`${MOD}+k`);
    const search = layer.getByRole("combobox", { name: "Buscar comandos" });
    await search.fill("pessoal");
    await search.press("Enter");
    await expect(first.window.getByRole("button", { name: "Workspace Pessoal" })).toBeVisible();
    await expect(tabs(first.window)).toHaveCount(1);
    await expect(tabs(first.window).first()).toContainText("Página PESSOAL");
    await first.window.waitForTimeout(1200);
  } finally {
    await first.app.close();
  }

  const second = await launch(profile);
  try {
    await expect(second.window.getByRole("button", { name: "Workspace Pessoal" })).toBeVisible();
    await expect(tabs(second.window)).toHaveCount(1);
    await second.window.getByRole("button", { name: "Workspace Pessoal" }).click();
    const layer = await overlayPage(second.app);
    await layer
      .getByRole("button", { name: /Estudos/ })
      .first()
      .click();
    await expect(tabs(second.window).first()).toContainText("ESTUDOS");
  } finally {
    await second.app.close();
  }
});

test("2.0: tela dividida mostra duas páginas lado a lado; clicar num lado ativa a guia", async () => {
  const { app, window } = await launch(tempProfile());
  const left = `${origin}/lado-a`;
  const right = `${origin}/lado-b`;
  try {
    await go(window, left);
    await expect(tabs(window).first()).toContainText("Página LADO-A");
    await window.keyboard.press(`${MOD}+Alt+Shift+s`);
    await expect(tabs(window)).toHaveCount(2);
    await go(window, right);
    await expect(tabs(window).last()).toContainText("Página LADO-B");
    await expect
      .poll(async () => {
        const views = await nativeChildren(app);
        const a = views.find((view) => view.url === left)?.bounds;
        const b = views.find((view) => view.url === right)?.bounds;
        return Boolean(a && b && a.width > 100 && b.width > 100 && a.x + a.width <= b.x);
      })
      .toBe(true);
    const active = window.locator(".tabs .browser-tab.active");
    await expect(active).toContainText("LADO-B");
    // Foco na página da esquerda (como um clique nela): ela vira a guia ativa.
    await app.evaluate(({ webContents }, target) => {
      webContents
        .getAllWebContents()
        .find((contents) => contents.getURL() === target)!
        .focus();
    }, left);
    await expect(active).toContainText("LADO-A");
    await expect(omnibox(window)).toHaveValue(left);
    // As duas continuam à vista; outra guia desfaz a vista (a divisão fica guardada).
    const both = await nativeChildren(app);
    expect(
      both.filter((view) => [left, right].includes(view.url) && view.bounds.width > 0),
    ).toHaveLength(2);
    await window.getByRole("separator", { name: /Divisória/ }).dblclick();
    await expect
      .poll(
        async () =>
          (await nativeChildren(app)).filter(
            (view) => [left, right].includes(view.url) && view.bounds.width > 0,
          ).length,
      )
      .toBe(1);
  } finally {
    await app.close();
  }
});

test("2.0: painel lateral abre ao lado da página, fica carregado e some ao fechar", async () => {
  const panelUrl = `${origin}/painel-lateral`;
  const { app, window } = await launch(tempProfile(), { AGZOS_SIDE_PANEL_URL: panelUrl });
  const page = `${origin}/principal`;
  try {
    await go(window, page);
    await expect(tabs(window).first()).toContainText("Página PRINCIPAL");
    await window
      .getByRole("navigation", { name: "Painéis laterais" })
      .getByRole("button", { name: "WhatsApp" })
      .click();
    await expect(window.getByRole("complementary", { name: "Painel WhatsApp" })).toBeVisible();
    await expect
      .poll(async () => {
        const views = await nativeChildren(app);
        const panel = views.find((view) => view.url === panelUrl)?.bounds;
        const tab = views.find((view) => view.url === page)?.bounds;
        return Boolean(panel && tab && panel.width > 200 && panel.x + panel.width <= tab.x);
      })
      .toBe(true);
    // Fechar esconde, mas a página do painel continua viva (mensagens seguem chegando).
    await window.getByRole("button", { name: "Fechar WhatsApp" }).click();
    await expect
      .poll(
        async () => (await nativeChildren(app)).find((view) => view.url === panelUrl)?.bounds.width,
      )
      .toBe(0);
    expect(await liveViews(app, "/painel-lateral")).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test("2.2.3: conta Argon2id desbloqueia e o popup de autofill fica acima da página", async () => {
  const { app, window } = await launch(tempProfile(), {
    AGZOS_DEBUG_OVERLAY: "1",
    AGZOS_KEY_URL: origin,
  });
  // 2.2.7: o popup só sobe sozinho em página com formulário de login.
  const url = `${origin}/entrar-key`;
  try {
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Entrar no site");

    // Pareia e desbloqueia com a senha mestra (Argon2id p=4, na worker do main).
    await window.getByRole("button", { name: "Abrir Agzos Key" }).click();
    const overlay = await overlayPage(app);
    await overlay.getByLabel("Código de pareamento").fill("ABCD-1234");
    await overlay.getByRole("button", { name: "Conectar" }).click();
    await overlay.getByLabel("Senha mestra").fill(KEY_PASSWORD);
    await overlay.getByRole("button", { name: "Desbloquear" }).click();
    await expect(overlay.getByText("Login local")).toBeVisible({ timeout: 30_000 });
    await overlay.keyboard.press("Escape");

    // A página de login tem credencial: o popup sobe NA CAMADA, por cima da página.
    const popup = overlay.getByRole("complementary", { name: "Entrar com o Agzos Key" });
    await expect(popup).toBeVisible();
    await expect.poll(async () => (await layersOf(app, url)).overlayOnTop).toBe(true);
    expect((await layersOf(app, url)).overlayVisible).toBe(true);
    await expect(window.locator(".autofill-popup")).toHaveCount(0);
    await expect(window.locator(".view-snapshot")).toHaveCount(0);
    // Aparece sozinho: não rouba o foco da página.
    expect(
      await app.evaluate(({ webContents }) => webContents.getFocusedWebContents()?.getURL()),
    ).not.toMatch(/overlay\.html$/);

    // Fechar dispensa neste site: a camada some.
    await popup.getByRole("button", { name: "Fechar" }).click();
    await expect.poll(async () => (await layersOf(app, url)).overlayVisible).toBe(false);
  } finally {
    await app.close();
  }
});

test("2.2.5: pasta da barra de favoritos abre o menu de vidro na camada, acima da página", async () => {
  const { app, window } = await launch(tempProfile());
  const url = `${origin}/video-vivo`;
  try {
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Vídeo vivo");
    // Menu nativo grampeado: guarda os rótulos e escolhe o item de `__pick`.
    await app.evaluate(({ Menu }) => {
      const g = globalThis as { __menus?: string[][]; __pick?: string };
      g.__menus = [];
      Menu.prototype.popup = function (options?: Electron.PopupOptions) {
        g.__menus!.push(this.items.map((item) => item.label));
        const item = this.items.find((entry) => entry.label === g.__pick);
        item?.click();
        options?.callback?.();
      };
    });
    const pick = (label: string) =>
      app.evaluate((_electron, value) => {
        (globalThis as { __pick?: string }).__pick = value;
      }, label);
    const menus = () => app.evaluate(() => (globalThis as { __menus?: string[][] }).__menus ?? []);

    // Nova pasta pelo menu da barra; o editor abre na camada e fecha com Esc.
    await pick("Nova pasta");
    const bar = window.getByRole("navigation", { name: "Barra de favoritos" });
    const box = (await bar.boundingBox())!;
    await bar.click({ button: "right", position: { x: box.width - 8, y: box.height / 2 } });
    const overlay = await overlayPage(app);
    await expect(overlay.getByLabel("Nome")).toBeVisible();
    await overlay.keyboard.press("Escape");

    // Clique na pasta: o dropdown de vidro abre na camada, por cima da página; nada
    // flutuando na casca (ficaria atrás do WebContentsView) e nenhum menu nativo.
    const before = (await menus()).length;
    await bar.getByRole("button", { name: "Nova pasta" }).click();
    const folder = overlay.getByRole("menu", { name: "Pasta de favoritos" });
    await expect(folder).toBeVisible();
    await expect(folder.getByRole("menuitem", { name: "(vazia)" })).toBeVisible();
    await overlay.keyboard.press("Escape");
    await expect.poll(async () => (await layersOf(app, url)).overlayVisible).toBe(false);

    // Favorita a página dentro da pasta e abre a pasta de novo: o item aparece.
    await window.getByRole("button", { name: "Favoritar página" }).click();
    const pasta = overlay.getByLabel("Pasta");
    const value = await pasta.evaluate(
      (select: HTMLSelectElement) =>
        [...select.options].find((option) => option.text.trim() === "Nova pasta")?.value ?? "",
    );
    await pasta.selectOption(value);
    await overlay.getByRole("button", { name: "Concluído" }).click();
    await expect.poll(async () => (await layersOf(app, url)).overlayVisible).toBe(false);
    await bar.getByRole("button", { name: "Nova pasta" }).click();
    await expect(folder.getByRole("menuitem", { name: "Vídeo vivo" })).toBeVisible();
    await expect(folder).toHaveClass(/glass-panel/);
    await expect.poll(async () => (await layersOf(app, url)).overlayOnTop).toBe(true);
    expect((await layersOf(app, url)).overlayVisible).toBe(true);
    await expect(window.getByRole("menu")).toHaveCount(0);
    expect((await menus()).length).toBe(before);
    if (process.env.AGZOS_SHOT) {
      await window.waitForTimeout(600);
      execFileSync("import", ["-window", "root", process.env.AGZOS_SHOT]);
    }

    // Clicar no item abre o favorito e fecha a camada.
    await folder.getByRole("menuitem", { name: "Vídeo vivo" }).click();
    await expect.poll(async () => (await layersOf(app, url)).overlayVisible).toBe(false);
  } finally {
    await app.close();
  }
});

/** Clica num campo da guia como o usuário (mouse de verdade na página, não um focus()). */
async function focusField(app: ElectronApplication, url: string, selector: string) {
  await app.evaluate(
    async ({ webContents }, [target, sel]) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === target)!;
      const rect = await contents.executeJavaScript(
        `(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();
          return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`,
      );
      contents.focus();
      for (const type of ["mouseDown", "mouseUp"] as const)
        contents.sendInputEvent({ type, x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    },
    [url, selector],
  );
}

test("2.2.7: clicar no campo de login sugere o Key, preenche e abre a barrinha do MFA", async () => {
  const { app, window } = await launch(tempProfile(), {
    AGZOS_DEBUG_OVERLAY: "1",
    AGZOS_KEY_URL: origin,
  });
  const url = `${origin}/entrar-key`;
  try {
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Entrar no site");
    // Formulário de login à vista: a chave do Agzos Key aparece na barra de endereço.
    await expect(window.getByRole("button", { name: "Agzos Key deste site" })).toBeVisible();

    // Clique no campo com o Key ainda desconectado: o popup já pede a conexão.
    await focusField(app, url, "#email");
    const overlay = await overlayPage(app);
    const popup = overlay.getByRole("complementary", { name: "Entrar com o Agzos Key" });
    await popup.getByRole("button", { name: "Conectar" }).click();
    await overlay.getByLabel("Código de pareamento").fill("ABCD-1234");
    await overlay.getByRole("button", { name: "Conectar" }).click();
    await overlay.getByLabel("Senha mestra").fill(KEY_PASSWORD);
    await overlay.getByRole("button", { name: "Desbloquear" }).click();
    await expect(overlay.getByText("Login local")).toBeVisible({ timeout: 30_000 });
    await overlay.keyboard.press("Escape");

    // Fechado o cofre, o popup volta com o login do site; preencher vai para a página.
    const fill = popup.getByRole("button", { name: "Preencher login de Login local" });
    await expect(fill).toBeVisible();
    if (process.env.AGZOS_SHOT) {
      await window.waitForTimeout(600);
      execFileSync("import", ["-window", "root", `${process.env.AGZOS_SHOT}-popup.png`]);
    }
    await fill.click();
    await expect
      .poll(() =>
        inTab<string>(
          app,
          url,
          `document.getElementById("email").value + "|" + document.getElementById("senha").value`,
        ),
      )
      .toBe("arnaldo@agzos.com|segredo");

    // O login tem Authenticator: a barrinha do Key abre na casca com o código, e a página
    // encolhe por baixo dela (nada cobre o site, copiar e colar seguem livres).
    const bar = window.getByRole("region", { name: "Código MFA do Agzos Key" });
    await expect(bar).toBeVisible();
    await expect(bar.locator(".key-bar-digits")).toHaveText(/^\d{3} \d{3}$/);
    const barBox = (await bar.boundingBox())!;
    await expect
      .poll(async () => (await nativeChildren(app)).find((view) => view.url === url)?.bounds.y)
      .toBeGreaterThanOrEqual(Math.floor(barBox.y + barBox.height));

    // Tachinha: a barra fica fixada; na tela do código, "Preencher" põe o código no campo.
    await bar.getByRole("button", { name: "Fixar a barra do Key" }).click();
    await expect(bar.getByRole("button", { name: "Desafixar a barra do Key" })).toBeVisible();
    const code = `${origin}/codigo-key`;
    await go(window, code);
    await expect(tabs(window).first()).toContainText("Código de verificação");
    await expect(bar).toBeVisible();
    // Na tela do código quem ajuda é a barrinha: o popup de login não volta sozinho.
    await window.waitForTimeout(800);
    expect((await layersOf(app, code)).overlayVisible).toBe(false);
    await bar.getByRole("button", { name: "Preencher" }).click();
    if (process.env.AGZOS_SHOT) {
      await window.waitForTimeout(600);
      execFileSync("import", ["-window", "root", `${process.env.AGZOS_SHOT}-bar.png`]);
    }
    await expect
      .poll(() => inTab<string>(app, code, `document.getElementById("otp").value`))
      .toMatch(/^\d{6}$/);
  } finally {
    await app.close();
  }
});

test("2.2.7: favorito da barra abre em guia nova e o hover troca a pasta aberta", async () => {
  const { app, window } = await launch(tempProfile());
  const url = `${origin}/video-vivo`;
  try {
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Vídeo vivo");
    await app.evaluate(({ Menu }) => {
      const g = globalThis as { __pick?: string };
      Menu.prototype.popup = function (options?: Electron.PopupOptions) {
        this.items.find((entry) => entry.label === g.__pick)?.click();
        options?.callback?.();
      };
    });
    const bar = window.getByRole("navigation", { name: "Barra de favoritos" });
    let overlay!: Page;
    // Duas pastas, criadas pelo menu da barra (o editor abre na camada).
    for (const name of ["Pasta A", "Pasta B"]) {
      await app.evaluate(() => {
        (globalThis as { __pick?: string }).__pick = "Nova pasta";
      });
      const box = (await bar.boundingBox())!;
      await bar.click({ button: "right", position: { x: box.width - 8, y: box.height / 2 } });
      overlay = await overlayPage(app);
      await overlay.getByLabel("Nome").fill(name);
      await overlay.getByRole("button", { name: "Concluído" }).click();
      await expect(bar.getByRole("button", { name })).toBeVisible();
    }

    // Favorito na barra: clicar abre numa guia nova, a página atual fica.
    await window.getByRole("button", { name: "Favoritar página" }).click();
    await overlay.getByRole("button", { name: "Concluído" }).click();
    await expect.poll(async () => (await layersOf(app, url)).overlayVisible).toBe(false);
    await bar.getByRole("button", { name: "Vídeo vivo" }).click();
    await expect(tabs(window)).toHaveCount(2);
    await tabs(window).first().click();
    await expect(omnibox(window)).toHaveValue(url);

    // Abre a Pasta A; passar o mouse na Pasta B (sob a camada) troca o menu para ela.
    await bar.getByRole("button", { name: "Pasta A" }).click();
    const folder = overlay.getByRole("menu", { name: "Pasta de favoritos" });
    await expect(folder).toBeVisible();
    await expect(bar.locator(".bookmark-chip.open")).toHaveText("Pasta A");
    const b = (await bar.getByRole("button", { name: "Pasta B" }).boundingBox())!;
    await overlay.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
    await expect(bar.locator(".bookmark-chip.open")).toHaveText("Pasta B");
    await expect(folder).toBeVisible();
    await expect(folder).toHaveAttribute("data-enter-from", "right");
    if (process.env.AGZOS_SHOT) {
      await window.waitForTimeout(600);
      execFileSync("import", ["-window", "root", `${process.env.AGZOS_SHOT}-folder.png`]);
    }
  } finally {
    await app.close();
  }
});

test("2.2.8: chave e estrela na ponta da omnibox; Preencher sem formulário avisa", async () => {
  const { app, window } = await launch(tempProfile(), {
    AGZOS_DEBUG_OVERLAY: "1",
    AGZOS_KEY_URL: origin,
  });
  const url = `${origin}/entrar-key`;
  try {
    await go(window, url);
    const key = window.getByRole("button", { name: "Agzos Key deste site" });
    await expect(key).toBeVisible();
    // Chave, estrela e link juntos na ponta direita, sem buraco dos ícones escondidos.
    const star = window.getByRole("button", { name: "Favoritar página" });
    const link = window.getByRole("button", { name: "Copiar link" });
    // A chave entra com animação (a largura cresce até a da estrela): mede depois dela.
    await expect
      .poll(async () => (await key.boundingBox())!.width)
      .toBe((await star.boundingBox())!.width);
    const [k, s, l] = await Promise.all(
      [key, star, link].map(async (b) => (await b.boundingBox())!),
    );
    expect(s.x).toBeGreaterThan(k.x);
    expect(l.x).toBeGreaterThan(s.x);
    expect(s.x - (k.x + k.width)).toBeLessThanOrEqual(4);
    expect(l.x - (s.x + s.width)).toBeLessThanOrEqual(4);
    expect(Math.abs(k.y - s.y)).toBeLessThanOrEqual(1);
    if (process.env.AGZOS_SHOT) {
      execFileSync("import", ["-window", "root", `${process.env.AGZOS_SHOT}-omnibox.png`]);
    }

    // Conecta e desbloqueia o Key pelo popup da chave.
    await key.click();
    const overlay = await overlayPage(app);
    const popup = overlay.getByRole("complementary", { name: "Entrar com o Agzos Key" });
    await popup.getByRole("button", { name: "Conectar" }).click();
    await overlay.getByLabel("Código de pareamento").fill("ABCD-1234");
    await overlay.getByRole("button", { name: "Conectar" }).click();
    await overlay.getByLabel("Senha mestra").fill(KEY_PASSWORD);
    await overlay.getByRole("button", { name: "Desbloquear" }).click();
    await expect(overlay.getByText("Login local")).toBeVisible({ timeout: 30_000 });
    await overlay.keyboard.press("Escape");

    // Página do site sem formulário de login: Preencher não some calado, o popup avisa.
    const plain = `${origin}/video-vivo`;
    await go(window, plain);
    await expect(tabs(window).first()).toContainText("Vídeo vivo");
    await expect(key).toBeVisible();
    await key.click();
    await popup.getByRole("button", { name: "Preencher login de Login local" }).click();
    await expect(popup.getByRole("status")).toContainText("Não achei campos de login");
    await expect(popup).toBeVisible();

    // Na tela de login (o popup do Key fechou ao navegar e volta sozinho com o login do
    // site), Preencher põe usuário e senha e o foco fica na página (Enter já entra).
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Entrar no site");
    await popup.getByRole("button", { name: "Preencher login de Login local" }).click();
    await expect
      .poll(() =>
        inTab<string>(
          app,
          url,
          `document.getElementById("email").value + "|" + document.getElementById("senha").value`,
        ),
      )
      .toBe("arnaldo@agzos.com|segredo");
    await expect.poll(async () => (await layersOf(app, url)).overlayVisible).toBe(false);
    await expect
      .poll(() => inTab<string>(app, url, `document.hasFocus() && document.activeElement.id`))
      .toBe("senha");

    // Login dentro de web component (shadow DOM aberto) também é preenchido.
    const shadow = `${origin}/entrar-shadow`;
    await go(window, shadow);
    await expect(tabs(window).first()).toContainText("Entrar com web component");
    await key.click();
    await popup.getByRole("button", { name: "Preencher login de Login local" }).click();
    await expect
      .poll(() =>
        inTab<string>(
          app,
          shadow,
          `(() => { const r = document.querySelector("login-box").shadowRoot;
             return r.getElementById("u").value + "|" + r.getElementById("p").value; })()`,
        ),
      )
      .toBe("arnaldo@agzos.com|segredo");
  } finally {
    await app.close();
  }
});

test("2.2.8: com uma pasta aberta, o cursor sobre outra troca o menu (sem hover da camada)", async () => {
  const { app, window } = await launch(tempProfile());
  const url = `${origin}/video-vivo`;
  try {
    await go(window, url);
    await expect(tabs(window).first()).toContainText("Vídeo vivo");
    await app.evaluate(({ Menu }) => {
      const g = globalThis as { __pick?: string };
      Menu.prototype.popup = function (options?: Electron.PopupOptions) {
        this.items.find((entry) => entry.label === g.__pick)?.click();
        options?.callback?.();
      };
    });
    const bar = window.getByRole("navigation", { name: "Barra de favoritos" });
    for (const name of ["Pasta A", "Pasta B", "Pasta C"]) {
      await app.evaluate(() => {
        (globalThis as { __pick?: string }).__pick = "Nova pasta";
      });
      const box = (await bar.boundingBox())!;
      await bar.click({ button: "right", position: { x: box.width - 8, y: box.height / 2 } });
      const overlay = await overlayPage(app);
      await overlay.getByLabel("Nome").fill(name);
      await overlay.getByRole("button", { name: "Concluído" }).click();
      await expect(bar.getByRole("button", { name })).toBeVisible();
    }
    // O cursor do sistema (o main acompanha): nenhum evento de mouse chega à camada.
    const cursorAt = async (name: string) => {
      const b = (await bar.getByRole("button", { name }).boundingBox())!;
      await app.evaluate(
        ({ screen, BrowserWindow }, point) => {
          const bounds = BrowserWindow.getAllWindows()[0].getContentBounds();
          screen.getCursorScreenPoint = () => ({ x: bounds.x + point.x, y: bounds.y + point.y });
        },
        { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) },
      );
    };
    await cursorAt("Pasta A");
    await bar.getByRole("button", { name: "Pasta A" }).click();
    await expect(bar.locator(".bookmark-chip.open")).toHaveText("Pasta A");
    await cursorAt("Pasta C");
    await expect(bar.locator(".bookmark-chip.open")).toHaveText("Pasta C");
    const overlay = await overlayPage(app);
    const folder = overlay.getByRole("menu", { name: "Pasta de favoritos" });
    await expect(folder).toHaveAttribute("data-enter-from", "right");
    await cursorAt("Pasta B");
    await expect(bar.locator(".bookmark-chip.open")).toHaveText("Pasta B");
    await expect(folder).toHaveAttribute("data-enter-from", "left");
    // Fechado o menu, o cursor sobre as pastas não abre nada.
    await overlay.keyboard.press("Escape");
    await expect(bar.locator(".bookmark-chip.open")).toHaveCount(0);
    await cursorAt("Pasta A");
    await window.waitForTimeout(300);
    await expect(bar.locator(".bookmark-chip.open")).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test("3.0: GX Control mede as guias de verdade, limpa o cache e fica ao lado da página", async () => {
  const { app, window } = await launch(tempProfile());
  const page = `${origin}/principal`;
  try {
    await go(window, page);
    await expect(tabs(window).first()).toContainText("Página PRINCIPAL");
    await window
      .getByRole("navigation", { name: "Painéis laterais" })
      .getByRole("button", { name: "GX Control" })
      .click();
    const panel = window.getByRole("complementary", { name: "GX Control" });
    await expect(panel).toBeVisible();
    await expect(panel).not.toContainText("Demonstração");
    // Números do main (app.getAppMetrics): memória do app e a guia com uso medido.
    await expect(panel.getByRole("figure", { name: /RAM: \d/ })).toBeVisible();
    const row = panel.getByRole("list", { name: "Guias por uso" }).getByRole("listitem");
    await expect(row).toHaveCount(1);
    await expect(row.getByLabel(/^Memória \d+ MB$/)).toBeVisible();
    // A página nativa encolhe para o painel da casca caber.
    const box = (await panel.boundingBox())!;
    await expect
      .poll(async () => {
        const tab = (await nativeChildren(app)).find((view) => view.url === page)?.bounds;
        return Boolean(tab && tab.x >= Math.floor(box.x + box.width) - 1);
      })
      .toBe(true);

    await panel.getByRole("switch", { name: "Ligar limitador de rede" }).click();
    await expect(panel.getByRole("slider", { name: "Download" })).toBeEnabled();
    await panel.getByRole("button", { name: "Limpar" }).click();
    await expect(panel.getByText(/liberados/)).toBeVisible({ timeout: 15_000 });
  } finally {
    await app.close();
  }
});

test("3.1.1: painel com zoom e largura próprios; a sessão dele volta depois de reiniciar", async () => {
  const profile = tempProfile();
  const panelUrl = `${origin}/painel-sessao`;
  const page = `${origin}/principal`;
  const env = { AGZOS_SIDE_PANEL_URL: panelUrl };
  const panelZoom = (app: ElectronApplication) =>
    app.evaluate(
      ({ webContents }, url) =>
        webContents
          .getAllWebContents()
          .filter((contents) => contents.getURL() === url)
          .map((contents) => contents.getZoomFactor()),
      panelUrl,
    );
  const panelTitle = (app: ElectronApplication) =>
    app.evaluate(
      ({ webContents }, url) =>
        webContents
          .getAllWebContents()
          .find((contents) => contents.getURL() === url)
          ?.getTitle() ?? "",
      panelUrl,
    );
  const asideWidth = (window: Page, id: string) =>
    window
      .locator(`aside[data-side-panel="${id}"]`)
      .evaluate((element) => Math.round(element.getBoundingClientRect().width));

  const first = await launch(profile, env);
  let grown = 0;
  try {
    await go(first.window, page);
    await expect(tabs(first.window).first()).toContainText("Página PRINCIPAL");
    const bar = first.window.getByRole("navigation", { name: "Painéis laterais" });
    await bar.getByRole("button", { name: "WhatsApp" }).click();
    await expect.poll(() => panelTitle(first.app)).toBe("token=nenhum");

    // Ctrl+= com o foco no painel: só ele aumenta (a guia do mesmo site fica em 100 %).
    await keyInTab(first.app, panelUrl, "=", ["control"]);
    await expect.poll(() => panelZoom(first.app)).toEqual([1.1]);
    await expect(
      first.window.getByRole("button", { name: "Zoom de WhatsApp: 110%. Voltar a 100%" }),
    ).toBeVisible();
    const tabZoom = await first.app.evaluate(
      ({ webContents }, url) =>
        webContents
          .getAllWebContents()
          .find((contents) => contents.getURL() === url)!
          .getZoomFactor(),
      page,
    );
    expect(tabZoom).toBe(1);

    // A alça aumenta a largura (antes só diminuía) e a página nativa acompanha.
    const separator = first.window.getByRole("separator", { name: "Largura do painel lateral" });
    const start = await asideWidth(first.window, "whatsapp");
    await separator.focus();
    for (let step = 0; step < 4; step += 1) await separator.press("ArrowRight");
    await expect.poll(() => asideWidth(first.window, "whatsapp")).toBe(start + 96);
    grown = start + 96;
    await expect
      .poll(async () => {
        const view = (await nativeChildren(first.app)).find(
          (item) => item.url === panelUrl && item.bounds.width > 0,
        );
        return view?.bounds.width ?? 0;
      })
      .toBeGreaterThan(start + 60);

    // Outro painel: largura e zoom dele, sem herdar os do WhatsApp.
    await bar.getByRole("button", { name: "Telegram" }).click();
    await expect.poll(() => asideWidth(first.window, "telegram")).toBe(start);
    await expect(first.window.getByRole("button", { name: /^Zoom de Telegram/ })).toHaveCount(0);
    await expect.poll(async () => (await panelZoom(first.app)).sort()).toEqual([1, 1.1]);
    await first.window.waitForTimeout(800);
  } finally {
    await first.app.close();
  }

  // Reiniciou: o painel volta logado (a página gravou ao descarregar), com zoom e largura.
  const second = await launch(profile, env);
  try {
    await second.window
      .getByRole("navigation", { name: "Painéis laterais" })
      .getByRole("button", { name: "WhatsApp" })
      .click();
    await expect.poll(() => panelTitle(second.app)).toBe("token=salvo");
    await expect.poll(() => panelZoom(second.app)).toEqual([1.1]);
    await expect.poll(() => asideWidth(second.window, "whatsapp")).toBe(grown);
    const exit = await second.app.evaluate(
      async (_electron, file) => {
        const { DatabaseSync } = process.getBuiltinModule(
          "node:sqlite",
        ) as typeof import("node:sqlite");
        const db = new DatabaseSync(file, { readOnly: true });
        const row = db.prepare("SELECT value FROM kv WHERE key = 'meta:sidePanelZoom'").get() as
          { value: string } | undefined;
        db.close();
        return row?.value ?? null;
      },
      path.join(profile, "agzos.db"),
    );
    expect(JSON.parse(exit ?? "{}")).toEqual({ whatsapp: 1.1 });
  } finally {
    await second.app.close();
  }
});

/** Arquivos do perfil (para conferir que a chave não ficou em texto puro). */
function profileFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return profileFiles(file);
    return entry.isFile() && fs.statSync(file).size < 20_000_000 ? [file] : [];
  });
}

test("4.0: Agzos AI pede a chave, guarda cifrada e responde em streaming", async () => {
  const profile = tempProfile();
  const page = `${origin}/principal`;
  groqCalls.length = 0;
  const { app, window } = await launch(profile, GROQ_ENV(profile));
  try {
    await go(window, page);
    await expect(tabs(window).first()).toContainText("Página PRINCIPAL");
    const panel = window.getByRole("complementary", { name: "Agzos AI" });
    // Sem chave: só o campo mascarado, nenhuma chamada à API.
    const field = panel.getByLabel("Chave da API Groq");
    await expect(field).toHaveAttribute("type", "password");
    expect(groqCalls).toEqual([]);

    await field.fill("gsk_errada_0123456789abcdefghijkl");
    await panel.getByRole("button", { name: "Salvar chave" }).click();
    await expect(panel.getByRole("alert")).toContainText("A Groq recusou a chave");
    await field.fill(GROQ_KEY);
    await panel.getByRole("button", { name: "Salvar chave" }).click();
    const input = panel.getByLabel("Mensagem para Agzos AI");
    await expect(input).toBeVisible();
    await expect(panel.getByLabel("Modelo")).toContainText("llama 3.3 70b versatile");

    // Resposta chega aos pedaços.
    await input.fill("Quem é você?");
    await input.press("Enter");
    const answer = panel.locator('.chat-bubble[data-role="assistant"]').last();
    await expect(answer).toContainText("Olá");
    await expect(answer).not.toContainText("streaming.");
    await expect(answer).toContainText("Olá do Groq em streaming.", { timeout: 10_000 });
    const first = JSON.parse(groqCalls.at(-1)!.body) as {
      stream: boolean;
      model: string;
      messages: { content: string }[];
    };
    expect(first.stream).toBe(true);
    expect(JSON.stringify(first.messages)).not.toContain(page);

    // Contexto só com o consentimento, e só naquele envio.
    await panel.getByRole("checkbox", { name: /Enviar contexto da aba/ }).check();
    await input.fill("Resuma esta página");
    await input.press("Enter");
    await expect(panel.locator(".ai-context-chip").last()).toContainText("Página PRINCIPAL");
    await expect(panel.locator('.chat-bubble[data-role="assistant"]')).toHaveCount(2);
    await expect(panel.locator('.chat-bubble[data-role="assistant"]').last()).toContainText(
      "streaming.",
      { timeout: 10_000 },
    );
    expect(groqCalls.at(-1)!.body).toContain(`URL: ${page}`);
    await expect(panel.getByRole("checkbox", { name: /Enviar contexto da aba/ })).not.toBeChecked();

    // A chave não aparece em nenhum arquivo do perfil nem na casca.
    for (const file of profileFiles(profile)) {
      expect(fs.readFileSync(file).includes(GROQ_KEY), file).toBe(false);
    }
    expect(await window.content()).not.toContain(GROQ_KEY);
  } finally {
    await app.close();
  }

  // Reabriu: a chave continua (cifrada) e a conversa volta do histórico local; apagar limpa.
  const again = await launch(profile, GROQ_ENV(profile));
  try {
    const panel = again.window.getByRole("complementary", { name: "Agzos AI" });
    await expect(panel.getByLabel("Mensagem para Agzos AI")).toBeVisible();
    await expect(panel.locator(".chat-bubble")).toHaveCount(4);
    await panel.getByRole("button", { name: "Apagar conversa" }).click();
    await expect(panel.locator(".chat-bubble")).toHaveCount(0);
  } finally {
    await again.app.close();
  }
});

/** Texto que o xterm desenhou (renderizador DOM). */
const terminalText = (window: Page) =>
  window.locator(".terminal-screen:not([hidden]) .xterm-rows").innerText();

/** 4.1.1: a primeira abertura do terminal oferece instalar as CLIs; os testes pulam. */
async function skipCliSetup(window: Page) {
  const setup = window.getByRole("dialog", { name: "Preparar as CLIs de IA" });
  await setup.getByRole("button", { name: "Agora não" }).click();
  await expect(setup).toHaveCount(0);
}

test("4.0: terminal de verdade: atalho, cd que persiste, Ctrl+C, resize e última pasta", async () => {
  test.skip(process.platform === "win32", "o e2e usa bash");
  const profile = tempProfile();
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agzos-pasta-")));
  const first = await launch(profile);
  try {
    await first.window.locator(".browser-stage").click({ position: { x: 600, y: 400 } });
    await first.window.keyboard.press("Control+Alt+t");
    await skipCliSetup(first.window);
    const dock = first.window.getByRole("region", { name: "Terminal" });
    await expect(dock).toBeVisible();
    await expect(dock.getByRole("tab")).toHaveCount(1);
    // Nada roda sozinho: só o prompt.
    await expect.poll(() => terminalText(first.window)).toMatch(/\S/);

    const type = async (text: string) => {
      await first.window.keyboard.type(text);
      await first.window.keyboard.press("Enter");
    };
    await type(`cd ${folder}`);
    await type("echo PASTA=$(pwd) SOMA=$((6*7))");
    await expect.poll(() => terminalText(first.window)).toContain(`PASTA=${folder} SOMA=42`);
    await expect(dock.getByRole("tab")).toContainText(path.basename(folder));

    // Ctrl+C interrompe o processo; Ctrl+W é do shell (a guia do navegador fica).
    await type("sleep 30");
    await first.window.waitForTimeout(300);
    await first.window.keyboard.press("Control+c");
    await type("echo CODIGO=$?");
    await expect.poll(() => terminalText(first.window)).toContain("CODIGO=130");
    await first.window.keyboard.press("Control+w");
    await expect(tabs(first.window)).toHaveCount(1);

    // Alça mais alta → mais linhas no PTY.
    await type("clear; echo ANTES=$(stty size)");
    await expect.poll(() => terminalText(first.window)).toMatch(/ANTES=\d+ \d+/);
    const before = Number(/ANTES=(\d+)/.exec(await terminalText(first.window))![1]);
    const handle = first.window.getByRole("separator", { name: "Altura do terminal" });
    await handle.focus();
    for (let step = 0; step < 5; step += 1) await handle.press("ArrowUp");
    await dock.locator(".xterm").click();
    await type("clear; echo DEPOIS=$(stty size)");
    await expect
      .poll(async () => Number(/DEPOIS=(\d+)/.exec(await terminalText(first.window))?.[1] ?? 0))
      .toBeGreaterThan(before);
    await first.window.waitForTimeout(500);
  } finally {
    await first.app.close();
  }

  // Reabriu: a sessão volta na última pasta.
  const second = await launch(profile);
  try {
    const dock = second.window.getByRole("region", { name: "Terminal" });
    await expect(dock).toBeVisible();
    await expect(dock.getByRole("tab")).toContainText(path.basename(folder));
    await dock.locator(".xterm").click();
    await second.window.keyboard.type("echo AQUI=$(pwd)");
    await second.window.keyboard.press("Enter");
    await expect.poll(() => terminalText(second.window)).toContain(`AQUI=${folder}`);
  } finally {
    await second.app.close();
  }
});

/** Eventos de mouse de verdade na página (passam pelo page-preload). */
async function mouseInTab(app: ElectronApplication, url: string, events: object[]) {
  await app.evaluate(
    ({ webContents }, [target, list]) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === target)!;
      for (const event of list as Electron.MouseInputEvent[]) contents.sendInputEvent(event);
    },
    [url, events] as const,
  );
}

test("4.0: gestos: traço com o botão direito, botões laterais, deslizar e pinça", async () => {
  const { app, window } = await launch(tempProfile());
  const a = `${origin}/gesto-a`;
  const b = `${origin}/gesto-b`;
  try {
    await go(window, a);
    await expect(tabs(window).first()).toContainText("Página GESTO-A");
    await go(window, b);
    await expect(tabs(window).first()).toContainText("Página GESTO-B");

    // Botão direito segurado + arrastar para a esquerda = voltar (sem menu de contexto).
    const drag = [
      { type: "mouseDown", x: 400, y: 300, button: "right", clickCount: 1 },
      ...[360, 320, 280, 240, 200].map((x) => ({
        type: "mouseMove",
        x,
        y: 302,
        modifiers: ["rightButtonDown"],
      })),
      { type: "mouseUp", x: 200, y: 302, button: "right", clickCount: 1 },
    ];
    await mouseInTab(app, b, drag);
    await expect(omnibox(window)).toHaveValue(a);

    // Botão lateral "avançar" (XButton2) na página.
    await inTab(app, a, `window.dispatchEvent(new MouseEvent("mouseup", { button: 4 }))`);
    await expect(omnibox(window)).toHaveValue(b);

    // Dois dedos no trackpad: rolagem horizontal precisa vira voltar.
    const swipe = Array.from({ length: 12 }, () => ({
      type: "mouseWheel",
      x: 400,
      y: 300,
      deltaX: 30,
      deltaY: 0,
      hasPreciseScrollingDeltas: true,
      canScroll: true,
    }));
    await mouseInTab(app, b, swipe);
    await expect(omnibox(window)).toHaveValue(a);

    // Pinça (Ctrl + roda fina): zoom só desta guia.
    const pinch = Array.from({ length: 8 }, () => ({
      type: "mouseWheel",
      x: 400,
      y: 300,
      deltaX: 0,
      deltaY: 12.5,
      modifiers: ["control"],
      hasPreciseScrollingDeltas: true,
      canScroll: true,
    }));
    await mouseInTab(app, a, pinch);
    await expect
      .poll(() =>
        app.evaluate(
          ({ webContents }, url) =>
            webContents
              .getAllWebContents()
              .find((contents) => contents.getURL() === url)!
              .getZoomFactor(),
          a,
        ),
      )
      .toBeGreaterThan(1);
  } finally {
    await app.close();
  }
});

test("4.1: terminal embaixo, à direita e flutuante sem perder as sessões; tema, lançador e alias", async () => {
  test.skip(process.platform === "win32", "o e2e usa bash");
  const profile = tempProfile();
  const { app, window } = await launch(profile, { AGZOS_TEST_BASIC_KEYRING: "1" });
  const type = async (page: Page, text: string) => {
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
  };
  try {
    await window.locator(".browser-stage").click({ position: { x: 600, y: 400 } });
    await window.keyboard.press("Control+Alt+t");
    await skipCliSetup(window);
    const dock = window.getByRole("region", { name: "Terminal" });
    await expect(dock).toBeVisible();
    await expect.poll(() => terminalText(window)).toMatch(/\S/);
    await type(window, "echo MARCA=$((5*5))");
    await expect.poll(() => terminalText(window)).toContain("MARCA=25");

    // À direita: a mesma sessão, com o que já estava na tela.
    await dock.getByRole("button", { name: "Terminal: À direita da página" }).click();
    await expect(window.locator('.terminal-dock[data-dock="right"]')).toBeVisible();
    await expect(window.getByRole("separator", { name: "Largura do terminal" })).toBeVisible();
    await expect(dock.getByRole("tab")).toHaveCount(1);
    await expect.poll(() => terminalText(window)).toContain("MARCA=25");

    // Janela flutuante (PiP): a sessão segue lá; a casca fica sem o painel.
    await window
      .getByRole("region", { name: "Terminal" })
      .getByRole("button", { name: "Terminal: Janela flutuante (PiP)" })
      .click();
    await expect
      .poll(() => app.windows().some((page) => page.url().endsWith("/terminal.html")))
      .toBe(true);
    const pip = app.windows().find((page) => page.url().endsWith("/terminal.html"))!;
    await expect(window.getByRole("region", { name: "Terminal" })).toHaveCount(0);
    await expect.poll(() => terminalText(pip)).toContain("MARCA=25");
    // 4.7.1: o terminal solto é uma janela normal, não flutuante. Antes ele nascia com
    // alwaysOnTop e ficava grudado na frente de tudo; o pedido foi deixá-lo sob o
    // navegador e sem ficar sempre sobreposto.
    const onTop = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().some(
        (win) => win.getTitle().startsWith("Terminal") && win.isAlwaysOnTop(),
      ),
    );
    expect(onTop).toBe(false);
    await pip.locator(".xterm").click();
    await type(pip, "echo NA-JANELA=$((2+2))");
    await expect.poll(() => terminalText(pip)).toContain("NA-JANELA=4");

    // Encaixar de volta embaixo pelo próprio PiP.
    await pip.getByRole("button", { name: "Terminal: Embaixo da página" }).click();
    await expect(window.locator('.terminal-dock[data-dock="bottom"]')).toBeVisible();
    await expect
      .poll(() => app.windows().some((page) => page.url().endsWith("/terminal.html")))
      .toBe(false);
    await expect.poll(() => terminalText(window)).toContain("NA-JANELA=4");

    // Tema e alias pelas Configurações.
    await go(window, "agzos://configuracoes");
    await window.getByRole("button", { name: "Terminal", exact: true }).first().click();
    await window.getByRole("combobox").filter({ hasText: "Agzos escuro" }).selectOption("dracula");
    await expect(window.locator(".terminal-view")).toHaveCSS("background-color", "rgb(40, 42, 54)");
    await window.getByRole("button", { name: "Terminal avançado" }).first().click();
    await window.getByLabel("Nome do alias").fill("cumprimenta");
    await window.getByLabel("Comando do alias").fill("echo ALIAS-OK");
    await window.getByRole("button", { name: "Adicionar alias" }).click();
    await window
      .getByRole("combobox", { name: "Provedor da chave" })
      .selectOption("OPENAI_API_KEY");
    await window.getByLabel("Valor de OPENAI_API_KEY").fill("sk-e2e-terminal");
    await window.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(window.getByRole("list", { name: "Chaves de API dos terminais" })).toContainText(
      "OPENAI_API_KEY",
    );
    await expect(
      window.getByRole("list", { name: "Chaves de API dos terminais" }),
    ).not.toContainText("sk-e2e-terminal");

    // Sessão nova (Ctrl+Shift+E) já com o alias e a chave no ambiente.
    await window.locator(".terminal-dock .xterm").click();
    await window.keyboard.press("Control+Shift+E");
    await expect(window.getByRole("region", { name: "Terminal" }).getByRole("tab")).toHaveCount(2);
    await window.waitForTimeout(500);
    await type(window, "cumprimenta; echo KEY=${OPENAI_API_KEY:0:6}");
    await expect.poll(() => terminalText(window)).toContain("ALIAS-OK");
    await expect.poll(() => terminalText(window)).toContain("KEY=sk-e2e");

    // Lançador: comando rápido padrão.
    await window.keyboard.press("Control+Shift+K");
    const launcher = window.getByRole("dialog", { name: "Lançador do terminal" });
    await expect(launcher).toContainText("Claude Code");
    await expect(launcher).toContainText("Freebuff");
    await launcher.getByRole("button", { name: /git status/ }).click();
    await expect.poll(() => terminalText(window)).toMatch(/git status|not a git repository|fatal/);
    // A chave nunca chega à casca.
    expect(await window.content()).not.toContain("sk-e2e-terminal");
  } finally {
    await app.close();
  }
});

test("4.1: modo voz grava, transcreve com a Groq e cola o comando no prompt", async () => {
  test.skip(process.platform === "win32", "o e2e usa bash");
  const profile = tempProfile();
  const { app, window } = await launch(profile, GROQ_ENV(profile), [
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
  ]);
  try {
    // A chave do Agzos AI (a mesma do modo voz).
    const panel = window.getByRole("complementary", { name: "Agzos AI" });
    await panel.getByLabel("Chave da API Groq").fill(GROQ_KEY);
    await panel.getByRole("button", { name: "Salvar chave" }).click();
    await expect(panel.getByLabel("Mensagem para Agzos AI")).toBeVisible();

    await window.locator(".browser-stage").click({ position: { x: 600, y: 400 } });
    await window.keyboard.press("Control+Alt+t");
    await skipCliSetup(window);
    const dock = window.getByRole("region", { name: "Terminal" });
    await expect.poll(() => terminalText(window)).toMatch(/\S/);
    await dock.getByRole("button", { name: "Falar um comando (modo voz)" }).click();
    await expect(dock.getByRole("status")).toContainText("Gravando");
    await window.waitForTimeout(1500);
    await dock.getByRole("button", { name: "Parar a gravação e transcrever" }).click();
    // Cola sem Enter (padrão): o texto fica no prompt; o Enter é do usuário.
    await expect.poll(() => terminalText(window)).toContain("echo VOZ-$((20+3))");
    expect(await terminalText(window)).not.toContain("VOZ-23");
    await dock.locator(".xterm").click();
    await window.keyboard.press("Enter");
    await expect.poll(() => terminalText(window)).toContain("VOZ-23");
    expect(groqCalls.some((call) => call.url === "/groq/audio/transcriptions")).toBe(true);
  } finally {
    await app.close();
  }
});

test("4.1.1: aba renomeada, modo ls lateral, snippets, skills e arquivos abertos no navegador", async () => {
  test.skip(process.platform === "win32", "o e2e usa bash");
  const profile = tempProfile();
  const folder = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "agzos-arquivos-")));
  fs.mkdirSync(path.join(folder, "sub"));
  fs.writeFileSync(path.join(folder, "codigo.ts"), "const tag = '<b>negrito</b>';\n");
  fs.writeFileSync(path.join(folder, "foto.png"), TINY_PNG);
  fs.mkdirSync(path.join(folder, ".claude", "skills", "revisar"), { recursive: true });
  fs.writeFileSync(
    path.join(folder, ".claude", "skills", "revisar", "SKILL.md"),
    "---\nname: revisar\ndescription: Revisa o código do projeto\n---\n",
  );
  const { app, window } = await launch(profile);
  const type = async (text: string) => {
    await window.keyboard.type(text);
    await window.keyboard.press("Enter");
  };
  try {
    await window.locator(".browser-stage").click({ position: { x: 600, y: 400 } });
    await window.keyboard.press("Control+Alt+t");
    // Primeira abertura: oferece instalar as CLIs de IA (kiro-cli e codex entre elas).
    const setup = window.getByRole("dialog", { name: "Preparar as CLIs de IA" });
    await expect(setup).toContainText("Kiro CLI");
    await expect(setup).toContainText("Codex");
    await setup.getByRole("button", { name: "Agora não" }).click();
    const dock = window.getByRole("region", { name: "Terminal" });
    await expect.poll(() => terminalText(window)).toMatch(/\S/);
    await window.locator(".terminal-dock .xterm").click();
    await type(`cd '${folder}'`);

    // Nome da aba: duplo clique, digita, Enter.
    await dock.getByRole("tab").locator("span").first().dblclick();
    await dock.getByLabel("Nome da aba").fill("meu-build");
    await dock.getByLabel("Nome da aba").press("Enter");
    await expect(dock.getByRole("tab")).toHaveText(/meu-build/);

    // Modo ls: a pasta da sessão; escolher uma pasta faz o cd no terminal.
    await dock.getByRole("button", { name: /Arquivos — modo ls lateral/ }).click();
    const list = dock.getByRole("listbox", { name: "Arquivos da pasta" });
    await expect(list).toContainText("codigo.ts");
    await expect(list).not.toContainText(".claude");
    await list.getByRole("option", { name: /^sub/ }).click();
    await expect(dock.locator(".terminal-files-path")).toHaveText(path.join(folder, "sub"));
    await window.locator(".terminal-dock .xterm").click();
    await type("echo ONDE=$(basename $PWD)");
    await expect.poll(() => terminalText(window)).toContain("ONDE=sub");
    await dock.getByRole("button", { name: "Pasta acima" }).click();
    await expect(list).toContainText("codigo.ts");

    // Código abre numa página de leitura (agzos-file), escapado.
    const code = list.getByRole("option", { name: /codigo\.ts/ });
    await code.hover();
    await code.getByRole("button", { name: "Abrir codigo.ts no navegador" }).click();
    await expect.poll(() => liveViews(app, "agzos-file:")).toHaveLength(1);
    const codeUrl = (await liveViews(app, "agzos-file:"))[0]!;
    expect(codeUrl).toContain("codigo.ts?k=");
    await expect
      .poll(() => inTab<string>(app, codeUrl, "document.querySelector('pre')?.innerText ?? ''"))
      .toContain("<b>negrito</b>");

    // Imagem abre no visualizador (título com as dimensões).
    const photo = list.getByRole("option", { name: /foto\.png/ });
    await photo.hover();
    await photo.getByRole("button", { name: "Abrir foto.png no navegador" }).click();
    const photoUrl = `file://${path.join(folder, "foto.png")}`;
    await expect.poll(() => liveViews(app, "foto.png")).toEqual([photoUrl]);
    await expect.poll(() => inTab<string>(app, photoUrl, "document.title")).toBe("foto.png (4×4)");

    // Snippets: cria e roda.
    await dock.getByRole("button", { name: "Snippets (comandos rápidos)" }).click();
    await dock.getByLabel("Nome do snippet").fill("resposta");
    await dock.getByLabel("Comando do snippet").fill("echo SNIP=$((6*7))");
    await dock.getByRole("button", { name: "Adicionar snippet" }).click();
    await dock
      .getByRole("button", { name: /resposta/ })
      .first()
      .click();
    await expect.poll(() => terminalText(window)).toContain("SNIP=42");

    // Skills do projeto entram no prompt.
    await dock.getByRole("button", { name: "Skills das CLIs de IA" }).click();
    await dock.getByRole("button", { name: /\/revisar/ }).click();
    await expect.poll(() => terminalText(window)).toContain("/revisar");
  } finally {
    await app.close();
  }
});

test("4.1.1: modo agente planeja com a Groq e roda as etapas em ordem, levando a saída adiante", async () => {
  const profile = tempProfile();
  const { app, window } = await launch(profile, GROQ_ENV(profile));
  try {
    const panel = window.getByRole("complementary", { name: "Agzos AI" });
    await panel.getByLabel("Chave da API Groq").fill(GROQ_KEY);
    await panel.getByRole("button", { name: "Salvar chave" }).click();
    await expect(panel.getByLabel("Mensagem para Agzos AI")).toBeVisible();

    await window.locator(".browser-stage").click({ position: { x: 600, y: 400 } });
    await window.keyboard.press("Control+Alt+t");
    await skipCliSetup(window);
    const dock = window.getByRole("region", { name: "Terminal" });
    await dock.getByRole("button", { name: "Modo agente" }).click();
    const canvas = dock.getByRole("region", { name: "Modo agente" });
    await canvas.getByLabel("Objetivo para os agentes").fill("Pesquisar e resumir um tema");
    await canvas.getByRole("button", { name: "Planejar com IA" }).click();
    await expect(canvas.getByRole("article")).toHaveCount(2);
    await expect(canvas.getByLabel("Nome da etapa").first()).toHaveValue("Pesquisar");
    await expect(canvas.locator(".agent-edge")).toHaveCount(1);
    await canvas.getByRole("button", { name: "Executar" }).click();
    await expect(canvas.getByRole("status")).toContainText("Fluxo concluído.");
    await expect(canvas.getByRole("article", { name: "Etapa Resumir" })).toContainText(
      "RESULTADO-2 (recebeu a etapa anterior)",
    );
    const plan = groqCalls.find((call) => call.body.includes("json_object"));
    expect(plan?.body).toContain("Pesquisar e resumir um tema");

    // O canvas fica salvo nas preferências.
    await canvas.getByRole("button", { name: "Fechar o modo agente" }).click();
    await expect(canvas).toBeHidden();
  } finally {
    await app.close();
  }
});

test("4.1.1: PWA instala com ícone no sistema, abre em janela própria isolada e desinstala", async () => {
  const profile = tempProfile();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-home-"));
  const env = { AGZOS_TEST_PWA_CONFIRM: "1", AGZOS_TEST_HOME: home };
  const pwaWindows = (app: ElectronApplication) =>
    app.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .filter((contents) => contents.session.getStoragePath()?.includes("pwa-"))
        .map((contents) => contents.getURL()),
    );
  let { app, window } = await launch(profile, env);
  let appId = "";
  try {
    await go(window, `${origin}/pwa/`);
    const install = window.getByRole("button", { name: "Instalar o app" });
    await expect(install).toBeVisible({ timeout: 20_000 });
    await install.click();
    await expect.poll(() => pwaWindows(app)).toEqual([`${origin}/pwa/`]);
    await expect(window.getByRole("button", { name: "Abrir o app instalado" })).toBeVisible();
    // Atalho do sistema (menu de aplicativos do Linux) e ícone do app.
    const shortcuts = fs.readdirSync(path.join(home, ".local", "share", "applications"));
    expect(shortcuts).toHaveLength(1);
    appId = /^agzos-pwa-([a-f0-9]{16})\.desktop$/.exec(shortcuts[0]!)![1]!;
    const entry = fs.readFileSync(
      path.join(home, ".local", "share", "applications", shortcuts[0]!),
      "utf8",
    );
    expect(entry).toContain(`--agzos-pwa=${appId}`);
    expect(entry).toContain("Name=Agzos Teste PWA");
    expect(fs.existsSync(path.join(profile, "pwa", appId, "icon.png"))).toBe(true);
    // Sem barra de guias: a janela do app carrega o site direto, em outra session.
    const isolated = await app.evaluate(async ({ webContents, session }, url) => {
      const pwa = webContents
        .getAllWebContents()
        .find(
          (contents) => contents.getURL() === url && contents.session !== session.defaultSession,
        )!;
      await pwa.executeJavaScript("document.cookie = 'quem=pwa; path=/'");
      const tab = webContents
        .getAllWebContents()
        .find(
          (contents) => contents.getURL() === url && contents.session === session.defaultSession,
        )!;
      return tab.executeJavaScript("document.cookie");
    }, `${origin}/pwa/`);
    expect(isolated).not.toContain("quem=pwa");
  } finally {
    await app.close();
  }

  // O atalho (--agzos-pwa=<id>) abre só a janela do app.
  const direct = await electron.launch({
    args: ["--no-sandbox", root, `--agzos-pwa=${appId}`],
    cwd: root,
    env: { ...process.env, AGZOS_USER_DATA: profile, ...env },
  });
  try {
    await expect.poll(() => pwaWindows(direct)).toEqual([`${origin}/pwa/`]);
    const shells = await direct.evaluate(
      ({ webContents }) =>
        webContents
          .getAllWebContents()
          .filter((contents) => /index\.html|--dev-url/.test(contents.getURL())).length,
    );
    expect(shells).toBe(0);
  } finally {
    await direct.close();
  }

  ({ app, window } = await launch(profile, env));
  try {
    await go(window, "agzos://configuracoes");
    await window.getByRole("button", { name: "Apps instalados" }).first().click();
    const list = window.getByRole("list", { name: "Apps instalados" });
    await expect(list).toContainText("Agzos Teste PWA");
    await list.getByRole("button", { name: "Desinstalar Agzos Teste PWA" }).click();
    await expect(list).toContainText("Nenhum app instalado ainda.");
    expect(fs.readdirSync(path.join(home, ".local", "share", "applications"))).toEqual([]);
    expect(fs.existsSync(path.join(profile, "pwa", appId))).toBe(false);
  } finally {
    await app.close();
  }
});

test("4.1.3: PWA sem service worker e com manifesto tardio instala; Configurações tenta instalar", async () => {
  const profile = tempProfile();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-home-"));
  const { app, window } = await launch(profile, {
    AGZOS_TEST_PWA_CONFIRM: "1",
    AGZOS_TEST_HOME: home,
  });
  try {
    // O <link rel=manifest> chega 1,5 s depois da carga e não há service worker.
    await go(window, `${origin}/pwa-spa/`);
    await expect(window.getByRole("button", { name: "Instalar o app" })).toBeVisible({
      timeout: 20_000,
    });
    // Site sem manifesto: Configurações explica, sem inventar instalação.
    await window.keyboard.press("Control+t");
    await go(window, `${origin}/principal`);
    await expect(tabs(window).last()).toContainText("Página PRINCIPAL");
    await window.keyboard.press("Control+t");
    await go(window, "agzos://configuracoes");
    await window.getByRole("button", { name: "Apps instalados" }).first().click();
    const site = window.getByLabel("Site para instalar");
    await expect(site.locator("option").first()).toContainText("Página PRINCIPAL");
    await window.getByRole("button", { name: "Tentar instalar" }).click();
    await expect(window.getByRole("status")).toContainText("não publica um manifesto");
    // O app de página única pela mesma ação.
    await site.selectOption({ label: `App SPA — ${new URL(origin).host}` });
    await window.getByRole("button", { name: "Tentar instalar" }).click();
    await expect(window.getByRole("status")).toContainText("Agzos SPA instalado como app.");
    const list = window.getByRole("list", { name: "Apps instalados" });
    await expect(list).toContainText("Agzos SPA");
    await expect
      .poll(() =>
        app.evaluate(({ webContents }) =>
          webContents
            .getAllWebContents()
            .filter((contents) => contents.session.getStoragePath()?.includes("pwa-"))
            .map((contents) => contents.getURL()),
        ),
      )
      .toEqual([`${origin}/pwa-spa/`]);
    await list.getByRole("button", { name: "Desinstalar Agzos SPA" }).click();
    await expect(list).toContainText("Nenhum app instalado ainda.");
  } finally {
    await app.close();
  }
});

test("4.1.3: Agzos AI no estilo Claude: barra lateral, guias, projetos, markdown e artifact", async () => {
  const profile = tempProfile();
  groqCalls.length = 0;
  const { app, window } = await launch(profile, GROQ_ENV(profile));
  try {
    await go(window, `${origin}/principal`);
    await expect(tabs(window).first()).toContainText("Página PRINCIPAL");
    const panel = window.getByRole("complementary", { name: "Agzos AI" });
    const nav = panel.getByRole("navigation", { name: "Conversas do Agzos AI" });
    await expect(nav).toBeVisible();
    // Sem chave: o composer só pede a GROQ_API_KEY; o rodapé mostra o status.
    await expect(panel.getByLabel("Mensagem para Agzos AI")).toHaveCount(0);
    await expect(nav).toContainText("Sem chave da Groq");
    await panel.getByLabel("Chave da API Groq").fill(GROQ_KEY);
    await panel.getByRole("button", { name: "Salvar chave" }).click();
    const input = panel.getByLabel("Mensagem para Agzos AI");
    await expect(input).toBeVisible();
    await expect(nav).toContainText("Chave Groq");
    await expect(nav).not.toContainText("Sem chave");

    // Projeto novo; a conversa nova nasce nele.
    await nav.getByRole("button", { name: "Novo projeto" }).click();
    await nav.getByLabel("Nome do projeto").fill("Pesquisa");
    await nav.getByLabel("Nome do projeto").press("Enter");
    await expect(nav.getByRole("button", { name: /Pesquisa/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await panel.getByRole("button", { name: "Novo Ctrl+N" }).click();
    await expect(panel.getByLabel("Projeto da conversa")).toHaveValue(/.+/);
    await input.fill("Primeira pergunta");
    await input.press("Enter");
    const answer = panel.locator('.chat-bubble[data-role="assistant"]').last();
    await expect(answer).toContainText("Olá do Groq em streaming.", { timeout: 10_000 });
    // Resposta em markdown (o **negrito** do servidor de mentira vira <strong>).
    await expect(answer.locator("strong")).toHaveText("Groq");
    const tabsBar = panel.getByRole("tablist", { name: "Conversas abertas" });
    await expect(tabsBar.getByRole("tab", { name: "Primeira pergunta" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    // Ctrl+N com o foco no painel: conversa nova (não janela nova), em outra guia.
    const windowCount = () =>
      app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
    const before = await windowCount();
    await input.focus();
    await window.keyboard.press("Control+n");
    await expect(tabsBar.getByRole("tab", { name: "Nova conversa" })).toBeVisible();
    await expect(panel.locator(".chat-bubble")).toHaveCount(0);
    await window.waitForTimeout(500);
    expect(await windowCount()).toBe(before);
    // Contexto só com a checkbox: esta não leva a URL.
    await input.fill("Me mostre um HTML");
    await input.press("Enter");
    await expect(panel.locator('.chat-bubble[data-role="assistant"]').last()).toContainText(
      "streaming.",
      { timeout: 10_000 },
    );
    expect(groqCalls.at(-1)!.body).not.toContain(`${origin}/principal`);
    // Só a pergunta desta conversa vai junto (a outra conversa fica de fora).
    expect(groqCalls.at(-1)!.body).not.toContain("Primeira pergunta");
    await expect(tabsBar.getByRole("tab")).toHaveCount(2);

    // Artifact HTML abre ao lado, com prévia isolada.
    await panel.getByRole("button", { name: "Abrir ao lado" }).first().click();
    const artifact = panel.getByRole("region", { name: /^Artifact:/ });
    await expect(artifact).toBeVisible();
    await expect(artifact.frameLocator("iframe").locator("h1")).toHaveText("Artifact de teste");
    await expect(artifact.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts");
    await expect(nav.getByRole("region", { name: "Artifacts" })).toContainText("Artifact de teste");

    // Renomear pela barra lateral (duplo clique) e buscar.
    await nav.getByRole("button", { name: "Me mostre um HTML" }).dblclick();
    await nav.getByLabel("Título da conversa").fill("Demo HTML");
    await nav.getByLabel("Título da conversa").press("Enter");
    await expect(tabsBar.getByRole("tab", { name: "Demo HTML" })).toBeVisible();
    await nav.getByRole("button", { name: /Pesquisa/ }).click();
    await nav.getByLabel("Buscar conversas").fill("primeira");
    await expect(nav.getByRole("button", { name: "Primeira pergunta" })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Demo HTML" })).toHaveCount(0);

    // Personalização: instruções vão no sistema da próxima pergunta.
    await nav.getByRole("button", { name: /Personalização/ }).click();
    const dialog = panel.getByRole("dialog", { name: "Personalização do Agzos AI" });
    await dialog.getByLabel("Instruções para todas as conversas").fill("Fale como pirata.");
    await dialog.getByRole("button", { name: "Salvar" }).click();
    await tabsBar.getByRole("tab", { name: "Primeira pergunta" }).click();
    await input.fill("De novo");
    await input.press("Enter");
    await expect(panel.locator('.chat-bubble[data-role="assistant"]')).toHaveCount(2, {
      timeout: 10_000,
    });
    await expect(panel.locator('.chat-bubble[data-role="assistant"]').last()).toContainText(
      "streaming.",
      { timeout: 10_000 },
    );
    expect(groqCalls.at(-1)!.body).toContain("Fale como pirata.");
    expect(groqCalls.at(-1)!.body).toContain("Primeira pergunta");
    expect(await window.content()).not.toContain(GROQ_KEY);
  } finally {
    await app.close();
  }
});

test("4.1.1 fix: arquivo aberto pelo sistema (duplo clique, Abrir com) abre numa guia", async () => {
  const profile = tempProfile();
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-abrir-"));
  const page = path.join(folder, "pagina.html");
  const notes = path.join(folder, "notas.ts");
  fs.writeFileSync(page, "<title>Pagina local</title><h1>Aberta pelo sistema</h1>");
  fs.writeFileSync(notes, "export const nota = 1;\n");
  const env = { ...process.env, AGZOS_USER_DATA: profile } as Record<string, string>;
  // Primeira execução com o arquivo (como o Explorer/gerenciador chama o executável).
  const app = await electron.launch({ args: ["--no-sandbox", root, page], cwd: root, env });
  try {
    const window = await app.firstWindow();
    await window.locator('.browser-stage[data-ready="true"]').waitFor();
    const pageUrl = `file://${page}`;
    await expect.poll(() => liveViews(app, "pagina.html")).toEqual([pageUrl]);
    await expect
      .poll(() => inTab<string>(app, pageUrl, "document.querySelector('h1')?.textContent ?? ''"))
      .toBe("Aberta pelo sistema");

    // Com o navegador aberto: a segunda execução entrega o arquivo para esta e sai.
    const electronBinary = await app.evaluate(() => process.execPath);
    execFileSync(electronBinary, ["--no-sandbox", root, path.relative(folder, notes)], {
      cwd: folder,
      env,
      timeout: 30_000,
    });
    await expect.poll(() => liveViews(app, "notas.ts?k=")).toHaveLength(1);
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  } finally {
    await app.close();
  }
});

// ---------------------------------------------------------------------------
// 4.5
// ---------------------------------------------------------------------------

test("4.5: atalho expandido ocupa a área principal e fecha o painel menor", async () => {
  const panelUrl = `${origin}/painel-lateral`;
  const { app, window } = await launch(tempProfile(), { AGZOS_SIDE_PANEL_URL: panelUrl });
  const page = `${origin}/principal`;
  const bounds = async () => {
    const views = await nativeChildren(app);
    return {
      panel: views.find((view) => view.url === panelUrl)?.bounds ?? null,
      tab: views.find((view) => view.url === page)?.bounds ?? null,
    };
  };
  try {
    await go(window, page);
    await expect(tabs(window).first()).toContainText("Página PRINCIPAL");
    await window
      .getByRole("navigation", { name: "Painéis laterais" })
      .getByRole("button", { name: "WhatsApp" })
      .click();
    const panel = window.getByRole("complementary", { name: "Painel WhatsApp" });
    await expect(panel).toBeVisible();
    await expect.poll(async () => (await bounds()).panel?.width ?? 0).toBeGreaterThan(200);

    // Expandir: o mesmo painel vai para a área principal; a guia e o painel menor somem.
    await window.getByRole("button", { name: "Expandir WhatsApp" }).click();
    await expect(panel).toHaveAttribute("data-expanded", "true");
    await expect(window.getByRole("complementary", { name: "Painel WhatsApp" })).toHaveCount(1);
    await expect
      .poll(async () => {
        const { panel: shown, tab } = await bounds();
        return Boolean(shown && tab && tab.width === 0 && shown.width > 600);
      })
      .toBe(true);
    // A mesma página do painel (sem recarregar outra).
    expect(await liveViews(app, "/painel-lateral")).toHaveLength(1);

    // Recolher: volta só o painel menor, ao lado da guia.
    await window.getByRole("button", { name: "Recolher WhatsApp" }).click();
    await expect
      .poll(async () => {
        const { panel: shown, tab } = await bounds();
        return Boolean(shown && tab && tab.width > 0 && shown.x + shown.width <= tab.x);
      })
      .toBe(true);

    // "Abrir numa guia" também nunca deixa as duas superfícies abertas.
    await window.getByRole("button", { name: "Abrir WhatsApp numa guia" }).click();
    await expect(window.getByRole("complementary", { name: "Painel WhatsApp" })).toHaveCount(0);
    await expect(tabs(window)).toHaveCount(2);
  } finally {
    await app.close();
  }
});

test("4.5: painel de portas lista e mata o processo; túnel HTTPS copia a URL e encerra", async () => {
  // Servidor "de projeto" numa pasta com package.json e um cloudflared de mentira no PATH.
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-proj-"));
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "leadmobi-e2e" }));
  const { spawn } = await import("node:child_process");
  const child = spawn(
    process.execPath,
    [
      "-e",
      "const s=require('http').createServer((q,r)=>r.end('ok')).listen(0,'127.0.0.1',()=>console.log('PORTA='+s.address().port))",
    ],
    { cwd: project, stdio: ["ignore", "pipe", "inherit"] },
  );
  // Só a linha com o número (o Node pode escrever avisos antes).
  const port = await new Promise<number>((resolve) => {
    let out = "";
    child.stdout!.on("data", (chunk) => {
      out += String(chunk);
      const match = /^PORTA=(\d+)$/m.exec(out);
      if (match) resolve(Number(match[1]));
    });
  });
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-bin-"));
  const pidFile = path.join(bin, "tunnel.pid");
  fs.writeFileSync(
    path.join(bin, "cloudflared"),
    `#!/bin/sh\necho "INF Requesting new quick Tunnel on trycloudflare.com..." >&2\n` +
      `echo "INF |  https://agzos-e2e.trycloudflare.com  |" >&2\necho $$ > "${pidFile}"\nexec sleep 600\n`,
    { mode: 0o755 },
  );
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const { app, window } = await launch(tempProfile(), {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
  });
  try {
    await window
      .getByRole("navigation", { name: "Painéis laterais" })
      .getByRole("button", { name: "Portas em uso" })
      .click();
    const panel = window.getByRole("complementary", { name: "Portas em uso" });
    await panel.getByLabel("Filtrar portas").fill(String(port));
    const item = panel.locator(`[data-port="${port}"]`);
    await expect(item).toContainText(`:${port}`, { timeout: 15_000 });
    await expect(item).toContainText("leadmobi-e2e");
    await expect(item).toContainText(`PID ${child.pid}`);

    // Expor: URL pública na tela e na área de transferência; encerrar mata o cloudflared.
    await item.getByRole("button", { name: `Expor porta ${port}` }).click();
    await expect(item.getByRole("link")).toContainText("agzos-e2e.trycloudflare.com");
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      "https://agzos-e2e.trycloudflare.com",
    );
    const tunnelPid = Number(fs.readFileSync(pidFile, "utf8"));
    expect(alive(tunnelPid)).toBe(true);
    await item.getByRole("button", { name: `Encerrar túnel da porta ${port}` }).click();
    await expect.poll(() => alive(tunnelPid)).toBe(false);

    // Fechar o painel também encerra o túnel.
    await item.getByRole("button", { name: `Expor porta ${port}` }).click();
    await expect(item.getByRole("link")).toBeVisible();
    const second = Number(fs.readFileSync(pidFile, "utf8"));
    await panel.getByRole("button", { name: "Fechar portas" }).click();
    await expect.poll(() => alive(second)).toBe(false);

    // Matar pede confirmação e encerra o processo da porta.
    await window
      .getByRole("navigation", { name: "Painéis laterais" })
      .getByRole("button", { name: "Portas em uso" })
      .click();
    await panel.getByLabel("Filtrar portas").fill(String(port));
    await item.getByRole("button", { name: new RegExp(`^Matar .* na porta ${port}$`) }).click();
    const confirm = item.getByRole("alertdialog", { name: "Confirmar encerrar processo" });
    await expect(confirm).toContainText(`PID ${child.pid}`);
    await confirm.getByRole("button", { name: "Encerrar" }).click();
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true);
    await expect(panel.getByRole("status")).toContainText(`a porta ${port} ficou livre`);
  } finally {
    child.kill();
    await app.close();
  }
});

test("4.5: três Session Tabs do mesmo site mantêm logins separados", async () => {
  const { app, window } = await launch(tempProfile());
  const login = (url: string, who: string) =>
    inTab(
      app,
      url,
      `document.cookie = "login=${who}; path=/"; localStorage.setItem("login", "${who}"); true`,
    );
  const read = (url: string) =>
    inTab<string>(app, url, `document.cookie + "|" + (localStorage.getItem("login") ?? "")`);
  try {
    const normal = `${origin}/sessao?normal`;
    await go(window, normal);
    await expect(tabs(window).first()).toContainText("Sessão isolada", { timeout: 15_000 });
    await login(normal, "normal");
    const people = ["admin", "corretor", "cliente"];
    for (const who of people) {
      await window.keyboard.press(`${MOD}+Alt+N`);
      await expect(tabs(window)).toHaveCount(people.indexOf(who) + 2);
      await go(window, `${origin}/sessao?${who}`);
      await expect(tabs(window).last()).toContainText("Sessão isolada");
      // Antes do login, a Session Tab não vê nada da guia normal nem das outras.
      expect(await read(`${origin}/sessao?${who}`)).toBe("|");
      await login(`${origin}/sessao?${who}`, who);
    }
    for (const who of people) {
      expect(await read(`${origin}/sessao?${who}`)).toBe(`login=${who}|${who}`);
    }
    expect(await read(normal)).toBe("login=normal|normal");
    await expect(window.locator(".browser-tab.session-tab")).toHaveCount(3);
    const partitions = await app.evaluate(({ webContents }) =>
      webContents
        .getAllWebContents()
        .filter((contents) => contents.getURL().includes("/sessao?"))
        .map((contents) => contents.session.getStoragePath() ?? ""),
    );
    expect(new Set(partitions).size).toBe(4);
    expect(partitions.filter((item) => item.includes("agzos-session-"))).toHaveLength(3);
  } finally {
    await app.close();
  }
});

test("4.5: API Scratchpad captura a requisição da guia e reenvia com o body editado", async () => {
  const { app, window } = await launch(tempProfile());
  const page = `${origin}/scratch`;
  try {
    await go(window, page);
    await expect(tabs(window).first()).toContainText("Scratch");
    await window.keyboard.press(`${MOD}+t`);
    await go(window, "agzos://scratchpad");
    const captured = window.getByRole("region", { name: "Requisições capturadas" });
    await expect(captured.getByLabel("Guia capturada")).toContainText("Scratch");
    await captured.getByRole("button", { name: "Capturar" }).click();
    await expect(captured.getByRole("status")).toContainText("Capturando");
    await inTab(
      app,
      page,
      `fetch("/api/eco", { method: "POST", headers: { "content-type": "application/json", "x-agzos": "1" }, body: JSON.stringify({ nome: "ana" }) }).then(() => true)`,
    );
    const send = captured.getByRole("button", {
      name: `Mandar para o Scratchpad: POST ${origin}/api/eco`,
    });
    await expect(send).toBeVisible();
    await send.click();
    const editor = window.getByRole("region", { name: "Editor da requisição" });
    await expect(editor.getByLabel("URL da requisição")).toHaveValue(`${origin}/api/eco`);
    await expect(editor.getByLabel("Headers")).toHaveValue(/x-agzos: 1/);
    await expect(editor.getByLabel("Body")).toHaveValue('{"nome":"ana"}');
    await editor.getByLabel("Body").fill('{"nome":"bia"}');
    await editor.getByRole("button", { name: "Enviar" }).click();
    const response = window.getByRole("region", { name: "Resposta" });
    await expect(response).toContainText("200");
    await expect(response.getByLabel("Corpo da resposta")).toContainText('"nome": "bia"');
    await expect(response.getByLabel("Corpo da resposta")).toContainText('"metodo": "POST"');
  } finally {
    await app.close();
  }
});

test("4.5: Ctrl+Shift+C mostra HEX e classes Tailwind do elemento clicado", async () => {
  const { app, window } = await launch(tempProfile());
  const page = `${origin}/mira`;
  try {
    await go(window, page);
    await expect(tabs(window).first()).toContainText("Mira");
    await keyInTab(app, page, "C", ["control", "shift"]);
    const target = await inTab<{ x: number; y: number }>(
      app,
      page,
      `(() => { const r = document.getElementById("alvo").getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`,
    );
    const card = async () =>
      app.evaluate(
        ({ webContents }, [url, point]) => {
          const contents = webContents.getAllWebContents().find((item) => item.getURL() === url)!;
          return contents
            .executeJavaScriptInIsolatedWorld(4132, [
              {
                code: `(() => { const s = window.__agzosInspector; return s ? (s.root.querySelector(".card")?.textContent ?? "mira") : null; })()`,
              },
            ])
            .then((text) => {
              if (text === "mira") {
                const p = point as { x: number; y: number };
                contents.sendInputEvent({ type: "mouseMove", x: p.x, y: p.y });
                contents.sendInputEvent({
                  type: "mouseDown",
                  x: p.x,
                  y: p.y,
                  button: "left",
                  clickCount: 1,
                });
                contents.sendInputEvent({
                  type: "mouseUp",
                  x: p.x,
                  y: p.y,
                  button: "left",
                  clickCount: 1,
                });
              }
              return text as string | null;
            });
        },
        [page, target] as const,
      );
    await expect.poll(card, { timeout: 10_000 }).toContain("#D10A11");
    const text = (await card())!;
    expect(text).toContain("#FFFFFF");
    expect(text).toContain("bg-[#d10a11]");
    expect(text).toContain("text-white");
    expect(text).toContain("rounded-lg");
    // O clique da mira não chega na página.
    expect(await inTab(app, page, "document.activeElement?.id ?? null")).not.toBe("alvo");
    // Esc fecha o balão e depois a mira.
    await keyInTab(app, page, "Escape");
    await keyInTab(app, page, "Escape");
    await expect
      .poll(() =>
        app.evaluate(({ webContents }, url) => {
          const contents = webContents.getAllWebContents().find((item) => item.getURL() === url)!;
          return contents.executeJavaScriptInIsolatedWorld(4132, [
            { code: "Boolean(window.__agzosInspector)" },
          ]);
        }, page),
      )
      .toBe(false);
  } finally {
    await app.close();
  }
});

test("4.5: extensão MV3 descompactada carrega, desliga e sai", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-ext-"));
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Agzos E2E Ext",
      version: "1.0",
      content_scripts: [{ matches: ["<all_urls>"], js: ["c.js"], run_at: "document_end" }],
    }),
  );
  fs.writeFileSync(path.join(dir, "c.js"), 'document.documentElement.dataset.agzosExt = "ok";');
  const { app, window } = await launch(tempProfile());
  try {
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as never;
    }, dir);
    await go(window, "agzos://configuracoes");
    await window
      .getByRole("navigation", { name: "Seções das configurações" })
      .getByRole("button", { name: "Extensões" })
      .click();
    await expect(window.getByText(/Este build não traz o Widevine/)).toBeVisible();
    await window.getByRole("button", { name: "Carregar descompactada…" }).click();
    await expect(
      window.getByRole("status").filter({ hasText: "Extensão carregada." }),
    ).toBeVisible();
    const list = window.getByRole("list", { name: "Extensões" });
    await expect(list).toContainText("Agzos E2E Ext");

    const page = `${origin}/a`;
    await window.keyboard.press(`${MOD}+t`);
    await go(window, page);
    await expect(tabs(window).last()).toContainText("Página A");
    await expect
      .poll(() => inTab(app, page, "document.documentElement.dataset.agzosExt ?? null"))
      .toBe("ok");

    // Desligada: a página recarregada não recebe mais o script.
    await tabs(window).first().click();
    await window
      .getByRole("navigation", { name: "Seções das configurações" })
      .getByRole("button", { name: "Extensões" })
      .click();
    await list.getByRole("switch", { name: "Agzos E2E Ext ligada" }).click();
    await expect(list.getByRole("switch", { name: "Agzos E2E Ext ligada" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    await app.evaluate(({ webContents }, url) => {
      webContents
        .getAllWebContents()
        .find((item) => item.getURL() === url)!
        .reload();
    }, page);
    await expect
      .poll(() =>
        inTab(
          app,
          page,
          "document.readyState === 'complete' ? (document.documentElement.dataset.agzosExt ?? 'sem') : null",
        ),
      )
      .toBe("sem");
    await list.getByRole("button", { name: "Remover Agzos E2E Ext" }).click();
    await expect(window.getByText("Nenhuma extensão ainda.")).toBeVisible();
  } finally {
    await app.close();
  }
});

test("4.5: captura, modo leitura, nota e tema persistem", async () => {
  const profile = tempProfile();
  let { app, window } = await launch(profile);
  const article = `${origin}/artigo`;
  try {
    // Tema: escuro por padrão.
    await expect(window.locator("html")).toHaveClass(/dark/);

    // Captura de tela: guia ou janela do app; copiar vai para a área de transferência.
    await go(window, article);
    await expect(tabs(window).first()).toContainText("Artigo de teste");
    await window.keyboard.press(`${MOD}+Shift+S`);
    const dialog = window.getByRole("dialog", { name: "Captura de tela" });
    await expect(dialog.getByRole("img", { name: "Prévia da captura" })).toBeVisible();
    await dialog.getByRole("radio", { name: "Janela do app" }).click();
    await dialog.getByRole("button", { name: "Copiar" }).click();
    await expect(dialog.getByRole("status")).toHaveText("Imagem copiada.");
    const copied = await app.evaluate(async ({ clipboard }) => {
      const [item] = await clipboard.read();
      if (!item?.types.includes("image/png")) return 0;
      return ((await item.getType("image/png")) as Blob).size;
    });
    expect(copied).toBeGreaterThan(1000);
    await window.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // Modo leitura: título e corpo, sem o menu do site; a guia fica coberta e volta.
    await keyInTab(app, article, "R", ["control", "alt"]);
    const reader = window.getByRole("region", { name: "Modo leitura" });
    await expect(reader.getByRole("heading", { level: 1 })).toHaveText("Como o Agzos lê artigos");
    await expect(reader).toContainText("Segunda parte");
    await expect(reader).toContainText("Ana Autora");
    await expect(reader).not.toContainText("Menu do site");
    await expect(reader).not.toContainText("Publicidade lateral");
    const tabWidth = async () =>
      (await nativeChildren(app)).find((view) => view.url === article)?.bounds.width ?? -1;
    await expect.poll(tabWidth).toBe(0);
    await reader.getByRole("button", { name: "Sair do modo leitura" }).click();
    await expect(reader).toHaveCount(0);
    await expect.poll(tabWidth).toBeGreaterThan(0);

    // Notas: markdown simples por URL.
    await expect(window.getByRole("complementary", { name: "Agzos AI" })).toBeVisible();
    await window.keyboard.press(`${MOD}+Shift+M`);
    const notes = window.getByRole("complementary", { name: "Notas" });
    // Notas e Agzos AI dividem o lado direito: abrir um fecha o outro.
    await expect(window.getByRole("complementary", { name: "Agzos AI" })).toHaveCount(0);
    await notes
      .getByRole("textbox", { name: "Nota desta página" })
      .fill("# Lembrete\n- revisar o artigo");
    await notes.getByRole("radio", { name: "Ver" }).click();
    await expect(notes.getByRole("heading", { name: "Lembrete" })).toBeVisible();
    await go(window, `${origin}/b`);
    await expect(tabs(window).first()).toContainText("Página B");
    await expect(notes.getByRole("textbox", { name: "Nota desta página" })).toHaveValue("");
    await expect(notes.getByRole("region", { name: "Outras notas" })).toContainText(
      "Artigo de teste",
    );

    // Tema claro pelas Configurações.
    await window.keyboard.press(`${MOD}+t`);
    await go(window, "agzos://configuracoes");
    await window.getByRole("radio", { name: "Claro" }).click();
    await expect(window.locator("html")).not.toHaveClass(/dark/);
    await app.close();

    ({ app, window } = await launch(profile));
    await expect(window.locator("html")).not.toHaveClass(/dark/);
    const notesAgain = window.getByRole("complementary", { name: "Notas" });
    await expect(notesAgain).toBeVisible();
    await expect(notesAgain.getByRole("region", { name: "Outras notas" })).toContainText(
      "Artigo de teste",
    );
  } finally {
    await app.close();
  }
});

test("4.6: ferramentas só na barra lateral, em menu com o visual do app", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    // Página inicial e Discador sem a grade de ferramentas.
    await expect(window.getByRole("region", { name: "Ferramentas" })).toHaveCount(0);
    await window
      .getByRole("button", { name: /Discador/ })
      .first()
      .click();
    await expect(window.getByRole("list", { name: "Sites do Discador" })).toBeVisible();
    await expect(window.getByRole("region", { name: "Ferramentas" })).toHaveCount(0);
    // Ferramentas na barra lateral abre o menu na camada (não é menu nativo).
    await window
      .getByRole("navigation", { name: "Painéis laterais" })
      .getByRole("button", { name: "Ferramentas" })
      .click();
    const layer = await overlayPage(app);
    const menu = layer.getByRole("menu", { name: "Ferramentas" });
    await expect(menu).toBeVisible();
    await expect(menu).toHaveClass(/app-menu/);
    await expect(menu.getByRole("menuitem", { name: /Mira de elemento/ })).toBeVisible();
    await menu.getByRole("menuitem", { name: /Nova Session Tab/ }).click();
    await expect(window.locator(".browser-tab.session-tab")).toHaveCount(1);
    // Sem barra de ferramentas duplicada.
    await expect(window.getByRole("button", { name: "Ferramentas" })).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test("4.6: caderno do modo leitura só aparece em página com artigo", async () => {
  const { app, window } = await launch(tempProfile());
  const reader = window.getByRole("button", { name: "Modo leitura", exact: true });
  try {
    await go(window, `${origin}/curta`);
    await expect(tabs(window).first()).toContainText("Página CURTA");
    await window.waitForTimeout(1500);
    await expect(reader).toHaveCount(0);
    await go(window, `${origin}/artigo`);
    await expect(tabs(window).first()).toContainText("Artigo de teste");
    await expect(reader).toBeVisible({ timeout: 10_000 });
    await reader.click();
    await expect(window.getByRole("region", { name: "Modo leitura" })).toBeVisible();
    await expect(reader).toHaveAttribute("aria-pressed", "true");
    await reader.click();
    await expect(window.getByRole("region", { name: "Modo leitura" })).toHaveCount(0);
    await expect(tabs(window)).toHaveCount(1);
  } finally {
    await app.close();
  }
});

test("4.6: extensões em pop-up: abrir ancorado, fixar, acesso ao site e remover", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-ext-"));
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      manifest_version: 3,
      name: "Agzos Pop-up",
      version: "1.0",
      action: { default_popup: "popup.html" },
      content_scripts: [{ matches: ["<all_urls>"], js: ["c.js"], run_at: "document_end" }],
    }),
  );
  fs.writeFileSync(path.join(dir, "c.js"), 'document.documentElement.dataset.agzosExt = "ok";');
  fs.writeFileSync(
    path.join(dir, "popup.html"),
    '<!doctype html><body style="width:240px;height:120px;margin:0"><h1>Pop-up</h1></body>',
  );
  const { app, window } = await launch(tempProfile());
  const page = `${origin}/a`;
  try {
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as never;
    }, dir);
    await go(window, page);
    await expect(tabs(window).first()).toContainText("Página A");
    // Quebra-cabeça abre o pop-up (camada), não uma guia.
    await window.getByRole("button", { name: "Extensões" }).click();
    const layer = await overlayPage(app);
    const panel = layer.getByRole("complementary", { name: "Extensões" });
    await expect(panel).toContainText("Nenhuma extensão instalada");
    await panel.getByRole("button", { name: "Carregar extensão descompactada…" }).click();
    await window.getByRole("button", { name: "Extensões" }).click();
    await expect(panel).toContainText("Agzos Pop-up");
    await expect(panel).toContainText("Pode ler e alterar dados em todos os sites");
    await expect(tabs(window)).toHaveCount(1);
    // Alfinete: o ícone entra na barra.
    await panel.getByRole("button", { name: "Fixar Agzos Pop-up" }).click();
    const pinned = window.getByRole("button", { name: "Agzos Pop-up", exact: true });
    await expect(pinned).toBeVisible();
    await layer.keyboard.press("Escape");
    // Clique no ícone fixado: o pop-up da extensão abre ancorado abaixo dele.
    await pinned.click();
    const popup = async () =>
      app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find((item) =>
          item.webContents.getURL().startsWith("chrome-extension://"),
        );
        if (!win || !win.isVisible()) return null;
        const parent = BrowserWindow.getAllWindows()
          .find((item) => item.webContents.getURL().endsWith("index.html"))!
          .getContentBounds();
        return { bounds: win.getBounds(), parent, url: win.webContents.getURL() };
      });
    await expect.poll(async () => (await popup())?.url ?? "").toMatch(/\/popup\.html$/);
    const opened = (await popup())!;
    const anchor = (await pinned.boundingBox())!;
    expect(opened.bounds.y).toBeGreaterThanOrEqual(opened.parent.y + anchor.y + anchor.height);
    expect(
      Math.abs(opened.bounds.x + opened.bounds.width - (opened.parent.x + anchor.x + anchor.width)),
    ).toBeLessThanOrEqual(2);
    // A página carregou antes da extensão: recarrega para o content script entrar.
    await app.evaluate(({ webContents }, url) => {
      webContents
        .getAllWebContents()
        .find((item) => item.getURL() === url)!
        .reload();
    }, page);
    await expect
      .poll(() =>
        inTab(
          app,
          page,
          "document.readyState === 'complete' ? (document.documentElement.dataset.agzosExt ?? 'sem') : null",
        ),
      )
      .toBe("ok");
    // Clique direito: menu da extensão (camada), sem acesso a este site.
    await window.mouse.click(5, 5);
    await pinned.click({ button: "right" });
    const menu = layer.getByRole("menu", { name: "Menu de Agzos Pop-up" });
    await expect(menu).toBeVisible();
    // 4.6.1: só o que existe no manifest (esta não tem página de opções).
    await expect(menu.getByRole("menuitem", { name: "Opções" })).toHaveCount(0);
    for (const item of [
      "Desafixar da barra",
      "Exibir permissões",
      "Gerenciar extensão",
      "Inspecionar pop-up",
      "Remover…",
    ]) {
      await expect(menu.getByRole("menuitem", { name: item })).toBeVisible();
    }
    await menu.getByRole("menuitemradio", { name: "Nenhum acesso a este site" }).click();
    await expect(window.locator(".agzos-notice")).toContainText("não tem mais acesso");
    await app.evaluate(({ webContents }, url) => {
      webContents
        .getAllWebContents()
        .find((item) => item.getURL() === url)!
        .reload();
    }, page);
    await expect
      .poll(() =>
        inTab(
          app,
          page,
          "document.readyState === 'complete' ? (document.documentElement.dataset.agzosExt ?? 'sem') : null",
        ),
      )
      .toBe("sem");
    // Remover pede confirmação.
    await pinned.click({ button: "right" });
    await menu.getByRole("menuitem", { name: "Remover…" }).click();
    await menu
      .getByRole("alertdialog", { name: "Confirmar remover" })
      .getByRole("button", { name: "Remover" })
      .click();
    await expect(pinned).toHaveCount(0);
    await window.getByRole("button", { name: "Extensões" }).click();
    await expect(panel).toContainText("Nenhuma extensão instalada");
  } finally {
    await app.close();
  }
});

test("4.6.1: o manifest decide o clique; pop-ups trocados não encolhem; reinício mantém", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agzos-ext461-"));
  const make = (name: string, manifest: object, files: Record<string, string> = {}) => {
    const dir = path.join(root, name);
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({ manifest_version: 3, name, version: "1.0", ...manifest }),
    );
    for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), text);
    return dir;
  };
  const dirs = [
    // Pop-up que monta depois (busca dados): cresce depois do load.
    make(
      "Larga",
      { action: { default_popup: "p.html" } },
      {
        "p.html":
          '<!doctype html><body style="margin:0;width:420px"><h1>Larga</h1><script src="p.js"></script></body>',
        "p.js":
          'setTimeout(() => { const box = document.createElement("div"); box.style.height = "300px"; document.body.append(box); }, 700);',
      },
    ),
    make(
      "Pequena",
      { action: { default_popup: "p.html" } },
      {
        "p.html": '<!doctype html><body style="margin:0;width:220px;height:90px">Pequena</body>',
      },
    ),
    make("SoOpcoes", { options_page: "o.html" }, { "o.html": "<title>Opções SoOpcoes</title>" }),
    make("SoFundo", { background: { service_worker: "sw.js" } }, { "sw.js": "" }),
    make(
      "Lateral",
      { side_panel: { default_path: "s.html" } },
      {
        "s.html": "<title>Painel Lateral</title><p>painel</p>",
      },
    ),
    // MV2 também entra (4.6.1).
    make(
      "Antiga",
      {
        manifest_version: 2,
        browser_action: { default_popup: "p.html" },
      },
      { "p.html": '<body style="width:200px;height:60px">mv2</body>' },
    ),
  ];
  const profile = tempProfile();
  let { app, window } = await launch(profile);
  type Bridge = {
    extensionsAddUnpacked: () => Promise<{ ok: boolean; error?: string }>;
    extensionsList: () => Promise<{ list: { dir: string; kind: string; loaded: boolean }[] }>;
    extensionsPin: (dir: string, pinned: boolean) => Promise<unknown>;
  };
  const popup = async () =>
    app.evaluate(({ BrowserWindow }) => {
      const wins = BrowserWindow.getAllWindows().filter((item) =>
        item.webContents.getURL().startsWith("chrome-extension://"),
      );
      const win = wins.find((item) => item.isVisible());
      return { count: wins.length, url: win?.webContents.getURL() ?? "", bounds: win?.getBounds() };
    });
  try {
    for (const dir of dirs) {
      await app.evaluate(({ dialog }, folder) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as never;
      }, dir);
      const result = await window.evaluate(() =>
        (window as never as { agzosDesktop: Bridge }).agzosDesktop.extensionsAddUnpacked(),
      );
      expect(result).toMatchObject({ ok: true });
    }
    const kinds = await window.evaluate(async () => {
      const desktop = (window as never as { agzosDesktop: Bridge }).agzosDesktop;
      const { list } = await desktop.extensionsList();
      for (const item of list) await desktop.extensionsPin(item.dir, true);
      return list.map((item) => item.kind);
    });
    expect(kinds).toEqual(["popup", "popup", "options", "background", "sidepanel", "popup"]);
    const icon = (name: string) => window.getByRole("button", { name, exact: true });

    // Pop-up que cresce depois do load: acompanha o conteúdo.
    await icon("Larga").click();
    await expect.poll(async () => (await popup()).bounds?.width ?? 0).toBe(420);
    await expect.poll(async () => (await popup()).bounds?.height ?? 0).toBeGreaterThan(300);
    // Trocar de extensão: a anterior some (janela destruída) e a nova tem o tamanho dela.
    await icon("Pequena").click();
    await expect.poll(async () => (await popup()).url).toMatch(/\/p\.html$/);
    await expect.poll(async () => (await popup()).bounds?.width ?? 0).toBe(220);
    await expect.poll(async () => (await popup()).bounds?.height ?? 0).toBe(90);
    expect((await popup()).count).toBe(1);
    // Voltar para a larga: nada de faixa pequena herdada.
    await icon("Larga").click();
    await expect.poll(async () => (await popup()).bounds?.width ?? 0).toBe(420);
    await expect.poll(async () => (await popup()).bounds?.height ?? 0).toBeGreaterThan(300);
    expect((await popup()).count).toBe(1);
    // MV2 com browser_action.default_popup.
    await icon("Antiga").click();
    await expect.poll(async () => (await popup()).bounds?.width ?? 0).toBe(216);
    await app.evaluate(({ BrowserWindow }) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.webContents.getURL().startsWith("chrome-extension://")) win.destroy();
      }
    });

    // Sem pop-up, com opções: o clique abre as opções numa guia.
    await icon("SoOpcoes").click();
    await expect(tabs(window)).toHaveCount(2);
    await expect
      .poll(() =>
        app.evaluate(({ webContents }) =>
          webContents.getAllWebContents().some((item) => /\/o\.html$/.test(item.getURL())),
        ),
      )
      .toBe(true);
    expect((await popup()).count).toBe(0);

    // Só fundo: nenhuma janela vazia; o menu dela avisa que está ativa.
    await icon("SoFundo").click();
    const layer = await overlayPage(app);
    const menu = layer.getByRole("menu", { name: "Menu de SoFundo" });
    await expect(menu).toContainText("SoFundo está ativa.");
    await expect(menu.getByRole("menuitem", { name: "Opções" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Inspecionar pop-up" })).toHaveCount(0);
    expect((await popup()).count).toBe(0);
    await layer.keyboard.press("Escape");

    // side_panel: abre no painel lateral do navegador.
    await icon("Lateral").click();
    await expect
      .poll(() =>
        app.evaluate(({ webContents }) =>
          webContents.getAllWebContents().some((item) => /\/s\.html$/.test(item.getURL())),
        ),
      )
      .toBe(true);
    await expect(window.getByRole("complementary", { name: "Painel Lateral" })).toBeVisible();
  } finally {
    await app.close();
  }

  // Reiniciar mantém as extensões instaladas e carregadas.
  ({ app, window } = await launch(profile));
  try {
    await expect
      .poll(() =>
        window.evaluate(async () => {
          const { list } = await (
            window as never as { agzosDesktop: Bridge }
          ).agzosDesktop.extensionsList();
          return list.filter((item) => item.loaded).length;
        }),
      )
      .toBe(6);
    await expect(window.getByRole("button", { name: "Larga", exact: true })).toBeVisible();
  } finally {
    await app.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("4.6.1: dica da barra inteira, dentro da janela (não o tooltip nativo)", async () => {
  const { app, window } = await launch(tempProfile());
  try {
    await go(window, `${origin}/baixar`);
    await go(window, `${origin}/arquivo/relatorio.txt`);
    const downloads = window.getByRole("button", { name: "Downloads", exact: true });
    await expect(downloads).toBeVisible();
    await window.keyboard.press("Escape");
    const box = (await downloads.boundingBox())!;
    await window.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const tip = () =>
      app.evaluate(({ BrowserWindow, webContents }) => {
        const win = BrowserWindow.getAllWindows()[0]!;
        const view = win.contentView.children.find(
          (child) =>
            "webContents" in child &&
            (child as { webContents: Electron.WebContents }).webContents
              .getURL()
              .startsWith("data:text/html") &&
            child.getVisible(),
        ) as { webContents: Electron.WebContents; getBounds: () => Electron.Rectangle } | undefined;
        void webContents;
        return view
          ? view.webContents
              .executeJavaScript('document.getElementById("t").textContent')
              .then((text: string) => ({
                text,
                bounds: view.getBounds(),
                width: win.getContentBounds().width,
              }))
          : null;
      });
    await expect
      .poll(async () => (await tip())?.text ?? "")
      .toBe(process.platform === "darwin" ? "Downloads (⌘J)" : "Downloads (Ctrl+J)");
    const shown = (await tip())!;
    expect(shown.bounds.x + shown.bounds.width).toBeLessThanOrEqual(shown.width);
    expect(shown.bounds.y).toBeGreaterThanOrEqual(box.y + box.height);
    // O título nativo sai (não aparece por cima, cortado).
    await expect(downloads).not.toHaveAttribute("title");
    await window.mouse.move(400, 300);
    await expect.poll(async () => (await tip()) === null).toBe(true);
  } finally {
    await app.close();
  }
});

test("4.6: barra lateral muda de largura arrastando e se adapta", async () => {
  const profile = tempProfile();
  let { app, window } = await launch(profile);
  try {
    const bar = window.getByRole("navigation", { name: "Painéis laterais" });
    const handle = window.getByRole("separator", { name: "Largura da barra lateral" });
    await expect(bar).toHaveAttribute("data-mode", "normal");
    const drag = async (x: number) => {
      const box = (await handle.boundingBox())!;
      await window.mouse.move(box.x + box.width / 2, box.y + 200);
      await window.mouse.down();
      await window.mouse.move(x, box.y + 200, { steps: 6 });
      await window.mouse.up();
    };
    await drag(150);
    await expect(bar).toHaveAttribute("data-mode", "wide");
    expect(Math.round((await bar.boundingBox())!.width)).toBeGreaterThan(120);
    await expect(bar.getByRole("button", { name: "WhatsApp" })).toContainText("WhatsApp");
    await drag(30);
    await expect(bar).toHaveAttribute("data-mode", "compact");
    await expect(bar.locator(".side-bar-name").first()).toBeHidden();
    await handle.dblclick();
    await expect(bar).toHaveAttribute("data-mode", "normal");
    await handle.focus();
    for (let index = 0; index < 8; index += 1) await window.keyboard.press("ArrowRight");
    await expect(bar).toHaveAttribute("data-mode", "wide");
    await window.waitForTimeout(800);
    await app.close();
    ({ app, window } = await launch(profile));
    await expect(window.getByRole("navigation", { name: "Painéis laterais" })).toHaveAttribute(
      "data-mode",
      "wide",
    );
  } finally {
    await app.close();
  }
});

// --- 4.7 ---

const desktopCall = <T>(window: Page, code: string) =>
  window.evaluate(
    (source) =>
      new Function("desktop", `return (async () => { ${source} })()`)(
        (window as unknown as { agzosDesktop: unknown }).agzosDesktop,
      ),
    code,
  ) as Promise<T>;

test("4.7: gerenciador de downloads (Ctrl+J, regras, etiquetas, Range, filtros, teclado)", async () => {
  const profile = tempProfile();
  let { app, window } = await launch(profile);
  const pdfDir = path.join(profile, "Documentos PDF");
  try {
    // Organizar por tipo (PDF numa pasta própria) e regra de domínio → etiqueta.
    await desktopCall(
      window,
      `const { config } = await desktop.downloadsConfig();
       await desktop.downloadsSetConfig({ ...config, byTypeOn: true,
         byType: { ...config.byType, pdf: ${JSON.stringify(pdfDir)} },
         rules: [{ id: "r1", match: "domain", pattern: "127.0.0.1", tag: "teste", folder: "", subfolder: "", enabled: true }] });`,
    );
    // Ctrl+J abre o gerenciador em menos de 150 ms (medido na casca, com o app já de pé:
    // nos primeiros instantes o processo ainda carrega listas e perfil).
    await window.waitForTimeout(1500);
    const elapsed = await window.evaluate((meta) => {
      return new Promise<number>((resolve) => {
        const start = performance.now();
        window.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "j",
            code: "KeyJ",
            ctrlKey: !meta,
            metaKey: meta,
            bubbles: true,
          }),
        );
        const check = () =>
          document.querySelector(".downloads-manager")
            ? resolve(performance.now() - start)
            : requestAnimationFrame(check);
        check();
      });
    }, process.platform === "darwin");
    expect(elapsed).toBeLessThan(150);
    await expect(omnibox(window)).toHaveValue("agzos://downloads");
    const manager = window.getByRole("grid", { name: "Lista de downloads" });

    // A rede cai no meio: o Chromium retoma de onde parou com Range (If-Range pelo ETag),
    // sozinho ou pelo "Retomar" quando ele desiste.
    await app.evaluate(
      ({ session }, url) => session.defaultSession.downloadURL(url),
      `${origin}/v47/retomavel.bin`,
    );
    const row = manager.getByRole("row").filter({ hasText: "retomavel.bin" });
    const resume = row.getByRole("button", { name: /Retomar retomavel\.bin/ });
    await expect
      .poll(
        async () =>
          ((await row.textContent()) ?? "").includes("Concluído") || (await resume.count()) > 0,
        { timeout: 20_000 },
      )
      .toBe(true);
    if ((await resume.count()) > 0) await resume.click();
    await expect(row).toContainText("Concluído", { timeout: 20_000 });
    await expect(row).toContainText("teste");
    expect(v47Ranges.some((range) => /^bytes=\d+-$/.test(range) && range !== "bytes=0-")).toBe(
      true,
    );
    expect(fs.statSync(path.join(profile, "Downloads", "retomavel.bin")).size).toBe(
      RESUMABLE.length,
    );

    // PDF vai para a pasta do tipo.
    await app.evaluate(
      ({ session }, url) => session.defaultSession.downloadURL(url),
      `${origin}/v47/doc.pdf`,
    );
    const pdfRow = manager.getByRole("row").filter({ hasText: "doc.pdf" });
    await expect(pdfRow).toContainText("Concluído", { timeout: 20_000 });
    expect(fs.existsSync(path.join(pdfDir, "doc.pdf"))).toBe(true);

    // Filtros e busca no histórico local.
    await window.getByRole("tab", { name: /Concluídos/ }).click();
    await expect(manager.getByRole("row")).toHaveCount(3);
    await window.getByLabel("Filtrar por tipo").selectOption("pdf");
    await expect(manager.getByRole("row")).toHaveCount(2);
    await window.getByLabel("Filtrar por tipo").selectOption("all");
    await window.getByLabel("Pesquisar downloads").fill("retomavel");
    await expect(manager.getByRole("row")).toHaveCount(2);
    await window.getByLabel("Pesquisar downloads").fill("");

    // Etiqueta à mão (vale em todas as janelas pelo main).
    await pdfRow.getByRole("button", { name: "Etiquetar doc.pdf" }).click();
    await pdfRow.getByLabel("Nova etiqueta").fill("contratos");
    await pdfRow.getByLabel("Nova etiqueta").press("Enter");
    await expect(pdfRow).toContainText("contratos");
    await pdfRow.getByRole("button", { name: "Pronto" }).click();
    await window.getByLabel("Filtrar por etiqueta").selectOption("contratos");
    await expect(manager.getByRole("row")).toHaveCount(2);
    await window.getByLabel("Filtrar por etiqueta").selectOption("");

    // Teclado: F busca; setas e Shift+Delete tiram do histórico.
    await pdfRow.focus();
    await window.keyboard.press("Shift+Delete");
    await expect(manager.getByRole("row").filter({ hasText: "doc.pdf" })).toHaveCount(0);
    await window.keyboard.press("f");
    await expect(window.getByLabel("Pesquisar downloads")).toBeFocused();

    // Exportar CSV (diálogo trocado no teste).
    const csv = path.join(profile, "downloads.csv");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: file,
      })) as typeof dialog.showSaveDialog;
    }, csv);
    await window.getByRole("button", { name: "Exportar CSV" }).click();
    await expect.poll(() => fs.existsSync(csv)).toBe(true);
    expect(fs.readFileSync(csv, "utf8")).toContain("retomavel.bin");

    // Ctrl+J no gerenciador fecha (a guia volta ou fecha).
    await window.keyboard.press(`${MOD}+j`);
    await expect(omnibox(window)).not.toHaveValue("agzos://downloads");
  } finally {
    await app.close();
  }
  // A pasta e as regras sobrevivem ao reinício.
  ({ app, window } = await launch(profile));
  try {
    const config = await desktopCall<{ byTypeOn: boolean; rules: unknown[] }>(
      window,
      "return (await desktop.downloadsConfig()).config;",
    );
    expect(config.byTypeOn).toBe(true);
    expect(config.rules).toHaveLength(1);
  } finally {
    await app.close();
  }
});

test("4.7: tema Dark por domínio (sem reload, mídia fora, lembrado)", async () => {
  const profile = tempProfile();
  let { app, window } = await launch(profile);
  const page = `${origin}/v47/tema`;
  const filterOf = (url: string, selector: string) =>
    inTab<string>(
      app,
      url,
      `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).filter`,
    );
  try {
    await go(window, page);
    await expect.poll(() => liveViews(app, page)).toHaveLength(1);
    const on = window.getByRole("button", { name: "Ligar o tema Dark nesta página" });
    await expect(on).toBeVisible();
    await on.click();
    await expect.poll(() => filterOf(page, "html")).toContain("invert");
    // Imagem volta ao original (inverte de novo) e a página não recarregou.
    expect(await filterOf(page, "#foto")).toContain("invert");
    expect(await inTab(app, page, "window.marcador")).toBe("sem-reload");
    const off = window.getByRole("button", { name: /voltar ao Lightning/i });
    await expect(off).toHaveAttribute("aria-pressed", "true");
    // Mesmo domínio, outra página: já nasce em Dark.
    await go(window, `${origin}/outra`);
    await expect.poll(() => liveViews(app, "/outra")).toHaveLength(1);
    await expect.poll(() => filterOf(`${origin}/outra`, "html")).toContain("invert");
    // Outro domínio nasce em Lightning.
    const other = `${origin.replace("127.0.0.1", "localhost")}/v47/tema`;
    await go(window, other);
    await expect(
      window.getByRole("button", { name: "Ligar o tema Dark nesta página" }),
    ).toBeVisible();
    expect(await filterOf(other, "html")).toBe("none");
  } finally {
    await app.close();
  }
  ({ app, window } = await launch(profile));
  try {
    await go(window, page);
    await expect.poll(() => liveViews(app, page)).toHaveLength(1);
    await expect.poll(() => filterOf(page, "html")).toContain("invert");
    // Clique volta ao Lightning sem recarregar.
    await window.getByRole("button", { name: /voltar ao Lightning/i }).click();
    await expect.poll(() => filterOf(page, "html")).toBe("none");
  } finally {
    await app.close();
  }
});

test("4.7: ColorTools (conta-gotas, analisador, gradiente, histórico)", async () => {
  const profile = tempProfile();
  let { app, window } = await launch(profile);
  const page = `${origin}/v47/cores`;
  try {
    await go(window, page);
    await expect.poll(() => liveViews(app, "/v47/cores")).toHaveLength(1);
    await expect.poll(() => inTab(app, page, "document.readyState")).toBe("complete");
    await window.getByRole("button", { name: "ColorTools" }).click();
    let layer = await overlayPage(app);
    await layer.getByRole("button", { name: /Pegar cor da página/ }).click();
    // Camada do conta-gotas por cima da guia: clica no bloco azul.
    const picked = await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      const find = () =>
        win.contentView.children.find(
          (child) =>
            "webContents" in child &&
            (child as { webContents: Electron.WebContents }).webContents
              .getTitle()
              .startsWith("agzos-pick"),
        ) as { webContents: Electron.WebContents } | undefined;
      for (let i = 0; i < 80; i++) {
        const view = find();
        if (
          view &&
          (await view.webContents
            .executeJavaScript("typeof ready !== 'undefined' && ready")
            .catch(() => false))
        )
          break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const view = find();
      if (!view) return "sem camada";
      view.webContents.sendInputEvent({ type: "mouseMove", x: 120, y: 120 });
      view.webContents.sendInputEvent({
        type: "mouseDown",
        x: 120,
        y: 120,
        button: "left",
        clickCount: 1,
      });
      view.webContents.sendInputEvent({
        type: "mouseUp",
        x: 120,
        y: 120,
        button: "left",
        clickCount: 1,
      });
      return "ok";
    });
    expect(picked).toBe("ok");
    await expect.poll(() => app.evaluate(({ clipboard }) => clipboard.readText())).toBe("#1C7ED6");
    layer = await overlayPage(app);
    await expect(layer.getByRole("complementary", { name: "ColorTools" })).toContainText("#1C7ED6");
    // Analisador: as cores computadas da página.
    await layer.getByRole("tab", { name: "Cores da página" }).click();
    await layer.getByRole("button", { name: "Analisar página" }).click();
    await expect(layer.getByRole("list", { name: "Cores da página" })).toContainText("#1C7ED6");
    await expect(layer.getByRole("list", { name: "Cores da página" })).toContainText("#D10A11");
    // Gradiente: copia o CSS.
    await layer.getByRole("tab", { name: "Gradiente" }).click();
    await layer.getByRole("button", { name: "Copiar CSS" }).click();
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toContain("linear-gradient(");
    // Histórico com a cor pega.
    await layer.getByRole("tab", { name: "Histórico" }).click();
    await expect(layer.getByRole("list", { name: "Histórico de cores" })).toContainText("#1C7ED6");
  } finally {
    await app.close();
  }
  // O histórico fica no perfil.
  ({ app, window } = await launch(profile));
  try {
    await go(window, page);
    await window.getByRole("button", { name: "ColorTools" }).click();
    const layer = await overlayPage(app);
    await layer.getByRole("tab", { name: "Histórico" }).click();
    await expect(layer.getByRole("list", { name: "Histórico de cores" })).toContainText("#1C7ED6");
  } finally {
    await app.close();
  }
});

test("4.7: PDF Tools (ícone PDF na barra, organizar, senha AES-256, exportar, OCR)", async () => {
  const profile = tempProfile();
  const { app, window } = await launch(profile);
  try {
    await go(window, `${origin}/v47/doc.pdf`);
    const button = window.getByRole("button", { name: "Abrir no PDF Tools" });
    await expect(button).toBeVisible({ timeout: 15_000 });
    await button.click();
    await expect(omnibox(window)).toHaveValue("agzos://pdf");
    const head = window.locator(".pdf-head");
    await expect(head).toContainText("doc.pdf", { timeout: 20_000 });
    await expect(head).toContainText("3 páginas");

    // Organizar: apaga a página 2.
    await expect(window.locator(".pdf-thumb")).toHaveCount(3);
    await window.getByRole("button", { name: "Apagar a página" }).nth(1).click();
    await window.getByRole("button", { name: "Aplicar", exact: true }).click();
    await expect(head).toContainText("2 páginas");
    await expect(head).toContainText("não salvo");

    // Formulário AcroForm.
    await window.getByRole("button", { name: /^Formulário/ }).click();
    await window.getByLabel("nome").fill("Rodrigo");
    await window.getByRole("button", { name: "Preencher", exact: true }).click();
    await expect(window.getByText(/Formulário preenchido/).first()).toBeVisible();

    // Senha AES-256.
    await window.getByRole("button", { name: /^Senha/ }).click();
    await window.getByLabel("Senha para abrir").fill("agzos123");
    await window.getByLabel("Repita a senha").fill("agzos123");
    await window.getByRole("button", { name: "Proteger com senha" }).click();
    await expect(head).toContainText("com senha");

    // Exportar (diálogo trocado no teste) e conferir o arquivo.
    const out = path.join(profile, "saida.pdf");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: file,
      })) as typeof dialog.showSaveDialog;
    }, out);
    await window.getByRole("button", { name: "Exportar", exact: true }).click();
    await expect.poll(() => fs.existsSync(out)).toBe(true);
    const { PDFDocument } = await import("@cantoo/pdf-lib");
    const bytes = fs.readFileSync(out);
    expect(bytes.toString("latin1")).toContain("/AESV3");
    await expect(PDFDocument.load(bytes)).rejects.toThrow(/encrypted/i);
    const opened = await PDFDocument.load(bytes, { password: "agzos123" });
    expect(opened.getPageCount()).toBe(2);
    expect(opened.getForm().getTextField("nome").getText()).toBe("Rodrigo");

    // OCR local (português e inglês vêm no app): texto da página 1.
    await window.getByRole("button", { name: /^OCR/ }).click();
    await window.getByLabel("Páginas").fill("1");
    await window.getByRole("button", { name: "Executar OCR" }).click();
    await expect(window.locator(".pdf-text")).toContainText("AGZOS", { timeout: 60_000 });
    await expect(head).toContainText("com senha");
  } finally {
    await app.close();
  }
});

test("4.7: PDF Tools comprime as imagens (antes/depois) no worker", async () => {
  const profile = tempProfile();
  const { app, window } = await launch(profile);
  try {
    // Foto 1600×1200 com ruído (JPEG de qualidade alta), feita pelo nativeImage do Electron.
    const jpeg = Buffer.from(
      await app.evaluate(({ nativeImage }) => {
        const width = 1600;
        const height = 1200;
        const bitmap = Buffer.alloc(width * height * 4);
        let seed = 7;
        for (let i = 0; i < width * height; i++) {
          seed = (seed * 1103515245 + 12345) & 0x7fffffff;
          bitmap[i * 4] = (i % width) % 256;
          bitmap[i * 4 + 1] = (seed >> 8) & 255;
          bitmap[i * 4 + 2] = Math.floor(i / width) % 256;
          bitmap[i * 4 + 3] = 255;
        }
        return [...nativeImage.createFromBitmap(bitmap, { width, height }).toJPEG(95)];
      }),
    );
    const { PDFDocument } = await import("@cantoo/pdf-lib");
    const doc = await PDFDocument.create();
    const image = await doc.embedJpg(jpeg);
    doc.addPage([800, 600]).drawImage(image, { x: 0, y: 0, width: 800, height: 600 });
    const original = Buffer.from(await doc.save());
    v47Files.set("/v47/foto.pdf", original);

    await go(window, `${origin}/v47/foto.pdf`);
    await window.getByRole("button", { name: "Abrir no PDF Tools" }).click({ timeout: 15_000 });
    const head = window.locator(".pdf-head");
    await expect(head).toContainText("foto.pdf", { timeout: 20_000 });
    await window.getByRole("button", { name: /^Comprimir/ }).click();
    await window.getByRole("radio", { name: /Forte/ }).click();
    await window.getByRole("button", { name: "Comprimir", exact: true }).click();
    const result = window.locator(".pdf-result");
    await expect(result).toContainText("Depois", { timeout: 30_000 });
    await expect(result).toContainText("1 de 1 imagens refeitas");
    await expect(head).toContainText("não salvo");
    const out = path.join(profile, "foto-menor.pdf");
    await app.evaluate(({ dialog }, file) => {
      dialog.showSaveDialog = (async () => ({
        canceled: false,
        filePath: file,
      })) as typeof dialog.showSaveDialog;
    }, out);
    await window.getByRole("button", { name: "Exportar", exact: true }).click();
    await expect.poll(() => fs.existsSync(out)).toBe(true);
    const smaller = fs.readFileSync(out);
    expect(smaller.length).toBeLessThan(original.length / 2);
    expect((await PDFDocument.load(smaller)).getPageCount()).toBe(1);
  } finally {
    await app.close();
  }
});

test("4.8 Fase 0: capacidades gravadas, CDP na guia ativa, flags e cookies intactos", async () => {
  const profile = tempProfile();
  const file = path.join(profile, "capabilities.json");
  const env = { AGZOS_CAPABILITY_DELAY_MS: "200", AGZOS_FLAGS: "kiosk=1" };
  let { app, window } = await launch(profile, env);
  try {
    await go(window, `${origin}/a`);
    await expect(tabs(window).first()).toContainText("Página A");
    // Cookie da sessão padrão antes da sonda: ela usa uma partição em memória à parte.
    await inTab(app, `${origin}/a`, `document.cookie = "agzos_fase0=1; max-age=3600"`);

    await expect.poll(() => fs.existsSync(file), { timeout: 30_000 }).toBe(true);
    const caps = JSON.parse(fs.readFileSync(file, "utf8"));
    const versions = await app.evaluate(() => process.versions);
    expect(caps.versions.electron).toBe(versions.electron);
    expect(caps.versions.chrome).toBe(versions.chrome);
    expect(caps.cdp.runtimeEvaluate).toBe(true);
    expect(caps.printToPdf.available).toBe(true);
    expect(typeof caps.printToPdf.taggedPdf).toBe("boolean");
    expect(typeof caps.cdpPrintToPdf.returnAsStream).toBe("boolean");
    expect(caps.capture).toEqual({ measured: false, maxHeight: 0, safeCap: 32767 });
    // A casca lê o mesmo resultado pela ponte.
    const fromBridge = await window.evaluate(() =>
      (
        window as unknown as { agzosDesktop: { runtimeCapabilities(): Promise<{ key: string }> } }
      ).agzosDesktop.runtimeCapabilities(),
    );
    expect(fromBridge.key).toBe(caps.key);

    // Runtime.evaluate no depurador que a guia ativa já tem (identidade de Chrome).
    const evaluated = await app.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === url)!;
      const reply = await contents.debugger.sendCommand("Runtime.evaluate", {
        expression: "document.title",
        returnByValue: true,
      });
      return { attached: contents.debugger.isAttached(), title: reply.result.value };
    }, `${origin}/a`);
    expect(evaluated).toEqual({ attached: true, title: "Página A" });

    const cookies = await app.evaluate(async ({ session }, url) => {
      const own = await session.defaultSession.cookies.get({ url, name: "agzos_fase0" });
      const probe = await session.fromPartition("agzos-capabilities").cookies.get({});
      return { own: own.length, probe: probe.length };
    }, origin);
    expect(cookies).toEqual({ own: 1, probe: 0 });

    type Bridge = {
      agzosDesktop: {
        featureFlags(): Promise<Record<string, boolean>>;
        setFeatureFlag(name: string, value: boolean | null): Promise<Record<string, boolean>>;
      };
    };
    const flags = await window.evaluate(() =>
      (window as unknown as Bridge).agzosDesktop.featureFlags(),
    );
    expect(flags).toMatchObject({
      devtools: true,
      print_shield: true,
      copilot: false,
      kiosk: true,
    });
    const changed = await window.evaluate(() =>
      (window as unknown as Bridge).agzosDesktop.setFeatureFlag("copilot", true),
    );
    expect(changed.copilot).toBe(true);
  } finally {
    await app.close();
  }

  // Reabrir: a escolha do usuário fica e a sonda não mede de novo no mesmo Electron.
  const measuredAt = JSON.parse(fs.readFileSync(file, "utf8")).measuredAt;
  ({ app, window } = await launch(profile, env));
  try {
    const flags = await window.evaluate(() =>
      (
        window as unknown as { agzosDesktop: { featureFlags(): Promise<Record<string, boolean>> } }
      ).agzosDesktop.featureFlags(),
    );
    expect(flags.copilot).toBe(true);
    await window.waitForTimeout(1500);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).measuredAt).toBe(measuredAt);
  } finally {
    await app.close();
  }
});

/** Estado do DevTools encaixado da guia `url`: aberto, bounds da view e o frontend pronto. */
async function devtoolsState(app: ElectronApplication, url: string) {
  return app.evaluate(({ BrowserWindow, webContents }, target) => {
    const page = webContents.getAllWebContents().find((item) => item.getURL() === target);
    const front = page?.devToolsWebContents ?? null;
    let bounds = null;
    for (const window of BrowserWindow.getAllWindows()) {
      for (const child of window.contentView.children) {
        const contents = (child as { webContents?: Electron.WebContents }).webContents;
        if (front && contents === front) bounds = child.getBounds();
      }
    }
    return { front: Boolean(front && !front.isDestroyed()), bounds };
  }, url);
}

/** Roda no frontend do DevTools da guia `url` (módulos ES do próprio DevTools). */
async function inDevtools<T>(app: ElectronApplication, url: string, code: string): Promise<T> {
  return app.evaluate(
    ({ webContents }, [target, source]) =>
      webContents
        .getAllWebContents()
        .find((item) => item.getURL() === target)!
        .devToolsWebContents!.executeJavaScript(source!),
    [url, code] as const,
  ) as Promise<T>;
}

type V48Bridge = {
  agzosDesktop: {
    devtools(
      id: number,
      action: string,
      options?: { side?: string },
    ): Promise<{ ok: boolean; open: boolean; side: string | null; reason?: string }>;
  };
};

test("4.8 Fase 1: F12 encaixa o DevTools, iframes, modo dispositivo, mira, terminal e lado gravado", async () => {
  const profile = tempProfile();
  const page = `${origin}/v48/quadros`;
  let { app, window } = await launch(profile);
  try {
    await go(window, page);
    await expect(tabs(window).first()).toContainText("Quadros");

    // F12 na página: a view do DevTools aparece na área do dock em menos de 300 ms (o
    // conteúdo do frontend termina de carregar depois, dentro dela).
    const elapsed = await app.evaluate(async ({ BrowserWindow, webContents }, target) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === target)!;
      const window = BrowserWindow.getAllWindows()[0]!;
      const before = new Set(window.contentView.children);
      contents.focus();
      const start = Date.now();
      contents.sendInputEvent({ type: "keyDown", keyCode: "F12" });
      contents.sendInputEvent({ type: "keyUp", keyCode: "F12" });
      while (Date.now() - start < 5000) {
        const fresh = window.contentView.children.filter((child) => !before.has(child));
        if (fresh.some((child) => child.getBounds().width > 0)) return Date.now() - start;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      return -1;
    }, page);
    expect(elapsed).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(300);
    const dock = window.locator(".devtools-dock");
    await expect(dock).toHaveAttribute("data-dock", "right");
    // A página encolheu: o dock fica ao lado, sem cobrir a guia.
    await expect
      .poll(async () => (await devtoolsState(app, page)).front, { timeout: 15_000 })
      .toBe(true);
    await expect
      .poll(async () => {
        const state = await devtoolsState(app, page);
        const tabView = (await nativeChildren(app)).find((item) => item.url === page)!;
        return state.bounds!.x - (tabView.bounds.x + tabView.bounds.width);
      })
      .toBeGreaterThanOrEqual(0);
    // Solto por dentro: sem a área vazia que o frontend encaixado reserva para a página.
    await expect
      .poll(() =>
        inDevtools<string>(
          app,
          page,
          `import('./ui/legacy/legacy.js').then((UI) => UI.DockController.DockController.instance().dockSide())`,
        ),
      )
      .toBe("undocked");

    // Os três iframes aparecem como contextos (seletor de contexto do Console).
    await expect
      .poll(
        () =>
          inDevtools<number>(
            app,
            page,
            `import('./core/sdk/sdk.js').then((SDK) => SDK.TargetManager.TargetManager.instance()
              .models(SDK.RuntimeModel.RuntimeModel).flatMap((model) => model.executionContexts())
              .filter((context) => context.isDefault).length).catch(() => 0)`,
          ),
        { timeout: 20_000 },
      )
      .toBeGreaterThanOrEqual(4);

    // Ctrl+Shift+C com o DevTools aberto vai para o seletor dele, não para a mira.
    await keyInTab(app, page, "C", ["control", "shift"]);
    await window.waitForTimeout(600);
    await expect(window.getByText(/Mira ligada/)).toHaveCount(0);
    const mira = await app.evaluate(({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === url)!;
      return contents.executeJavaScriptInIsolatedWorld(4132, [
        { code: "Boolean(window.__agzosInspector)" },
      ]);
    }, page);
    expect(mira).toBe(false);

    // Modo dispositivo e, ao sair, a identidade de Chrome volta (login do Google).
    const tabId = await tabIdOf(window, "Quadros");
    const device = await window.evaluate(
      (id) => (window as unknown as V48Bridge).agzosDesktop.devtools(id, "device"),
      tabId,
    );
    expect(device.ok).toBe(true);
    await expect
      .poll(() => inTab<string>(app, page, "navigator.userAgent"), { timeout: 10_000 })
      .toContain("Mobile");
    // Como no Chrome: o frontend cobre a área da página e a guia fica dentro dele,
    // estreita (tamanho do aparelho) e afastada da borda (barra "Dimensions" em cima).
    await expect
      .poll(
        async () => {
          const front = (await devtoolsState(app, page)).bounds!;
          const tab = (await nativeChildren(app)).find((item) => item.url === page)!.bounds;
          return (
            tab.width > 0 &&
            tab.width < front.width / 2 &&
            tab.x > front.x &&
            tab.y > front.y &&
            tab.x + tab.width <= front.x + front.width
          );
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    await window.evaluate(
      (id) => (window as unknown as V48Bridge).agzosDesktop.devtools(id, "device"),
      tabId,
    );
    await expect
      .poll(
        () =>
          inTab<string>(
            app,
            page,
            "navigator.userAgentData.brands.map((item) => item.brand).join(',')",
          ),
        { timeout: 10_000 },
      )
      .toContain("Google Chrome");
    // Nenhuma janela solta do DevTools (device_mode_emulation_frame) no caminho.
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
    // Fora do modo, o dock volta a ser compacto ao lado da página.
    await expect
      .poll(async () => {
        const front = (await devtoolsState(app, page)).bounds!;
        const tab = (await nativeChildren(app)).find((item) => item.url === page)!.bounds;
        return front.x - (tab.x + tab.width);
      })
      .toBeGreaterThanOrEqual(0);

    // Aba Terminal: o frontend sai da área e o terminal da janela entra no lugar.
    await dock.getByRole("tab", { name: "Terminal" }).click();
    await expect(dock.locator(".terminal-view")).toBeVisible();
    await expect.poll(async () => (await devtoolsState(app, page)).bounds?.width).toBe(0);
    await dock.getByRole("tab", { name: "DevTools" }).click();
    await expect
      .poll(async () => (await devtoolsState(app, page)).bounds?.width ?? 0)
      .toBeGreaterThan(0);

    // Embaixo: grava no workspace.
    await dock.getByRole("button", { name: "Encaixar embaixo" }).click();
    await expect(dock).toHaveAttribute("data-dock", "bottom");
    await expect
      .poll(async () => {
        const below = await devtoolsState(app, page);
        const tabNow = (await nativeChildren(app)).find((item) => item.url === page)!;
        return below.bounds!.y - (tabNow.bounds.y + tabNow.bounds.height);
      })
      .toBeGreaterThanOrEqual(0);

    // F12 fecha; com o DevTools fechado, Ctrl+Shift+C volta a ser a mira.
    await keyInTab(app, page, "F12");
    await expect(dock).toHaveCount(0);
    await expect.poll(async () => (await devtoolsState(app, page)).bounds).toBeNull();
    await keyInTab(app, page, "C", ["control", "shift"]);
    await expect(window.locator(".agzos-notice")).toContainText("Mira ligada");

    // Cartão da mira → "Abrir no DevTools": abre no elemento clicado.
    const target = await inTab<{ x: number; y: number }>(
      app,
      page,
      `(() => { const r = document.getElementById("alvo").getBoundingClientRect(); return { x: Math.round(r.left + 20), y: Math.round(r.top + 20) }; })()`,
    );
    await mouseInTab(app, page, [
      { type: "mouseMove", x: target.x, y: target.y },
      { type: "mouseDown", x: target.x, y: target.y, button: "left", clickCount: 1 },
      { type: "mouseUp", x: target.x, y: target.y, button: "left", clickCount: 1 },
    ]);
    const clicked = await app.evaluate(({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((item) => item.getURL() === url)!;
      return contents.executeJavaScriptInIsolatedWorld(4132, [
        {
          code: `(() => { const b = [...(window.__agzosInspector?.root.querySelectorAll("button") ?? [])].find((item) => item.textContent === "Abrir no DevTools"); b?.click(); return Boolean(b); })()`,
        },
      ]);
    }, page);
    expect(clicked).toBe(true);
    await expect(dock).toHaveAttribute("data-dock", "bottom");
    await expect
      .poll(async () => (await devtoolsState(app, page)).bounds?.height ?? 0)
      .toBeGreaterThan(0);

    // Janela separada: o dock sai e o DevTools do Chromium abre solto.
    const detached = () =>
      app.evaluate(
        ({ webContents }, url) =>
          webContents
            .getAllWebContents()
            .find((item) => item.getURL() === url)!
            .isDevToolsOpened(),
        page,
      );
    await dock.getByRole("button", { name: "Abrir em janela separada" }).click();
    await expect(dock).toHaveCount(0);
    await expect.poll(detached).toBe(true);
    // De volta ao dock (paleta: "DevTools: encaixar embaixo").
    await window.evaluate(
      (id) =>
        (window as unknown as V48Bridge).agzosDesktop.devtools(id, "open", { side: "bottom" }),
      tabId,
    );
    await expect(window.locator(".devtools-dock")).toHaveAttribute("data-dock", "bottom");
    await expect
      .poll(async () => (await devtoolsState(app, page)).bounds?.height ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(0);
    // E solto de novo, para o reinício abaixo conferir o lado gravado.
    await window
      .locator(".devtools-dock")
      .getByRole("button", { name: "Abrir em janela separada" })
      .click();
    await expect.poll(detached).toBe(true);
    await window.evaluate(
      (id) => (window as unknown as V48Bridge).agzosDesktop.devtools(id, "close"),
      tabId,
    );
    await expect.poll(detached).toBe(false);
  } finally {
    await app.close();
  }

  // Reabrir: o lado gravado do workspace (janela separada) volta.
  ({ app, window } = await launch(profile));
  try {
    await expect(tabs(window).first()).toContainText("Quadros");
    await expect.poll(async () => (await liveViews(app, page)).length).toBeGreaterThan(0);
    await keyInTab(app, page, "F12");
    await expect
      .poll(() =>
        app.evaluate(
          ({ webContents }, url) =>
            webContents
              .getAllWebContents()
              .find((item) => item.getURL() === url)!
              .isDevToolsOpened(),
          page,
        ),
      )
      .toBe(true);
    await expect(window.locator(".devtools-dock")).toHaveCount(0);

    // Fechar a guia com o DevTools encaixado: o dock some e o app segue de pé.
    await keyInTab(app, page, "F12");
    await expect.poll(async () => (await liveViews(app, "devtools://")).length).toBe(0);
    const other = `${origin}/a`;
    await window.keyboard.press(`${MOD}+t`);
    await go(window, other);
    await expect(tabs(window).nth(1)).toContainText("Página A");
    const otherId = await tabIdOf(window, "Página A");
    await window.evaluate(
      (id) => (window as unknown as V48Bridge).agzosDesktop.devtools(id, "open", { side: "right" }),
      otherId,
    );
    await expect(window.locator(".devtools-dock")).toHaveAttribute("data-dock", "right");
    await keyInTab(app, other, "W", ["control"]);
    await expect(tabs(window)).toHaveCount(1);
    await expect(window.locator(".devtools-dock")).toHaveCount(0);
    await expect.poll(async () => (await liveViews(app, "devtools://")).length).toBe(0);
  } finally {
    await app.close();
  }

  // Flag desligada: F12 não abre e a casca explica.
  ({ app, window } = await launch(profile, { AGZOS_FLAGS: "devtools=0" }));
  try {
    await expect(tabs(window).first()).toContainText("Quadros");
    await expect.poll(async () => (await liveViews(app, page)).length).toBeGreaterThan(0);
    await keyInTab(app, page, "F12");
    await expect(window.locator(".agzos-notice")).toContainText("DevTools está desligado");
    expect((await devtoolsState(app, page)).front).toBe(false);
  } finally {
    await app.close();
  }
});

test("4.8.3: modo app do PWA abre só a janela do app, com perfil próprio, e sai junto com ela", async () => {
  const profile = tempProfile();
  const id = "0123456789abcdef";
  // Login de quando o app rodava dentro do navegador: vem junto para o perfil do app.
  const before = path.join(profile, "Partitions", `pwa-${id}`);
  fs.mkdirSync(before, { recursive: true });
  fs.writeFileSync(path.join(before, "agzos-teste.txt"), "login");
  const marker = path.join(profile, "agzos-pwa.json");
  fs.writeFileSync(
    marker,
    JSON.stringify({
      schema: 1,
      id,
      name: "Agzos Teste PWA",
      startUrl: `${origin}/pwa/`,
      scope: `${origin}/pwa/`,
      origin,
      version: "teste",
      agzosApp: null,
      userData: profile,
    }),
  );
  const app = await electron.launch({
    args: ["--no-sandbox", root],
    cwd: root,
    env: { ...process.env, AGZOS_USER_DATA: profile, AGZOS_TEST_PWA_HOST: marker },
  });
  const closed = new Promise<void>((resolve) => app.on("close", () => resolve()));
  const window = await app.firstWindow();
  await expect.poll(() => window.url()).toBe(`${origin}/pwa/`);
  await expect(window).toHaveTitle("App PWA");
  const state = await app.evaluate(({ app: electronApp, BrowserWindow, webContents }) => ({
    userData: electronApp.getPath("userData"),
    windows: BrowserWindow.getAllWindows().length,
    shells: webContents
      .getAllWebContents()
      .filter((contents) => /index\.html|overlay\.html/.test(contents.getURL())).length,
  }));
  expect(state).toEqual({ userData: path.join(profile, "PwaApps", id), windows: 1, shells: 0 });
  expect(
    fs.readFileSync(
      path.join(profile, "PwaApps", id, "Partitions", `pwa-${id}`, "agzos-teste.txt"),
      "utf8",
    ),
  ).toBe("login");
  // Fechar a janela encerra o app (o navegador não fica aberto atrás).
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await closed;
});
