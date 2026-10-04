/**
 * Cliente do worker do PDF Tools: cada chamada é uma promessa; a compressão manda o
 * progresso. O worker vem embutido no bundle (blob), então funciona na casca em file://.
 */
import PdfWorker from "./worker?worker&inline";

export class PdfToolError extends Error {
  constructor(
    message: string,
    readonly password: "needed" | "wrong" | null,
  ) {
    super(message);
  }
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: ((fraction: number) => void) | undefined;
};

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, Pending>();

function ensure(): Worker {
  if (worker) return worker;
  worker = new PdfWorker();
  worker.onmessage = (event: MessageEvent) => {
    const data = event.data as {
      id: number;
      ok?: boolean;
      result?: unknown;
      progress?: number;
      error?: { message: string; password: "needed" | "wrong" | null };
    };
    const job = pending.get(data.id);
    if (!job) return;
    if (typeof data.progress === "number" && data.ok === undefined) {
      job.onProgress?.(data.progress);
      return;
    }
    pending.delete(data.id);
    if (data.ok) job.resolve(data.result);
    else job.reject(new PdfToolError(data.error?.message ?? "Erro", data.error?.password ?? null));
  };
  worker.onerror = () => {
    for (const job of pending.values()) job.reject(new PdfToolError("O PDF Tools parou.", null));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** Chama uma operação do motor no worker (as cópias dos bytes vão por transferência). */
export function pdfCall<T>(
  op: string,
  args: unknown[],
  onProgress?: (fraction: number) => void,
): Promise<T> {
  const target = ensure();
  const id = ++seq;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, onProgress });
    target.postMessage({ id, op, args });
  });
}

/** Cancela tudo (fechar o PDF Tools, "Cancelar"): o worker recomeça na próxima chamada. */
export function pdfCancelAll() {
  if (!worker) return;
  worker.terminate();
  worker = null;
  for (const job of pending.values()) job.reject(new PdfToolError("Cancelado.", null));
  pending.clear();
}
