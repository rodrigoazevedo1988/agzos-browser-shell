import { cn } from "@/lib/utils";

export function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={cn("setting-row", disabled && "disabled")}>
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        className={cn("switch", checked && "on")}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <i />
      </button>
    </label>
  );
}
