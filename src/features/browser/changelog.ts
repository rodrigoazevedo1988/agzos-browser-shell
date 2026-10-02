/**
 * Novidades de cada versão publicada, mostradas no aviso "Atualizado com sucesso".
 * Toda publicação (scripts/build-all.sh) acrescenta uma entrada no topo, com a mesma
 * versão do VERSION do build.
 */
export type ChangelogEntry = { version: string; date: string; items: string[] };

export const CHANGELOG: ChangelogEntry[] = [
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
