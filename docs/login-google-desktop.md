# Login do Google no app desktop

Desde a v1.3.3 o login em contas Google funciona dentro das guias do Agzos Browser
(Electron). Antes, o `accounts.google.com` redirecionava para `/v3/signin/rejected`
com a mensagem "Não foi possível fazer o login. Esse navegador ou app pode não ser
seguro".

Tudo fica em `electron/main.cjs`. Nada disso existe na versão web.

## Por que o Google recusava

O Google bloqueia navegadores embutidos (Electron, CEF, webviews) com um script de
detecção que roda na página de login. Comparando o Electron 44 com um Chromium
comum na mesma máquina e com a mesma conta, só o Electron era recusado. As
diferenças que importavam:

| Sinal                     | Electron     | Chrome/Chromium                |
| ------------------------- | ------------ | ------------------------------ |
| `window.chrome`           | objeto vazio | tem `app`, `csi` e `loadTimes` |
| `Notification.permission` | `"granted"`  | `"default"`                    |

User-agent e Client Hints sozinhos **não** resolvem: com UA de Chrome limpo, e até
com UA de Firefox, o login continuava sendo recusado. O que destravou foi o shim de
`window.chrome` e `Notification.permission`.

## Como funciona

Em `app.on("web-contents-created")`, toda webContents (guias, aba anônima, popups de
OAuth e a própria interface) passa por `applyChromeIdentity()`, que conecta o
debugger (CDP) e envia dois comandos **antes da primeira navegação**:

0. **`Page.enable`**. Sem o domínio `Page` habilitado, o Chromium aplica os scripts de
   `addScriptToEvaluateOnNewDocument` **só ao primeiro documento** da guia. Da 1.3.3 à
   1.3.6 isso fazia o login funcionar apenas quando o Google era a primeira página da
   guia (ou num popup); entrando pelo "Fazer login" do google.com, na mesma guia,
   `window.chrome.app` chegava vazio e o Google recusava. O teste e2e "identidade de
   Chrome vale em toda carga da guia" cobre recarga, mesma origem e outra origem.
1. **`Page.addScriptToEvaluateOnNewDocument` com `chromePageShim()`**: roda no mundo
   principal de cada documento, antes dos scripts da página. Preenche
   `window.chrome.app/csi/loadTimes` e faz `Notification.permission` responder
   `"default"`. As funções criadas respondem `[native code]` no `toString()`.
2. **`Emulation.setUserAgentOverride`**: UA reduzido de Chrome
   (`Chrome/<major>.0.0.0`) e `navigator.userAgentData` com as marcas do Google
   Chrome, incluindo `getHighEntropyValues`.

Nas sessions (`app.on("session-created")`, o que inclui a partição em memória
`agzos-anonima`):

- `session.setUserAgent` e `app.userAgentFallback` com o mesmo UA;
- `onBeforeSendHeaders` adiciona `Sec-CH-UA`, `-Mobile` e `-Platform` em toda
  requisição HTTPS (o Electron não envia nenhum), e os de alta entropia
  (`-Full-Version-List`, `-Arch`, `-Platform-Version`…) quando a origem pede via
  `Accept-CH`, como o próprio Chrome faz;
- as marcas usam o mesmo GREASE do Chromium (`chromeBrands()`), então header e
  JavaScript batem entre si e com o Chrome real da mesma versão.

Tudo é derivado de `process.versions.chrome`: ao atualizar o Electron, a identidade
acompanha sozinha.

### Popups de "Fazer login com Google" em outros sites

`wirePopups()` segue a regra do Chrome: `window.open` com features (largura/altura)
chega com `disposition === "new-window"` e abre como janela popup de verdade, com a
mesma session e `window.opener`, que é o que o OAuth usa para devolver o resultado. Os
demais `window.open` viram guia nova.

### Fallback se o Google voltar a recusar

Se uma guia cair em `accounts.google.com/.../signin/rejected`, o main oculta a view
nativa (`rejectedLoginViews`) e envia `login-rejected` ao chrome, que mostra a tela
"O Google recusou o login nesta guia" com:

- **Entrar pelo navegador do sistema**: abre o `continue` original (não a página de
  erro) via `shell:openExternal`, que só aceita `http(s)`;
- **Voltar**.

## Cuidados ao mexer

- **Não aguarde (`await`) os `sendCommand`** numa webContents que ainda não navegou:
  eles só respondem depois da primeira navegação, e o `await` trava a abertura da
  guia. Enviados sem aguardar, já valem para essa navegação.
- **Não registre outro `onBeforeSendHeaders`/`onHeadersReceived`** nas sessions: o
  Electron aceita um listener por evento e o novo substitui o dos Client Hints.
- **Não troque o shim por `executeJavaScript` no `dom-ready`**: roda tarde demais (a
  detecção do Google já executou) e fica visível para a página.
- Mantenha `contextIsolation`, `sandbox` e o preload fora das guias; globals
  injetados pelo preload também são sinal de app embutido.

## Como testar

Com xvfb no servidor (sem conta real, usando um e-mail inexistente):

1. Abra `https://accounts.google.com/signin` numa `BrowserWindow` com a identidade
   aplicada, digite o e-mail e clique em Avançar.
2. **Aprovado**: fica em `/v3/signin/identifier` com "Não foi possível encontrar essa
   conta" (o fluxo passou da detecção).
   **Reprovado**: vai para `/v3/signin/rejected`.
3. Repita com a partição `agzos-anonima`.

Checagens rápidas no console de uma guia:

```js
navigator.userAgent; // sem "Electron" nem "AgzosBrowser"
navigator.userAgentData.brands; // Chromium, Google Chrome e a marca GREASE
Object.keys(window.chrome); // ["app", "csi", "loadTimes"]
Notification.permission; // "default"
```

Depois, com uma conta real no app instalado: login em aba normal e anônima, e
"Fazer login com Google" em um site de terceiros (popup).

## Build e publicação

`scripts/build-all.sh` gera os pacotes Windows, Linux e macOS (arm64/x64) da versão
definida em `VERSION`, atualiza o `package.json` e publica com
`scripts/release-browser.sh` em `https://agzosagency.com.br/browser/`, que mantém só
as duas versões mais recentes.

## Nada de preload nem scripts extras nas páginas de login

Desde a 1.3.7 o Agzos não registra preload nas páginas das guias. Os scriptlets do
adblock entram pelo mesmo canal do shim (CDP), só nos sites com regras, e nunca em URLs
de login (`isAuthUrl`: `accounts.*`, `login.*`, `auth.*`, `sso.*`, caminhos `/login`,
`/signin`, `/oauth`, `/authorize`, `/saml`… e provedores como Google, Apple, Microsoft,
Okta, Auth0, gov.br). Nessas páginas também não roda a leitura do DOM do CSS de ocultação.

## Adblock (desde a 1.3.5)

O antifraude do login usa a telemetria do próprio Google (`play.google.com/log`,
`google.com/gen_204`), que o EasyPrivacy bloqueia. Com ela bloqueada o Google recusa
o login como "navegador não seguro". Por isso `electron/adblock.cjs` nunca filtra
páginas de login nem requisições para serviços de conta (`isAuthFlow`, lista
`AUTH_HOSTS`). Ao adicionar listas ou regras, confira que esse desvio continua valendo
(teste em `src/features/browser/main-process.test.ts`).

## Permissões por site (desde a 1.6)

`electron/permissions.cjs` salva as decisões de câmera, microfone, notificações etc. O
_check_ de permissão (`setPermissionCheckHandler`) continua respondendo "permitido" para
tudo que o usuário **não** bloqueou, como o Electron fazia antes. Assim o
`Notification.permission` das páginas de login segue nascendo `"granted"` e o shim o
mostra como `"default"`. Só um bloqueio explícito responde `denied` (igual ao Chrome com o
site bloqueado). Não troque isso por "negar o que não foi decidido": o Google passaria a ver
`"denied"` e o fingerprint mudaria. O e2e "permissão lembrada vale depois de reiniciar"
confere o `"default"` antes de qualquer decisão.
