# Agzos Browser — Changelog e backlog

> Atualizado em 2026-10-08, na versão publicada **4.7.2** (`ff2db01`).
>
> As notas de cada release que o app mostra ("Atualizado com sucesso") e que vão para o
> `latest.json` saem só de `src/features/browser/changelog.ts`. Este arquivo é o resumo
> técnico para quem desenvolve: o que existe por versão, com o PRD e os módulos de cada
> entrega, e o que ainda está pendente. Ao publicar, atualize os dois.

## Sumário

- [Visão geral do que existe hoje](#visão-geral-do-que-existe-hoje)
- [Histórico por versão](#histórico-por-versão)
- [Backlog: oportunidades e melhorias pendentes](#backlog-oportunidades-e-melhorias-pendentes)
- [Dívidas de processo e de documentação](#dívidas-de-processo-e-de-documentação)

---

## Visão geral do que existe hoje

| Área               | Recursos                                                                                                                                                  | Onde está                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Navegação          | Guias horizontais/verticais, anônimas, fixar, duplicar, reabrir fechadas, arrastar, Ctrl+Tab por uso, prévia com RAM/CPU, buscar na página, zoom por site | `src/features/browser/`, `store/reducer.ts`, `commands.ts`                                |
| Janelas e sessão   | Várias janelas, mover guia entre janelas, restauração após crash, hibernação de guias                                                                     | `electron/windows.cjs`, `electron/hibernate.cjs`                                          |
| Biblioteca         | Histórico (Ctrl+H), favoritos com pastas e barra, importar/exportar HTML Netscape, omnibox com sugestões                                                  | `src/features/history/`, `src/features/bookmarks/`                                        |
| Privacidade        | Adblock real (Ghostery), permissões por site persistidas, telas de erro (rede, DNS, certificado, travamento)                                              | `electron/adblock.cjs`, `electron/permissions.cjs`                                        |
| Organização        | Workspaces, grupos de guias, tela dividida (2 guias), paleta de comandos (Ctrl+K), Session Tabs com cookies isolados                                      | `store/`, `electron/session-tabs.cjs`                                                     |
| Barra lateral      | 20+ apps web em painéis (WhatsApp, Discord, Claude…), zoom e largura por painel, botão "Mais", barra redimensionável                                      | `sidepanel:*`, `electron/panel-session.cjs`                                               |
| Desempenho         | GX Control (limitadores de RAM, CPU e rede), Hot Tabs Killer, teste de velocidade, aceleração de GPU com fallback                                         | `electron/gx-control.cjs`, `electron/gpu-flags.cjs`                                       |
| Senhas             | Agzos Key: pareamento, cofre E2E, captura e autofill, TOTP, categorias, PBKDF2/Argon2id                                                                   | `electron/agzos-key.cjs`, `src/features/key/`                                             |
| IA                 | Agzos AI com Groq (chave cifrada no main), conversas, projetos, artifacts, markdown, contexto da aba opcional                                             | `electron/ai.cjs`, `electron/ai-library.cjs`, `src/features/ai/`                          |
| Terminal           | PTY real (bottom/direita/flutuante), temas, SSH, aliases, lançador de CLIs de IA, modo voz (Whisper), modo agente em nós                                  | `electron/terminal*.cjs`, `electron/cli-install.cjs`, `src/features/terminal/`            |
| Ferramentas de dev | Painel de portas + túnel Cloudflare, API Scratchpad, mira de elemento, captura de tela, ColorTools                                                        | `electron/ports*.cjs`, `tunnel.cjs`, `scratchpad.cjs`, `inspector.cjs`, `color-tools.cjs` |
| Leitura e conteúdo | Modo leitura, notas por página, tema Dark por site, visualizador de arquivos e imagens, PDF Tools completo                                                | `electron/reader.cjs`, `page-theme.cjs`, `files.cjs`, `src/features/pdf/`                 |
| Ecossistema        | Extensões MV2/MV3 (pasta ou Chrome Web Store), PWAs instaláveis, Widevine + VMP (castLabs ECS)                                                            | `electron/extensions.cjs`, `crx.cjs`, `pwa.cjs`                                           |
| Downloads          | Gerenciador completo (`agzos://downloads`), regras por tipo/site/nome, etiquetas, exportar JSON/CSV                                                       | `electron/download-rules.cjs`, `src/features/downloads/`                                  |
| Personalização     | Tema escuro/claro, cor de acento, papel de parede, vidro, sons opcionais, gestos de mouse e trackpad, atalhos de recursos configuráveis                   | `src/features/settings/`, `src/features/gestures/`, `src/features/sounds/`                |
| Distribuição       | Instaladores Windows/macOS/Linux, auto-update por `latest.json`, notas geradas do changelog, limpeza de artefatos de build                                | `scripts/build-all.sh`, `scripts/release-browser.sh`, `electron/updater.cjs`              |

---

## Histórico por versão

Datas conforme `changelog.ts`. PRDs em `docs/prd/`.

### 4.8.x — Base do v4.8, DevTools encaixado e PWA como app no Mac

**4.8.4** (2026-10-09)

- Instalador do Windows (`scripts/windows-installer.nsi`, NSIS gerado no Linux pelo `build-all.sh`, em paralelo com Linux e Mac): por usuário em `%LOCALAPPDATA%\Programs\Agzos Browser`, sem administrador; atalhos na Área de trabalho e no menu Iniciar; entrada em "Programas e Recursos" (HKCU). Nunca toca no perfil (`%APPDATA%`) nem em cópias portáteis; o desinstalador também mantém o perfil.
- O OTA continua pelo ZIP. O app instalado acerta `DisplayVersion` e o AppUserModelID dos atalhos ao abrir (`electron/win-install.cjs`).
- Mac assinado com o certificado autoassinado "Rodrigo Dev Local" (SHA-1 fixado) pelo `scripts/sign-mac.sh` (rcodesign, runtime endurecido, `scripts/entitlements.mac.plist`), conferido por `scripts/verify-mac-signature.sh`; a release falha se sair ad-hoc. O updater do Mac exige o mesmo certificado no `.app` novo (`verifyMacBundle`). Clones de PWA assinados com ele quando está nas Chaves (`hasSigningIdentity`). Ver `BUILD.md` e `SECURITY.md`.

**4.8.3** (2026-10-09) — `docs/pwa-macos.md`

- PWA no macOS vira app próprio: o `.app` em `~/Applications/Agzos Apps` é um clone APFS do `Agzos Browser.app` (`cp -c`) com `CFBundleIdentifier` `br.agzos.browser.pwa.<id>`, nome e ícone do PWA e assinatura ad-hoc local. Dock, ⌘Tab e Mission Control mostram o app separado; ele sobrevive ao ⌘Q do navegador.
- Modo app no main (`pwaHost`, `electron/pwa-mac.cjs`): marcador `Contents/Resources/agzos-pwa.json`, perfil `<userData>/PwaApps/<id>` (lock e banco próprios), só a janela do app, sai quando ela fecha. A partição `pwa-<id>` antiga é copiada uma vez. Links fora do escopo vão ao navegador por `--agzos-open=<url>`.
- Apps antigos (lançador em script) e clones de outra versão são remontados ao abrir o navegador (`refreshMacPwaApps`). Flag `pwa_mac_apps` (ligada); Windows e Linux sem mudança.

**4.8.2** (2026-10-08)

- DevTools compacto (frontend `undocked`, sem área vazia) e modo dispositivo como no Chrome (`setInspectedPageBounds` + `setSidebarSize`).

**4.8.1** (2026-10-08) — Fase 1 do PRD v4.8

- DevTools do Chromium encaixado por guia (`electron/devtools-dock.cjs`), integrado à mira, ao menu Inspecionar e ao terminal.

**4.8.0** (2026-10-08) — Fase 0 do PRD v4.8

- Capacidades medidas do runtime (`electron/capabilities.cjs`) e flags por bloco (`electron/feature-flags.cjs`).

### 4.7.x — Downloads, tema por site, ColorTools e PDF Tools

**4.7.2** (2026-10-04)

- Corrigido: sair da tela cheia para o PiP no Mac deixava o layout preso em tela cheia.
- Corrigido: atalho de PWA no Mac abria a janela atrás do navegador; agora ativa o app e traz a janela à frente.

**4.7.1** (2026-10-04)

- PiP rastreado por eventos da página (`pipContents`, `agzos:pip`), sem `executeJavaScript` por frame — fim do congelamento da janela. Guia em PiP não hiberna.
- `second-instance` registrado no carregamento do módulo (`pendingSecondInstances`): atalho de PWA abre o app, nunca a janela do navegador.
- PWA no macOS sem `LSUIElement` (aparece no Dock).
- Terminal flutuante deixa de ser `alwaysOnTop`.
- Nome canônico dos artefatos passa a `Agzos-Browser-*`.

**4.7.0** (2026-10-04) — PRD `v4.7.0-downloads-tema-cores-pdf.md`

- Gerenciador de downloads (Ctrl+J): filtros, busca, pausar/retomar com Range, etiquetas, mudar destino, exportar JSON/CSV, atalhos de teclado. Migration 5 (`tags`, `etag`, `last_modified`, `url_chain`).
- Pastas e regras de download por tipo, site e nome.
- Tema Dark por site (`insertCSS` + script de leitura no mundo isolado 4134), com proteção de contraste WCAG AA.
- ColorTools: conta-gotas com lupa, analisador de cores da página, gradientes, paletas e histórico.
- PDF Tools (`agzos://pdf`): editar, organizar, juntar, dividir, comprimir, AES-256, formulários, OCR local (pt/en/es), conversões; Word ↔ PDF via LibreOffice.
- PDFs abrem na guia (visualizador do Chromium) com atalho para o PDF Tools.

### 4.6.x — Extensões como no Chrome, leitura na barra

**4.6.2** (2026-10-04)

- Assinatura VMP da castLabs no Windows e no macOS: Netflix, Disney+, Prime Video e Max tocam.

**4.6.1** (2026-10-04) — PRD `v4.6.1-web-store-popup-manifest.md`

- Instalação da Chrome Web Store corrigida: `parseCrx` usa a chave do autor (antes todas as extensões tinham o mesmo id).
- Erros reais de instalação; checagem de atualização só notifica (badge).
- Pop-up de extensão em janela nova por abertura, medida repetidamente enquanto monta.
- Clique segue o manifest (popup, side panel, opções, background). Manifest V2 carrega.
- Tooltips da barra feitos pelo app (`electron/tooltip.cjs`).

**4.6.0** (2026-10-04) — PRD `v4.6-extensoes-popup-leitura-barra.md`

- Menu de extensões (quebra-cabeça) em overlay, fixar na barra, acesso por site.
- Modo leitura no ícone de caderno da URL, só quando há artigo (`readerProbeScript`).
- Menu "Ferramentas" na barra lateral; barra lateral redimensionável (`sideBarWidth`).

### 4.5.x — Ferramentas de desenvolvedor, sessões, extensões e leitura

**4.5.1** (2026-10-03)

- Grade de ferramentas no Início/Discador, botões Ferramentas e Extensões, botão de Session Tab.
- Correções: fundo branco de sites no tema escuro, ordem do painel de portas.

**4.5.0** (2026-10-03) — PRD `v4.5-dev-sessoes-extensoes-leitura.md`

- Session Tabs (Ctrl+Alt+N) com partição própria e cor.
- Painel de portas com matar processo e túnel HTTPS via `cloudflared`.
- API Scratchpad, mira de elemento (Ctrl+Shift+C), captura de tela (Ctrl+Shift+S).
- Extensões MV3 (pasta descompactada ou Web Store) e módulo Widevine.
- Modo leitura (Ctrl+Alt+R), notas por página (Ctrl+Shift+M), "Salvar imagem já carregada".
- Tema escuro como padrão; cor de acento padrão #D10A11.

### 4.1.x — Terminal completo, arquivos, agentes e PWAs

**4.1.3** (2026-10-03) — PRD `v4.1.3-pwa-e-agzos-ai-estilo-claude.md`

- Agzos AI no estilo Claude: projetos, conversas em guias, artifacts, personalização.
- Markdown em streaming; prévia isolada de código/HTML/SVG.
- PWA sem exigir service worker; manifesto via CDP `Page.getAppManifest`.

**4.1.2** (2026-10-03)

- Arquivos abertos pelo sistema (duplo clique, "Abrir com", arrastar no ícone) abrem em guia.

**4.1.1** (2026-10-03) — PRD `v4.1.1-arquivos-agentes-pwa.md`

- Instalar sites como app (janela própria, ícone no SO, sessão separada).
- Abrir qualquer arquivo (Ctrl+O) via `agzos-file://`; visualizador de imagens com modo Canvas.
- Terminal: abas renomeáveis, modo ls, snippets, skills de CLIs de IA.
- Modo agente (Ctrl+Shift+G) em canvas de nós.
- Instalador de CLIs de IA na primeira abertura.

**4.1.0** (2026-10-03) — PRD `v4.1-terminal.md`

- Terminal embaixo, à direita ou flutuante, sem perder sessões.
- Temas e aparência do terminal; modo voz (Whisper/Groq); lançador (Ctrl+Shift+K).
- SSH (chaves, gerar ed25519, conexões salvas); aliases multi-shell; atalhos novos.

### 4.0.0 (2026-10-03) — IA, gestos, terminal e GPU

PRD `v4.0-ia-gestos-terminal-gpu.md`

- Agzos AI real com Groq; chave cifrada por `safeStorage`, nunca volta ao renderer.
- Gestos de trackpad, mouse e botão direito, configuráveis.
- Terminal real (node-pty) com abas de sessão.
- Aceleração de GPU forçada com fallback após 3 crashes.

### 3.x — GX Control, Discador e refinos

**3.1.1** (2026-10-02) — PRD `v3.1.1-refinos-paineis-e-sons.md`

- Barra lateral com rolagem fina e botão "Mais"; modal único de novo site.
- Sons opcionais; zoom e largura por painel; sessão do Discord preservada ao sair.

**3.0.0** (2026-10-02) — PRD `v3.0-gx-control-discador.md`

- GX Control (CPU, RAM, rede), Hot Tabs Killer, teste de velocidade, limpar cache.
- Discador com grade de sites; barra lateral com 20 apps.

### 2.x — Workspaces, Agzos Key e overlays

**2.2.8** (2026-10-02) — ícones da barra de endereço fixos à direita; menus de pastas por hover; Agzos Key preenche com foco e web components.
**2.2.7** (2026-10-02) — favoritos abrem em guia nova; Agzos Key sugere ao focar o campo; barra de TOTP; chave na barra de endereço.
**2.2.6** (2026-10-01) — pastas do Agzos Key não aparecem mais como credenciais vazias nem podem ser apagadas; senhas agrupadas por pasta.
**2.2.5** (2026-10-01) — pastas de favoritos de volta ao menu de vidro.
**2.2.4** (2026-10-01) — menu de pastas de favoritos sempre acima da página.
**2.2.3** (2026-10-01) — desbloqueio Argon2id corrigido e em segundo plano; popup do Key acima da página.
**2.2.2** (2026-10-01) — cofre recarregado inteiro; KDF por conta.
**2.2.1** (2026-10-01) — várias contas do Agzos Key no mesmo computador.

**2.2.0** (2026-10-01)

- Captura e autofill de senhas, TOTP no navegador, categorias no cofre.
- Barra de favoritos sempre acima da página.

**2.1.0** (2026-10-01)

- Agzos Key pareado de verdade (E2E). Vidro no modo escuro. Roda de cores para o acento.

**2.0.1** (2026-10-01) — estabilidade visual (transparência, acento, atalhos).

**2.0.0** — PRD `v2.0-workspaces-grupos-split-paineis.md`

- Workspaces, grupos de guias, tela dividida, painéis laterais, paleta de comandos (Ctrl+K).
- Barra de endereço: seleção total no primeiro clique, copiar link.
- Personalização: acento, papel de parede, desfoque.

### 1.x — Fundação, navegador de verdade e overlays

**1.5.5** — clicar fora de um menu fecha e já executa o clique.
**1.5.4** — menus da toolbar em camada transparente (`chrome-overlay.cjs`); a página continua viva. PRD `PRD-Agzos-Browser-Live-Chrome-Overlays.md`.
**1.5.3** — Ctrl+Tab confirma ao soltar sempre; seletor acima da página.
**1.5.2** (2026-10-01) — prévia de guia com RAM/CPU; página de Configurações (Ctrl+,); menu ⋯ enxuto; menu do macOS completo.
**1.5.1** (2026-09-30) — PiP em qualquer vídeo; arrastar guias; aviso de novidades pós-update.
**1.5.0** (2026-09-29) — várias janelas; restauração após crash; telas de erro; hibernação.
**1.4.2** (2026-09-28) — auto-update no Windows; motivo de falha nas Configurações.
**1.4.1** (2026-09-27) — ícone e nome no Windows/Mac; faixa de permissão; atalhos no Windows.
**1.4.0** (2026-09-26) — histórico, favoritos com pastas, omnibox com sugestões, permissões por site, auto-update.

PRDs internos da linha 1.x: `v1.4-fundacao` (store, SQLite, testes, CI), `v1.5-navegador` (adblock, downloads, buscar, zoom, atalhos), `v1.5.1`…`v1.5.3` (correções, login Google, YouTube), `v1.6-biblioteca`, `v1.6.1-marca-e-correcoes`, `v1.7-janelas-e-sessao`, `v1.7.1-novidades-pip-guias`, `v1.7.2-configuracoes-e-previa`. A numeração dos PRDs 1.6/1.7 não bate com a das releases (ver [dívidas](#dívidas-de-processo-e-de-documentação)).

---

## Backlog: oportunidades e melhorias pendentes

Prioridade: **P0** bloqueia uso diário ou segurança; **P1** diferencial visível; **P2** polimento; **P3** depende de backend ou parceria. Origem indica de onde o item saiu.

### Segurança e distribuição

| Pri | Item                                                                                                          | Origem               |
| --- | ------------------------------------------------------------------------------------------------------------- | -------------------- |
| P0  | Assinar o `latest.json` (Ed25519) e validar no `updater.cjs`: hoje quem controla o servidor controla o update | `v1.6-biblioteca` §4 |
| P0  | Assinatura de código no Windows e notarização no macOS (SmartScreen/Gatekeeper)                               | roadmap FND-004      |
| P1  | Update quando o app está em `Arquivos de Programas` (sem escrita): hoje manda baixar pelo site                | `v1.6-biblioteca` §4 |
| P1  | Modo "somente HTTPS" opcional                                                                                 | roadmap NAV-009      |
| P2  | DevTools configurável no build empacotado (Configurações → Avançado)                                          | roadmap DEV-001      |

### Navegação, janelas e sessão

| Pri | Item                                                                       | Origem                     |
| --- | -------------------------------------------------------------------------- | -------------------------- |
| P1  | Arrastar guia para fora da janela cria nova janela                         | `v1.7-janelas-e-sessao` §8 |
| P1  | "Janelas fechadas recentemente"                                            | `v1.7-janelas-e-sessao` §8 |
| P1  | Imprimir / salvar como PDF (`printToPDF`)                                  | roadmap NAV-012            |
| P2  | Janela anônima inteira                                                     | `v1.7-janelas-e-sessao` §8 |
| P2  | Barra de favoritos com botão "»" para o excesso                            | `v1.6-biblioteca` §4       |
| P2  | Restaurar posição de rolagem na sessão                                     | roadmap NAV-010            |
| P2  | Atalhos configuráveis para todos os comandos (hoje só os de recursos, 4.7) | roadmap PWR-006            |

### Organização (workspaces, grupos, split, painéis)

| Pri | Item                                                         | Origem                         |
| --- | ------------------------------------------------------------ | ------------------------------ |
| P1  | Painéis/apps da barra lateral com URL livre                  | `v2.0` e `v3.0` fora de escopo |
| P1  | Contador de notificações no ícone dos apps da barra lateral  | `v2.0` e `v3.0` fora de escopo |
| P2  | Tela dividida com mais de duas guias ou divisão vertical     | `v2.0` fora de escopo          |
| P2  | Arrastar grupo como bloco; mover grupo inteiro entre janelas | `v2.0` fora de escopo          |
| P2  | Pilhas de guias estilo Vivaldi                               | roadmap PWR-002                |
| P3  | Workspaces sincronizados entre janelas                       | `v2.0` fora de escopo          |

### Desempenho (GX Control)

| Pri | Item                                                     | Origem                |
| --- | -------------------------------------------------------- | --------------------- |
| P2  | Hot Tabs Killer listando guias de todas as janelas       | `v3.0` fora de escopo |
| P2  | Limitador de CPU também para a guia à vista e os painéis | `v3.0` fora de escopo |

### Conteúdo, mídia e produtividade

| Pri | Item                                                                              | Origem                        |
| --- | --------------------------------------------------------------------------------- | ----------------------------- |
| P1  | Tradução de página ("Traduzir para português"), via Agzos AI ou API               | roadmap UX-006                |
| P1  | Ações de IA no menu de contexto: resumir seleção, traduzir, explicar              | roadmap PWR-009               |
| P2  | Controle de mídia global (o que toca em qualquer guia, play/pause)                | roadmap MED-002               |
| P2  | Captura da página inteira (`captureBeyondViewport`) e anotação na captura         | roadmap UX-001                |
| P2  | Discador com pastas e sites sugeridos pelo histórico; widgets no Início           | `v3.0` fora de escopo, UX-005 |
| P2  | Acento adaptado ao site (`theme-color`) e tema claro/escuro agendado              | roadmap UX-004                |
| P2  | "Adicionar seleção às notas"                                                      | roadmap UX-003                |
| P2  | Adblock: escolher listas na interface e filtros cosméticos avançados (scriptlets) | `v1.5-navegador` §2           |
| P2  | Agzos Key: importar CSV do Chrome/Bitwarden                                       | roadmap PWR-010               |

### Extensões

| Pri | Item                                                                               | Origem          |
| --- | ---------------------------------------------------------------------------------- | --------------- |
| P2  | Extensões em guias anônimas e Session Tabs (opt-in por extensão, como o Chrome)    | `v4.6.1`        |
| P2  | Matriz de compatibilidade testada (Bitwarden, uBlock Lite, Dark Reader, Grammarly) | roadmap EXT-001 |

### Contas, sync e rede

| Pri | Item                                                                                              | Origem                    |
| --- | ------------------------------------------------------------------------------------------------- | ------------------------- |
| P3  | Conta Agzos (backend próprio)                                                                     | roadmap SYN-001           |
| P3  | Sync E2E de favoritos, histórico, abas, workspaces, configurações e regras de download            | roadmap SYN-002, `v4.7.0` |
| P3  | Nuvem por API (Drive, Dropbox, OneDrive) no PDF Tools; hoje copia para a pasta sincronizada local | `v4.7.0`                  |
| P3  | Proxy por workspace/guia anônima (`session.setProxy`); VPN só como parceria                       | roadmap NET-001           |

### Validação manual pendente

Itens que os PRDs marcaram como "pendente de validação manual" e que o e2e não cobre:

- Windows com Intel UHD 620: decode por hardware e YouTube 1080p fluido (`v4.0`).
- Trackpad do macOS e de notebooks Windows: sentido e limiares dos gestos (`v4.0`).
- PowerShell/ConPTY no Windows e zsh no macOS com o binário empacotado (`v4.0`).
- Terminal flutuante e microfone no Windows e no macOS, com o pedido de permissão do sistema (`v4.1`).
- Aliases no PowerShell/cmd e zsh; detecção de CLIs quando o app abre pelo Dock/Finder com PATH menor (`v4.1`).
- WhatsApp/Telegram no painel com login por QR; Ctrl+Alt+↑/↓ no Windows (`v2.0`).
- Limitadores de RAM, CPU e rede com carga real; teste de velocidade no Windows e no macOS (`v3.0`).

### Fora de escopo por decisão

Não entram no backlog:

- Sniffer de m3u8/HLS para baixar vídeo de terceiros e qualquer forma de contornar DRM (`v4.5`).
- Módulos nativos além do `node-pty` (PDFium, qpdf, mupdf, C++/Rust): usar JS/WASM (`AGENTS.md`, `v4.7.0`).
- `alwaysOnTop` no terminal flutuante (`AGENTS.md`, 4.7.1).

---

## Dívidas de processo e de documentação

| Item                                                                                                                                                                                 | Ação sugerida                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `changelog.ts` tem datas fora de ordem: 2.0.0 está em 2026-10-05 (depois da 4.7.2) e 1.5.3–1.5.5 estão depois da 2.0.x. O `changesBetween` ordena por versão, então o app não quebra | Corrigir as datas no `changelog.ts`; um teste unitário pode exigir datas não decrescentes por versão |
| Os PRDs 1.6 e 1.7 não têm release com esse número (o changelog vai de 1.5.5 para 2.0.0)                                                                                              | Anotar no topo de cada PRD em qual release ele saiu                                                  |
| 4.6.2 e 4.7.1/4.7.2 não têm PRD próprio; as decisões estão só no `AGENTS.md`                                                                                                         | Criar PRDs curtos de correção ou uma seção "correções" no PRD da linha                               |
| `docs/roadmap-opera-vivaldi.md` ainda diz "Nada aqui foi implementado" (base v1.3.3)                                                                                                 | Marcar cada ID como feito/pendente ou apontar para este arquivo                                      |
| Duas fontes de notas (`changelog.ts` para o app, este arquivo para o time)                                                                                                           | Manter este arquivo no checklist de release do `AGENTS.md`                                           |
