import { ADJUST_RANGES, isHexColor } from "./filters";
import {
  ADJUST_KEYS,
  BLENDS,
  LIMITS,
  SHAPE_KINDS,
  type Adjust,
  type Asset,
  type Assets,
  type Blend,
  type Crop,
  type Doc,
  type Element,
  type Transform,
} from "./model";
import { FONT_WEIGHTS } from "./text";

/**
 * Projeto .agzimg: JSON com o documento e as fotos embutidas (data URLs). Ao ler, nada entra
 * sem validação: formatos, limites, cores, ids e referências às fotos são conferidos, e o
 * que sobra é recriado só com os campos conhecidos.
 */

export const PROJECT_FORMAT = "agzimg";
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = "agzimg";
export const PROJECT_MAX_BYTES = 300 * 1024 * 1024;
export const PROJECT_MAX_ASSETS = 200;
export const ASSET_MIMES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;

export type ProjectData = { name: string; doc: Doc; assets: Assets };
export type ParseResult = ({ ok: true } & ProjectData) | { ok: false; error: string };

const MAX_ID = 64;

class ProjectError extends Error {}
const fail = (message: string): never => {
  throw new ProjectError(message);
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    return fail(`${label} fora do intervalo.`);
  }
  return value;
}

/** Número limitado: fora do intervalo é apertado nos limites (o ajuste nunca falha por isso). */
function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function str(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || value["length"] > max) return fail(`${label} inválido.`);
  return value;
}

function hex(value: unknown, label: string): string {
  if (!isHexColor(value)) return fail(`${label}: cor inválida.`);
  return value;
}

function nullableHex(value: unknown, label: string): string | null {
  return value === null || value === undefined ? null : hex(value, label);
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function idOf(value: unknown, seen: Set<string>): string {
  const id = str(value, MAX_ID, "id");
  if (!id || seen.has(id)) return fail("id repetido ou vazio.");
  seen.add(id);
  return id;
}

function parseTransform(value: unknown): Transform {
  if (!isRecord(value)) return fail("caixa inválida.");
  const rotation = num(value["rotation"] ?? 0, -100000, 100000, "rotação");
  return {
    x: num(value["x"], -20000, 20000, "posição X"),
    y: num(value["y"], -20000, 20000, "posição Y"),
    width: num(value["width"], 0, 20000, "largura"),
    height: num(value["height"], 0, 20000, "altura"),
    rotation: ((rotation % 360) + 360) % 360,
    flipX: bool(value["flipX"]),
    flipY: bool(value["flipY"]),
  };
}

function parseAdjust(value: unknown): Adjust {
  const source = isRecord(value) ? value : {};
  const adjust = {} as Adjust;
  for (const key of ADJUST_KEYS) {
    const range = ADJUST_RANGES[key];
    adjust[key] = clampNum(source[key], range.min, range.max, 0);
  }
  return adjust;
}

function parseCrop(value: unknown): Crop | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return fail("recorte inválido.");
  const width = num(value["width"], 1, 20000, "recorte");
  const height = num(value["height"], 1, 20000, "recorte");
  return {
    x: num(value["x"], 0, 20000, "recorte"),
    y: num(value["y"], 0, 20000, "recorte"),
    width,
    height,
  };
}

function parseElement(value: unknown, seen: Set<string>, assetIds: Set<string>): Element {
  if (!isRecord(value)) return fail("elemento inválido.");
  const common = {
    id: idOf(value["id"], seen),
    name: str(value["name"] ?? "", 120, "nome").slice(0, 120),
    transform: parseTransform(value["transform"]),
    opacity: clampNum(value["opacity"], 0, 1, 1),
    blend: (BLENDS as readonly string[]).includes(value["blend"] as string)
      ? (value["blend"] as Blend)
      : "normal",
    hidden: bool(value["hidden"]),
    locked: bool(value["locked"]),
  };
  switch (value["kind"]) {
    case "image": {
      const asset = str(value["asset"], MAX_ID, "foto");
      if (!assetIds.has(asset))
        return fail("elemento aponta para uma foto que não está no projeto.");
      const keyColor = isRecord(value["keyColor"])
        ? {
            color: hex(value["keyColor"]["color"], "remoção de fundo"),
            tolerance: clampNum(value["keyColor"]["tolerance"], 0, 100, 0),
          }
        : null;
      return {
        ...common,
        kind: "image",
        asset,
        crop: parseCrop(value["crop"]),
        adjust: parseAdjust(value["adjust"]),
        keyColor,
      };
    }
    case "shape": {
      if (!(SHAPE_KINDS as readonly string[]).includes(value["shape"] as string)) {
        return fail("forma desconhecida.");
      }
      return {
        ...common,
        kind: "shape",
        shape: value["shape"] as (typeof SHAPE_KINDS)[number],
        fill: nullableHex(value["fill"], "preenchimento"),
        stroke: nullableHex(value["stroke"], "contorno"),
        strokeWidth: clampNum(value["strokeWidth"], 0, 400, 0),
        radius: clampNum(value["radius"], 0, 10000, 0),
        sides: Math.round(clampNum(value["sides"], 3, 24, 5)),
      };
    }
    case "text": {
      const text = str(value["text"], LIMITS.textLength, "texto");
      const shadow = isRecord(value["shadow"])
        ? {
            color: hex(value["shadow"]["color"], "sombra"),
            blur: clampNum(value["shadow"]["blur"], 0, 200, 0),
            x: clampNum(value["shadow"]["x"], -200, 200, 0),
            y: clampNum(value["shadow"]["y"], -200, 200, 0),
          }
        : null;
      const outline = isRecord(value["outline"])
        ? {
            color: hex(value["outline"]["color"], "contorno"),
            width: clampNum(value["outline"]["width"], 0, 100, 0),
          }
        : null;
      const background = isRecord(value["background"])
        ? {
            color: hex(value["background"]["color"], "fundo do texto"),
            padding: clampNum(value["background"]["padding"], 0, 400, 0),
            radius: clampNum(value["background"]["radius"], 0, 400, 0),
          }
        : null;
      const weight = Math.round(clampNum(value["weight"], 100, 900, 400));
      return {
        ...common,
        kind: "text",
        text,
        font: str(value["font"] ?? "Sans", 80, "fonte").slice(0, 80) || "Sans",
        weight: (FONT_WEIGHTS as readonly number[]).includes(weight) ? weight : 400,
        size: clampNum(value["size"], 4, 2000, 48),
        color: hex(value["color"], "texto"),
        align: value["align"] === "center" || value["align"] === "right" ? value["align"] : "left",
        lineHeight: clampNum(value["lineHeight"], 0.5, 4, 1.2),
        shadow,
        outline,
        background,
      };
    }
    case "sticker":
      return {
        ...common,
        kind: "sticker",
        glyph: str(value["glyph"], 32, "figurinha").slice(0, 32),
      };
    default:
      return fail("tipo de elemento desconhecido.");
  }
}

function parseDoc(value: unknown, assetIds: Set<string>): Doc {
  if (!isRecord(value)) return fail("documento inválido.");
  const { min, max } = LIMITS.dimension;
  const elements = value["elements"];
  if (!Array.isArray(elements) || elements.length > LIMITS.elements) {
    return fail("lista de elementos inválida.");
  }
  const seen = new Set<string>();
  return {
    width: Math.round(num(value["width"], min, max, "largura")),
    height: Math.round(num(value["height"], min, max, "altura")),
    background: nullableHex(value["background"], "fundo"),
    elements: elements.map((element) => parseElement(element, seen, assetIds)),
  };
}

function parseAssets(value: unknown): Assets {
  if (value === undefined) return {};
  if (!Array.isArray(value) || value["length"] > PROJECT_MAX_ASSETS)
    return fail("fotos inválidas.");
  const assets: Assets = {};
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) return fail("foto inválida.");
    const id = idOf(item["id"], seen);
    const mime = item["mime"];
    if (!(ASSET_MIMES as readonly string[]).includes(mime as string)) {
      return fail("formato de foto não aceito.");
    }
    const dataUrl = str(item["dataUrl"], 60_000_000, "foto");
    const prefix = `data:${mime as string};base64,`;
    if (!dataUrl.startsWith(prefix) || !/^[A-Za-z0-9+/=]*$/.test(dataUrl.slice(prefix.length))) {
      return fail("foto corrompida.");
    }
    const asset: Asset = {
      id,
      name: str(item["name"] ?? "foto", 200, "nome da foto").slice(0, 200),
      mime: mime as string,
      width: Math.round(num(item["width"], 1, LIMITS.dimension.max, "largura da foto")),
      height: Math.round(num(item["height"], 1, LIMITS.dimension.max, "altura da foto")),
      dataUrl,
    };
    assets[id] = asset;
  }
  return assets;
}

/** Projeto para texto (JSON). As fotos que nenhum elemento usa saem do arquivo. */
export function serializeProject(data: ProjectData, savedAt = new Date()): string {
  const used = new Set(
    data.doc.elements
      .filter((element): element is Extract<Element, { kind: "image" }> => element.kind === "image")
      .map((element) => element.asset),
  );
  const assets = Object.values(data.assets).filter((asset) => used.has(asset.id));
  return JSON.stringify({
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: data.name.slice(0, 120) || "Sem título",
    savedAt: savedAt.toISOString(),
    doc: data.doc,
    assets,
  });
}

/** Lê e valida um projeto. Erro com uma frase em português quando não serve. */
export function parseProject(text: string): ParseResult {
  if (text.length > PROJECT_MAX_BYTES) return { ok: false, error: "O projeto é grande demais." };
  try {
    const raw: unknown = JSON.parse(text);
    if (!isRecord(raw)) return fail("arquivo que não é um projeto.");
    if (raw["format"] !== PROJECT_FORMAT)
      return fail("arquivo que não é um projeto do Agzos Imagem.");
    if (raw["version"] !== PROJECT_VERSION) return fail("versão de projeto não suportada.");
    const assets = parseAssets(raw["assets"]);
    const assetIds = new Set(Object.keys(assets));
    const doc = parseDoc(raw["doc"], assetIds);
    const name = typeof raw["name"] === "string" ? raw["name"]["slice"](0, 120) : "";
    return { ok: true, name: name || "Sem título", doc, assets };
  } catch (error) {
    if (error instanceof ProjectError) return { ok: false, error: error.message };
    return { ok: false, error: "Não foi possível ler o projeto (JSON inválido)." };
  }
}
