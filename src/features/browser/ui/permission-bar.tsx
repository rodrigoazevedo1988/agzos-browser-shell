import { ShieldCheck } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import type { DesktopPermissionRequest } from "../desktop";
import { hostOf } from "../store/selectors";

function describe(mediaTypes: string[]) {
  const video = mediaTypes.includes("video");
  const audio = mediaTypes.includes("audio");
  if (video && audio) return "a câmera e o microfone";
  return video ? "a câmera" : "o microfone";
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
        <strong>{hostOf(request.origin) ?? request.origin}</strong> quer usar{" "}
        {describe(request.mediaTypes)}.
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
