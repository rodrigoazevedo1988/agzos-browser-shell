/**
 * Novidades de cada versão publicada, mostradas no aviso "Atualizado com sucesso".
 * Toda publicação (scripts/build-all.sh) acrescenta uma entrada no topo, com a mesma
 * versão do VERSION do build.
 */
export type ChangelogEntry = { version: string; date: string; items: string[] };

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "4.1.1",
    date: "2026-10-03",
    items: [
      "Instale sites como apps: quando a página tem manifesto e service worker, aparece o ícone de instalar na barra de endereço. O app abre em janela própria, sem a barra de guias, ganha ícone no menu Iniciar, no Dock (Aplicativos › Agzos Apps) ou no menu de aplicativos, e tem login, zoom e permissões separados da guia normal. Desinstale em Configurações → Apps instalados ou pelo menu do próprio app.",
      "Abra qualquer arquivo no navegador: Ctrl+O (⌘O), digitando o caminho na barra de endereço ou pelo terminal. HTML, SVG, PDF, vídeo e áudio abrem direto; código e texto viram uma página de leitura com números de linha; os outros tipos mostram os detalhes e o botão para abrir no app do sistema.",
      "Visualizador de imagens completo: zoom no cursor, arrastar, girar, espelhar, brilho, contraste, saturação, fundo escuro, claro ou xadrez, informações e tela cheia. No modo Canvas você desenha, marca, faz retângulos, setas e textos e exporta a imagem anotada em PNG.",
      "Terminal com abas que você renomeia (duplo clique ou F2) e um painel lateral: o modo ls (Ctrl+Shift+O) navega pelas pastas e, ao escolher uma, abre ela no terminal; os snippets rodam ou só digitam comandos; as skills do Claude Code, Codex, OpenCode e Gemini entram no prompt com um clique, e dá para criar uma skill nova.",
      "Modo agente (Ctrl+Shift+G): um canvas de nós ligados, no estilo do ComfyUI. Descreva um objetivo e a IA monta as etapas com os agentes (Claude Code, Codex, OpenCode, Gemini, Kiro ou a própria Groq); cada etapa roda numa aba do terminal, as independentes em paralelo, e a saída de uma segue para a próxima.",
      "Na primeira abertura, o terminal oferece instalar as CLIs de IA (Claude Code, Codex, Kiro CLI, OpenCode, Gemini CLI, Freebuff) no Windows, macOS e Linux, numa aba à vista, e põe as pastas delas no PATH. Também pelo lançador: Instalar CLIs de IA.",
    ],
  },
  {
    version: "4.1.0",
    date: "2026-10-03",
    items: [
      "Terminal onde você quiser: embaixo da página, à direita dela ou numa janela flutuante sempre por cima (PiP). Arraste a borda para redimensionar; trocar de lugar não fecha as sessões nem apaga o que estava na tela.",
      "Aparência do terminal em Configurações → Terminal: temas prontos (Agzos, Claro, Dracula, Solarized, Monokai, Meia-noite), cor de fundo, do texto e do cursor, fonte, tamanho e formato do cursor.",
      "Modo voz: aperte o microfone (ou Ctrl+Shift+M), fale o comando e o texto transcrito pelo Whisper da Groq aparece no prompt — usa a mesma chave do Agzos AI.",
      "Lançador (Ctrl+Shift+K) com Claude Code, OpenCode, Kiro, Antigravity, Freebuff, Codex e Gemini CLI, suas conexões SSH e comandos rápidos. As chaves de API dessas ferramentas ficam cifradas e entram só no ambiente do terminal.",
      "SSH: veja as chaves de ~/.ssh, gere uma ed25519 nova, copie a chave pública e salve conexões que abrem com um clique.",
      "Aliases que funcionam no bash, zsh, PowerShell e cmd, e atalhos novos: Ctrl+Shift+E nova sessão, Ctrl+Shift+W fecha, Ctrl+Shift+←/→ troca de sessão e Ctrl +/−/0 muda a fonte.",
    ],
  },
  {
    version: "4.0.0",
    date: "2026-10-03",
    items: [
      "Agzos AI de verdade, com a Groq: na primeira abertura o painel pede a sua chave da API (num campo mascarado) e a guarda cifrada pelo cofre do sistema — ela nunca volta para a tela. As respostas chegam em tempo real, dá para escolher o modelo e a conversa fica salva no computador até você apagar.",
      "Contexto só quando você quer: marque “Enviar contexto da aba” para mandar o endereço, o título e o texto selecionado junto com aquela pergunta. Abra e feche a IA com Ctrl+Shift+A (⌘⇧A no Mac) ou pelo menu ⋯.",
      "Gestos: deslize dois dedos no trackpad para voltar e avançar, faça pinça para dar zoom só na página ou no painel sob o cursor, use os botões laterais do mouse e desenhe gestos com o botão direito segurado (← voltar, → avançar, ↑↓ recarregar, ↓ nova guia, ↓→ fechar guia). Em Configurações → Gestos você liga, desliga e troca a ação de cada um.",
      "Terminal de verdade embaixo da página (Ctrl+Alt+T): PowerShell, PowerShell 7 ou Prompt de Comando no Windows, zsh ou bash no macOS, com abas de sessão, cores, Ctrl+C, copiar e colar. Cada aba volta na última pasta usada.",
      "Vídeos mais leves: o navegador agora força a aceleração pela placa de vídeo, inclusive em GPUs integradas como a Intel UHD, e decodifica o vídeo nela — YouTube em 1080p sem engasgar e com menos CPU. Se a sua placa der problema, o Agzos volta sozinho ao modo padrão; dá para desligar em Configurações → Desempenho.",
    ],
  },
  {
    version: "3.1.1",
    date: "2026-10-02",
    items: [
      "Barra lateral mais limpa: a rolagem ficou fina e quase invisível, sem setas no rodapé. Quando os apps não cabem na altura da janela, o último lugar vira o botão Mais, que abre uma caixinha com os outros apps.",
      "Novo modal para adicionar sites, o mesmo no Discador e no Adicionar da página inicial: nome, endereço, categoria e a prévia do card com o logo do site, que vem sozinho. No Discador, os cards mostram a categoria e dá para filtrar por ela.",
      "Sons opcionais: um tick discreto ao passar o mouse na barra lateral e nos cards do Discador, e um som de tecla ao digitar na busca, na barra de endereço e nos modais. Em Configurações → Sons você liga ou desliga cada um, escolhe entre três ticks de teclado e ajusta o volume.",
      "Cada painel da barra lateral tem o seu zoom (Ctrl + roda do mouse ou Ctrl +/−/0 com o foco nele) e a sua largura, guardados mesmo depois de fechar o navegador — sem mudar o zoom das guias do mesmo site nem o dos outros painéis.",
      "A alça do painel lateral agora aumenta a largura também, até onde a janela permitir.",
      "Discord e outros apps da barra lateral continuam logados depois de fechar e abrir o navegador: as páginas dos painéis são encerradas direito antes de sair, e o armazenamento é gravado.",
      "Início e Discador: a página aberta fica marcada no seletor do topo.",
    ],
  },
  {
    version: "3.0.0",
    date: "2026-10-02",
    items: [
      "GX Control: um painel no topo da barra lateral com medidores de CPU e memória, limitador de RAM (hiberna as guias mais pesadas acima do teto), limitador de CPU (desacelera as guias em segundo plano) e limitador de rede para download e upload.",
      "Hot Tabs Killer: veja quanto de CPU e memória cada guia usa, ordene pelas mais pesadas e encerre a guia num clique. O mesmo painel testa a velocidade da internet e limpa o cache sem tirar você das suas contas.",
      "Discador: uma página nova ao lado do Início, com uma grade de sites com logo. Pesquise nos seus sites ou na web, adicione sites com o +, arraste os cards para reordenar e clique para abrir na mesma guia.",
      "Barra lateral maior: além de WhatsApp, Telegram, Messenger, Instagram, Discord, X, Gmail e ChatGPT, agora tem Claude, Gemini, Duck.ai, TikTok, Kwai, YouTube, LinkedIn, Reddit, Spotify, Deezer e Pinterest — cada um com logo e nome. Dá para ocultar a barra nas Configurações.",
      "Os atalhos da página inicial agora mostram o logo de cada site no lugar da inicial.",
    ],
  },
  {
    version: "2.2.8",
    date: "2026-10-02",
    items: [
      "Barra de endereço: a chave do Agzos Key, a estrela e o link agora ficam juntos na ponta direita, sempre no mesmo lugar e com o mesmo espaçamento — os ajustes do site e a proteção aparecem à esquerda deles ao passar o mouse.",
      "Correção: com uma pasta de favoritos aberta, passar o mouse nas outras pastas troca o menu de verdade, em qualquer sistema, sem precisar clicar.",
      "Agzos Key: Preencher agora leva o foco para a página (é só apertar Enter), funciona também em logins feitos com web components e, quando a página não tem formulário de login à vista, avisa no próprio popup em vez de fechar sem fazer nada.",
      "Voltando a uma página de login, o Agzos Key sugere o preenchimento de novo, e o popup da chave fecha ao trocar de página.",
    ],
  },
  {
    version: "2.2.7",
    date: "2026-10-02",
    items: [
      "Favoritos da barra (e das pastas) agora sempre abrem numa guia nova — a página que você está vendo não é mais substituída.",
      "Com uma pasta de favoritos aberta, basta passar o mouse nas outras pastas para ir abrindo cada uma, com uma transição suave.",
      "Agzos Key mais confiável nas páginas de login: ao clicar no campo de usuário ou senha ele já busca no cofre e sugere o preenchimento (ou pede para desbloquear), inclusive em sites que montam o login aos poucos ou em etapas.",
      "Logins com Authenticator: depois de preencher, a barrinha do Key abre com o código de verificação, sem cobrir a página. Use a tachinha para deixá-la fixa enquanto copia e cola; o botão Preencher põe o código direto no campo.",
      "Chave do Agzos Key na barra de endereço: mostra os logins do site, busca no cofre e salva um login novo em um clique, já com o que você digitou na página.",
      "O navegador agora guarda no cofre a URL do site quando um login sem endereço é usado, e o sincroniza com o Agzos Key.",
    ],
  },
  {
    version: "2.2.6",
    date: "2026-10-01",
    items: [
      "Correção: as pastas e o histórico do Agzos Key não aparecem mais como credenciais vazias no painel de senhas, e o navegador não consegue mais apagá-los — antes, apagar esses itens fazia as pastas sumirem do Agzos Key em todos os dispositivos.",
      "As senhas agora aparecem agrupadas pelo nome da pasta em que estão no Agzos Key.",
    ],
  },
  {
    version: "2.2.5",
    date: "2026-10-01",
    items: [
      'As pastas da barra de favoritos voltaram ao menu de vidro (transparência, cantos arredondados, subpastas e "Abrir todos") — agora sempre por cima da página do site.',
    ],
  },
  {
    version: "2.2.4",
    date: "2026-10-01",
    items: [
      'Correção: as pastas da barra de favoritos abriam o menu atrás da página do site. Agora o menu da pasta (com subpastas e "Abrir todos") aparece sempre por cima.',
    ],
  },
  {
    version: "2.2.3",
    date: "2026-10-01",
    items: [
      "Correção: contas do Agzos Key protegidas com Argon2id voltam a desbloquear com a senha mestra correta — o navegador agora deriva a chave com os mesmos parâmetros do Agzos Key e, como ele, tenta a outra proteção quando o cofre está rotulado diferente.",
      "O desbloqueio dessas contas roda em segundo plano, sem travar as janelas enquanto a senha é verificada.",
      'Correção: o popup "Entrar com o Agzos Key" ficava escondido atrás da página; agora sobe por cima do site, como os outros painéis, sem tirar o foco do que você está digitando.',
    ],
  },
  {
    version: "2.2.2",
    date: "2026-10-01",
    items: [
      "Correção: as credenciais sincronizadas não somem mais depois de entrar — o cofre inteiro é recarregado a cada abertura, em vez de só as mudanças recentes.",
      "Correção: o desbloqueio agora respeita a proteção (KDF) de cada conta do Agzos Key — PBKDF2 ou Argon2id, com os parâmetros do próprio cofre —, então a senha mestra correta deixa de ser recusada.",
    ],
  },
  {
    version: "2.2.1",
    date: "2026-10-01",
    items: [
      "Correção: quando mais de uma pessoa usava o Agzos Key no mesmo computador, a senha mestra correta de outra conta era recusada. Agora cada conta desbloqueia o seu cofre normalmente.",
    ],
  },
  {
    version: "2.2.0",
    date: "2026-10-01",
    items: [
      "Senhas como nos navegadores principais: ao digitar um login e senha num site, o navegador pergunta se quer salvar no Agzos Key e sincroniza com o seu cofre cifrado.",
      "Autofill: quando o site aberto tem uma credencial no cofre, sobe um popup para copiar e-mail e senha ou preencher e entrar com um clique.",
      "MFA no navegador: as credenciais com verificação em duas etapas mostram o código TOTP atual (com contagem regressiva) e copiam na hora, igual ao Agzos Key.",
      "Cofre organizado por categorias (Pessoal, Trabalho, Finanças…): crie as suas, filtre por categoria e recolha os grupos; cada credencial agora tem favorito, categoria e chave MFA no cadastro.",
      "Barra de favoritos sempre acima da página: antes ela sumia atrás do site quando você saía da aba inicial — corrigido na web e no app.",
    ],
  },
  {
    version: "2.1.0",
    date: "2026-10-01",
    items: [
      "Agzos Key conectado de verdade: pareie o navegador com o seu cofre por um código, desbloqueie com a senha mestra e veja suas credenciais sincronizadas e cifradas de ponta a ponta (a senha mestra e as chaves nunca saem do seu dispositivo).",
      "Modo escuro com vidro de verdade: os menus e painéis translúcidos agora respeitam o tema escuro, sem mais fundo branco.",
      "Escolha a cor de destaque da interface na roda de cores (Configurações > Personalização), e ela vale também nos menus.",
      "Menu de favoritos corrigido: o clique direito numa pasta abre o menu de editar/renomear sem conflitar com a lista da pasta.",
    ],
  },
  {
    version: "2.0.1",
    date: "2026-10-01",
    items: ["Melhorias visuais e de estabilidade (transparência, cores de destaque e atalhos)."],
  },
  {
    version: "2.0.0",
    date: "2026-10-05",
    items: [
      "Workspaces: separe as guias por assunto (Pessoal, Trabalho, Estudos…) e troque com um clique no começo da barra de guias.",
      "Grupos de guias com nome e cor: clique direito na guia → Adicionar guia a novo grupo (Ctrl+Shift+G); clique no grupo para recolher.",
      "Tela dividida: duas páginas lado a lado (Ctrl+Alt+Shift+S ou clique direito na guia); arraste a divisória para ajustar.",
      "Painéis laterais com WhatsApp, Telegram, Messenger e Instagram ao lado da página (escolha outros no +).",
      "Busca de comandos (Ctrl+K): ache qualquer comando, guia, workspace ou favorito digitando.",
      "Barra de endereço: o primeiro clique seleciona o endereço todo; o ícone de link copia o endereço, e favorito, ajustes do site e proteção aparecem ao pausar o mouse.",
      "Personalização: escolha uma nova cor de acento para a interface, papel de parede na aba inicial e efeito de desfoque translúcido nos painéis (Configurações > Personalização).",
    ],
  },
  {
    version: "1.5.5",
    date: "2026-10-04",
    items: [
      "Com um menu aberto, clicar fora fecha o menu e o clique já vale (link, guia ou botão), como no Comet.",
    ],
  },
  {
    version: "1.5.4",
    date: "2026-10-03",
    items: [
      "Menus da toolbar não congelam mais o vídeo da página: o menu ⋯, downloads, proteção, site, favorito e cofre abrem por cima e a página continua viva.",
      "Com um menu aberto, a rolagem fora dele rola a página; clicar fora ou Esc fecham.",
    ],
  },
  {
    version: "1.5.3",
    date: "2026-10-02",
    items: [
      "Ctrl+Tab: soltar o Ctrl confirma a guia escolhida sempre, não só às vezes.",
      "O seletor do Ctrl+Tab aparece por cima da página, que continua à vista.",
    ],
  },
  {
    version: "1.5.2",
    date: "2026-10-01",
    items: [
      "Ctrl+Tab: soltar o Ctrl já abre a guia escolhida (antes só com Enter).",
      "Pare o mouse sobre uma guia para ver a prévia da página, a memória (RAM) e a CPU que ela usa.",
      "Configurações completas em uma página própria (Ctrl+,), com seções e busca.",
      "O menu ⋯ ficou mais enxuto: o essencial à mão, com zoom e tema.",
      "No Mac, a barra de menus superior traz tudo, inclusive Configurações (⌘,) e copiar/colar.",
    ],
  },
  {
    version: "1.5.1",
    date: "2026-09-30",
    items: [
      "Picture-in-picture em qualquer vídeo (YouTube ou outro player): botão na barra, Ctrl+Shift+P ou clique direito no vídeo.",
      "Arraste as guias para reordenar, na horizontal ou na vertical (ou Ctrl+Shift+PgUp/PgDn).",
      "Depois de cada atualização, este aviso mostra o que mudou.",
      "Novidades da versão atual em Configurações.",
    ],
  },
  {
    version: "1.5.0",
    date: "2026-09-29",
    items: [
      "Várias janelas: Ctrl+N abre uma nova e dá para mover uma guia para outra janela sem recarregar.",
      "Se o app fechar de repente, janelas e guias voltam como estavam.",
      "Telas de erro claras: sem internet, site inexistente, certificado inválido e página travada.",
      "Guias paradas hibernam e liberam memória; voltam do ponto onde você parou.",
    ],
  },
  {
    version: "1.4.2",
    date: "2026-09-28",
    items: [
      "Atualização automática corrigida no Windows.",
      "Se uma atualização falhar, o motivo aparece em Configurações.",
    ],
  },
  {
    version: "1.4.1",
    date: "2026-09-27",
    items: [
      "Ícone e nome Agzos Browser no Windows e no Mac.",
      "Pedido de permissão em faixa acima da página.",
      "Atalhos de teclado corrigidos no Windows.",
    ],
  },
  {
    version: "1.4.0",
    date: "2026-09-26",
    items: [
      "Histórico (Ctrl+H) e favoritos com pastas.",
      "Barra de endereço com sugestões do histórico, favoritos e buscador.",
      "Permissões lembradas por site e atualização automática.",
    ],
  },
];

/** -1, 0 ou 1, comparando "1.4.10" com "1.4.9" do jeito certo. */
export function compareVersions(a: string, b: string): number {
  const parts = (value: string) =>
    value.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

/**
 * Novidades de quem estava em `from` e agora está em `to` (as versões puladas também, até
 * `limit`). Sem `from`, só as da versão atual.
 */
export function changesBetween(
  from: string | null,
  to: string,
  entries: ChangelogEntry[] = CHANGELOG,
  limit = 3,
): ChangelogEntry[] {
  return entries
    .filter(
      (entry) =>
        compareVersions(entry.version, to) <= 0 &&
        (from ? compareVersions(entry.version, from) > 0 : entry.version === to),
    )
    .sort((a, b) => compareVersions(b.version, a.version))
    .slice(0, limit);
}
