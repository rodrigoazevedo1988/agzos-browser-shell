import { hashString, seededRandom } from "@/lib/seeded";
import { hostOf } from "@/features/browser/store/selectors";

export type AiProfile = {
  host: string | null;
  contextLine: string;
  summary: { headline: string; body: string; bullets: string[] };
  explain: { headline: string; body: string; insight: string };
  reputation: { score: number; verdict: string; note: string };
  faq: { q: string; a: string }[];
  replies: string[];
};

function reputationOf(host: string) {
  const score = 62 + (hashString(`reputacao:${host}`) % 38);
  const verdict =
    score >= 90 ? "Reputação alta" : score >= 75 ? "Reputação confiável" : "Reputação regular";
  return { score, verdict };
}

function profileForCategory(category: string, host: string | null, title: string): AiProfile {
  const hostLabel = host ?? "esta página";
  const reputation =
    host !== null
      ? { ...reputationOf(host), note: reputationNotes[category] ?? reputationNotes["web"]! }
      : {
          score: 100,
          verdict: "Ambiente local",
          note: "A página inicial do Agzos roda no seu dispositivo.",
        };

  const base: Omit<AiProfile, "contextLine" | "summary" | "explain" | "faq" | "replies"> = {
    host,
    reputation,
  };

  switch (category) {
    case "dev":
      return {
        ...base,
        contextLine: `Contexto técnico · ${hostLabel}`,
        summary: {
          headline: "Resumo técnico da página",
          body: `Analisei "${title}" em ${hostLabel}. O conteúdo é voltado para desenvolvimento de software, com foco em código, versões e documentação.`,
          bullets: [
            "Histórico de commits e releases com notas de versão",
            "Instruções de instalação e exemplos de uso em código",
            "Issues e discussões da comunidade de desenvolvedores",
            "Licenças e mantenedores do projeto",
          ],
        },
        explain: {
          headline: "O que esta página apresenta?",
          body: "É uma página de plataforma de desenvolvimento: combina código-fonte, issues, pull requests e documentação. A estrutura prioriza navegação rápida entre arquivos e versões.",
          insight:
            "Análise gerada localmente por templates — nenhum conteúdo saiu do seu dispositivo.",
        },
        faq: [
          {
            q: "Este site rastreia meus dados?",
            a: "Plataformas de desenvolvimento usam poucos rastreadores de marketing, mas coletam telemetria de uso. O escudo Agzos bloqueou as tentativas listadas no painel de privacidade.",
          },
          {
            q: "Posso confiar no conteúdo?",
            a: `A reputação simulada de ${hostLabel} é ${reputation.score}/100. Verifique licenças e mantenedores antes de adotar qualquer código.`,
          },
          {
            q: "Como resumir rapidamente?",
            a: 'Use a ação "Resumir tópicos": o resumo é montado por templates locais a partir do contexto do site.',
          },
        ],
        replies: [
          `Sobre "${title}": no modo demonstração monto a resposta com templates locais — em breve a Agzos AI usará um modelo real.`,
          `Entendi. Em "${title}" posso detalhar commits, releases ou documentação — o que preferir.`,
          `Boa pergunta. Nesta fase a resposta é simulada com foco no contexto de ${hostLabel}.`,
        ],
      };
    case "design":
      return {
        ...base,
        contextLine: `Contexto de design · ${hostLabel}`,
        summary: {
          headline: "Resumo da página de design",
          body: `"${title}" em ${hostLabel} trata de interfaces, protótipos ou referências visuais. O conteúdo prioriza elementos gráficos e colaboração.`,
          bullets: [
            "Arquivos e protótipos compartilhados com a equipe",
            "Paletas, componentes e estilos reutilizáveis",
            "Comentários e versões de revisão",
          ],
        },
        explain: {
          headline: "O que há aqui?",
          body: "Ferramentas de design concentram canvas editável, bibliotecas de componentes e fluxo de aprovação. É comum a página exigir login para exibir tudo.",
          insight: "O resumo considera apenas o domínio e o título da aba nesta fase.",
        },
        faq: [
          {
            q: "Este site carrega bem em iframe?",
            a: `Ferramentas de design costumam bloquear embed por segurança. No aplicativo Agzos para computador a página abre dentro da aba.`,
          },
          {
            q: "Qual a reputação do site?",
            a: `${hostLabel}: ${reputation.score}/100 — ${reputation.verdict}. ${reputation.note}`,
          },
        ],
        replies: [
          `Sobre "${title}": posso destacar fluxos, componentes e revisões — dentro do que os templates locais conseguem inferir.`,
          `Pergunta registrada. Para "${title}" a resposta é simulada com contexto de design de ${hostLabel}.`,
        ],
      };
    case "docs":
      return {
        ...base,
        contextLine: `Contexto de documentação · ${hostLabel}`,
        summary: {
          headline: "Resumo da documentação",
          body: `"${title}" em ${hostLabel} é conteúdo de referência ou guia. A página organiza informações em seções navegáveis e exemplos.`,
          bullets: [
            "Guias passo a passo com pré-requisitos",
            "Referência de API e parâmetros",
            "Exemplos prontos para copiar",
          ],
        },
        explain: {
          headline: "Como usar esta página?",
          body: "Documentações funcionam melhor pela busca interna e pelo índice lateral. Seções de exemplos costumam trazer código atualizado com a versão estável.",
          insight: "Nenhum dado da página é enviado para servidores nesta demonstração.",
        },
        faq: [
          {
            q: "O conteúdo está atualizado?",
            a: `Não consigo verificar a data de publicação nesta fase. A reputação simulada de ${hostLabel} é ${reputation.score}/100.`,
          },
          {
            q: "Como salvar esta referência?",
            a: "Use a estrela na omnibox para favoritar e acessar depois pela start page.",
          },
        ],
        replies: [
          `Sobre "${title}": nesta fase respondo com templates locais — consulte a seção de exemplos da própria página para o código mais novo.`,
          `Entendi. "${title}" parece documentação; posso apontar tópicos comuns como instalação, API e exemplos.`,
        ],
      };
    case "search":
      return {
        ...base,
        contextLine: `Contexto de busca · ${hostLabel}`,
        summary: {
          headline: "Resumo da busca",
          body: `Você está em ${hostLabel} com resultados para "${title}". O motor foi selecionado nas configurações e a busca não é compartilhada com o Agzos.`,
          bullets: [
            "Resultados ordenados pelo motor escolhido",
            "O escudo bloqueou rastreadores de anúncios da página",
            "A consulta existe apenas nesta aba",
          ],
        },
        explain: {
          headline: "Como a busca funciona aqui?",
          body: "A omnibox decide entre URL e busca pelo padrão do texto. O motor ativo é persistido localmente e pode ser trocado nas configurações.",
          insight: "DuckDuckGo minimiza rastreamento; Yandex é a alternativa configurável.",
        },
        faq: [
          {
            q: "Meus termos de busca são armazenados?",
            a: "Só o histórico da aba, salvo no seu dispositivo. Nada é enviado a servidores do Agzos.",
          },
          {
            q: "Como trocar o motor?",
            a: "Painel ··· → Motor de busca. A preferência sobrevive ao refresh.",
          },
        ],
        replies: [
          `Sobre a busca em "${title}": nesta fase a resposta é simulada; a navegação real acontece no motor escolhido.`,
          `Entendi. A consulta "${title}" ficou apenas nesta aba e no seu dispositivo.`,
        ],
      };
    case "video":
      return {
        ...base,
        contextLine: `Contexto de mídia · ${hostLabel}`,
        summary: {
          headline: "Resumo da página de vídeo",
          body: `"${title}" em ${hostLabel} é conteúdo de mídia com player incorporado, recomendações e comentários.`,
          bullets: [
            "Player com fila e recomendações algorítmicas",
            "Comentários e curtidas da comunidade",
            "Anúncios frequentes — o escudo bloqueou parte",
          ],
        },
        explain: {
          headline: "Por que alguns vídeos não abrem aqui?",
          body: 'Plataformas de vídeo bloqueiam embed fora do próprio domínio. No Electron a página carrega direto na aba; na web, use "Abrir em nova janela".',
          insight: "Rastreadores de mídia estão entre os mais agressivos da web.",
        },
        faq: [
          {
            q: "O vídeo carrega na preview web?",
            a: `Depende da política de embed de ${hostLabel}. Reputação simulada: ${reputation.score}/100.`,
          },
          {
            q: "Quantos rastreadores aqui?",
            a: "Confira o painel do escudo — mídia costuma liderar em anúncios e métricas.",
          },
        ],
        replies: [
          `Sobre "${title}": nesta fase a resposta é simulada; a reprodução real acontece no player da página.`,
          `Entendi. Mídia em ${hostLabel} mistura player, anúncios e recomendação — posso detalhar o que o escudo bloqueou.`,
        ],
      };
    case "social":
      return {
        ...base,
        contextLine: `Contexto social · ${hostLabel}`,
        summary: {
          headline: "Resumo da rede social",
          body: `"${title}" em ${hostLabel} é um feed social: publicações, interações e perfis. Redes deste tipo concentram muitos rastreadores de terceiros.`,
          bullets: [
            "Feed ordenado por algoritmo de engajamento",
            "Botões de compartilhamento que rastreiam outros sites",
            "Login obrigatório para a maior parte do conteúdo",
          ],
        },
        explain: {
          headline: "Atenção à privacidade",
          body: `Redes sociais registram navegação, cliques e tempo de sessão. A reputação simulada de ${hostLabel} é ${reputation.score}/100 — use o escudo e o modo anônimo quando necessário.`,
          insight: "O modo anônimo do Agzos não grava histórico no dispositivo.",
        },
        faq: [
          {
            q: "Devo usar aba anônima aqui?",
            a: "Se quiser navegar sem deixar histórico no dispositivo, sim. O escudo continua ativo nas abas anônimas.",
          },
          {
            q: "Qual a reputação do site?",
            a: `${hostLabel}: ${reputation.score}/100 — ${reputation.verdict}. ${reputation.note}`,
          },
        ],
        replies: [
          `Sobre "${title}": redes sociais exigem cautela com dados — o escudo bloqueou as tentativas listadas no painel.`,
          `Entendi. Para ${hostLabel} a resposta é simulada, mas a dica vale: confira o painel de privacidade.`,
        ],
      };
    case "product":
      return {
        ...base,
        contextLine: "Contexto: página inicial do Agzos",
        summary: {
          headline: "Seu espaço de navegação, organizado.",
          body: "A página inicial reúne seus acessos mais usados e mantém as proteções de privacidade visíveis sem interromper o fluxo.",
          bullets: [
            "Acesso rápido aos sites frequentes",
            "Cofre Agzos Key disponível em um clique",
            "Escudo de privacidade ativo por padrão",
          ],
        },
        explain: {
          headline: "Como a proteção funciona?",
          body: "O indicador na barra mostra quantas tentativas de rastreamento foram interrompidas durante sua sessão. O cofre e a IA funcionam localmente.",
          insight: "Tudo acontece localmente nesta demonstração — nenhum dado é enviado.",
        },
        faq: [
          {
            q: "A IA envia minha navegação para a nuvem?",
            a: "Não. Nesta fase todo o processamento é local e mockado — os textos saem de templates no seu dispositivo.",
          },
          {
            q: "Onde ficam minhas credenciais?",
            a: "No Agzos Key, persistidas apenas neste dispositivo via localStorage.",
          },
          {
            q: "Como abrir uma aba anônima?",
            a: "Clique no ícone de máscara na barra de abas: a aba não grava histórico.",
          },
        ],
        replies: [
          "Esta é a start page do Agzos: atalhos, busca e proteções em um só lugar. Posso explicar qualquer recurso.",
          "Boa pergunta. Tudo aqui roda localmente — cofre, escudo e IA de demonstração.",
        ],
      };
    default:
      return {
        ...base,
        contextLine: `Contexto web · ${hostLabel}`,
        summary: {
          headline: `Resumo de "${title}"`,
          body: `Página de ${hostLabel} sobre "${title}". Classifiquei o domínio automaticamente e o resumo abaixo usa templates locais.`,
          bullets: [
            "Título e estrutura lidos da aba atual",
            "Domínio classificado como site geral",
            "Nenhum dado enviado para servidores externos",
          ],
        },
        explain: {
          headline: "O que a Agzos AI vê aqui?",
          body: "Nesta fase a IA analisa apenas o domínio e o título da aba. Fase 3 trará leitura real do conteúdo da página via WebContentsView.",
          insight: "Templates por categoria de host — sem chamadas de rede.",
        },
        faq: [
          {
            q: "Este site é confiável?",
            a: `Reputação simulada de ${hostLabel}: ${reputation.score}/100 — ${reputation.verdict}. ${reputation.note}`,
          },
          {
            q: "Quantos rastreadores nesta página?",
            a: "Abra o selo do escudo na toolbar: a lista mostra os hosts bloqueados nesta página.",
          },
        ],
        replies: [
          `Sobre "${title}": nesta fase a resposta é gerada por templates locais — sem modelo de linguagem ainda.`,
          `Entendi. Analisei o contexto de ${hostLabel} e respondo com o que os templates conseguem inferir.`,
          `Pergunta registrada sobre "${title}". O escudo segue ativo nesta página.`,
        ],
      };
  }
}

const reputationNotes: Record<string, string> = {
  dev: "Plataformas de código tendem a ter boa reputação de privacidade.",
  design: "Ferramentas de design coletam telemetria moderada de uso.",
  docs: "Sites de documentação costumam ser leves em rastreamento.",
  search: "Motores de busca registram consultas; DuckDuckGo minimiza isso.",
  video: "Plataformas de mídia concentram rastreadores de anúncios.",
  social: "Redes sociais têm o maior volume de rastreadores de terceiros.",
  product: "Página local do navegador — sem rastreadores reais.",
  web: "Classificação simulada com base apenas no domínio.",
};

const categoryHosts: Record<string, string[]> = {
  dev: ["github.com", "gitlab.com", "stackoverflow.com", "npmjs.com", "linear.app", "vercel.com"],
  design: ["figma.com", "dribbble.com", "behance.net", "unsplash.com"],
  docs: ["developer.mozilla.org", "notion.so", "wikipedia.org", "medium.com"],
  search: ["duckduckgo.com", "yandex.com", "google.com", "bing.com"],
  video: ["youtube.com", "vimeo.com", "twitch.tv"],
  social: ["x.com", "twitter.com", "instagram.com", "linkedin.com", "reddit.com", "facebook.com"],
};

function categoryOf(host: string | null) {
  if (host === null) return "product";
  for (const [category, hosts] of Object.entries(categoryHosts)) {
    if (hosts.some((item) => host === item || host.endsWith(`.${item}`))) return category;
  }
  return "web";
}

export function profileFor(url: string, title: string): AiProfile {
  const host = hostOf(url);
  return profileForCategory(categoryOf(host), host, title);
}

export function replyFor(text: string, profile: AiProfile): string {
  const hostLabel = profile.host ?? "esta página";
  if (/tópico|resum/i.test(text)) {
    return [
      "Tópicos principais desta página:",
      ...profile.summary.bullets.map((item) => `• ${item}`),
    ].join("\n");
  }
  if (/reputa/i.test(text)) {
    return `Reputação de ${hostLabel}: ${profile.reputation.score}/100 — ${profile.reputation.verdict}. ${profile.reputation.note}`;
  }
  if (/pergunta|faq/i.test(text)) {
    return profile.faq.map((item) => `${item.q}\n→ ${item.a}`).join("\n\n");
  }
  const random = seededRandom(hashString(text + hostLabel));
  const index = Math.floor(random() * profile.replies.length);
  return profile.replies[index] ?? profile.replies[0]!;
}
