import type { PageNote } from "@/features/browser/types";

const normalize = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Outras notas: busca no título, na URL e no texto; mais recentes primeiro. */
export function otherNotes(
  notes: Record<string, PageNote>,
  currentKey: string | null,
  query: string,
) {
  const text = normalize(query.trim());
  return Object.entries(notes)
    .filter(([key]) => key !== currentKey)
    .filter(
      ([, note]) =>
        !text || [note.title, note.url, note.text].some((value) => normalize(value).includes(text)),
    )
    .sort((a, b) => b[1].updatedAt - a[1].updatedAt);
}
