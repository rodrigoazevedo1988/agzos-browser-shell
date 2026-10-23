import { Download, FileVideo, Music, Video } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { YtdlpQuality } from "./bridge";
import "./ytdlp.css";

export type YtdlpMenuProps = {
  right: number;
  top: number;
  host: string;
  /** Site da lista de sempre (YouTube, X, Instagram…). */
  known: boolean;
  installed: boolean;
  managed: boolean;
  /** Versão do binário (AAAA.MM.DD); null quando não dá para ler. */
  version: string | null;
  /** Escolhido pelo usuário ou do PATH e com mais de 60 dias. */
  stale: boolean;
  ffmpeg: boolean;
  installing: boolean;
  busy: boolean;
  error: string | null;
  onStart: (quality: YtdlpQuality) => void;
  onInstall: () => void;
  onPick: () => void;
  onUseManaged: () => void;
  onClose: () => void;
};

const OPTIONS: { quality: YtdlpQuality; label: string; audio: boolean }[] = [
  { quality: "best", label: "Vídeo (melhor)", audio: false },
  { quality: "1080", label: "Vídeo 1080p", audio: false },
  { quality: "720", label: "Vídeo 720p", audio: false },
  { quality: "audio-mp3", label: "Só áudio (mp3)", audio: true },
  { quality: "audio-m4a", label: "Só áudio (m4a)", audio: true },
];

/** Popup da barra (e do clique direito): qualidade, ou a instalação do yt-dlp. */
export function YtdlpMenu(props: YtdlpMenuProps) {
  return (
    <aside
      className="key-panel ytdlp-panel"
      aria-label="Baixar vídeo com yt-dlp"
      style={{ right: props.right, top: props.top }}
    >
      <div className="ytdlp-head">
        <span className="ai-mark">
          <FileVideo />
        </span>
        <div>
          <strong>Baixar vídeo</strong>
          <small title={props.host}>{props.host || "Página atual"}</small>
        </div>
      </div>

      {props.installed ? (
        <>
          <div className="ytdlp-options">
            {OPTIONS.map((option) => {
              const Icon = option.audio ? Music : option.quality === "best" ? Download : Video;
              return (
                <Button
                  key={option.quality}
                  variant="ghost"
                  size="sm"
                  disabled={props.busy}
                  onClick={() => props.onStart(option.quality)}
                >
                  <Icon />
                  {option.label}
                </Button>
              );
            })}
          </div>
          {!props.ffmpeg && (
            <p className="ytdlp-note">
              Sem ffmpeg: o vídeo sai como um arquivo único e o áudio no formato original.
            </p>
          )}
          {props.known && <p className="ytdlp-note">Site com vídeo: o yt-dlp atende direto.</p>}
          {props.stale && (
            <div className="ytdlp-note" role="status">
              <p>
                O yt-dlp deste computador é de {props.version ?? "uma versão antiga"}. Sites como o
                YouTube mudam a cada poucas semanas e os downloads falham com versões antigas.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={props.installing}
                onClick={props.onUseManaged}
              >
                {props.installing ? "Instalando…" : "Usar o yt-dlp do Agzos"}
              </Button>
            </div>
          )}
          {props.managed && (
            <Button variant="ghost" size="sm" disabled={props.installing} onClick={props.onInstall}>
              {props.installing ? "Atualizando…" : "Atualizar yt-dlp"}
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="ytdlp-note">
            O yt-dlp não está neste computador. Instale a versão oficial (conferida por SHA-256) ou
            aponte o arquivo que você já tem.
          </p>
          <div className="ytdlp-options">
            <Button
              variant="outline"
              size="sm"
              disabled={props.installing}
              onClick={props.onInstall}
            >
              <Download />
              {props.installing ? "Instalando…" : "Instalar yt-dlp"}
            </Button>
            <Button variant="ghost" size="sm" disabled={props.installing} onClick={props.onPick}>
              Já tenho o yt-dlp…
            </Button>
          </div>
        </>
      )}

      {props.error && (
        <p className="ytdlp-error" role="alert">
          {props.error}
        </p>
      )}
      <div className="settings-actions">
        <Button variant="ghost" size="sm" onClick={props.onClose}>
          Fechar
        </Button>
      </div>
    </aside>
  );
}
