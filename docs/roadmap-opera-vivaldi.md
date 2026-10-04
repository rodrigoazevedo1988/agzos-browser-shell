# Roadmap: Agzos Browser no nível Opera/Vivaldi

> Base analisada: v1.3.3 (`88e2837`). Documento de planejamento. Nada aqui foi implementado ainda.

## 1. Diagnóstico do que existe hoje

### Arquitetura

| Camada             | Arquivo                                                    | Estado                                                                                                                                                                            |
| ------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Processo principal | `electron/main.cjs` (822 linhas)                           | Uma janela, um `WebContentsView` por aba, menus nativos, permissão de mídia, identidade de Chrome (UA, Client Hints, shim `window.chrome`), popups OAuth, cofre com `safeStorage` |
| Bridge             | `electron/preload.cjs` + `src/features/browser/desktop.ts` | IPC tipado de aba (attach, navigate, back/forward, mute, bounds), menus, permissões, cofre                                                                                        |
| UI (chrome)        | `src/features/browser/chrome.tsx` (1317 linhas)            | **Monolito**: abas, omnibox, atalhos, painéis, menus, sync com o desktop e persistência no mesmo componente                                                                       |
| Persistência       | `src/features/browser/storage.ts`                          | `localStorage` com ~11 chaves soltas e sem versionamento de schema                                                                                                                |
| Web fallback       | `web-frame.tsx`                                            | iframe, com lista fixa de sites que recusam embed                                                                                                                                 |

### Funcionalidades

| Recurso                                                           | Situação                                                                                              |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Abas (criar, fechar, fixar, duplicar, mutar, reabrir 20 fechadas) | ✅ real                                                                                               |
| Abas verticais com rail colapsável                                | ✅ real                                                                                               |
| Aba anônima (partição em memória)                                 | ✅ real                                                                                               |
| Omnibox com DuckDuckGo/Yandex                                     | ✅ básica: sem sugestões, sem histórico e sem autocomplete                                            |
| Favoritos                                                         | ⚠️ só "quick links" da página inicial, sem pastas nem barra                                           |
| Histórico global                                                  | ❌ só o histórico por aba, dentro do estado da aba                                                    |
| Downloads                                                         | ❌ sem `will-download`: nem gerenciador nem progresso                                                 |
| Bloqueio de rastreadores                                          | ❌ **mockado** (`privacy.ts` gera números com seed pelo host)                                         |
| IA na lateral                                                     | ❌ **mockada** (`ai/templates.ts`)                                                                    |
| Cofre Agzos Key                                                   | ⚠️ criptografado com `safeStorage`, mas sem autofill nem captura de login                             |
| Permissões                                                        | ⚠️ só mídia, lembradas **em memória** (somem ao reiniciar). Notificações e geolocalização são negadas |
| Buscar na página (Ctrl+F), zoom, imprimir para PDF                | ❌ / ❌ / ⚠️ só `print()`                                                                             |
| Várias janelas                                                    | ❌ `mainWindow` é global único                                                                        |
| Extensões Chrome                                                  | ❌                                                                                                    |
| DRM (Netflix, Spotify, Prime)                                     | ❌ o Electron vanilla não traz Widevine                                                               |
| Atualização automática                                            | ❌ o `release-browser.sh` só publica os arquivos                                                      |
| Hibernação de abas                                                | ❌ toda aba mantém o renderer vivo                                                                    |
| DevTools no build empacotado                                      | ❌ bloqueado de propósito                                                                             |

### Dívidas técnicas que travam a evolução

1. **`chrome.tsx` monolítico.** Cada recurso novo aumenta o risco de regressão. Precisa virar store + componentes.
2. **Estado duplicado.** O renderer mantém `history[]` por aba e o `WebContents` tem o histórico real. O `tab-updated` reescreve a entrada, o que gera divergência com SPA e redirects.
3. **IDs de aba com `Date.now()`.** Pode colidir em ações em lote (duplicar, restaurar).
4. **`localStorage` como banco.** Não aguenta histórico, favoritos e downloads em volume. O SQLite no main já estava previsto.
5. **Não há testes.** Nenhum teste unitário nem e2e. Para um navegador, e2e com Playwright + Electron é obrigatório.

---

## 2. Matriz de gap: Opera / Vivaldi / Agzos

| Categoria                                  | Opera          | Vivaldi           | Agzos hoje                      | Meta                |
| ------------------------------------------ | -------------- | ----------------- | ------------------------------- | ------------------- |
| Adblock + antirrastreio real               | ✅             | ✅                | mock                            | **P0**              |
| Downloads                                  | ✅             | ✅                | ❌                              | **P0**              |
| Histórico + favoritos com pastas           | ✅             | ✅                | parcial                         | **P0**              |
| Buscar na página, zoom por site            | ✅             | ✅                | ❌                              | **P0**              |
| Sessão restaurada com segurança            | ✅             | ✅                | parcial                         | **P0**              |
| Workspaces                                 | ✅             | ✅                | ❌                              | P1                  |
| Grupos/pilhas de abas                      | ✅ Tab Islands | ✅ Tab Stacks     | ❌                              | P1                  |
| Split view / tiling                        | ✅             | ✅                | ❌                              | P1                  |
| Painéis web laterais (WhatsApp, Telegram…) | ✅             | ✅                | ❌                              | P1                  |
| Command palette                            | ❌             | ✅ Quick Commands | ❌ (o `cmdk` já está instalado) | P1                  |
| Atalhos configuráveis + gestos do mouse    | parcial        | ✅                | fixos                           | P1                  |
| Hibernação de abas                         | ✅             | ✅                | ❌                              | P1                  |
| IA real na lateral                         | ✅ Aria        | ❌                | mock                            | P1                  |
| Notas                                      | ❌             | ✅                | ❌                              | P2                  |
| Captura de tela, leitor, PiP               | ✅             | ✅                | ❌                              | P2                  |
| Extensões Chrome                           | ✅             | ✅                | ❌                              | P2                  |
| Temas / personalização da UI               | ✅             | ✅✅              | claro/escuro                    | P2                  |
| Sync entre dispositivos                    | ✅             | ✅ (E2E)          | ❌                              | P3                  |
| VPN/proxy                                  | ✅ VPN         | ❌                | ❌                              | P3 (proxy)          |
| E-mail, calendário, feeds                  | ❌             | ✅                | ❌                              | P3 / fora de escopo |
| DRM (Widevine)                             | ✅             | ✅                | ❌                              | P2                  |
| Auto-update                                | ✅             | ✅                | ❌                              | **P0**              |

---

## 3. Fase 0: Fundação (antes de qualquer recurso)

Sem esta fase, cada recurso das fases seguintes custa o dobro.

### FND-001: Quebrar o `chrome.tsx`

```
src/features/browser/
  store/            # zustand (ou useReducer + context): tabs, windows, workspaces, panels
    tabs.ts         # ações puras: open/close/move/pin/group, testáveis sem React
    selectors.ts
  toolbar/          # omnibox, botões, indicadores
  tabstrip/         # horizontal, vertical, grupos
  hotkeys/          # registro central de comandos (base da palette e dos atalhos custom)
  desktop-sync.ts   # único ponto que fala com o bridge
```

- **Registro de comandos.** Toda ação vira `{ id, label, run, defaultShortcut }`. Esse registro alimenta a command palette, os atalhos configuráveis, os menus de contexto e os gestos. É a base do "estilo Vivaldi".
- **Fonte da verdade da navegação no main.** O renderer só espelha `url/title/canBack/canForward/loading`. Remover o `history[]` do estado da aba no modo desktop.

### FND-002: Camada de dados no main process

- `better-sqlite3` em `userData/agzos.db`, com migrations versionadas. Tabelas: `history`, `bookmarks`, `downloads`, `site_settings`, `sessions`, `workspaces`, `notes`.
- A API é exposta pelo preload como `agzosDesktop.db.*`, com métodos específicos (`history.search(q)`) e **nunca SQL cru** vindo do renderer.
- A versão web mantém um adapter em `localStorage`/IndexedDB com a mesma interface, o que preserva a regra do `AGENTS.md` para o MVP web:

```ts
interface BrowserStore {
  history: { add(e: Visit): Promise<void>; search(q: string, limit?: number): Promise<Visit[]> };
  bookmarks: { tree(): Promise<BookmarkNode[]>; add(...): ...; move(...): ... };
  siteSettings: { get(origin: string): Promise<SiteSettings>; set(...): ... };
}
export const store: BrowserStore = desktopBridge()?.db ?? localStore;
```

- Migrar as chaves `agzos-*` do `localStorage` no primeiro boot.

### FND-003: Qualidade

- Vitest para o store de abas e os helpers (`hostOf`, `normalizeUrlKey`, engines).
- Playwright `_electron` com smoke tests: abrir app, navegar, abrir e fechar aba, aba anônima, e **login do Google não cair em `/signin/rejected`** (regressão da identidade de Chrome).
- CI no GitHub Actions: lint + typecheck + vitest + build do desktop no Linux.

### FND-004: Auto-update

- `electron-updater` + `electron-builder` no lugar do `@electron/packager`. Ele gera `latest.yml` e `latest-mac.yml` e já resolve a assinatura.
- Feed estático no mesmo servidor do `release-browser.sh` (`/var/www/agzosagency/browser`).
- Assinatura de código no macOS (notarização) e no Windows. Sem isso, o SmartScreen e o Gatekeeper bloqueiam o update.

---

## 4. Fase 1: Paridade de navegador (P0)

| ID      | Recurso                      | Implementação                                                                                                                                                                                                                                                                                                                   |
| ------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NAV-001 | **Adblock real**             | `@ghostery/adblocker-electron` com EasyList + EasyPrivacy + lista PT-BR em cache no disco, aplicado em `session.defaultSession` **e** na partição anônima. O contador do `PrivacyPanel` passa a vir de eventos reais (`request-blocked`). Mantém "pausar no site" (`pausedHosts`) via allowlist. Remover o `privacy.ts` mockado |
| NAV-002 | **Downloads**                | `session.on('will-download')`: salvar em `Downloads/`, emitir progresso via IPC, painel com pausar, retomar, cancelar, abrir e mostrar na pasta. Persistir no SQLite. Corrigir o "Salvar como…" atual (`downloadURL` da própria página)                                                                                         |
| NAV-003 | **Histórico**                | Registrar no `did-navigate` (nunca na aba anônima). Página `agzos://historico` com busca, filtro por dia e limpar intervalo                                                                                                                                                                                                     |
| NAV-004 | **Favoritos**                | Árvore com pastas, barra de favoritos opcional, gerenciador `agzos://favoritos`, importação de HTML (Netscape) e do Chrome/Firefox                                                                                                                                                                                              |
| NAV-005 | **Omnibox inteligente**      | Sugestões mescladas de histórico (frecency), favoritos, abas abertas ("Mudar para a aba") e sugestões do buscador. Atalhos de buscador (`y termo` → Yandex). Mais engines: Google, Bing, Brave, Startpage                                                                                                                       |
| NAV-006 | **Buscar na página**         | Barra Ctrl+F no chrome, usando `webContents.findInPage` / `stopFindInPage` e `found-in-page` para mostrar "3 de 12"                                                                                                                                                                                                             |
| NAV-007 | **Zoom por site**            | Ctrl +/−/0 com `setZoomFactor`, persistido em `site_settings`, e indicador na omnibox                                                                                                                                                                                                                                           |
| NAV-008 | **Permissões por site**      | Câmera, microfone, notificações, geolocalização, clipboard e pop-ups, persistidos em `site_settings` (hoje ficam em memória). Popover do cadeado com as permissões do site + HTTPS/certificado                                                                                                                                  |
| NAV-009 | **Segurança**                | Tela de erro de certificado (`certificate-error`), modo "somente HTTPS" opcional, páginas de erro de rede próprias (`did-fail-load`)                                                                                                                                                                                            |
| NAV-010 | **Sessão**                   | Restaurar janelas, abas, grupos e posição de scroll. Recuperação após crash com "Restaurar sessão?"                                                                                                                                                                                                                             |
| NAV-011 | **Várias janelas**           | Trocar o `mainWindow` global por `Map<windowId, WindowState>`, com arrastar aba para fora = nova janela. Janela anônima dedicada                                                                                                                                                                                                |
| NAV-012 | **Imprimir / salvar em PDF** | `printToPDF` além do `print()`                                                                                                                                                                                                                                                                                                  |
| NAV-013 | **Atalhos completos**        | Ctrl+Tab/Ctrl+Shift+Tab, Ctrl+1..9, Ctrl+Shift+N, Alt+←/→, F5, F11, Ctrl+H/J/D, Esc para parar o carregamento. Hoje o `forwardAppShortcut` só repassa `t,w,r,l,k`                                                                                                                                                               |

---

## 5. Fase 2: Diferenciais Opera/Vivaldi (P1)

| ID      | Recurso                         | Notas de implementação                                                                                                                                                                                                                                                                                                                             |
| ------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PWR-001 | **Workspaces**                  | Conjuntos nomeados de abas com ícone/cor (Trabalho, Pessoal, Clientes). Troca rápida pela barra lateral ou por Ctrl+Alt+1..9. Tabela `workspaces` + `tab.workspaceId`                                                                                                                                                                              |
| PWR-002 | **Grupos de abas**              | Grupo com nome e cor, colapsável (estilo Chrome/Opera Islands). No modo vertical vira árvore. Opção de "pilha" estilo Vivaldi (uma aba visível com as demais agrupadas)                                                                                                                                                                            |
| PWR-003 | **Split view / tiling**         | 2 a 4 `WebContentsView` visíveis ao mesmo tempo. O `applyLayout()` deixa de assumir "uma aba ativa" e recebe um **layout** (`{ tabId, rect }[]`). Divisores arrastáveis no renderer, que envia os rects                                                                                                                                            |
| PWR-004 | **Painéis web laterais**        | Barra lateral fina (estilo Opera sidebar) com painéis fixos: WhatsApp, Telegram, Discord, Spotify, ChatGPT/duck.ai, mais URL customizada. Cada painel é um `WebContentsView` persistente com partição própria (`persist:panel-<id>`), para manter o login. **Precisa passar pelo `applyChromeIdentity`** (já coberto pelo `web-contents-created`)  |
| PWR-005 | **Command palette**             | Ctrl+K/F2 (hoje o Ctrl+K foca a omnibox; mover). Usa o `cmdk` já instalado e busca comandos, abas, histórico, favoritos e configurações                                                                                                                                                                                                            |
| PWR-006 | **Atalhos configuráveis**       | Tela de atalhos a partir do registro de comandos (FND-001), com detecção de conflito                                                                                                                                                                                                                                                               |
| PWR-007 | **Gestos do mouse**             | Botão direito + arrasto (←, →, ↓→ fecha, ↑ nova aba). Captura via `before-mouse-event`, ou por script injetado com IPC, já que o `WebContentsView` não expõe o movimento com o botão direito ao chrome                                                                                                                                             |
| PWR-008 | **Hibernação de abas**          | Após N minutos inativa (configurável, com exceção de abas com áudio ou fixadas): guardar a URL, destruir o `WebContents` e recriar ao ativar. Menu "Hibernar aba/grupo". É o maior ganho de RAM                                                                                                                                                    |
| PWR-009 | **IA real**                     | Trocar o `ai/templates.ts` por um provedor real, com a chave de API do usuário ou um backend Agzos: extrair o texto da página (script injetado, Readability) → resumir, explicar ou chat com contexto. Streaming na lateral. Ações no menu de contexto: "Resumir seleção", "Traduzir", "Explicar". Ver a skill `claude-api` na hora de implementar |
| PWR-010 | **Autofill do Agzos Key**       | Detectar formulário de login (script no preload das abas, world isolado), sugerir credencial, capturar credenciais novas ("Salvar senha?"), gerador de senha, importar CSV do Chrome/Bitwarden. Opção de trava com senha mestra                                                                                                                    |
| PWR-011 | **Tab preview e busca de abas** | Miniatura ao passar o mouse (`capturePage`) e busca de abas (Ctrl+Shift+A)                                                                                                                                                                                                                                                                         |

---

## 6. Fase 3: Polimento e ecossistema (P2)

| ID      | Recurso                                     | Notas                                                                                                                                                                                                                                                        |
| ------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EXT-001 | **Extensões Chrome**                        | `electron-chrome-extensions` (API `chrome.tabs`, ações na barra) + `electron-chrome-web-store` para instalar da Chrome Web Store. MV3 com suporte parcial. Começar pela lista de alvos (Bitwarden, uBlock Lite, Dark Reader, Grammarly) e testar uma por uma |
| MED-001 | **DRM / Widevine**                          | Trocar o Electron por **Castlabs ECS** (fork com Widevine) + assinatura VMP. Sem isso, Netflix, Prime e Spotify Web não tocam. Avaliar o custo: o processo de VMP é gratuito, mas burocrático                                                                |
| MED-002 | **Picture-in-Picture + controles de mídia** | Botão PiP sobre vídeos, e um popover global de mídia (tocando em qualquer aba) com play/pause                                                                                                                                                                |
| UX-001  | **Captura de tela**                         | Área, página inteira ou visível (`capturePage` + CDP `Page.captureScreenshot` com `captureBeyondViewport`), com anotação simples e cópia                                                                                                                     |
| UX-002  | **Modo leitura**                            | `@mozilla/readability` injetado, renderizado em `agzos://leitor` com tipografia da marca                                                                                                                                                                     |
| UX-003  | **Notas**                                   | Painel de notas em markdown vinculadas à URL, com "Adicionar seleção às notas"                                                                                                                                                                               |
| UX-004  | **Temas**                                   | Editor de tema (cor de destaque, fundo, cantos, densidade) sobre os tokens da marca (#0E0E0E, #D10A11, #FFFDFD). Cor de destaque adaptada ao site (estilo Vivaldi, a partir de `theme-color`). Temas agendados claro/escuro                                  |
| UX-005  | **Página inicial**                          | Speed Dial com pastas, widgets (clima, notas, tarefas) e wallpaper                                                                                                                                                                                           |
| UX-006  | **Tradução de página**                      | Via IA ou API de tradução, com barra "Traduzir para português"                                                                                                                                                                                               |
| DEV-001 | **DevTools configurável**                   | Opção "Ferramentas de desenvolvedor" em Configurações > Avançado (hoje é bloqueado sempre no pacote)                                                                                                                                                         |

## 7. Fase 4: Contas e sync (P3)

| ID      | Recurso     | Notas                                                                                                                                                                                                                  |
| ------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SYN-001 | Conta Agzos | Backend próprio. Era o "sync real" adiado no `AGENTS.md`                                                                                                                                                               |
| SYN-002 | Sync E2E    | Favoritos, histórico, senhas, abas abertas, workspaces e configurações. Criptografia no cliente (chave derivada da senha, estilo Vivaldi/Bitwarden). O SQLite local vira a fonte e o servidor guarda só blobs cifrados |
| NET-001 | Proxy/VPN   | Primeiro: proxy configurável por workspace/aba anônima (`session.setProxy`). Uma VPN própria (estilo Opera) exige infraestrutura; fica como parceria                                                                   |

---

## 8. Ordem sugerida de entregas

| Versão   | Conteúdo                                                                                       | Por quê                                               |
| -------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **1.4**  | FND-001, FND-002, FND-003                                                                      | Sem store, SQLite e testes, o resto fica frágil       |
| **1.5**  | NAV-001 adblock, NAV-002 downloads, NAV-006 buscar, NAV-007 zoom, NAV-013 atalhos              | Maior percepção de "navegador de verdade" por esforço |
| **1.6**  | NAV-003 histórico, NAV-004 favoritos, NAV-005 omnibox, NAV-008 permissões, FND-004 auto-update | A partir daqui dá para usar como navegador principal  |
| **1.7**  | NAV-009 a NAV-012 + PWR-008 hibernação                                                         | Robustez e RAM                                        |
| **2.0**  | PWR-001 workspaces, PWR-002 grupos, PWR-003 split, PWR-004 painéis, PWR-005 palette            | O "nível Opera/Vivaldi" visível                       |
| **2.1**  | PWR-009 IA real, PWR-010 autofill, PWR-006/007 atalhos e gestos                                | Diferencial Agzos                                     |
| **2.2+** | Fase 3 (extensões, DRM, temas…)                                                                | Ecossistema                                           |
| **3.0**  | Fase 4 (sync)                                                                                  | Depende de backend                                    |

## 9. Riscos e cuidados

- **Identidade de Chrome** (`applyChromeIdentity`, `chromePageShim`, Client Hints): todo `WebContents` novo (painéis, split, popups, extensões) precisa dela. Adblock e extensões também usam `webRequest`: **combinar os handlers numa função só por session**, porque o Electron aceita apenas um `onBeforeSendHeaders` por session e um segundo registro **substitui** o que injeta os Client Hints e quebra o login do Google. Ler o `docs/login-google-desktop.md` antes.
- **Extensões + adblock** disputam o `webRequest`. Definir desde já um "request pipeline" central no main.
- **Castlabs ECS** acompanha o Electron com atraso. Verificar a compatibilidade com o Electron 44 antes de adotar.
- **Memória**: split view e painéis multiplicam os renderers. A hibernação (PWR-008) deve chegar antes ou junto do 2.0.
- **Versão web**: o renderer precisa continuar funcionando na web (fallback iframe + stores em `localStorage`). Todo recurso só de desktop fica atrás de `desktopBridge()`.
- **Segurança do preload**: a API vai crescer muito. Manter métodos específicos e validados no main (nunca `eval`/SQL/`fs` genérico) e `sandbox: true` em tudo.
