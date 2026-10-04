import type { DesktopBridge, DownloadRecord } from "@/features/browser/desktop";

import { cleanTagList } from "./filters";

/**
 * API interna `agzos.downloads` (4.7): a mesma coisa que o gerenciador faz, para o resto
 * da casca (e o console do DevTools do app). Não existe nas páginas dos sites.
 */
export type DownloadsApi = {
  list(): Promise<DownloadRecord[]>;
  pause(id: number): Promise<boolean>;
  resume(id: number): Promise<boolean>;
  restart(id: number): Promise<boolean>;
  cancel(id: number): Promise<boolean>;
  /** Pasta absoluta (ou sem pasta: o diálogo pergunta). */
  setDestination(id: number, dir?: string): Promise<boolean>;
  addTag(id: number, tag: string): Promise<boolean>;
  export(ids: number[], format: "json" | "csv"): Promise<string | null>;
  onChanged(callback: (record: DownloadRecord) => void): () => void;
};

export function createDownloadsApi(desktop: DesktopBridge): DownloadsApi {
  const ok = (promise: Promise<{ ok: boolean }>) => promise.then((result) => result.ok);
  return {
    list: () => desktop.downloadsList(),
    pause: (id) => ok(desktop.downloadAction(id, "pause")),
    resume: (id) => ok(desktop.downloadAction(id, "resume")),
    restart: (id) => ok(desktop.downloadAction(id, "restart")),
    cancel: (id) => ok(desktop.downloadAction(id, "cancel")),
    setDestination: (id, dir) => ok(desktop.downloadAction(id, "destination", dir)),
    addTag: async (id, tag) => {
      const record = (await desktop.downloadsList()).find((item) => item.id === id);
      if (!record) return false;
      return ok(desktop.downloadAction(id, "tags", cleanTagList([...(record.tags ?? []), tag])));
    },
    export: (ids, format) =>
      desktop
        .downloadsExport({ ids, format })
        .then((result) => (result.ok ? (result.path ?? null) : null)),
    onChanged: (callback) => desktop.onDownload(callback),
  };
}
