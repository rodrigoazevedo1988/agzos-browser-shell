# Agzos Browser Shell

gostei do plano, por hora comece pela casca, interface e se baseie no brandbook do Agzos documento anexo, nao use banco de dados e lovable cloud, isso irei fazer depois de conectar no github, faça algo localhost sqlite se for o caso e mocado por hora

Construa a casca (shell) e a interface do navegador Agzos Browser como um app web navegável, seguindo o plano de MVP já definido — escopo desta fase: apenas a casca/interface, sem backend:

- Janela do navegador com barra de abas (criar, fechar, alternar abas), botões voltar/avançar/recarregar e omnibox (barra de endereços) que aceita URL ou busca simulada.
- Barra lateral retrátil de IA (Agzos AI Sidebar) com resumo/explicação/chat mocados.
- Painel/botão do cofre Agzos Key na barra de ferramentas, com lista de credenciais mocada por domínio e cópia em um clique.
- Indicador de privacidade com contador visual de rastreadores bloqueados (números mocados).
- Modo escuro/claro.

Use a identidade visual do brandbook anexo: paleta Preto #0E0E0E, Vermelho #D10A11, Branco #FFFDFD (PDF Paleta_de_cores), e os logos em SVG anexados (1.svg a 7.svg são variações do símbolo Agzos em preto, branco e vermelho). Leia também o Manual_de_Arquivos.pdf anexo para seguir as regras de uso da marca.

Não use Lovable Cloud, banco de dados nem autenticação. Persista o que for preciso localmente no navegador (localStorage) e use dados mocados por hora. O backend real (sync, contas, SQLite no Electron) será conectado depois pelo GitHub. Ao final, mostre um screenshot da interface.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/d08d0a75-30c8-490f-afde-7a03538876a6).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Desktop (Electron)

- [Login do Google no app desktop](docs/login-google-desktop.md): por que o Google
  recusava o login, como a identidade de Chrome é aplicada e como testar.
- [Roadmap Opera/Vivaldi](docs/roadmap-opera-vivaldi.md): diagnóstico da v1.3.3 e
  plano de evolução por fases.
- [PRD v1.4 — Fundação](docs/prd/v1.4-fundacao.md): store, SQLite e testes.
- [PRD v1.5 — Navegador de verdade](docs/prd/v1.5-navegador.md): adblock real, downloads,
  buscar na página, zoom por site e atalhos.
- [PRD v1.5.1 — Correções](docs/prd/v1.5.1-correcoes.md): login do Google com adblock,
  DMG "danificado", YouTube, layout no Mac.
- [PRD v1.5.2 — Login do Google e YouTube](docs/prd/v1.5.2-login-youtube.md): identidade de
  Chrome em toda carga da guia, logins intocados, listas oficiais do uBlock Origin.
- [PRD v1.5.3 — YouTube](docs/prd/v1.5.3-youtube.md): scriptlets isolados entre si, mundo
  isolado do uBO e primeira carga de guia nova.
- [PRD v1.6 — Biblioteca](docs/prd/v1.6-biblioteca.md): histórico, favoritos com pastas,
  omnibox com sugestões, permissões por site e atualização automática.
- [PRD v1.6.1 — Marca e correções](docs/prd/v1.6.1-marca-e-correcoes.md): ícone e nome
  "Agzos Browser" no Windows/Mac, barra de permissão e atalhos no Windows.
- Build e publicação de todas as plataformas: `bash scripts/build-all.sh`.

## Testes

```sh
bun run lint && bun run typecheck && bun run test   # lint, tipos e unitários (Vitest)
bun run test:e2e:web                                 # Playwright na versão web
xvfb-run -a bun run test:e2e:desktop                 # Playwright no Electron (sem tela: xvfb-run)
```

Se o `bun install` não baixar o binário do Electron, rode `node node_modules/electron/install.js`.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
