import { KeyRound, X } from "lucide-react";

import { Button } from "@/components/ui/button";

export type SaveCandidate = {
  url: string;
  username: string;
  password: string;
  /** Já existe uma entrada para este site: oferecer "atualizar" em vez de "salvar". */
  update: boolean;
};

/**
 * Faixa "salvar no Agzos Key?" que surge abaixo da barra de endereço quando o navegador
 * detecta um login enviado numa página (como no Chrome/Firefox). O usuário salva/atualiza
 * no cofre ou dispensa.
 */
export function SavePrompt({
  candidate,
  onSave,
  onDismiss,
}: {
  candidate: SaveCandidate;
  onSave: () => void;
  onDismiss: () => void;
}) {
  let host = candidate.url;
  try {
    host = new URL(candidate.url).hostname.replace(/^www\./, "");
  } catch {
    /* mantém a url crua */
  }
  return (
    <div className="save-prompt" role="dialog" aria-label="Salvar credencial no Agzos Key">
      <span className="save-prompt-mark">
        <KeyRound aria-hidden="true" />
      </span>
      <div className="save-prompt-text">
        <strong>
          {candidate.update ? "Atualizar senha no Agzos Key?" : "Salvar no Agzos Key?"}
        </strong>
        <small>
          {candidate.username ? `${candidate.username} · ` : ""}
          {host}
        </small>
      </div>
      <div className="save-prompt-actions">
        <Button size="sm" onClick={onSave}>
          {candidate.update ? "Atualizar" : "Salvar"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss} aria-label="Agora não">
          <X />
        </Button>
      </div>
    </div>
  );
}
