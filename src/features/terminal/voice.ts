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
/** Nível RMS (0–1) abaixo do qual a gravação inteira conta como silêncio. */
export const SILENCE_RMS = 0.01;

export const VOICE_SILENT_TEXT =
  "O microfone não captou som. Confira o dispositivo de entrada nas configurações de som do sistema e se ele não está mudo.";
export const VOICE_EMPTY_TEXT =
  "Não deu para entender o áudio. Fale mais perto do microfone e tente de novo.";

/** Por que o getUserMedia falhou, em texto de gente (o caso mais comum vem primeiro). */
export function micErrorText(error: unknown) {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "O sistema bloqueou o microfone. Windows: Configurações → Privacidade e segurança → Microfone → ligue “Permitir que aplicativos da área de trabalho acessem o microfone”. macOS: Ajustes do Sistema → Privacidade e Segurança → Microfone → Agzos Browser.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "Nenhum microfone encontrado. Conecte um ou escolha o dispositivo de entrada nas configurações de som do sistema.";
    case "NotReadableError":
    case "AbortError":
      return "O microfone está em uso por outro app (ou travou). Feche o outro app e tente de novo.";
    default:
      return "Não foi possível abrir o microfone.";
  }
}

/**
 * Mede o volume enquanto grava: sem isso, um microfone mudo (ou o dispositivo errado)
 * mandava silêncio ao Whisper e o modo voz terminava sem texto e sem aviso.
 */
function watchLevel(stream: MediaStream) {
  let peak = 0;
  let context: AudioContext | null = null;
  let timer: number | null = null;
  try {
    context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const value of samples) sum += value * value;
      peak = Math.max(peak, Math.sqrt(sum / samples.length));
    }, 100);
  } catch {
    // Sem Web Audio: não dá para medir; trata como som captado.
    peak = 1;
  }
  return {
    peak: () => peak,
    close: () => {
      if (timer) window.clearInterval(timer);
      void context?.close().catch(() => {});
    },
  };
}

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
  const level = useRef<ReturnType<typeof watchLevel> | null>(null);
  const textRef = useRef(onText);
  textRef.current = onText;

  const release = () => {
    recorder.current?.stream.getTracks().forEach((track) => track.stop());
    recorder.current = null;
    level.current?.close();
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
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      setState({ status: "error", message: micErrorText(error) });
      return;
    }
    const media = new MediaRecorder(stream, { mimeType: type });
    const meter = watchLevel(stream);
    level.current = meter;
    chunks.current = [];
    media.ondataavailable = (event) => {
      if (event.data.size) chunks.current.push(event.data);
    };
    media.onstop = async () => {
      const blob = new Blob(chunks.current, { type });
      const peak = meter.peak();
      release();
      if (!blob.size) {
        setState({ status: "idle" });
        return;
      }
      if (peak < SILENCE_RMS) {
        setState({ status: "error", message: VOICE_SILENT_TEXT });
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
              : result.error === "model-unavailable"
                ? `A Groq não liberou o Whisper para esta chave${result.detail ? ` (${result.detail})` : ""}. Confira em console.groq.com → Settings → Limits/Models.`
                : `${aiErrorText(result.error, result.retryAfter)}${result.detail ? ` (${result.detail})` : ""}`,
        });
        return;
      }
      if (!result.text) {
        setState({ status: "error", message: VOICE_EMPTY_TEXT });
        return;
      }
      setState({ status: "idle" });
      textRef.current(result.text);
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
