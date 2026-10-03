import { KeyRound, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { AiKeyForm } from "@/features/ai/panel";
import { aiErrorText, modelLabel } from "@/features/ai/model";
import {
  desktopBridge,
  type AiError,
  type AiState,
  type GpuStatus,
  type TerminalShell,
} from "@/features/browser/desktop";
import {
  ACTION_LABELS,
  NAV_ACTIONS,
  type GestureId,
  type GestureSetting,
} from "@/features/gestures/gestures";
import { Toggle } from "@/features/ui/toggle";

/** Chave da Groq (4.0): mostra só se existe; trocar e remover passam pelo main. */
export function AiKeySettings({
  model,
  onModel,
}: {
  model: string;
  onModel: (model: string) => void;
}) {
  const desktop = desktopBridge();
  const [state, setState] = useState<AiState | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState<AiError | null>(null);

  useEffect(() => {
    if (!desktop) return;
    void desktop.aiState().then((value) => {
      setState(value);
      if (value.hasKey) {
        void desktop.aiModels().then((result) => {
          if (result.ok) setModels(result.models);
          else setError(result.error);
        });
      }
    });
  }, [desktop]);

  if (!desktop) {
    return (
      <p className="settings-note">
        A IA com a Groq funciona no app desktop: a chave fica no cofre do sistema.
      </p>
    );
  }
  if (!state) return null;

  return (
    <div className="settings-block ai-settings">
      <div className="setting-row">
        <span>
          <strong>Chave da API Groq</strong>
          <small>
            {state.hasKey
              ? "Configurada e cifrada pelo sistema. Ela nunca é mostrada de volta."
              : "Nenhuma chave. O Agzos AI pede a chave na primeira abertura."}
          </small>
        </span>
        <span className="ai-settings-actions">
          <Button size="sm" variant="outline" onClick={() => setReplacing((open) => !open)}>
            <KeyRound /> {state.hasKey ? "Trocar" : "Informar"}
          </Button>
          {state.hasKey && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                void desktop.aiRemoveKey().then(() => {
                  setState({ ...state, hasKey: false });
                  setModels([]);
                })
              }
            >
              <Trash2 /> Remover
            </Button>
          )}
        </span>
      </div>
      {replacing && (
        <AiKeyForm
          desktop={desktop}
          replacing={state.hasKey}
          onCancel={() => setReplacing(false)}
          onSaved={(list) => {
            setState({ ...state, hasKey: true });
            setModels(list);
            setError(null);
            setReplacing(false);
          }}
        />
      )}
      {error && <p className="ai-error">{aiErrorText(error)}</p>}
      {state.hasKey && (
        <label className="settings-select">
          <span>Modelo</span>
          <select value={model} onChange={(event) => onModel(event.target.value)}>
            <option value="">Automático{models[0] ? ` (${modelLabel(models[0])})` : ""}</option>
            {model && !models.includes(model) && (
              <option value={model}>{modelLabel(model)} (indisponível)</option>
            )}
            {models.map((id) => (
              <option key={id} value={id}>
                {modelLabel(id)}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

const VIDEO_STATUS: Record<string, string> = {
  enabled: "acelerado por hardware",
  enabled_on: "acelerado por hardware",
  enabled_force: "acelerado por hardware (forçado)",
  disabled_software: "por software",
  disabled_off: "desligado",
  unavailable_software: "por software (GPU indisponível)",
  unavailable_off: "indisponível",
};

/** Aceleração de hardware (4.0): ligar/desligar vale no próximo início. */
export function GpuSettings() {
  const desktop = desktopBridge();
  const [status, setStatus] = useState<GpuStatus | null>(null);
  const [changed, setChanged] = useState(false);
  useEffect(() => {
    void desktop?.gpuStatus().then(setStatus);
  }, [desktop]);
  if (!desktop || !status) return null;
  const video = status.videoDecode
    ? (VIDEO_STATUS[status.videoDecode] ?? status.videoDecode)
    : null;
  const hint = [
    "GPU integrada (ex.: Intel UHD) e decodificação de vídeo na placa",
    video ? `Vídeo agora: ${video}` : null,
    status.reason === "crash" ? "Desligada nesta execução: a GPU caiu várias vezes" : null,
    changed ? "Vale ao reiniciar o app" : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Toggle
      label="Aceleração de hardware forçada"
      hint={hint}
      checked={status.enabled}
      onChange={(enabled) =>
        void desktop.gpuSet(enabled).then(() => {
          setStatus({ ...status, enabled });
          setChanged(true);
        })
      }
    />
  );
}

/** Um gesto: liga/desliga e, nos de navegação, a ação. */
export function GestureRow({
  label,
  hint,
  setting,
  fixed,
  onChange,
}: {
  id: GestureId;
  label: string;
  hint: string;
  setting: GestureSetting;
  fixed: boolean;
  onChange: (setting: GestureSetting) => void;
}) {
  return (
    <div className="gesture-row">
      <Toggle
        label={label}
        hint={hint}
        checked={setting.on}
        onChange={(on) => onChange({ ...setting, on })}
      />
      {!fixed && (
        <select
          aria-label={`Ação de ${label}`}
          value={setting.action}
          disabled={!setting.on}
          onChange={(event) =>
            onChange({ ...setting, action: event.target.value as GestureSetting["action"] })
          }
        >
          {NAV_ACTIONS.map((action) => (
            <option key={action} value={action}>
              {ACTION_LABELS[action]}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

/** Shell padrão das sessões novas (lista do sistema, vinda do main). */
export function TerminalShellSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const desktop = desktopBridge();
  const [shells, setShells] = useState<TerminalShell[]>([]);
  useEffect(() => {
    void desktop?.terminalAvailable().then((info) => setShells(info.shells));
  }, [desktop]);
  return (
    <label className="settings-select">
      <span>Shell padrão</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Padrão do sistema{shells[0] ? ` (${shells[0].label})` : ""}</option>
        {shells.map((shell) => (
          <option key={shell.id} value={shell.id}>
            {shell.label}
          </option>
        ))}
      </select>
    </label>
  );
}
