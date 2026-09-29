import { Hourglass, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { StartupInfo } from "../desktop";

/** Faixa (como a de permissão) quando a página da guia ativa trava num loop. */
export function UnresponsiveBar({ onWait, onKill }: { onWait: () => void; onKill: () => void }) {
  return (
    <div className="permission-bar notice-bar" role="alertdialog" aria-label="Página sem resposta">
      <Hourglass aria-hidden="true" />
      <span>Esta página não está respondendo.</span>
      <Button size="sm" variant="outline" onClick={onWait}>
        Esperar
      </Button>
      <Button size="sm" onClick={onKill}>
        Encerrar página
      </Button>
    </div>
  );
}

/** Aviso depois de um fechamento inesperado (crash, falta de energia, processo encerrado). */
export function StartupNotice({ info, onClose }: { info: StartupInfo; onClose: () => void }) {
  const windows = info.windows > 1 ? `As ${info.windows} janelas e as guias` : "Suas guias";
  return (
    <div className="permission-bar notice-bar" role="status" aria-label="Sessão restaurada">
      <RotateCcw aria-hidden="true" />
      <span>
        {info.safe ? (
          <>
            <strong>O Agzos fechou logo depois de abrir.</strong> {windows} foram restauradas sem
            carregar, para evitar outro travamento: abra cada uma quando quiser.
          </>
        ) : (
          <>
            <strong>O Agzos não foi fechado corretamente.</strong> {windows} foram restauradas.
          </>
        )}
      </span>
      <Button size="sm" variant="outline" onClick={onClose}>
        Entendi
      </Button>
    </div>
  );
}
