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
