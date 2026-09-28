import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type ContextMenuItem = {
  id: string;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
};

export type ContextMenuGroup = ContextMenuItem[] | "separator";

export type ContextMenuState = {
  x: number;
  y: number;
  groups: ContextMenuGroup[];
  onClose: () => void;
};

export function ContextMenu({ x, y, groups, onClose }: ContextMenuState) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    setPosition({
      left: Math.min(x, window.innerWidth - rect.width - 8),
      top: Math.min(y, window.innerHeight - rect.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      style={{ left: position.left, top: position.top }}
    >
      {groups.map((group, groupIndex) =>
        group === "separator" ? (
          <div key={`sep-${groupIndex}`} className="ctx-sep" />
        ) : (
          group.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className="ctx-item"
              onClick={() => {
                onClose();
                item.onSelect();
              }}
            >
              <span>{item.label}</span>
              {item.shortcut && <kbd>{item.shortcut}</kbd>}
            </button>
          ))
        ),
      )}
    </div>
  );
}

export function useContextMenu() {
  const [menu, setMenu] = useState<Omit<ContextMenuState, "onClose"> | null>(null);
  const open = (x: number, y: number, groups: ContextMenuGroup[]) => setMenu({ x, y, groups });
  return { open, close: () => setMenu(null), menu };
}
