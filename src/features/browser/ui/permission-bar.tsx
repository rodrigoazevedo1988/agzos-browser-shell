import { ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import type { DesktopPermissionRequest } from "../desktop";
import { hostOf } from "../store/selectors";

const WHAT: Record<string, string> = {
  camera: "usar a câmera",
  microphone: "usar o microfone",
  notifications: "mostrar notificações",
  geolocation: "saber sua localização",
  "clipboard-read": "ler a área de transferência",
  midi: "usar dispositivos MIDI",
};

function describe(types: string[]) {
  if (types.includes("camera") && types.includes("microphone")) {
    return "usar a câmera e o microfone";
  }
  return types.map((type) => WHAT[type] ?? type).join(" e ");
}

export function PermissionBar({
  request,
  onAnswer,
}: {
  request: DesktopPermissionRequest;
  onAnswer: (allow: boolean, remember: boolean) => void;
}) {
  const [remember, setRemember] = useState(true);
  return (
    <div className="permission-bar" role="alertdialog" aria-label="Pedido de permissão">
      <ShieldCheck aria-hidden="true" />
      <span>
        <strong>{hostOf(request.origin) ?? request.origin}</strong> quer{" "}
        {describe(request.types ?? [])}.
      </span>
      <label className="permission-remember">
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => setRemember(event.target.checked)}
        />
        Lembrar
      </label>
      <Button size="sm" onClick={() => onAnswer(true, remember)}>
        Permitir
      </Button>
      <Button size="sm" variant="outline" onClick={() => onAnswer(false, remember)}>
        Bloquear
      </Button>
    </div>
  );
}
