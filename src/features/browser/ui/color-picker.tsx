import { Check, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Converte HSL para Hex
function hslToHex(h: number, s: number, l: number): string {
  l /= 100;
  const a = (s * Math.min(l, 1 - l)) / 100;
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

// Converte Hex para HSL
function hexToHsl(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return [0, 100, 50];

  let r = parseInt(result[1]!, 16) / 255;
  let g = parseInt(result[2]!, 16) / 255;
  let b = parseInt(result[3]!, 16) / 255;

  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0,
    l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

const PRESETS = [
  "#D43420", // Default Red
  "#E11D48", // Rose
  "#9333EA", // Purple
  "#4F46E5", // Indigo
  "#2563EB", // Blue
  "#0891B2", // Cyan
  "#059669", // Emerald
  "#65A30D", // Lime
  "#D97706", // Amber
  "#EA580C", // Orange
  "#475569", // Slate
];

export function ColorPicker({
  color,
  onChange,
}: {
  color: string;
  onChange: (color: string) => void;
}) {
  const [hsl, setHsl] = useState<[number, number, number]>(() => hexToHsl(color));
  const wheelRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  useEffect(() => {
    setHsl(hexToHsl(color));
  }, [color]);

  const updateFromEvent = useCallback(
    (e: PointerEvent | React.PointerEvent) => {
      if (!wheelRef.current) return;
      const rect = wheelRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const radius = rect.width / 2;

      let dx = e.clientX - centerX;
      let dy = e.clientY - centerY;
      const distance = Math.min(Math.sqrt(dx * dx + dy * dy), radius);

      if (distance > 0) {
        dx = (dx / distance) * distance;
        dy = (dy / distance) * distance;
      }

      let angle = Math.atan2(dy, dx) * (180 / Math.PI);
      if (angle < 0) angle += 360;

      const saturation = (distance / radius) * 100;
      const newHsl: [number, number, number] = [Math.round(angle), Math.round(saturation), 50];
      setHsl(newHsl);
      onChange(hslToHex(newHsl[0], newHsl[1], newHsl[2]));
    },
    [onChange],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    isDragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    updateFromEvent(e);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (isDragging.current) {
      updateFromEvent(e);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    isDragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const currentHex = hslToHex(hsl[0], hsl[1], hsl[2]);

  return (
    <div className="color-picker flex flex-col gap-4">
      <div className="flex gap-4 items-center">
        <div
          ref={wheelRef}
          className="color-wheel w-32 h-32 rounded-full cursor-crosshair relative touch-none shadow-inner"
          style={{
            background:
              "conic-gradient(from 90deg, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background: "radial-gradient(circle closest-side, #808080, transparent)",
            }}
          />
          <div
            className="color-thumb absolute w-4 h-4 rounded-full border-2 border-white shadow-sm pointer-events-none"
            style={{
              backgroundColor: currentHex,
              left: `calc(50% + ${Math.cos((hsl[0] * Math.PI) / 180) * (hsl[1] / 100) * 50}% - 8px)`,
              top: `calc(50% + ${Math.sin((hsl[0] * Math.PI) / 180) * (hsl[1] / 100) * 50}% - 8px)`,
            }}
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-md shadow-sm border"
              style={{ backgroundColor: currentHex }}
            />
            <span className="font-mono text-sm uppercase">{currentHex}</span>
          </div>
          <Button variant="outline" size="sm" onClick={() => onChange("#D43420")}>
            <Undo2 className="w-4 h-4 mr-1" /> Padrão
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 max-w-[240px]">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            className={cn(
              "w-6 h-6 rounded-full border shadow-sm flex items-center justify-center transition-transform hover:scale-110",
              color === preset && "ring-2 ring-primary ring-offset-1",
            )}
            style={{ backgroundColor: preset }}
            onClick={() => onChange(preset)}
          >
            {color === preset && <Check className="w-3 h-3 text-white mix-blend-difference" />}
          </button>
        ))}
      </div>
    </div>
  );
}
