import { Check, Copy, KeyRound, LogIn, User, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { VaultEntry } from "@/features/browser/types";

import { TotpCode } from "./totp-code";

/**
 * Popup de autofill: quando o site aberto tem credencial no cofre, aparece perto do botão
 * do Agzos Key para copiar e-mail/senha, preencher e entrar, e (se houver) gerar o código
 * MFA — como nos navegadores principais.
 */
export function AutofillPopup({
  entries,
  copied,
  canFill,
  onCopy,
  onFill,
  onOpenVault,
  onClose,
}: {
  entries: VaultEntry[];
  copied: string | null;
  /** Só no desktop dá para preencher a página de verdade. */
  canFill: boolean;
  onCopy: (id: string, value: string) => void;
  onFill: (entry: VaultEntry) => void;
  onOpenVault: () => void;
  onClose: () => void;
}) {
  return (
    <aside className="autofill-popup" aria-label="Entrar com o Agzos Key">
      <div className="autofill-head">
        <span className="key-mark">
          <KeyRound aria-hidden="true" />
        </span>
        <strong>Entrar com o Agzos Key</strong>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar">
          <X />
        </Button>
      </div>
      <div className="autofill-list">
        {entries.map((entry) => (
          <div className="autofill-item" key={entry.id}>
            <div className="autofill-info">
              <strong>{entry.username || entry.title}</strong>
              <small>{entry.title}</small>
              {entry.totpSecret && (
                <TotpCode
                  secret={entry.totpSecret}
                  onCopy={(code) => onCopy(`afa-${entry.id}`, code)}
                  copied={copied === `afa-${entry.id}`}
                />
              )}
            </div>
            <div className="autofill-actions">
              {canFill && (
                <Button
                  size="sm"
                  onClick={() => onFill(entry)}
                  title="Preencher e entrar"
                  aria-label={`Preencher login de ${entry.title}`}
                >
                  <LogIn /> Entrar
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onCopy(`afu-${entry.id}`, entry.username ?? "")}
                title="Copiar usuário"
                aria-label={`Copiar usuário de ${entry.title}`}
              >
                {copied === `afu-${entry.id}` ? <Check /> : <User />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onCopy(`afp-${entry.id}`, entry.password ?? "")}
                title="Copiar senha"
                aria-label={`Copiar senha de ${entry.title}`}
              >
                {copied === `afp-${entry.id}` ? <Check /> : <Copy />}
              </Button>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="autofill-foot" onClick={onOpenVault}>
        Abrir o cofre do Agzos Key
      </button>
    </aside>
  );
}
