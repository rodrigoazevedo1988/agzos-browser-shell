import { FolderOpen, ImagePlus } from "lucide-react";

import { Button } from "@/components/ui/button";

import { PRESETS, TEMPLATES } from "./templates";
import { useState } from "react";
import { LIMITS } from "./model";

/** Tela inicial "Criar um design": tamanhos prontos, modelos e abrir arquivos. */
export function StartScreen({
  onPreset,
  onTemplate,
  onOpenImage,
  onOpenProject,
}: {
  onPreset(width: number, height: number): void;
  onTemplate(id: string): void;
  onOpenImage(): void;
  onOpenProject(): void;
}) {
  const [width, setWidth] = useState(1200);
  const [height, setHeight] = useState(800);
  const clamp = (value: number) =>
    Math.min(
      LIMITS.dimension.max,
      Math.max(LIMITS.dimension.min, Math.round(value) || LIMITS.dimension.min),
    );
  return (
    <div className="ims-start">
      <header className="ims-start-head">
        <h1>Criar um design</h1>
        <p>Comece por um tamanho pronto, um modelo ou abra uma imagem que já tem.</p>
        <div className="ims-stack ims-row-wrap">
          <Button variant="outline" onClick={onOpenImage}>
            <ImagePlus /> Abrir imagem
          </Button>
          <Button variant="outline" onClick={onOpenProject}>
            <FolderOpen /> Abrir projeto (.agzimg)
          </Button>
        </div>
      </header>
      <section className="ims-start-section" aria-labelledby="ims-sizes">
        <h2 id="ims-sizes">Tamanhos</h2>
        <div className="ims-start-grid">
          {PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="ims-card"
              onClick={() => onPreset(preset.width, preset.height)}
            >
              <span
                className="ims-card-shape"
                style={{ aspectRatio: `${preset.width} / ${preset.height}` }}
                aria-hidden="true"
              />
              <strong>{preset.label}</strong>
              <small>
                {preset.width} × {preset.height}
              </small>
            </button>
          ))}
          <form
            className="ims-card ims-custom"
            onSubmit={(event) => {
              event.preventDefault();
              onPreset(clamp(width), clamp(height));
            }}
          >
            <strong>Personalizado</strong>
            <div className="ims-pair">
              <label className="ims-field">
                <span>Largura</span>
                <input
                  type="number"
                  min={LIMITS.dimension.min}
                  max={LIMITS.dimension.max}
                  value={width}
                  onChange={(event) => setWidth(Number(event.target.value))}
                />
              </label>
              <label className="ims-field">
                <span>Altura</span>
                <input
                  type="number"
                  min={LIMITS.dimension.min}
                  max={LIMITS.dimension.max}
                  value={height}
                  onChange={(event) => setHeight(Number(event.target.value))}
                />
              </label>
            </div>
            <Button type="submit" size="sm">
              Criar
            </Button>
          </form>
        </div>
      </section>
      <section className="ims-start-section" aria-labelledby="ims-models">
        <h2 id="ims-models">Modelos para começar</h2>
        <div className="ims-start-grid">
          {TEMPLATES.map((template) => (
            <button
              key={template.id}
              type="button"
              className="ims-card"
              onClick={() => onTemplate(template.id)}
            >
              <span className="ims-card-shape ims-card-model" aria-hidden="true" />
              <strong>{template.label}</strong>
              <small>{template.hint}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
