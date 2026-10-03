import type { AiError, AiHistoryItem } from "@/features/browser/desktop";

/** Mensagem na tela: o histórico salvo mais a resposta que ainda está chegando. */
export type AiMessage = AiHistoryItem & { streaming?: boolean };

/** Texto de cada erro da IA (a chave nunca aparece em mensagem nenhuma). */
export function aiErrorText(error: AiError, retryAfter?: number | null): string {
  switch (error) {
    case "no-key":
      return "Informe a chave da API Groq para começar.";
    case "invalid-key":
      return "A Groq recusou a chave. Confira a chave ou troque por outra.";
    case "insecure":
      return "O sistema não oferece armazenamento cifrado agora; a chave não foi salva.";
    case "storage":
      return "Não foi possível gravar a chave neste computador.";
    case "rate-limit":
      return retryAfter
        ? `Limite de uso da Groq atingido. Tente de novo em ${retryAfter} s.`
        : "Limite de uso da Groq atingido. Espere um pouco e tente de novo.";
    case "network":
      return "Sem conexão com a Groq. Verifique a internet e tente de novo.";
    case "model-unavailable":
      return "Nenhum modelo da Groq está disponível para esta chave agora.";
    case "server":
      return "A Groq está instável no momento. Tente de novo em instantes.";
    case "request":
      return "A Groq não aceitou o pedido.";
    case "aborted":
      return "Resposta interrompida.";
  }
}

/** Erros em que o painel volta a pedir a chave. */
export function needsKey(error: AiError) {
  return error === "no-key" || error === "invalid-key";
}

/** Nome curto do modelo ("llama-3.3-70b-versatile" → "llama 3.3 70b versatile"). */
export function modelLabel(id: string) {
  return id.replace(/^[^/]+\//, "").replace(/-/g, " ");
}

/**
 * Pedaços de uma resposta: texto corrido e blocos de código entre ``` (o resto do
 * Markdown aparece como texto, com as quebras de linha preservadas).
 */
export function answerBlocks(text: string): { kind: "text" | "code"; text: string }[] {
  const blocks: { kind: "text" | "code"; text: string }[] = [];
  const parts = text.split(/```/);
  parts.forEach((part, index) => {
    if (index % 2 === 1) {
      // Primeira linha do bloco é a linguagem (```ts).
      const code = part.replace(/^[^\n]*\n/, "");
      blocks.push({ kind: "code", text: code.replace(/\n$/, "") });
    } else if (part.trim()) {
      blocks.push({ kind: "text", text: part.replace(/^\n+|\n+$/g, "") });
    }
  });
  return blocks;
}

let requestSeq = 0;
export function nextRequestId() {
  requestSeq += 1;
  return `ai-${Date.now().toString(36)}-${requestSeq}`;
}

const normalize = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

const DAY = 24 * 60 * 60 * 1000;

/**
 * Conversas da barra lateral (4.1.3): busca pelo título, filtro de projeto e arquivadas,
 * agrupadas como no Claude (Hoje, Ontem, 7 dias, mais antigas).
 */
export function chatGroups<
  T extends { title: string; projectId: string | null; archived: boolean; updatedAt: number },
>(
  chats: T[],
  {
    search = "",
    projectId = null,
    archived = false,
    now = Date.now(),
  }: { search?: string; projectId?: string | null; archived?: boolean; now?: number } = {},
) {
  const query = normalize(search.trim());
  const list = chats
    .filter((chat) => chat.archived === archived)
    .filter((chat) => projectId === null || chat.projectId === projectId)
    .filter((chat) => !query || normalize(chat.title).includes(query))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const start = today.getTime();
  const buckets: { label: string; test: (at: number) => boolean }[] = archived
    ? [{ label: "Arquivadas", test: () => true }]
    : [
        { label: "Hoje", test: (at) => at >= start },
        { label: "Ontem", test: (at) => at >= start - DAY },
        { label: "Últimos 7 dias", test: (at) => at >= start - 6 * DAY },
        { label: "Mais antigas", test: () => true },
      ];
  const groups: { label: string; chats: T[] }[] = [];
  for (const chat of list) {
    const bucket = buckets.find((item) => item.test(chat.updatedAt))!;
    const group = groups.find((item) => item.label === bucket.label);
    if (group) group.chats.push(chat);
    else groups.push({ label: bucket.label, chats: [chat] });
  }
  return groups;
}
