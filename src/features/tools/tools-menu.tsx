import { TOOLS, shortcutText, type ToolId } from "./tools";

/**
 * Menu "Ferramentas" (4.6), aberto pelo item da barra lateral. Mesmo visual do menu "⋯":
 * vidro translúcido, tema escuro ou claro e a cor de acento (não é menu nativo).
 */
export function ToolsMenu({
  left,
  top,
  mac,
  onRun,
  onClose,
}: {
  left: number;
  top: number;
  mac: boolean;
  onRun: (id: ToolId) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="app-menu tools-menu"
      role="menu"
      aria-label="Ferramentas"
      style={{ left, top, right: "auto" }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="app-menu-head tools-menu-head">
        <span>
          <strong>Ferramentas</strong>
          <small>Para quem desenvolve e lê na web</small>
        </span>
      </div>
      <div className="app-menu-group">
        {TOOLS.filter((tool) => tool.id !== "ports.open").map((tool) => {
          const Icon = tool.icon;
          return (
            <button
              key={tool.id}
              type="button"
              role="menuitem"
              className="app-menu-item"
              title={tool.hint}
              onClick={() => {
                onClose();
                onRun(tool.id);
              }}
            >
              <Icon aria-hidden="true" />
              <span>{tool.label}</span>
              {tool.shortcut && <kbd>{shortcutText(tool.shortcut, mac)}</kbd>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
