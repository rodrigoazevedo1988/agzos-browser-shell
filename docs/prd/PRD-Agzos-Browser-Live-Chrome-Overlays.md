# PRD — Agzos Browser: overlays da casca sem congelar o canvas da guia

**Produto:** Agzos Browser (Electron 44 + WebContentsView)  
**Versão do PRD:** 1.0  
**Data:** 2026-09-30  
**Prioridade:** P0 — paridade visual com Comet/Vivaldi/Opera  
**Versão alvo sugerida:** 1.5.4 (entrada no topo de `changelog.ts`)  
**Audiência:** IA de implementação (Claude Code / VPS) + dev humano

---

## 0. Instrução para a IA implementadora

Você vai eliminar o freeze do `WebContentsView` da guia ativa quando a casca abre um popover/menu/dialog por cima da página.

Regras:

1. Não invente um app novo. Reuse o pipeline já usado pelo cartão de prévia da guia e pelo seletor Ctrl+Tab (camada `WebContentsView` transparente no topo).
2. **Proibido** como solução padrão: `view.setVisible(false)` + `webContents.capturePage()` para menus da toolbar. Isso é a causa raiz do canvas estático e do vídeo pausado visualmente.
3. `capturePage` pode ficar só como fallback de emergência (GPU crash, view já hibernada, captura em andamento que impede overlay). Não é o caminho feliz.
4. Preserve as 10 regras de arquitetura: várias janelas via `ctx`, um listener por `webRequest`, identidade Chrome, permissões, `contextIsolation`, `ELECTRON_FILES`, updater, hibernação, changelog, validação.
5. Não quebre o teclado: `before-input-event`, `suppress_events_until_keydown` e o Ctrl sintético continuam valendo. Overlay no topo **precisa receber clique**; a página por baixo **continua pintando**.
6. Windows, macOS e Linux. Sem “janela principal” global.
7. Commits pequenos. Sem force push.

Antes de codar, inventarie e imprima:

- onde a casca pede “esconder a view da guia” ao abrir popover
- implementação atual do overlay de preview e do Ctrl+Tab
- IPC que liga `capturePage` / `setVisible`
- quais componentes Radix/shadcn usam `Portal` para o body da casca
- se já existe um `OverlayView` / `ChromeOverlay` / `topLayerView` no main

Se um path for diferente do citado aqui, **procure** no repo e use o que já existe.

---

## 1. Problema

Hoje, ao clicar em qualquer um destes controles da chrome (setas na captura 1.5.3):

- menu overflow `…` (Nova guia, Nova janela, Histórico, Downloads, Favoritos, Buscar na página, Zoom, Tema, Configurações, Sair)
- engrenagem de configurações rápidas
- downloads
- (mesmo padrão: favorito, permissões/adblock “N bloqueados”, tema)

o `WebContentsView` da guia **some** e a casca mostra um **bitmap estático** (`capturePage`). Efeito:

- vídeo do YouTube (e qualquer canvas/WebGL/CSS animation) congela
- o áudio às vezes continua, a imagem não
- ao fechar o menu, a view volta e o vídeo “pula” para o frame atual
- Comet / Vivaldi / Opera **não** fazem isso: o menu flutua e a página segue viva

Causa arquitetural conhecida:

> Um `WebContentsView` é desenhado **acima** do HTML da casca. Popover React fica atrás da página. O workaround atual esconde a view e cola um snapshot.

Isso é aceitável para um preview de 200ms. É inaceitável para um menu que o usuário deixa aberto enquanto assiste vídeo.

---

## 2. Objetivo

Abrir qualquer UI da casca **por cima** da guia **sem** pausar o compositor da página.

1. Menu `…`, popovers da toolbar, dialogs curtos e o painel de zoom/tema **não** chamam `capturePage` no caminho feliz.
2. Vídeo, CSS animation, canvas e `requestAnimationFrame` da página **continuam**.
3. O menu recebe mouse e teclado; clique fora fecha o menu e devolve o hit-test à página.
4. Paridade com o overlay já usado no cartão de prévia e no Ctrl+Tab — **um** sistema, não três.
5. Hibernação, PiP, várias janelas e identidade Chrome intactos.

Fora de escopo nesta sprint:

- Widevine / Netflix
- extensões Chrome
- reescrever o menu `…` (IA lateral, cofre)
- trocar shadcn/Radix
- “always-on-top” nativo do SO para o popover

---

## 3. Decisão de arquitetura (obrigatória)

### 3.1 Caminho feliz — overlay view transparente

Manter **duas** superfícies nativas na janela:

| Camada | Quem é | Z |
|---|---|---|
| A | `WebContentsView` da guia ativa (página) | base do content bounds |
| B | `WebContentsView` da casca-overlay (HTML transparente, só o popover) | acima de A, mesmo bounds do content **ou** bounds do popover + margem |

A casca principal (tabs, omnibox, toolbar) continua no `BrowserWindow` / view de chrome. O popover **não** é pintado nessa superfície por baixo da página.

Padrão já validado no produto: preview ao hover e seletor Ctrl+Tab.

Fluxo:

```
casca (preload)  --IPC-->  main(ctx)
  openChromeOverlay({ kind, bounds, htmlOrRoute })
main:
  garante overlayView no ctx daquela janela
  overlayView.setBounds(contentBounds ou popoverBounds)
  overlayView.setVisible(true)
  overlayView.webContents.focus() se o menu precisa de teclado
  NÃO chama capturePage
  NÃO setVisible(false) na view da guia
casca overlay:
  renderiza só o menu (fundo rgba(0,0,0,0))
  click no backdrop transparente → close
  Escape → close
main closeChromeOverlay:
  overlayView.setVisible(false)
  devolve foco à guia (ou à chrome, se o trigger era a toolbar)
```

### 3.2 Alternativa rejeitada como padrão

| Abordagem | Por que não |
|---|---|
| `hide + capturePage` | congela vídeo; custo GPU; race ao redimensionar |
| `BrowserWindow` filho frameless sempre on top | quebra multi-monitor, foco, Wayland, Alt-Tab; duas janelas por menu |
| Descer a view da guia com `setBounds` encolhido só na área do menu | layout da página reflow; YouTube player some; pior que freeze |
| `setIgnoreMouseEvents` na guia + pintar menu na casca de baixo | o menu continua **atrás** da view; invisível |

### 3.3 Fallback

Usar snapshot **somente** se:

- a guia está hibernada (`about:blank` / sem compositor)
- `overlayView` falhou ao criar (log + métrica)
- captura de tela do SO / sharing já segura o compositor de um jeito que o overlay quebra (verificar empiricamente; se não quebrar, não fallback)

---

## 4. Superfícies que entram no mesmo sistema

Tudo que hoje provavelmente esconde a view:

1. Menu overflow `…` (screenshot)
2. Popover de downloads
3. Popover / page de configurações rápidas (engrenagem da toolbar, se for overlay e não rota)
4. Popover “N bloqueados” do adblock
5. Popover de permissão do cadeado / site
6. Menu de zoom se for popover
7. Autocomplete da omnibox se ele desce **sobre** a página
8. Dialog “Atualizado com sucesso” / confetes se cobrem o content
9. Context menu customizado da casca que atravessa o content bounds
10. Find-in-page se for overlay flutuante sobre o content (a barra colada no chrome pode ficar na casca)

Já cobertos e **devem ser unificados**, não duplicados:

- cartão de prévia da guia
- seletor Ctrl+Tab

Não entrar agora:

- página cheia de Configurações / Histórico / Favoritos / Downloads (são guias ou rotas da casca sem view de página por cima)
- menu nativo do SO (Windows titlebar, macOS menu bar)

---

## 5. Comportamento detalhado

### 5.1 Abrir

- Clique no trigger (ou atalho que abre o mesmo menu, ex. se existir).
- Overlay aparece no frame seguinte, sem flash branco e sem frame estático da página.
- Página visível **ao redor e através** da área sem pixel opaco do menu.
- Vídeo em play continua play. Medir com YouTube 1080p + menu aberto 10s: o currentTime avança e o frame muda.

### 5.2 Geometria

- Menu ancorado no botão, igual hoje (direita da toolbar, abaixo da chrome).
- Não pode nascer atrás da titlebar nativa nem fora do work area.
- Resize da janela com menu aberto: recalcula bounds; página não some.
- Guias verticais: âncora muda; overlay acompanha.

### 5.3 Hit-testing

- Clique **dentro** do card do menu: ação do item.
- Clique **fora** do card, na página visível: fecha o menu **e** o clique **não** deve navegar / pausar o vídeo na primeira implementação (comer o click, como a maioria dos browsers). Documentar. Fase 2 pode “click-through fecha e entrega o clique” se Comet fizer isso — verificar na implementação com um teste manual no Comet e anotar o resultado no PR.
- Scroll na página com menu aberto: **página rola** (Comet). Overlay não captura wheel fora do card.
- Menu em si rola se a lista passar da altura máxima.

### 5.4 Foco e teclado

- Abrir o menu: setas sobem/descem itens, Enter dispara, Esc fecha.
- Atalhos globais da página (`Space` pausa YouTube, `F` fullscreen) **não** vazam enquanto o menu tem foco.
- Atalhos da casca que não conflitam (`Ctrl+T`, `Ctrl+W`) continuam no `before-input-event` do `ctx`.
- Ao fechar: foco volta para a guia se o foco estava na página; volta para o botão `…` se o usuário abriu por teclado a partir da chrome.
- Lembrar `suppress_events_until_keydown`: depois de `preventDefault`, mandar o Ctrl sintético se a superfície da overlay “engolir” o keydown. Reuse o helper já existente. **Não invente outro unlock.**
- Overlay escondido (`setVisible(false)`) **não** deve ficar no meio da cadeia de foco (view escondida não recebe tecla — regra já documentada).

### 5.5 Várias janelas

- Overlay é **por `ctx` / janela**. Abrir `…` na janela A não cria overlay na B.
- Mover a guia para outra janela com menu aberto: fecha o overlay da origem.

### 5.6 Hibernação / PiP / áudio

- Abrir menu **não** é motivo para hibernar nem para impedir hibernação.
- PiP nativo do vídeo continua.
- Guia com áudio: menu não muta.

### 5.7 Tema

- Card do menu segue tema claro/escuro atual (já tem toggle no próprio menu).
- Fundo do overlay: totalmente transparente. Sem dim de tela cheia no caminho feliz (o screenshot atual não escurece a página).

### 5.8 Acessibilidade

- Role `menu` / `menuitem` no HTML do overlay.
- `aria-expanded` no botão trigger da casca principal (IPC de estado aberto/fechado).

---

## 6. API interna sugerida (adapte aos nomes reais)

Main (`electron/*.cjs`), sempre com `ctx` via `event.sender`:

```js
// nomes ilustrativos — case iguais aos já usados no preview/Ctrl+Tab
ipcMain.handle('chrome-overlay:open', (event, payload) => { /* ctx = windowFromSender(event) */ })
ipcMain.handle('chrome-overlay:update', (event, payload) => {})
ipcMain.on('chrome-overlay:close', (event) => {})
```

`payload` mínimo:

```ts
type ChromeOverlayOpen = {
  kind: 'app-menu' | 'downloads' | 'ablock' | 'find' | 'omnibox' | 'preview' | 'ctrl-tab' | 'generic'
  anchor: { x: number; y: number; w: number; h: number } // coords da janela
  size?: { w: number; h: number }
}
```

Preload da casca: só esses canais. Sem `nodeIntegration`.

Se o overlay for **a própria casca** com uma rota `/overlay/:kind` num segundo `WebContentsView` apontando para o mesmo origin Vite: ok, desde que o bundle já esteja no `ELECTRON_FILES` / extraResources certos. Não crie um segundo app React.

Preferência: **um** `overlayView` reusado por janela (criar na primeira abertura, hide depois). Não alocar/destruir a cada clique do `…`.

---

## 7. Casos de borda

| Caso | Esperado |
|---|---|
| YouTube play + menu 30s | frames andam, áudio contínuo |
| YouTube Shorts / Reels / Twitch | idem |
| Canvas WebGL (jogo no browser) | não congela |
| Página em fullscreen HTML5 | menu da chrome normalmente nem aparece; se aparecer, overlay no bounds restante |
| Zoom da página 80% (como no print) | overlay em DIP da janela, não em CSS da página |
| Zoom da chrome / display scale 150% Win | âncora alinhada ao botão |
| Hibernar a guia com menu aberto | fecha overlay, depois hiberna |
| Crash da GPU / view destroyed | fallback snapshot **ou** fecha overlay; sem throw no main |
| Duas overlays ao mesmo tempo (preview + menu) | uma só. Menu ganha. Fecha preview |
| Ctrl+Tab com menu aberto | fecha menu, abre seletor (mesmo overlayView, outro kind) |
| Context menu da **página** (Chromium nativo) | não passa por este PRD; continua nativo |
| Drag da janela com menu aberto | menu acompanha / fecha — escolha uma e teste; preferir fechar |
| Linux Wayland | overlayView filho da mesma BrowserWindow; sem janela popup extra |
| macOS ⌘H com menu aberto | app esconde; ao voltar overlay fechado |
| Windows Ctrl key-repeat | não deve spammar open/close do menu |

---

## 8. Critérios de aceite

1. YouTube em play, clicar `…`, `downloads` e `engrenagem`: a imagem do player **não** vira frame estático. Um reviewer humano confirma em 10 segundos de relógio.
2. Nenhum `capturePage` no stack trace / log no caminho feliz desses três triggers (flag de debug `AGZOS_DEBUG_OVERLAY=1` imprime qual strategy foi usada: `live-overlay` vs `snapshot-fallback`).
3. Clique fora fecha o menu.
4. Itens do menu `…` disparam os **mesmos** `commands.ts` de hoje (`NEW_TAB`, `NEW_WINDOW`, `NEW_INCOGNITO`, `HISTORY`, `DOWNLOADS`, `BOOKMARKS`, `FIND_IN_PAGE`, zoom ±, theme toggle, settings, quit).
5. Atalhos listados no menu continuam funcionando com menu fechado.
6. Multi-janela: menu só na janela clicado.
7. Não regressão: preview da guia, Ctrl+Tab, hibernação, PiP, updater, login Google.
8. Lint + typecheck + unit + e2e web + e2e Electron (`xvfb-run` no Linux) verdes.
9. Changelog 1.5.4 (ou a versão que vocês bumparem): “Menus da toolbar não congelam mais o vídeo da página.”

---

## 9. Testes

### 9.1 Unit

- reducer / store: `chromeOverlay.open` / `.close` não mexe em `tabs[].url` nem dispara hibernate.
- só um overlay `kind` ativo por `ctx`.

### 9.2 e2e Electron (polling, sem `sleep` fixo)

```
1. abrir janela, navegar para fixture local com <video autoplay loop> (não depender de YouTube na CI)
2. ler currentTime T0 via executeJavaScript na guia
3. disparar comando OPEN_APP_MENU
4. esperar menu visível (seletor no overlay)
5. esperar até currentTime >= T0 + 0.8s (poll 50ms, timeout 3s)
6. assert strategy !== snapshot (via IPC de debug ou data-attr)
7. clicar fora / Escape
8. menu some, currentTime segue aumentando
```

Segundo teste: dois `BrowserWindow`, menu só no `sender`.

Terceiro: abrir menu e `Ctrl+T` — nova guia, menu fecha.

Não use eventos sintéticos do Playwright como prova única de atalho físico; para o vídeo, `executeJavaScript` no `webContents` da guia basta.

### 9.3 Manual (obrigatório antes do publish)

- YouTube watch + Shorts, Windows e Linux.
- Comparar lado a lado com Comet: página viva, menu opaco, sem dim.
- Twitch ou qualquer HLS.
- `chrome://gpu` por curiosidade se o overlay criar uma compositor tile extra (não bloquear o ship).

---

## 10. Hipótese da causa raiz (para o PR)

**Hipótese:** no open dos popovers da toolbar, o main faz `tabView.setVisible(false)` (ou `setBounds` zero) + `capturePage()` e a casca pinta o PNG no lugar do content. O compositor da guia para de apresentar frames.

**Como provar:** logar `setVisible`, `capturePage` e `overlay.setVisible` com timestamp no open/close do menu `…`. Reproduzir no YouTube: `performance.now()` vs `video.currentTime` no `webContents` da guia — `currentTime` sobe, mas o usuário vê frame único se a view estiver invisível.

**Correção:** não esconder a guia; pintar o menu numa `WebContentsView` transparente no z-index acima, reusando o helper de preview/Ctrl+Tab.

**Teste anti-regressão:** e2e da seção 9.2 + o log `strategy=live-overlay`.

---

## 11. Riscos

| Risco | Mitigação |
|---|---|
| Dois `WebContentsView` transparentes = input vai para o errado | overlay só `visible` quando há UI; `setIgnoreMouseEvents(true)` quando hidden |
| Overlay captura 100% do content e a página não rola | backdrop com `pointer-events: none` exceto o card; wheel fora do card não é `preventDefault` |
| Foco preso no overlay hidden | `setVisible(false)` + `tabView.webContents.focus()` no close |
| Duplicar o React tree no overlay | mesma origem, rota leve; ou serializar o menu já aberto via props/IPC |
| `ELECTRON_FILES` esquece o html do overlay | se for arquivo novo no main, incluir no `build-all.sh` |
| macOS: menu bar Editar some o foco | não criar janela separada |

---

## 12. Prompt autocontido para o Claude Code

```
Implemente o PRD docs/prd/PRD-Agzos-Browser-Live-Chrome-Overlays.md.

Objetivo: menus da toolbar (overflow …, downloads, engrenagem, adblock)
não podem mais esconder o WebContentsView da guia nem usar capturePage
no caminho feliz. A página (vídeo incluso) continua pintando. O menu
vive numa WebContentsView transparente no topo, no mesmo padrão do
preview de guia e do Ctrl+Tab.

Passos:
1. Ache no repo onde open de popover chama capturePage / setVisible(false)
   na view da guia. Liste os call sites.
2. Ache o helper do overlay de preview / Ctrl+Tab. Extraia um
   chromeOverlay por ctx (uma view reusada por janela).
3. Roteie app-menu + downloads + settings-popover + adblock-popover
   para esse overlay.
4. Hit-test: card recebe clique; fora fecha; wheel fora do card vai
   para a página se possível.
5. Foco/teclado: reuse before-input-event + Ctrl sintético já existente.
   Overlay hidden não fica no foco.
6. Flag AGZOS_DEBUG_OVERLAY=1 loga strategy=live-overlay|snapshot-fallback.
7. e2e Electron com <video autoplay loop> local: currentTime avança
   com o menu aberto. Sem sleep fixo.
8. changelog.ts no topo. Sem force push. Windows/macOS/Linux.

Não viole: multi-janela via ctx, um webRequest listener, UA/Client Hints,
contextIsolation, ELECTRON_FILES, regras de hibernação.
```

---

## 13. Entregáveis

- Código no repo (main + casca + testes).
- Este PRD versionado em `docs/prd/PRD-Agzos-Browser-Live-Chrome-Overlays.md`.
- Linha no changelog.

---

## 14. Implementação (1.5.4)

### 14.1 Inventário (antes)

- **Quem escondia a guia:** `src/features/browser/chrome.tsx`. Com `panel !== null`, o
  efeito do `overlay` chamava `desktop.snapshotTab()` (`tab:snapshot` → `capturePage` em
  `electron/main.cjs`) e depois `setPanelOpen(true)` (`chrome:panel` → `ctx.panelOpen` →
  `applyLayout` dava bounds 0 à guia ativa). A casca pintava a foto (`.view-snapshot`).
- **Outros `capturePage`:** miniaturas do Ctrl+Tab (`captureThumbnail`) e foto da prévia
  (`showPreview`). Não escondem a guia, então ficaram como estavam.
- **Camadas existentes:** `previewLayer` (hover-card.cjs) e `switcherLayer`
  (switcher-layer.cjs), cada uma com um `WebContentsView` transparente por janela,
  criado à mão.
- **Portal:** os painéis da toolbar não usam Portal do Radix. São `<aside>`/`<div>`
  posicionados dentro de `.browser-window`.
- **ChromeOverlay:** não existia.

### 14.2 O que mudou

- **`electron/chrome-overlay.cjs`:**
  - `createLayerView`, a fábrica única das camadas: transparente, sandbox, sem navegação e
    sem janelas. Prévia, seletor e painéis usam a mesma.
  - `sanitizeOverlay`, `wheelEvent` e `overlayDebugger` (`AGZOS_DEBUG_OVERLAY=1`).
- **`main.cjs`, `panelLayer(ctx)`:**
  - uma camada por janela, criada na primeira abertura e reusada depois;
  - carrega `dist/overlay.html`, com o mesmo bundle e os mesmos componentes React;
  - usa o preload mínimo `overlay-preload.cjs`.
- **IPC:**
  - da casca: `overlay:open` (abre, troca ou atualiza), `overlay:close` e `overlay:reply`;
  - da camada: `overlay:ready`, `overlay:call`, `overlay:dismiss` e `overlay:wheel`.
  - O `ctx` vem do `event.sender`: da casca por `contexts`, da camada por `overlayOfEvent`.
- **Casca:**
  - `chrome.tsx` monta um `PanelSpec` (`overlay/panels.tsx`) em vez do JSX do painel;
  - `useLiveOverlay` manda os dados para a camada, e as funções viram nomes (`overlay/bridge.ts`);
  - na camada, cada nome chama a casca de volta (`agzos:overlay-call` → `overlay:reply`), então
    os itens do menu disparam os mesmos comandos de `commands.ts`.
- **Painéis na camada:**
  - menu ⋯, downloads, proteção (adblock), informações do site, favorito (estrela) e cofre;
  - a omnibox, o aviso de novidades e o seletor sem camada continuam no caminho da foto.
- **Plano B:** se `dist/overlay.html` não existir (ex.: `desktop:dev`) ou a camada não
  carregar em 10 s, a casca desenha o painel e usa a foto, como antes. Isso é logado como
  `strategy=snapshot-fallback`.

### 14.3 Decisões de comportamento

| Caso | Decisão |
|---|---|
| Clique fora do cartão | Como no Comet (conferido pelo dono do produto): fecha **e o clique vale** para o que está embaixo. A camada manda o ponto; o main repassa `mouseMove`/`mouseDown`/`mouseUp` (`sendInputEvent`) para a página, em coordenadas dela, ou para a casca (guias, omnibox, botões), e dá o foco ao alvo. Clicar no botão do próprio painel (⋯, downloads, estrela…) só fecha: a casca não reabre com o clique repassado (vale uma vez, decidido de forma síncrona por `panelRef`, porque o aviso e o clique chegam em qualquer ordem). |
| Rolagem fora do cartão | A página rola: `sendInputEvent` `mouseWheel` na guia ativa, com as coordenadas convertidas da janela para a página. |
| Esc | Fecha, pela camada ou pelo próprio componente. |
| Atalho do app com o foco no painel (Ctrl+T, Ctrl+Tab, Ctrl+J…) | O painel fecha e o atalho segue pelo `forwardAppShortcut`, o mesmo caminho da página, com o Ctrl sintético. |
| Foco ao fechar | Volta para o webContents que tinha o foco ao abrir (a casca, que recebeu o clique). A camada escondida sai do foco (`setVisible(false)`). |
| Arrastar a janela | Fecha, mas só se a posição mudou de fato. O WM manda `move` solto ao mostrar a janela. |
| Minimizar ou esconder (⌘H) | Fecha. Ao voltar, o painel está fechado. |
| Perder o foco (blur) | **Não** fecha. Sob xvfb e alguns WMs chega um `blur` solto logo depois de a janela aparecer, e o painel recém-aberto sumia. |
| Fullscreen HTML5 da página | Fecha. |
| Mover a guia para outra janela | Fecha o painel da janela de origem. |
| Prévia e painel juntos | O painel ganha: esconde a prévia, e a prévia não abre com o painel aberto. |
| Guia nova aberta com o painel aberto | A camada volta ao topo (`raisePanelLayer`). |
| Argumento não clonável (`onClick={onClose}` passa o evento) | Vira `undefined` antes do IPC. Sem isso a chamada inteira falhava. |
| Copiar senha no cofre | É escrito na área de transferência pela própria camada, que tem o foco. |

### 14.4 Testes

- **Unit** (`overlay/overlay.test.ts`): separar e reidratar props, argumentos não
  clonáveis, validação do pedido (só os tipos conhecidos), rolagem para a página e
  contagem do debug.
- **e2e Electron:**
  - `1.5.4: menus da toolbar…`:
    - fixture `/video-vivo` com `<video autoplay loop>` e `requestAnimationFrame`;
    - com o menu aberto, `currentTime` avança pelo menos 0,8 s e a página pinta quadros novos;
    - a guia mantém os bounds, a camada fica no topo, `live-overlay=1` e `snapshot-fallback=0`;
    - a rolagem rola a página, Esc fecha e o foco sai da camada;
    - clique fora: num botão da página fecha a proteção e o botão recebe o clique (com o foco);
      no ⋯ com a proteção aberta, abre o menu direto; no ⋯ com o menu aberto, só fecha;
      numa guia, fecha o menu e troca de guia;
    - Ctrl+T abre a guia e fecha o menu;
    - o item "Nova guia anônima" dispara o comando.
  - `1.5.4: várias janelas…`: o painel abre só na janela clicada, com uma camada por janela.
  - O antigo "painel mostra a foto" virou "sugestões da omnibox mostram a foto", que ainda
    usa esse caminho.
  - Os testes que mexiam nos painéis procuram agora na camada (`overlayPage`).
- **Manual antes do publish:**
  - YouTube e Shorts no Windows e no Linux, com o menu aberto por 10 s;
  - comparar com o Comet (clique fora entregue ou comido);
  - macOS: ⌘C/⌘V no editor de favorito aberto na camada.

