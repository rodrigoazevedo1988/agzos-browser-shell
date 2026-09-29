import type { PermissionType } from "@/features/browser/desktop";

export const PERMISSION_LABELS: Record<PermissionType, string> = {
  camera: "Câmera",
  microphone: "Microfone",
  notifications: "Notificações",
  geolocation: "Localização",
  "clipboard-read": "Ler a área de transferência",
  midi: "Dispositivos MIDI",
};
export const PERMISSION_TYPES = Object.keys(PERMISSION_LABELS) as PermissionType[];

export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}
