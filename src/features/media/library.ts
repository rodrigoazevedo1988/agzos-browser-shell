// Biblioteca de mídia gravada na section "media" do BrowserStore (SQLite no app; na web, a
// chave agzos-state do localStorage). Cada gravação relê antes, para não desfazer o que
// outra janela acabou de gravar.

import { desktopBridge } from "@/features/browser/desktop";
import { STATE_KEY } from "@/features/browser/persistence/store";
import { emptyMedia, parseMedia, type MediaLibrary } from "@/features/browser/persistence/snapshot";

export async function loadMedia(): Promise<MediaLibrary> {
  try {
    const bridge = desktopBridge();
    if (bridge) {
      const result = await bridge.stateLoad();
      return result.available ? parseMedia(result.sections["media"]) : emptyMedia();
    }
    const stored = JSON.parse(window.localStorage.getItem(STATE_KEY) ?? "null") as {
      media?: unknown;
    } | null;
    return parseMedia(stored?.media);
  } catch {
    return emptyMedia();
  }
}

/** Aplica `change` à biblioteca atual e grava o resultado. */
export async function updateMedia(
  change: (library: MediaLibrary) => MediaLibrary,
): Promise<MediaLibrary> {
  const next = change(await loadMedia());
  try {
    const bridge = desktopBridge();
    if (bridge) {
      await bridge.stateSave({ media: next });
    } else {
      const stored = (JSON.parse(window.localStorage.getItem(STATE_KEY) ?? "null") ?? {}) as Record<
        string,
        unknown
      >;
      window.localStorage.setItem(STATE_KEY, JSON.stringify({ ...stored, media: next }));
    }
  } catch {
    // Sem armazenamento (modo privado, cota): a sessão atual segue sem gravar.
  }
  return next;
}
