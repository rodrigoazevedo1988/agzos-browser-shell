import { cn } from "@/lib/utils";

import { TOOLS, shortcutText, type ToolId } from "./tools";

/** Grade "Ferramentas" (4.5) da página inicial e do Discador. */
export function ToolsGrid({
  onTool,
  mac,
  className,
}: {
  onTool: (id: ToolId) => void;
  mac: boolean;
  className?: string;
}) {
  return (
    <section className={cn("tools-grid", className)} aria-label="Ferramentas">
      <h2>Ferramentas</h2>
      <ul>
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          return (
            <li key={tool.id}>
              <button
                type="button"
                className="tool-card"
                data-tool={tool.id}
                title={
                  tool.shortcut ? `${tool.hint} (${shortcutText(tool.shortcut, mac)})` : tool.hint
                }
                onClick={() => onTool(tool.id)}
              >
                <span className="tool-icon">
                  <Icon aria-hidden="true" />
                </span>
                <strong>{tool.label}</strong>
                <small>{tool.hint}</small>
                {tool.shortcut && <kbd>{shortcutText(tool.shortcut, mac)}</kbd>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
