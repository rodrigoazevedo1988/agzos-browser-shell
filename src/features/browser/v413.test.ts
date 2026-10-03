import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  artifactKind,
  artifactsOf,
  parseInline,
  parseMarkdown,
  previewDocument,
} from "@/features/ai/markdown";
import { chatGroups } from "@/features/ai/model";

// 4.1.3: PWA instalável de verdade e Agzos AI no estilo do Claude Desktop.
const require = createRequire(import.meta.url);
const electronDir = path.join(process.cwd(), "electron");

type Message = { role: string; text: string; at: number; context?: object };
type Library = {
  projects: { id: string; name: string; archived: boolean }[];
  chats: {
    id: string;
    title: string;
    titled?: boolean;
    projectId: string | null;
    messages: Message[];
  }[];
  openIds: string[];
  activeId: string | null;
  persona: { instructions: string };
};
const lib = require(path.join(electronDir, "ai-library.cjs")) as {
  emptyLibrary: () => Library;
  parseLibrary: (value: unknown, legacy?: unknown) => Library;
  applyAction: (
    library: Library,
    action: object,
    deps: { newId: () => string; now: number },
  ) => { library: Library; id?: string };
  appendExchange: (library: Library, id: string, entries: Message[], now: number) => Library;
  summaryOf: (library: Library) => {
    chats: { id: string; title: string; count: number; messages?: unknown }[];
  };
  messagesOf: (library: Library, id: string | null) => Message[];
  titleOf: (text: string) => string;
};
const ai = require(path.join(electronDir, "ai.cjs")) as {
  PREFERRED_MODELS: string[];
  buildMessages: (
    history: object[],
    question: string,
    context: object | null,
    instructions?: string,
  ) => { role: string; content: string }[];
  createAi: (options: Record<string, unknown>) => {
    setKey(key: string): Promise<{ ok: boolean }>;
    chat(
      payload: object,
      onDelta: (delta: string) => void,
    ): Promise<{ ok: boolean; model?: string; chatId?: string | null }>;
    library(): Library & { chats: { id: string; title: string; projectId: string | null }[] };
    messages(id: string | null): Message[];
    libraryAction(action: object): { ok: boolean; id: string | null; library: Library };
  };
};

function ids() {
  let n = 0;
  return () => `id-${(n += 1)}`;
}

describe("conversas do Agzos AI (biblioteca)", () => {
  it("a conversa única da 4.0 vira a primeira conversa, aberta numa guia", () => {
    const library = lib.parseLibrary(null, [
      { role: "user", text: "Como funciona o cache HTTP?", at: 1 },
      { role: "assistant", text: "Assim…", at: 2 },
      { role: "system", text: "ignorada", at: 3 },
    ]);
    expect(library.chats).toHaveLength(1);
    expect(library.chats[0]).toMatchObject({ title: "Como funciona o cache HTTP?" });
    expect(library.chats[0]!.messages).toHaveLength(2);
    expect(library.openIds).toEqual([library.chats[0]!.id]);
    expect(library.activeId).toBe(library.chats[0]!.id);
    expect(lib.parseLibrary(null, null)).toEqual(lib.emptyLibrary());
  });

  it("nova conversa, título automático e editável, arquivar fecha a guia", () => {
    const newId = ids();
    const first = lib.applyAction(lib.emptyLibrary(), { type: "chat-new" }, { newId, now: 10 });
    let library = first.library;
    const id = first.id;
    expect(id).toBe("id-1");
    expect(library.openIds).toEqual(["id-1"]);
    expect(library.activeId).toBe("id-1");
    library = lib.appendExchange(
      library,
      "id-1",
      [
        {
          role: "user",
          text: "Explique em detalhes como funciona o garbage collector do V8 hoje",
          at: 11,
        },
        { role: "assistant", text: "Ok", at: 11 },
      ],
      11,
    );
    expect(library.chats[0]!.title).toBe(
      lib.titleOf("Explique em detalhes como funciona o garbage collector do V8 hoje"),
    );
    expect(String(library.chats[0]!.title).endsWith("…")).toBe(true);
    ({ library } = lib.applyAction(
      library,
      { type: "chat-update", id: "id-1", title: "  GC do V8\n" },
      { newId, now: 12 },
    ));
    expect(library.chats[0]).toMatchObject({ title: "GC do V8", titled: true });
    // Título dado pelo usuário não muda com a próxima pergunta.
    library = lib.appendExchange(
      library,
      "id-1",
      [{ role: "user", text: "e o Oilpan?", at: 13 }],
      13,
    );
    expect(library.chats[0]!.title).toBe("GC do V8");
    ({ library } = lib.applyAction(library, { type: "chat-new" }, { newId, now: 14 }));
    expect(library.openIds).toEqual(["id-1", "id-2"]);
    ({ library } = lib.applyAction(
      library,
      { type: "chat-update", id: "id-2", archived: true },
      { newId, now: 15 },
    ));
    expect(library.openIds).toEqual(["id-1"]);
    expect(library.activeId).toBe("id-1");
    ({ library } = lib.applyAction(
      library,
      { type: "chat-delete", id: "id-1" },
      { newId, now: 16 },
    ));
    expect(library.openIds).toEqual([]);
    expect(library.activeId).toBeNull();
    expect(library.chats.map((chat) => chat.id)).toEqual(["id-2"]);
  });

  it("projetos: criar, renomear, arquivar e mover conversa", () => {
    const newId = ids();
    const first = lib.applyAction(
      lib.emptyLibrary(),
      { type: "project-new", name: "Site novo" },
      { newId, now: 1 },
    );
    let library = first.library;
    const id = first.id;
    expect(id).toBe("id-1");
    expect(
      lib.applyAction(library, { type: "project-new", name: "   " }, { newId, now: 1 }).id,
    ).toBeUndefined();
    ({ library } = lib.applyAction(
      library,
      { type: "chat-new", projectId: "id-1" },
      { newId, now: 2 },
    ));
    expect(library.chats[0]!.projectId).toBe("id-1");
    ({ library } = lib.applyAction(
      library,
      { type: "chat-new", projectId: "nao-existe" },
      { newId, now: 3 },
    ));
    expect(library.chats[1]!.projectId).toBeNull();
    ({ library } = lib.applyAction(
      library,
      { type: "chat-update", id: library.chats[1]!.id, projectId: "id-1" },
      { newId, now: 4 },
    ));
    expect(library.chats[1]!.projectId).toBe("id-1");
    ({ library } = lib.applyAction(
      library,
      { type: "project-update", id: "id-1", name: "Site 2", archived: true },
      { newId, now: 5 },
    ));
    expect(library.projects[0]).toMatchObject({ name: "Site 2", archived: true });
  });

  it("guias e personalização validadas; a lista para a casca vem sem mensagens", () => {
    const newId = ids();
    let { library } = lib.applyAction(lib.emptyLibrary(), { type: "chat-new" }, { newId, now: 1 });
    ({ library } = lib.applyAction(
      library,
      { type: "tabs", openIds: ["id-1", "x", "id-1"], activeId: null },
      { newId, now: 2 },
    ));
    expect(library.openIds).toEqual(["id-1"]);
    expect(library.activeId).toBeNull();
    ({ library } = lib.applyAction(
      library,
      { type: "persona", instructions: "a".repeat(9000) },
      { newId, now: 3 },
    ));
    expect(library.persona.instructions).toHaveLength(4000);
    const summary = lib.summaryOf(library);
    expect(summary.chats[0]).toMatchObject({ id: "id-1", count: 0 });
    expect(summary.chats[0]).not.toHaveProperty("messages");
    // Lixo salvo não derruba nada.
    expect(
      lib.parseLibrary({ chats: [{ id: "../x" }, 3], projects: "x", openIds: ["nada"] }),
    ).toEqual(lib.emptyLibrary());
  });

  it("chat cria a conversa na primeira resposta e usa a personalização", async () => {
    const meta = new Map<string, unknown>();
    const bodies: string[] = [];
    const service = ai.createAi({
      userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), "agzos-v413-")),
      safeStorage: {
        isEncryptionAvailable: () => true,
        encryptString: (text: string) => Buffer.from(text, "utf8").reverse(),
        decryptString: (buffer: Buffer) => Buffer.from(buffer).reverse().toString("utf8"),
      },
      database: {
        getMeta: (key: string) => meta.get(key) ?? null,
        setMeta: (key: string, value: unknown) => void meta.set(key, value),
      },
      fetch: async (url: string, init: RequestInit = {}) => {
        if (url.endsWith("/models"))
          return Response.json({
            data: [{ id: "openai/gpt-oss-120b" }, { id: "llama-3.3-70b-versatile" }],
          });
        bodies.push(String(init.body));
        return new Response('data: {"choices":[{"delta":{"content":"oi"}}]}\n\ndata: [DONE]\n\n');
      },
    });
    await service.setKey("gsk_test_0123456789abcdefghijklmnop");
    const project = service.libraryAction({ type: "project-new", name: "Trabalho" });
    service.libraryAction({ type: "persona", instructions: "Responda em tópicos." });
    const first = await service.chat(
      {
        requestId: "1",
        chatId: null,
        projectId: project.id,
        model: null,
        text: "Olá",
        context: null,
      },
      () => {},
    );
    expect(first).toMatchObject({ ok: true, model: "openai/gpt-oss-120b" });
    const chatId = first.chatId as string;
    expect(service.library().chats[0]).toMatchObject({
      id: chatId,
      title: "Olá",
      projectId: project.id,
    });
    expect(service.library().activeId).toBe(chatId);
    expect(JSON.parse(bodies[0]!).messages[0].content).toContain("Responda em tópicos.");
    // Outra conversa não leva as mensagens da primeira.
    const second = await service.chat(
      { requestId: "2", chatId: null, model: null, text: "Novo assunto", context: null },
      () => {},
    );
    expect(second.chatId).not.toBe(chatId);
    expect(JSON.parse(bodies[1]!).messages).toHaveLength(2);
    expect(service.messages(chatId)).toHaveLength(2);
    expect(meta.has("aiChats")).toBe(true);
  });

  it("Automático prefere o gpt oss 120b", () => {
    expect(ai.PREFERRED_MODELS[0]).toBe("openai/gpt-oss-120b");
    const messages = ai.buildMessages([], "oi", null, "");
    expect(messages[0]!.content).not.toContain("personalização");
  });
});

describe("markdown das respostas", () => {
  it("títulos, listas, citação, tabela e código", () => {
    const blocks = parseMarkdown(
      [
        "# Título",
        "Texto com **negrito**, *itálico* e `código`.",
        "",
        "- um",
        "- dois",
        "  continua",
        "",
        "1. primeiro",
        "2. segundo",
        "",
        "> citação",
        "",
        "| a | b |",
        "|---|---|",
        "| 1 | 2 |",
        "",
        "```ts",
        "const a = 1;",
        "```",
        "---",
      ].join("\n"),
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
      "quote",
      "table",
      "code",
      "rule",
    ]);
    expect(blocks[2]).toMatchObject({ ordered: false });
    expect((blocks[2] as { items: unknown[] }).items).toHaveLength(2);
    expect(blocks[3]).toMatchObject({ ordered: true, start: 1 });
    expect(blocks[6]).toMatchObject({ lang: "ts", text: "const a = 1;", open: false });
  });

  it("bloco de código aberto (streaming) vale até o fim", () => {
    expect(parseMarkdown("Veja:\n```py\nprint(1)")).toEqual([
      { kind: "paragraph", children: [{ kind: "text", text: "Veja:" }] },
      { kind: "code", lang: "py", text: "print(1)", open: true },
    ]);
  });

  it("links só da web; javascript: vira texto", () => {
    expect(parseInline("[ok](https://a.com) e [x](javascript:void0)")).toEqual([
      { kind: "link", href: "https://a.com", children: [{ kind: "text", text: "ok" }] },
      { kind: "text", text: " e " },
      { kind: "text", text: "x" },
    ]);
    expect(parseInline("veja https://b.com/x.")[1]).toMatchObject({
      kind: "link",
      href: "https://b.com/x",
    });
  });

  it("artifacts: HTML, SVG e código longo; prévia do SVG sem script", () => {
    const messages = [
      { role: "user", text: "```html\n<p>não é artifact (pergunta)</p>\n```", at: 1 },
      {
        role: "assistant",
        text: "```html\n<!doctype html><title>Demo</title>\n```\n```svg\n<svg></svg>\n```\n```js\nshort()\n```\n```js\na()\nb()\nc()\nd()\n```",
        at: 2,
      },
    ];
    const list = artifactsOf(messages);
    expect(list.map((item) => [item.kind, item.title])).toEqual([
      ["html", "Demo"],
      ["svg", "Imagem SVG"],
      ["code", "JS · a()"],
    ]);
    expect(list[0]!.id).toBe("2-1-0");
    expect(list[2]!.id).toBe("2-1-3");
    expect(artifactKind("", "<svg viewBox='0 0 1 1'></svg>")).toBe("svg");
    expect(previewDocument(list[1]!)).toContain("default-src 'none'");
  });
});

describe("barra lateral do Agzos AI", () => {
  it("agrupa por data, busca sem acento e filtra projeto e arquivadas", () => {
    const now = new Date(2026, 9, 3, 15).getTime();
    const day = 86_400_000;
    const chats = [
      {
        id: "a",
        title: "Ação no servidor",
        projectId: "p",
        archived: false,
        updatedAt: now - 1000,
      },
      { id: "b", title: "Ontem", projectId: null, archived: false, updatedAt: now - day },
      { id: "c", title: "Semana", projectId: null, archived: false, updatedAt: now - 3 * day },
      { id: "d", title: "Velha", projectId: null, archived: false, updatedAt: now - 40 * day },
      { id: "e", title: "Guardada", projectId: null, archived: true, updatedAt: now },
    ];
    expect(
      chatGroups(chats, { now }).map((group) => [group.label, group.chats.map((c) => c.id)]),
    ).toEqual([
      ["Hoje", ["a"]],
      ["Ontem", ["b"]],
      ["Últimos 7 dias", ["c"]],
      ["Mais antigas", ["d"]],
    ]);
    expect(chatGroups(chats, { now, search: "acao" })[0]!.chats.map((c) => c.id)).toEqual(["a"]);
    expect(
      chatGroups(chats, { now, projectId: "p" }).flatMap((g) => g.chats.map((c) => c.id)),
    ).toEqual(["a"]);
    expect(chatGroups(chats, { now, archived: true })).toEqual([
      { label: "Arquivadas", chats: [chats[4]] },
    ]);
  });
});

describe("PWA 4.1.3", () => {
  const main = fs.readFileSync(path.join(electronDir, "main.cjs"), "utf8");
  const preload = fs.readFileSync(path.join(electronDir, "page-preload.cjs"), "utf8");

  it("lê o manifesto pelo Chromium, observa o <link> e verifica na hora", () => {
    expect(main).toContain('sendCommand("Page.getAppManifest")');
    expect(main).toContain('ipcMain.handle("pwa:check"');
    expect(preload).toContain("MutationObserver");
    expect(preload).toContain('link[rel~="manifest"]');
  });

  it("o main empacotado leva a biblioteca de conversas", () => {
    const build = fs.readFileSync(path.join(process.cwd(), "scripts", "build-all.sh"), "utf8");
    expect(build).toMatch(/ELECTRON_FILES=\([^)]*\bai-library\.cjs\b/);
  });

  it("microfone só para o quadro principal da casca (prévia de artifact não)", () => {
    expect(main).toContain("details?.isMainFrame === false");
  });
});
