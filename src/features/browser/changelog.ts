/**
 * Novidades de cada versão publicada, mostradas no aviso "Atualizado com sucesso".
 * Toda publicação (scripts/build-all.sh) acrescenta uma entrada no topo, com a mesma
 * versão do VERSION do build.
 */
export type ChangelogEntry = { version: string; date: string; items: string[] };

export const CHANGELOG: ChangelogEntry[] = [
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
