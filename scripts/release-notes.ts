#!/usr/bin/env bun
/**
 * release-notes.ts — texto de `notes` para o latest.json, a partir do changelog.ts.
 *
 * A fonte da verdade das novidades é src/features/browser/changelog.ts (é o que o
 * diálogo "Atualizado com sucesso" mostra). O manifesto do auto-update não pode ter
 * um texto escrito à mão em outro lugar: as duas cópias divergem na primeira release
 * esquecida. Este script junta a entrada da versão pedida em um parágrafo.
 *
 *   bun run scripts/release-notes.ts 4.7.0
 *
 * Sai com erro se a versão não tiver entrada no changelog — é a regra de publicação
 * ("toda release acrescenta uma entrada no topo") virando verificação de CI, e não
 * só um cuidado do autor.
 */
import { CHANGELOG, type ChangelogEntry } from "../src/features/browser/changelog.ts";

// O updater corta em 2000 caracteres (electron/updater.cjs), então cortamos antes,
// numa fronteira de item, para nunca terminar no meio de uma frase.
const LIMIT = 1800;

const version = process.argv[2];
if (!version) {
  console.error("Uso: bun run scripts/release-notes.ts <versao>");
  process.exit(2);
}

const entry: ChangelogEntry | undefined = CHANGELOG.find((item) => item.version === version);
if (!entry) {
  console.error(
    `changelog.ts não tem entrada para a versão ${version}.\n` +
      `Adicione o bloco no topo de CHANGELOG antes de publicar (a release mostra as novidades de lá).`,
  );
  process.exit(1);
}

const paragraphs: string[] = [];
let used = 0;
for (const item of entry.items) {
  const next = used === 0 ? item : `${paragraphs.length ? " " : ""}${item}`;
  if (used + next.length > LIMIT) break;
  paragraphs.push(next);
  used += next.length + 1;
}

const truncated = paragraphs.length < entry.items.length;
const notes = `${entry.version}: ${paragraphs.join(" ")}${truncated ? "…" : ""}`;

// As notas do manifesto são uma linha: o "Atualizado com sucesso" mostra os itens
// formatados, e aqui só o resumo para quem lê o feed.
process.stdout.write(notes.replace(/\s+/g, " ").trim());
