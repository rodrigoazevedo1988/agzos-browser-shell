import { Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";

import { typeLabel } from "./form-fill";
import type { FormLearn } from "./use-form-fill";

/**
 * Faixa "lembrar este campo?" abaixo da barra de endereço: o usuário corrigiu um valor
 * que o perfil preencheu, e o Agzos pode guardar o tipo certo do campo neste site.
 */
export function LearnPrompt({
  learn,
  onRemember,
  onDismiss,
}: {
  learn: FormLearn;
  onRemember: () => void;
  onDismiss: () => void;
}) {
  const field = learn.label ? `“${learn.label}”` : "este campo";
  return (
    <div className="save-prompt" role="dialog" aria-label="Lembrar o tipo do campo">
      <span className="save-prompt-mark">
        <Sparkles aria-hidden="true" />
      </span>
      <div className="save-prompt-text">
        <strong>
          {learn.to === "ignore"
            ? `Não preencher ${field} em ${learn.site}?`
            : `Lembrar que ${field} é ${typeLabel(learn.to)} em ${learn.site}?`}
        </strong>
        <small>
          {learn.from ? `Hoje o Agzos preenche como ${typeLabel(learn.from)}. ` : ""}
          Dá para desfazer em Configurações.
        </small>
      </div>
      <div className="save-prompt-actions">
        <Button size="sm" onClick={onRemember}>
          Lembrar
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss} aria-label="Agora não">
          <X />
        </Button>
      </div>
    </div>
  );
}
