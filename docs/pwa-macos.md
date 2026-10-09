# PWA como app próprio no macOS (4.8.3)

## O problema

Até a 4.8.2, o `.app` de cada PWA em `~/Applications/Agzos Apps` só tinha um script
`launcher` que rodava `open -n -a "Agzos Browser.app" --args --agzos-pwa=<id>`. O script
saía na hora e o Agzos já aberto recebia o pedido pelo lock de instância única. Ele então
abria o PWA como mais uma `BrowserWindow` do processo do navegador. Para o macOS, essa
janela pertence ao `br.agzos.browser`: o Dock, o ⌘Tab e o Mission Control mostravam o
ícone do Agzos. `BrowserWindow.setIcon`, `app.dock.setIcon` e `setActivationPolicy` não
mudam isso, porque a identidade no Dock é do processo e do bundle, não da janela.

## A solução

Cada PWA roda num processo próprio, lançado de dentro do próprio `.app`:

| Peça                                                                                                                                                                                                                              | Onde                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Montagem do `.app`: clone APFS (`cp -Rc`) do `Agzos Browser.app`, `Info.plist` com `CFBundleIdentifier` `br.agzos.browser.pwa.<id>`, `CFBundleDisplayName` e `CFBundleIconFile` do PWA, `xattr -cr` e `codesign --force --sign -` | `buildMacPwaApp` em `electron/pwa-mac.cjs`        |
| Marcador do app (id, nome, URLs, versão, onde está o navegador e o perfil dele)                                                                                                                                                   | `Contents/Resources/agzos-pwa.json`               |
| Modo app: perfil `<userData>/PwaApps/<id>` (lock e banco próprios), só a janela do PWA, menu Editar/Ver/Janela, sai quando a janela fecha                                                                                         | `pwaHost` e `startPwaHost` em `electron/main.cjs` |
| Abrir pelo navegador (Configurações, ícone da barra, atalho antigo): `open -a <bundle>`, que traz o app para a frente se ele já estiver aberto                                                                                    | `launchMacPwa`                                    |
| Links fora do escopo: o app chama `open -n -a "Agzos Browser.app" --args --agzos-open=<url>`                                                                                                                                      | `openInBrowserFromHost`, `openArgOf`              |
| Atualização: ao abrir, o navegador remonta os clones feitos por outra versão e converte os lançadores antigos                                                                                                                     | `refreshMacPwaApps`                               |
| Desinstalar: encerra os processos do clone (SIGTERM), apaga o `.app`, o perfil do app e o registro                                                                                                                                | `quitMacPwa`, `uninstallPwa`                      |

O clone APFS compartilha os blocos com o Agzos: o `du` mostra uns 300 MB, mas o disco
gasto de verdade é só o executável reassinado, o `Info.plist`, o ícone e o selo. Sem
`--deep`, o framework do Electron não é reescrito.

### O que foi testado e descartado

- **Executável copiado com `Frameworks` e `Resources/app` em symlink.** O macOS aceitou a
  identidade e a assinatura, mas o processo cai com `EXC_BREAKPOINT (SIGTRAP)` no
  `CrBrowserMain`, cerca de 0,5 s depois de abrir. É um CHECK do Chromium, sem mensagem no
  build de produção.
- **App shim nativo como o do Chrome (`app_mode_loader`).** Depende do remote cocoa do
  Chromium, que o Electron não expõe, e de um módulo nativo, que o projeto não aceita.

## Roteiro de teste manual (macOS)

| ID      | Passo                                                                     | Esperado                                                                |
| ------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| MAC-001 | Instalar um PWA (ícone na barra de endereço) e abrir                      | Janela sem guias nem barra, com título e ícone do PWA                   |
| MAC-002 | Navegador e PWA abertos juntos                                            | Dois ícones no Dock; ⌘Tab alterna entre eles                            |
| MAC-003 | Instalar e abrir dois PWAs diferentes                                     | Três ícones no Dock, cada um com nome e ícone certos                    |
| MAC-004 | ⌘Q no navegador com o PWA aberto                                          | O PWA continua funcionando                                              |
| MAC-005 | ⌘Q no PWA                                                                 | O navegador e os outros PWAs continuam                                  |
| MAC-006 | Fechar e reabrir o PWA                                                    | Continua logado; posição e zoom da janela voltam                        |
| MAC-007 | Clicar no ícone do PWA já aberto (Dock, Launchpad, Configurações → Abrir) | A janela existente vem para a frente, sem segunda janela                |
| MAC-008 | Mission Control e Dock                                                    | O PWA aparece como app separado, com o próprio nome                     |
| MAC-009 | Atualizar o Agzos e abrir o navegador                                     | Em poucos segundos o `.app` do PWA é remontado; ele abre na versão nova |
| MAC-010 | Windows e Linux                                                           | Como antes: atalho do sistema e janela do PWA no processo do navegador  |

Também vale testar:

- link para outro site dentro do PWA, que abre numa guia do navegador, mesmo com o navegador fechado;
- notificação do site, que sai com o nome do PWA;
- desinstalar pelas Configurações com o PWA aberto, que o fecha e remove o `.app`.

## Limitações conhecidas

- O nome em negrito na barra de menus continua "Agzos Browser": o Electron acha os
  processos auxiliares pelo `CFBundleName`, então ele não muda. O Dock, o ⌘Tab e o
  Mission Control mostram o nome do PWA.
- Cada PWA aberto é um processo Electron completo, com uns 150 a 250 MB de RAM.
- O bloqueador de anúncios e o gerenciador de downloads do navegador não rodam dentro do
  app. Downloads usam a caixa padrão do sistema.
- Permissões já decididas para o PWA quando ele rodava dentro do navegador são perguntadas
  de novo uma vez. O login vem junto, porque a partição é copiada.
- A assinatura é ad-hoc, a mesma do Agzos publicado. Com Developer ID e notarização, o
  clone precisa ser assinado com a mesma identidade, o que hoje não existe.
- O clone sem gasto de disco depende de APFS. Em outro sistema de arquivos, vira uma cópia
  comum, com uns 300 MB por app.
