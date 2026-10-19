/**
 * Categorias das Configurações (agzos://configuracoes): nove categorias com subgrupos e o
 * "Sobre o Agzos" no rodapé da navegação. Puro (sem React) para os testes.
 *
 * Cada linha declara `category` e `group`. Uma linha nova sem categoria cai em
 * `categorize`, que pontua o nome e as palavras-chave da linha contra os dicionários abaixo
 * (sem acento, como a busca) e escolhe a melhor; sem nenhum acerto, vai para "Geral".
 */

export type CategoryId =
  | "geral"
  | "aparencia"
  | "privacidade"
  | "desempenho"
  | "ferramentas"
  | "ia"
  | "terminal"
  | "apps"
  | "atalhos"
  | "sobre";

/** Ids antigos das seções (4.5–4.9): quem abre as Configurações numa seção continua valendo. */
export type LegacySectionId =
  | "personalizacao"
  | "sons"
  | "pesquisa"
  | "gestos"
  | "terminal-avancado"
  | "extensoes"
  | "inicializacao"
  | "downloads"
  | "recursos"
  | "traducao"
  | "preenchimento";

export type SettingsSectionId = CategoryId | LegacySectionId;

export type SettingsGroup = {
  id: string;
  label: string;
  /** Palavras que puxam uma linha sem grupo para cá (sem acento, minúsculas). */
  keywords: string[];
};

export type SettingsCategory = {
  id: CategoryId;
  label: string;
  /** Vai separado, no rodapé da navegação. */
  footer?: boolean;
  /**
   * Palavras que puxam uma linha sem categoria para cá (sem acento, minúsculas): "+" na
   * frente é forte, "!" é o assunto da categoria (veja `score`).
   */
  keywords: string[];
  groups: SettingsGroup[];
};

export const CATEGORIES: SettingsCategory[] = [
  {
    id: "geral",
    label: "Geral",
    keywords: [
      "inicial",
      "iniciar",
      "ao abrir",
      "+sessao",
      "restaurar",
      "+pesquisa",
      "+buscador",
      "busca",
      "motor",
      "omnibox",
      "sugest",
      "+download",
      "baixar",
      "arquivo",
      "pasta",
      "idioma",
    ],
    groups: [
      {
        id: "inicializacao",
        label: "Inicialização",
        keywords: ["inicial", "iniciar", "ao abrir", "sessao", "restaurar", "reset"],
      },
      {
        id: "pesquisa",
        label: "Pesquisa",
        keywords: ["pesquisa", "buscador", "busca", "motor", "omnibox", "sugest", "autocomplet"],
      },
      {
        id: "downloads",
        label: "Downloads",
        keywords: ["download", "baixar", "arquivo", "pasta", "salvar", "gerenciador"],
      },
    ],
  },
  {
    id: "aparencia",
    label: "Aparência",
    keywords: [
      "+tema",
      "+escuro",
      "claro",
      "cor",
      "visual",
      "layout",
      "+barra",
      "vertical",
      "sonor",
      "favoritos",
      "+acento",
      "efeito",
      "blur",
      "translucid",
      "+papel de parede",
      "wallpaper",
      "fundo",
      "+som",
      "+sons",
      "+audio",
      "volume",
      "tick",
      "+aparencia",
      "fonte da interface",
    ],
    groups: [
      {
        id: "tema-layout",
        label: "Tema e layout",
        keywords: ["tema", "escuro", "claro", "layout", "barra", "vertical", "favoritos", "pip"],
      },
      {
        id: "personalizacao",
        label: "Personalização",
        keywords: ["cor", "acento", "efeito", "blur", "papel de parede", "wallpaper", "fundo"],
      },
      {
        id: "sons",
        label: "Sons",
        keywords: ["som", "sons", "sonor", "audio", "volume", "tick", "mudo"],
      },
    ],
  },
  {
    id: "privacidade",
    label: "Privacidade e segurança",
    keywords: [
      "+privacidade",
      "+seguranca",
      "bloque",
      "+anuncio",
      "+rastreador",
      "+adblock",
      "+escudo",
      "+cookie",
      "terceiros",
      "+permiss",
      "camera",
      "microfone",
      "localizacao",
      "notificac",
      "+historico",
      "limpar",
      "apagar",
      "dados",
      "senha",
      "!drm",
      "!widevine",
      "protegido",
      "https",
      "!preench",
      "+autofill",
      "+formulario",
    ],
    groups: [
      {
        id: "bloqueador",
        label: "Bloqueador",
        keywords: ["bloque", "anuncio", "rastreador", "adblock", "escudo", "cookie", "terceiros"],
      },
      {
        id: "permissoes",
        label: "Permissões dos sites",
        keywords: ["permiss", "camera", "microfone", "localizacao", "notificac"],
      },
      {
        id: "dados",
        label: "Dados de navegação",
        keywords: ["historico", "limpar", "apagar", "dados", "cache", "senha"],
      },
      {
        id: "preenchimento",
        label: "Preenchimento automático",
        keywords: [
          "preench",
          "autofill",
          "formulario",
          "perfil de preenchimento",
          "endereco",
          "cpf",
        ],
      },
      {
        id: "conteudo-protegido",
        label: "Conteúdo protegido",
        keywords: ["drm", "widevine", "protegido", "netflix", "spotify"],
      },
    ],
  },
  {
    id: "desempenho",
    label: "Desempenho",
    keywords: [
      "+desempenho",
      "+performance",
      "!gpu",
      "hardware",
      "+aceleracao",
      "+memoria",
      "+ram",
      "cpu",
      "+hibern",
      "economia",
      "bateria",
      "rapido",
      "lento",
    ],
    groups: [
      {
        id: "aceleracao",
        label: "Aceleração de hardware",
        keywords: ["gpu", "hardware", "aceleracao", "video", "decodificacao", "cpu"],
      },
      {
        id: "hibernacao",
        label: "Hibernação de guias",
        keywords: ["hibern", "memoria", "ram", "dormir", "economia", "minutos"],
      },
    ],
  },
  {
    id: "ferramentas",
    label: "Ferramentas",
    keywords: [
      "ferramenta",
      "!colortools",
      "conta-gotas",
      "paleta",
      "gradiente",
      "!pdf",
      "ocr",
      "!tema da pagina",
      "dark",
      "lightning",
      "!devtools",
      "desenvolvedor",
      "inspecionar",
      "console",
      "recurso",
      "!tradu",
      "idioma",
      "glossario",
    ],
    groups: [
      {
        id: "colortools",
        label: "ColorTools",
        keywords: ["colortools", "conta-gotas", "paleta", "gradiente", "hex", "rgb"],
      },
      { id: "pdf", label: "PDF Tools", keywords: ["pdf", "ocr", "comprimir"] },
      {
        id: "tema-pagina",
        label: "Tema da página",
        keywords: ["tema da pagina", "dark", "lightning", "site", "dominio"],
      },
      {
        id: "devtools",
        label: "DevTools",
        keywords: ["devtools", "desenvolvedor", "inspecionar", "console", "f12", "debug"],
      },
      {
        id: "traducao",
        label: "Tradução",
        keywords: ["tradu", "idioma", "lingua", "glossario", "bilingue"],
      },
    ],
  },
  {
    id: "ia",
    label: "Agzos AI",
    keywords: ["!agzos ai", "!groq", "modelo", "llama", "inteligencia artificial", "assistente"],
    groups: [
      {
        id: "ia-groq",
        label: "Chave Groq e modelo",
        keywords: ["groq", "modelo", "chave", "llama"],
      },
    ],
  },
  {
    id: "terminal",
    label: "Terminal",
    keywords: [
      "!terminal",
      "!shell",
      "console",
      "bash",
      "zsh",
      "powershell",
      "!ssh",
      "alias",
      "snippet",
      "comando",
      "cli",
      "voz",
      "variavel",
      "ambiente",
    ],
    groups: [
      {
        id: "terminal-basico",
        label: "Básico",
        keywords: ["shell", "pasta", "posicao", "tema", "fonte", "cor", "voz", "atalho", "cursor"],
      },
      {
        id: "terminal-automacao",
        label: "Automação",
        keywords: ["alias", "snippet", "comando", "ferramenta", "agente", "claude", "codex"],
      },
      {
        id: "terminal-chaves",
        label: "Chaves e SSH",
        keywords: ["chave", "api", "ssh", "servidor", "conexao", "variavel"],
      },
    ],
  },
  {
    id: "apps",
    label: "Apps e extensões",
    keywords: [
      "+app",
      "+apps",
      "!pwa",
      "instalar",
      "instalado",
      "desinstalar",
      "!extens",
      "plugin",
      "addon",
      "web store",
      "manifest",
    ],
    groups: [
      {
        id: "apps-pwa",
        label: "Apps instalados",
        keywords: ["app", "apps", "pwa", "instalar", "instalado", "desinstalar", "manifesto"],
      },
      {
        id: "extensoes",
        label: "Extensões",
        keywords: ["extens", "plugin", "addon", "web store", "manifest v"],
      },
    ],
  },
  {
    id: "atalhos",
    label: "Atalhos e gestos",
    keywords: [
      "+atalho",
      "tecla",
      "ctrl",
      "shift",
      "+gesto",
      "trackpad",
      "mouse",
      "arrastar",
      "deslizar",
      "pinca",
    ],
    groups: [
      {
        id: "atalhos-teclado",
        label: "Atalhos de teclado",
        keywords: ["atalho", "teclado", "tecla", "ctrl", "shift", "alt"],
      },
      {
        id: "gestos",
        label: "Gestos",
        keywords: ["gesto", "trackpad", "mouse", "arrastar", "deslizar", "pinca", "dedos"],
      },
    ],
  },
  {
    id: "sobre",
    label: "Sobre o Agzos",
    footer: true,
    keywords: [
      "+sobre",
      "+versao",
      "+atualiza",
      "novidades",
      "+biblioteca",
      "!historico e favoritos",
      "agzos browser",
    ],
    groups: [
      {
        id: "versao",
        label: "Versão e atualizações",
        keywords: ["sobre", "versao", "atualiza", "novidades"],
      },
      {
        id: "biblioteca",
        label: "Histórico e favoritos",
        keywords: ["biblioteca", "historico e favoritos"],
      },
    ],
  },
];

export const DEFAULT_CATEGORY: CategoryId = "geral";

/** Seções antigas → categoria nova (e o grupo, para rolar até ele). */
const LEGACY_SECTIONS: Record<LegacySectionId, { category: CategoryId; group?: string }> = {
  personalizacao: { category: "aparencia", group: "personalizacao" },
  sons: { category: "aparencia", group: "sons" },
  pesquisa: { category: "geral", group: "pesquisa" },
  gestos: { category: "atalhos", group: "gestos" },
  "terminal-avancado": { category: "terminal", group: "terminal-automacao" },
  extensoes: { category: "apps", group: "extensoes" },
  inicializacao: { category: "geral", group: "inicializacao" },
  downloads: { category: "geral", group: "downloads" },
  recursos: { category: "ferramentas" },
  traducao: { category: "ferramentas", group: "traducao" },
  preenchimento: { category: "privacidade", group: "preenchimento" },
};

export function resolveSection(id: SettingsSectionId): { category: CategoryId; group?: string } {
  if (id in LEGACY_SECTIONS) return LEGACY_SECTIONS[id as LegacySectionId];
  return CATEGORIES.some((item) => item.id === id)
    ? { category: id as CategoryId }
    : { category: DEFAULT_CATEGORY };
}

export const normalize = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export function categoryOf(id: CategoryId): SettingsCategory {
  return CATEGORIES.find((item) => item.id === id) ?? CATEGORIES[0]!;
}

export function groupOf(
  id: string,
): { category: SettingsCategory; group: SettingsGroup } | undefined {
  for (const category of CATEGORIES) {
    const group = category.groups.find((item) => item.id === id);
    if (group) return { category, group };
  }
  return undefined;
}

/**
 * Pontos de um texto contra um dicionário: cada palavra do dicionário que aparece no começo
 * de uma palavra do texto (ou a expressão inteira, quando tem espaço). O nome vale o dobro
 * das palavras-chave, porque diz do que a linha trata. Palavras com "+" são fortes (×10) e
 * com "!" dizem o assunto (×100: "terminal", "pdf"…), para "Atalhos do terminal" ir ao
 * Terminal e "Tema e cores do terminal" não cair em Aparência.
 */
function score(label: string, keywords: string, dictionary: string[]): number {
  const words = (text: string) =>
    normalize(text)
      .split(/[^a-z0-9+-]+/)
      .filter(Boolean);
  const labelWords = words(label);
  const keywordWords = words(keywords);
  const labelText = ` ${labelWords.join(" ")} `;
  const keywordText = ` ${keywordWords.join(" ")} `;
  let total = 0;
  for (const raw of dictionary) {
    const weight = raw.startsWith("!") ? 100 : raw.startsWith("+") ? 10 : 1;
    const entry = weight > 1 ? raw.slice(1) : raw;
    const phrase = entry.includes(" ");
    const hit = (text: string, list: string[]) =>
      phrase ? text.includes(` ${entry}`) : list.some((word) => word.startsWith(entry));
    if (hit(labelText, labelWords)) total += 2 * weight;
    else if (hit(keywordText, keywordWords)) total += weight;
  }
  return total;
}

export type Placeable = { label: string; keywords?: string; category?: CategoryId; group?: string };

/**
 * Onde a linha fica. A categoria e o grupo declarados valem; sem categoria, o melhor
 * placar (empate: a primeira na ordem da navegação, então a "Geral"); sem grupo (ou com um
 * grupo de outra categoria), o melhor grupo da categoria, ou o primeiro dela.
 */
export function categorize(row: Placeable): { category: CategoryId; group: string } {
  const keywords = row.keywords ?? "";
  let category = row.category ? categoryOf(row.category) : undefined;
  if (!category) {
    let best = 0;
    for (const item of CATEGORIES) {
      // Só o dicionário da categoria: o dos grupos tem palavras genéricas ("tema", "atalho"
      // no Terminal) que puxariam linhas de outras categorias.
      const points = score(row.label, keywords, item.keywords);
      if (points > best) {
        best = points;
        category = item;
      }
    }
    category ??= categoryOf(DEFAULT_CATEGORY);
  }
  const declared = row.group && category.groups.find((item) => item.id === row.group);
  if (declared) return { category: category.id, group: declared.id };
  let group = category.groups[0]!;
  let best = 0;
  for (const item of category.groups) {
    const points = score(row.label, keywords, item.keywords);
    if (points > best) {
      best = points;
      group = item;
    }
  }
  return { category: category.id, group: group.id };
}
