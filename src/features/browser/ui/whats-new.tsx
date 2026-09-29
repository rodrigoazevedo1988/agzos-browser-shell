import { PartyPopper, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";

import { changesBetween } from "../changelog";

// Vermelho da marca, âmbar, verde-água, azul, violeta e branco.
const COLORS = ["#d4282b", "#f5a524", "#17c3b2", "#3b82f6", "#a855f7", "#ffffff"];
const DURATION_MS = 3200;

/** Confetes em canvas (sem dependência); somem sozinhos e respeitam "reduzir movimento". */
export function Confetti() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const ratio = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.scale(ratio, ratio);

    // Dois jatos, dos cantos de baixo para o centro, como uma comemoração.
    const pieces = Array.from({ length: 170 }, (_, index) => {
      const left = index % 2 === 0;
      const angle = (left ? -1 : -2.14) + (Math.random() - 0.5) * 0.7;
      const speed = 11 + Math.random() * 9;
      return {
        x: left ? width * 0.08 : width * 0.92,
        y: height * 0.95,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 5 + Math.random() * 6,
        rotation: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.35,
        color: COLORS[index % COLORS.length]!,
        round: Math.random() < 0.3,
      };
    });

    const start = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      const elapsed = now - start;
      context.clearRect(0, 0, width, height);
      context.globalAlpha = Math.max(0, Math.min(1, (DURATION_MS - elapsed) / 800));
      for (const piece of pieces) {
        piece.vy += 0.32;
        piece.vx *= 0.985;
        piece.vy *= 0.985;
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.rotation += piece.spin;
        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.rotation);
        context.fillStyle = piece.color;
        if (piece.round) {
          context.beginPath();
          context.arc(0, 0, piece.size / 2.4, 0, Math.PI * 2);
          context.fill();
        } else {
          context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
        }
        context.restore();
      }
      if (elapsed < DURATION_MS) frame = requestAnimationFrame(draw);
      else context.clearRect(0, 0, width, height);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return <canvas ref={canvasRef} className="confetti" aria-hidden="true" />;
}

/**
 * Aviso "Atualizado com sucesso": versão nova, o que mudou (das versões puladas também) e
 * confetes na primeira vez.
 */
export function WhatsNew({
  from,
  to,
  celebrate,
  onClose,
}: {
  from: string | null;
  to: string;
  celebrate: boolean;
  onClose: () => void;
}) {
  const entries = changesBetween(from, to);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="whats-new-backdrop" onClick={onClose}>
      {celebrate && <Confetti />}
      <section
        className="whats-new"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="whats-new-x" aria-label="Fechar" onClick={onClose}>
          <X />
        </button>
        <span className="whats-new-mark">
          <PartyPopper aria-hidden="true" />
        </span>
        <h2 id="whats-new-title">
          {celebrate ? "Atualizado com sucesso!" : "Novidades desta versão"}
        </h2>
        <p className="whats-new-version">
          {from ? (
            <>
              Versão {from} → <strong>{to}</strong>
            </>
          ) : (
            <>
              Agzos Browser <strong>{to}</strong>
            </>
          )}
        </p>
        {entries.length ? (
          <div className="whats-new-list">
            {entries.map((entry) => (
              <div key={entry.version}>
                {entries.length > 1 && <h3>Versão {entry.version}</h3>}
                <ul>
                  {entry.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="whats-new-empty">Melhorias de estabilidade e correções.</p>
        )}
        <Button ref={closeRef} onClick={onClose}>
          Continuar navegando
        </Button>
      </section>
    </div>
  );
}
