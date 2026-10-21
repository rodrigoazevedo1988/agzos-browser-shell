/**
 * Ponte do yt-dlp (electron/ytdlp.cjs via preload). A casca manda a URL e a qualidade; o
 * binário, a instalação e os processos ficam no main.
 */
export type YtdlpQuality = "best" | "1080" | "720" | "audio-mp3" | "audio-m4a";

export type YtdlpStatus = {
  enabled: boolean;
  binary: string | null;
  /** Foi instalado pelo Agzos (<userData>/bin). */
  managed: boolean;
  ffmpeg: boolean;
  installing: boolean;
  jobs: number;
};

export type YtdlpResult = {
  ok: boolean;
  error?: string;
  id?: number;
  path?: string;
  binary?: string;
};

export type YtdlpOpenPayload = { tabId: number; url: string; private: boolean };

export type DesktopYtdlp = {
  ytdlpStatus(): Promise<YtdlpStatus | null>;
  ytdlpInstall(): Promise<YtdlpResult>;
  ytdlpPick(): Promise<YtdlpResult>;
  ytdlpStart(payload: {
    url: string;
    quality: YtdlpQuality;
    private: boolean;
    tabId?: number;
  }): Promise<YtdlpResult>;
  /** Clique direito num vídeo ou link ("Baixar vídeo com yt-dlp"). */
  onYtdlpOpen(callback: (payload: YtdlpOpenPayload) => void): () => void;
  onYtdlpError(callback: (payload: { id: number; message: string }) => void): () => void;
};
