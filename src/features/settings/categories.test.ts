import { describe, expect, it } from "vitest";

import { defaultPrefs } from "@/features/browser/store/state";
import { CATEGORIES, categorize, resolveSection, type CategoryId } from "./categories";
import { buildSettingsRows, type SettingsPageProps } from "./page";

const noop = () => {};

function props(desktop: boolean): SettingsPageProps {
  return {
    prefs: defaultPrefs,
    setPrefs: noop,
    onUnpauseHost: noop,
    desktop,
    isMac: false,
    permissions: desktop ? [] : null,
    onPermissionChange: noop,
    update: desktop ? { status: "idle", currentVersion: "4.9.6" } : null,
    onCheckUpdate: noop,
    onInstallUpdate: noop,
    appVersion: "4.9.6",
    onShowWhatsNew: null,
    downloadsDir: null,
    onOpenDownloadsDir: null,
    onOpenHistory: noop,
    onOpenBookmarks: noop,
    onReset: noop,
  } as SettingsPageProps;
}

/** Onde cada linha de hoje tem que ficar: categoria/grupo. */
const EXPECTED: Record<string, `${CategoryId}/${string}`> = {
  abrir: "geral/inicializacao",
  restaurar: "geral/inicializacao",
  motor: "geral/pesquisa",
  sugestoes: "geral/pesquisa",
  pasta: "geral/downloads",
  "recurso-downloads": "geral/downloads",
  tema: "aparencia/tema-layout",
  "guias-verticais": "aparencia/tema-layout",
  "barra-favoritos": "aparencia/tema-layout",
  sidebar: "aparencia/tema-layout",
  ai: "aparencia/tema-layout",
  "janela-de-video": "aparencia/tema-layout",
  "cor-acento": "aparencia/personalizacao",
  "ui-blur": "aparencia/personalizacao",
  "papel-parede": "aparencia/personalizacao",
  "sons-geral": "aparencia/sons",
  "sons-hover": "aparencia/sons",
  "sons-teclado": "aparencia/sons",
  "sons-tick": "aparencia/sons",
  "sons-volume": "aparencia/sons",
  escudo: "privacidade/bloqueador",
  "sites-pausados": "privacidade/bloqueador",
  permissoes: "privacidade/permissoes",
  limpar: "privacidade/dados",
  widevine: "privacidade/conteudo-protegido",
  gpu: "desempenho/aceleracao",
  hibernar: "desempenho/hibernacao",
  "hibernar-tempo": "desempenho/hibernacao",
  "recurso-cores": "ferramentas/colortools",
  "recurso-pdf": "ferramentas/pdf",
  "recurso-tema": "ferramentas/tema-pagina",
  "recurso-devtools": "ferramentas/devtools",
  "recurso-traducao": "ferramentas/traducao",
  "preenchimento-formularios": "privacidade/preenchimento",
  "ia-chave": "ia/ia-groq",
  "terminal-shell": "terminal/terminal-basico",
  "terminal-pasta": "terminal/terminal-basico",
  "terminal-posicao": "terminal/terminal-basico",
  "terminal-tema": "terminal/terminal-basico",
  "terminal-fonte": "terminal/terminal-basico",
  "terminal-voz": "terminal/terminal-basico",
  "terminal-atalhos": "terminal/terminal-basico",
  "terminal-aliases": "terminal/terminal-automacao",
  "terminal-comandos": "terminal/terminal-automacao",
  "terminal-ferramentas": "terminal/terminal-automacao",
  "terminal-chaves-api": "terminal/terminal-chaves",
  "terminal-ssh-chaves": "terminal/terminal-chaves",
  "terminal-ssh": "terminal/terminal-chaves",
  "apps-pwa": "apps/apps-pwa",
  "extensoes-lista": "apps/extensoes",
  "atalhos-ferramentas": "atalhos/atalhos-teclado",
  versao: "sobre/versao",
  atualizacoes: "sobre/versao",
  biblioteca: "sobre/biblioteca",
};

const expectedOf = (id: string) =>
  EXPECTED[id] ??
  (id.startsWith("atalho-")
    ? "atalhos/atalhos-teclado"
    : id.startsWith("gesto-")
      ? "atalhos/gestos"
      : undefined);

describe("Configurações: categorias", () => {
  const desktopRows = buildSettingsRows(props(true));
  const webRows = buildSettingsRows(props(false));

  it("cada linha de hoje fica na categoria e no grupo esperados", () => {
    for (const row of desktopRows) {
      const at = categorize(row);
      expect(`${at.category}/${at.group}`, row.id).toBe(expectedOf(row.id));
    }
    // Nenhuma linha esperada sumiu.
    const ids = new Set(desktopRows.map((row) => row.id));
    for (const id of Object.keys(EXPECTED)) expect(ids.has(id), id).toBe(true);
  });

  it("toda linha declara categoria e grupo existentes", () => {
    for (const row of [...desktopRows, ...webRows]) {
      expect(row.category, row.id).toBeDefined();
      const category = CATEGORIES.find((item) => item.id === row.category);
      expect(category, row.id).toBeDefined();
      expect(
        category!.groups.some((group) => group.id === row.group),
        row.id,
      ).toBe(true);
    }
  });

  it("na web ficam de fora o terminal, os apps e o que só existe no app", () => {
    const categories = new Set(webRows.map((row) => row.category));
    expect(categories.has("terminal")).toBe(false);
    expect(categories.has("apps")).toBe(false);
    const ids = new Set(webRows.map((row) => row.id));
    for (const id of ["gpu", "pasta", "widevine", "permissoes", "atualizacoes"]) {
      expect(ids.has(id), id).toBe(false);
    }
    expect(ids.has("recurso-downloads")).toBe(true);
  });

  it("sem categoria declarada, o dicionário acerta as linhas de hoje", () => {
    // Ficam só com o que declaram: "Agzos AI visível" é um botão do layout (pelo nome iria ao
    // Agzos AI), "Atalhos das ferramentas" liga as duas categorias de propósito, e os atalhos
    // do registro de comandos têm o nome do comando ("Abrir DevTools", "Histórico").
    const declaredOnly = (id: string) =>
      id === "ai" || id === "atalhos-ferramentas" || id.startsWith("atalho-");
    const wrong = desktopRows
      .filter((row) => !declaredOnly(row.id))
      .map((row) => {
        const at = categorize({
          label: row.label,
          ...(row.keywords ? { keywords: row.keywords } : {}),
        });
        return { id: row.id, got: at.category, want: expectedOf(row.id)!.split("/")[0] };
      })
      .filter((item) => item.got !== item.want);
    expect(wrong).toEqual([]);
  });

  it("linhas novas caem num lugar que faz sentido", () => {
    const cases: [string, string | undefined, `${CategoryId}/${string}`][] = [
      ["Bloquear cookies de terceiros", undefined, "privacidade/bloqueador"],
      ["Tamanho da fonte do terminal", undefined, "terminal/terminal-basico"],
      ["Atalho para abrir notas", undefined, "atalhos/atalhos-teclado"],
      ["Perguntar onde salvar cada download", undefined, "geral/downloads"],
      ["Volume dos efeitos sonoros", undefined, "aparencia/sons"],
      ["Limite de memória por guia", "ram", "desempenho/hibernacao"],
      ["Gesto de três dedos", undefined, "atalhos/gestos"],
      ["Atualizar extensões sozinho", undefined, "apps/extensoes"],
      ["Exportar paleta do ColorTools", undefined, "ferramentas/colortools"],
      ["Algo sem nenhuma pista", undefined, "geral/inicializacao"],
    ];
    const wrong = cases
      .map(([label, keywords, want]) => {
        const at = categorize({ label, ...(keywords ? { keywords } : {}) });
        return { label, got: `${at.category}/${at.group}`, want };
      })
      .filter((item) => item.got !== item.want);
    expect(wrong).toEqual([]);
  });

  it("categoria declarada sem grupo escolhe o grupo pelo nome", () => {
    expect(categorize({ label: "Conexões SSH salvas", category: "terminal" })).toEqual({
      category: "terminal",
      group: "terminal-chaves",
    });
    // Grupo de outra categoria não vale: cai no melhor grupo da declarada.
    expect(categorize({ label: "Sons", category: "aparencia", group: "pdf" }).group).toBe("sons");
  });

  it("seções antigas abrem a categoria nova (e o grupo)", () => {
    expect(resolveSection("terminal-avancado")).toEqual({
      category: "terminal",
      group: "terminal-automacao",
    });
    expect(resolveSection("recursos").category).toBe("ferramentas");
    expect(resolveSection("pesquisa")).toEqual({ category: "geral", group: "pesquisa" });
    expect(resolveSection("sons")).toEqual({ category: "aparencia", group: "sons" });
    expect(resolveSection("extensoes")).toEqual({ category: "apps", group: "extensoes" });
    expect(resolveSection("apps").category).toBe("apps");
    expect(resolveSection("downloads")).toEqual({ category: "geral", group: "downloads" });
    expect(resolveSection("gestos")).toEqual({ category: "atalhos", group: "gestos" });
    expect(resolveSection("ia").category).toBe("ia");
    expect(resolveSection("sobre").category).toBe("sobre");
  });
});
