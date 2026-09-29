import { Download, FileDown, FolderOpen, Pause, Play, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { DownloadAction, DownloadRecord } from "@/features/browser/desktop";
import { cn } from "@/lib/utils";

import { progressOf, statusOf } from "./format";

export function DownloadsPanel({
  downloads,
  desktop,
  onAction,
  onClear,
  onClose,
}: {
  downloads: DownloadRecord[];
  desktop: boolean;
  onAction: (id: number, action: DownloadAction) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const finished = downloads.some((item) => item.state !== "progressing");

  return (
    <aside className="key-panel downloads-panel" aria-label="Downloads">
      <div className="panel-heading">
        <div className="panel-title">
          <span className="ai-mark">
            <Download />
          </span>
          <div>
            <strong>Downloads</strong>
            <small>
              {downloads.length
                ? `${downloads.length} ${downloads.length === 1 ? "arquivo" : "arquivos"}`
                : "Nenhum download"}
            </small>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Fechar downloads">
          <X />
        </Button>
      </div>
      <div className="credential-list download-list">
        {downloads.length === 0 && (
          <p className="key-empty">
            {desktop
              ? "Os arquivos que você baixar aparecem aqui."
              : "Downloads funcionam no app Agzos para computador."}
          </p>
        )}
        {downloads.map((item) => {
          const progress = progressOf(item);
          const running = item.state === "progressing";
          const done = item.state === "completed";
          return (
            <div
              className={cn("credential download-item", !done && !running && "failed")}
              key={item.id}
              data-state={item.state}
            >
              <span className="domain-icon">
                <FileDown />
              </span>
              <div className="credential-copy">
                {done ? (
                  <button
                    type="button"
                    className="download-name"
                    title={`Abrir ${item.filename}`}
                    onClick={() => onAction(item.id, "open")}
                  >
                    {item.filename}
                  </button>
                ) : (
                  <strong className="download-name">{item.filename || "Download"}</strong>
                )}
                <span>
                  {statusOf(item)}
                  {item.private ? " · anônimo" : ""}
                </span>
                {running && (
                  <div
                    className={cn("download-progress", progress === null && "indeterminate")}
                    role="progressbar"
                    aria-label={`Progresso de ${item.filename}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress === null ? undefined : Math.round(progress * 100)}
                  >
                    <i style={{ width: `${Math.round((progress ?? 0.35) * 100)}%` }} />
                  </div>
                )}
              </div>
              <div className="download-actions">
                {running &&
                  (item.paused ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Retomar"
                      aria-label={`Retomar ${item.filename}`}
                      disabled={!item.canResume}
                      onClick={() => onAction(item.id, "resume")}
                    >
                      <Play />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Pausar"
                      aria-label={`Pausar ${item.filename}`}
                      onClick={() => onAction(item.id, "pause")}
                    >
                      <Pause />
                    </Button>
                  ))}
                {done && (
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Mostrar na pasta"
                    aria-label={`Mostrar ${item.filename} na pasta`}
                    onClick={() => onAction(item.id, "show")}
                  >
                    <FolderOpen />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  title={running ? "Cancelar" : "Remover da lista"}
                  aria-label={running ? `Cancelar ${item.filename}` : `Remover ${item.filename}`}
                  onClick={() => onAction(item.id, running ? "cancel" : "remove")}
                >
                  <X />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {finished && (
        <div className="settings-actions">
          <Button variant="outline" size="sm" onClick={onClear}>
            Limpar concluídos
          </Button>
        </div>
      )}
    </aside>
  );
}
