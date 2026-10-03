import { useCallback, useEffect, useRef, useState } from "react";

import { aiErrorText } from "@/features/ai/model";
import type { DesktopBridge } from "@/features/browser/desktop";
import type { VoiceLanguage } from "./config";

export type VoiceState =
  | { status: "idle" }
  | { status: "recording"; startedAt: number }
  | { status: "transcribing" }
  | { status: "error"; message: string };

/** Gravação mais longa aceita (o Whisper da Groq aceita até 25 MB). */
const MAX_SECONDS = 120;

function recorderType() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const type of [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

/**
 * Modo voz do terminal (4.1): grava o microfone na interface do Agzos, manda o áudio para o
 * main (Whisper da Groq, com a chave do Agzos AI) e devolve o texto para o prompt.
 */
export function useVoice(
  desktop: DesktopBridge,
  language: VoiceLanguage,
  onText: (text: string) => void,
) {
  const [state, setState] = useState<VoiceState>({ status: "idle" });
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const limit = useRef<number | null>(null);
  const textRef = useRef(onText);
  textRef.current = onText;

  const release = () => {
    recorder.current?.stream.getTracks().forEach((track) => track.stop());
    recorder.current = null;
    if (limit.current) window.clearTimeout(limit.current);
    limit.current = null;
  };
  useEffect(() => release, []);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (recorder.current) return;
    const type = recorderType();
    if (!type || !navigator.mediaDevices?.getUserMedia) {
      setState({ status: "error", message: "Gravação de áudio indisponível neste sistema." });
      return;
    }
    if (!(await desktop.micAccess())) {
      setState({ status: "error", message: "Sem permissão para usar o microfone." });
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState({ status: "error", message: "Não foi possível abrir o microfone." });
      return;
    }
    const media = new MediaRecorder(stream, { mimeType: type });
    chunks.current = [];
    media.ondataavailable = (event) => {
      if (event.data.size) chunks.current.push(event.data);
    };
    media.onstop = async () => {
      const blob = new Blob(chunks.current, { type });
      release();
      if (!blob.size) {
        setState({ status: "idle" });
        return;
      }
      setState({ status: "transcribing" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const result = await desktop.aiTranscribe(bytes, type, language === "auto" ? "" : language);
      if (!result.ok) {
        setState({
          status: "error",
          message:
            result.error === "no-key"
              ? "O modo voz usa a chave da Groq do Agzos AI: configure-a primeiro."
              : aiErrorText(result.error, result.retryAfter),
        });
        return;
      }
      setState({ status: "idle" });
      if (result.text) textRef.current(result.text);
    };
    recorder.current = media;
    media.start(1000);
    limit.current = window.setTimeout(stop, MAX_SECONDS * 1000);
    setState({ status: "recording", startedAt: Date.now() });
  }, [desktop, language, stop]);

  const toggle = useCallback(() => {
    if (recorder.current) stop();
    else if (state.status !== "transcribing") void start();
  }, [start, stop, state.status]);

  return { state, toggle, stop, dismiss: () => setState({ status: "idle" }) };
}
