import { Bot, Eraser, Send, Sparkles, X } from "lucide-react";
import { FormEvent, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { profileFor } from "./templates";

export type ChatMessage = { role: "user" | "ai"; text: string };

export const initialChat: ChatMessage[] = [
  {
    role: "ai",
    text: "Olá! Posso resumir, explicar ou responder perguntas sobre esta página.",
  },
];

const quickActions = ["Resumir tópicos", "Reputação do site", "Perguntas frequentes"];

export function AiSidebar({
  url,
  title,
  chat,
  onSend,
  onClear,
  onClose,
}: {
  url: string;
  title: string;
  chat: ChatMessage[];
  onSend: (text: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"Resumo" | "Explicar" | "Chat">("Resumo");
  const [message, setMessage] = useState("");
  const profile = useMemo(() => profileFor(url, title), [url, title]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!message.trim()) return;
    onSend(message);
    setMessage("");
  }

  return (
    <aside className="ai-sidebar">
      <div className="panel-heading">
        <div className="panel-title">
          <span className="ai-mark">
            <Sparkles />
          </span>
          <div>
            <strong>Agzos AI</strong>
            <small>{profile.contextLine}</small>
          </div>
        </div>
        <div className="panel-heading-actions">
          <Button
            variant="ghost"
            size="icon"
            onClick={onClear}
            title="Limpar conversa"
            aria-label="Limpar conversa"
          >
            <Eraser />
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar Agzos AI">
            <X />
          </Button>
        </div>
      </div>
      <div className="mode-switch">
        {(["Resumo", "Explicar", "Chat"] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={cn(mode === item && "selected")}
            onClick={() => setMode(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="ai-body">
        {mode === "Resumo" && (
          <>
            <div className="summary-label">
              <Bot /> RESUMO DA PÁGINA
            </div>
            <h3>{profile.summary.headline}</h3>
            <p>{profile.summary.body}</p>
            <ul>
              {profile.summary.bullets.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        )}
        {mode === "Explicar" && (
          <>
            <div className="summary-label">
              <Sparkles /> EXPLICAÇÃO
            </div>
            <h3>{profile.explain.headline}</h3>
            <p>{profile.explain.body}</p>
            <div className="insight">{profile.explain.insight}</div>
          </>
        )}
        {mode === "Chat" && (
          <div className="chat-log">
            {chat.map((item, index) => (
              <div
                key={`${item.role}-${index}`}
                className={cn("chat-bubble", item.role === "user" && "mine")}
              >
                {item.text}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="quick-actions">
        {quickActions.map((action) => (
          <button key={action} type="button" onClick={() => onSend(action)}>
            {action}
          </button>
        ))}
      </div>
      <form className="chat-input" onSubmit={submit}>
        <input
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onFocus={() => setMode("Chat")}
          placeholder="Pergunte sobre esta página…"
          aria-label="Mensagem para Agzos AI"
        />
        <Button size="icon" aria-label="Enviar mensagem">
          <Send />
        </Button>
      </form>
      <p className="ai-disclaimer">A IA pode cometer erros. Verifique informações importantes.</p>
    </aside>
  );
}
