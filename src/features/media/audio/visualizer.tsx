import { useEffect, useRef } from "react";

import type { MusicEngine } from "./engine";

const BARS = 32;
const RED = "209, 10, 17";

/** Barras vermelhas do AnalyserNode. Com movimento reduzido, atualiza a 4 quadros por segundo. */
export function Visualizer({
  engine,
  playing,
  className,
}: {
  engine: MusicEngine | null;
  playing: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !engine) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const buffer = new Uint8Array(128);
    const levels = new Float32Array(BARS);
    let frame = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let alive = true;

    const size = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (canvas.width !== Math.round(width * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      return { width, height };
    };

    const draw = () => {
      if (!alive) return;
      const { width, height } = size();
      let peak = 0;
      context.clearRect(0, 0, width, height);
      if (playing) engine.frequencies(buffer);
      else buffer.fill(0);
      const gap = 3;
      const barWidth = Math.max(2, (width - gap * (BARS - 1)) / BARS);
      for (let i = 0; i < BARS; i++) {
        // Os graves ficam à esquerda; cada barra pega uma faixa de frequências.
        const bin = Math.floor((i / BARS) ** 1.6 * 96) + 1;
        const target = (buffer[bin] ?? 0) / 255;
        levels[i] = reduced ? target : Math.max(target, levels[i]! * 0.86);
        peak = Math.max(peak, levels[i]!);
        const barHeight = Math.max(3, levels[i]! * height);
        const x = i * (barWidth + gap);
        context.fillStyle = `rgba(${RED}, ${0.35 + 0.65 * levels[i]!})`;
        context.fillRect(x, height - barHeight, barWidth, barHeight);
      }
      // Parado e já sem nada para desenhar: para o laço (a volta acontece com `playing`).
      if (!playing && peak < 0.01) return;
      if (reduced) timer = setTimeout(draw, 250);
      else frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, [engine, playing]);

  return <canvas ref={ref} className={className ?? "mx-visualizer"} aria-hidden="true" />;
}
