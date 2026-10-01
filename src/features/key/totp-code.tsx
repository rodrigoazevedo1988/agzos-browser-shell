import { Check, Copy, Timer } from "lucide-react";
import { useEffect, useState } from "react";

import { generateTotp, secondsRemaining } from "@/features/browser/totp";

/**
 * Mostra o código MFA (TOTP) atual de uma entrada do cofre, igual ao Agzos Key: recalcula
 * a cada janela de 30 s e desenha a contagem regressiva. Botão copia o código.
 */
export function TotpCode({
  secret,
  period = 30,
  onCopy,
  copied,
}: {
  secret: string;
  period?: number;
  onCopy?: (code: string) => void;
  copied?: boolean;
}) {
  const [code, setCode] = useState("");
  const [remaining, setRemaining] = useState(() => secondsRemaining({ period }));

  useEffect(() => {
    let active = true;
    const tick = async () => {
      const next = await generateTotp(secret, { period });
      if (active) setCode(next);
    };
    void tick();
    const id = window.setInterval(() => {
      const left = secondsRemaining({ period });
      setRemaining(left);
      if (left === period) void tick(); // virou a janela: novo código
    }, 1000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [secret, period]);

  if (!code) return null;

  const pretty = code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;

  return (
    <button
      type="button"
      className="totp-code"
      onClick={() => onCopy?.(code)}
      title="Copiar código MFA"
      aria-label={`Código MFA ${code}, copiar`}
    >
      <Timer aria-hidden="true" />
      <span className="totp-digits">{pretty}</span>
      <span
        className="totp-ring"
        style={{ "--totp-frac": String(remaining / period) } as React.CSSProperties}
        aria-hidden="true"
      >
        {remaining}
      </span>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
    </button>
  );
}
