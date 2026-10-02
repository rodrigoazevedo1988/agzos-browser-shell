import { Check, Copy, KeyRound, Pin, PinOff, Type, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { generateTotp, secondsRemaining } from "@/features/browser/totp";
import { cn } from "@/lib/utils";

const PERIOD = 30;

/**
 * Barrinha do Agzos Key com o código MFA (Authenticator) do login que acabou de ser
 * preenchido. Fica na casca, abaixo da barra de endereço — a página encolhe em vez de ser
 * coberta, então copiar e colar no site segue livre. Fica aberta até o usuário copiar o
 * código; com a tachinha (`pinned`) não some nem depois disso.
 */
export function KeyBar({
  title,
  secret,
  pinned,
  canFill,
  onCopied,
  onFill,
  onPin,
  onClose,
}: {
  title: string;
  secret: string;
  pinned: boolean;
  canFill: boolean;
  /** O código foi copiado (a casca fecha a barra em seguida, se não estiver fixada). */
  onCopied: (code: string) => void;
  onFill: (code: string) => void;
  onPin: () => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const [remaining, setRemaining] = useState(() => secondsRemaining({ period: PERIOD }));
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      const next = await generateTotp(secret, { period: PERIOD }).catch(() => "");
      if (active) setCode(next);
    };
    void tick();
    const id = window.setInterval(() => {
      const left = secondsRemaining({ period: PERIOD });
      setRemaining(left);
      if (left === PERIOD) {
        setCopied(false);
        void tick();
      }
    }, 1000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [secret]);

  const pretty = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;

  return (
    <div
      className={cn("key-bar", pinned && "pinned", remaining <= 5 && "expiring")}
      role="region"
      aria-label="Código MFA do Agzos Key"
    >
      <span className="save-prompt-mark">
        <KeyRound aria-hidden="true" />
      </span>
      <div className="save-prompt-text">
        <strong>Código de verificação</strong>
        <small>{title}</small>
      </div>
      <button
        type="button"
        className="key-bar-code"
        disabled={!code}
        onClick={() => {
          if (!code) return;
          setCopied(true);
          onCopied(code);
        }}
        title="Copiar código"
        aria-label={`Código ${code}, copiar`}
      >
        <span className="key-bar-digits">{pretty || "··· ···"}</span>
        <span
          className="totp-ring"
          style={{ "--totp-frac": String(remaining / PERIOD) } as React.CSSProperties}
          aria-hidden="true"
        >
          {remaining}
        </span>
        {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      </button>
      {copied && <small className="key-bar-hint">Copiado — cole no site</small>}
      <div className="save-prompt-actions">
        {canFill && (
          <Button
            size="sm"
            variant="secondary"
            disabled={!code}
            onClick={() => onFill(code)}
            title="Preencher o código na página"
          >
            <Type /> Preencher
          </Button>
        )}
        <Button
          size="icon"
          variant={pinned ? "default" : "ghost"}
          onClick={onPin}
          title={pinned ? "Desafixar a barra do Key" : "Fixar a barra do Key (não some ao copiar)"}
          aria-label={pinned ? "Desafixar a barra do Key" : "Fixar a barra do Key"}
          aria-pressed={pinned}
        >
          {pinned ? <PinOff /> : <Pin />}
        </Button>
        <Button size="icon" variant="ghost" onClick={onClose} aria-label="Fechar a barra do Key">
          <X />
        </Button>
      </div>
    </div>
  );
}
