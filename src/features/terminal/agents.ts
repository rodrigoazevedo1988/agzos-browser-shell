import type { AgentPlanStep } from "@/features/browser/desktop";
import { newId, type AgentEdge, type AgentGraph, type AgentNode } from "./config";

/**
 * Modo agente (4.1.1): regras puras do canvas. Cada nó é uma etapa feita por uma CLI de
 * IA (numa aba própria do terminal, sem interação) ou pela Groq; a saída de um nó entra
 * no prompt dos nós ligados a ele. Nós sem dependência pendente rodam em paralelo.
 */

/** Ferramentas que um nó pode usar (id da receita em electron/cli-install.cjs). */
export const AGENT_TOOLS: { id: string; label: string; cli: boolean }[] = [
  { id: "groq", label: "Agzos AI (Groq)", cli: false },
  { id: "claude", label: "Claude Code", cli: true },
  { id: "codex", label: "Codex", cli: true },
  { id: "opencode", label: "OpenCode", cli: true },
  { id: "gemini", label: "Gemini CLI", cli: true },
  { id: "kiro", label: "Kiro CLI", cli: true },
];

export const agentToolLabel = (id: string) =>
  AGENT_TOOLS.find((tool) => tool.id === id)?.label ?? id;

export type NodeStatus = "idle" | "waiting" | "running" | "done" | "error" | "skipped";
export type NodeRun = { status: NodeStatus; output: string; error?: string; session?: number };

export const NODE_WIDTH = 260;
const COLUMN_GAP = 90;
const ROW_GAP = 40;
const NODE_HEIGHT = 170;
/** Quanto da saída de cada etapa segue para as próximas. */
export const CONTEXT_LIMIT = 6000;

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/** Saída do terminal → texto (sem cores, sem \r de redesenho). */
export function plainOutput(text: string) {
  return text
    .replace(ANSI_RE, "")
    .split("\n")
    .map((line) => {
      // "\r" no fim é o "\r\n" do PTY; no meio, a linha foi redesenhada.
      const parts = line.replace(/\r+$/, "").split("\r");
      return parts[parts.length - 1] ?? "";
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Prompt do nó com as saídas dos nós que chegam nele. */
export function promptWithContext(
  node: AgentNode,
  graph: AgentGraph,
  runs: Record<string, NodeRun>,
) {
  const inputs = graph.edges
    .filter((edge) => edge.to === node.id)
    .map((edge) => graph.nodes.find((item) => item.id === edge.from))
    .filter((item): item is AgentNode => Boolean(item))
    .map((item) => {
      const output = (runs[item.id]?.output ?? "").slice(-CONTEXT_LIMIT);
      return `## ${item.title}\n${output || "(sem saída)"}`;
    });
  if (!inputs.length) return node.prompt;
  return `${node.prompt}\n\n# Resultado das etapas anteriores\n\n${inputs.join("\n\n")}`;
}

/** Nós prontos para começar: todos os anteriores terminaram bem. */
export function readyNodes(graph: AgentGraph, runs: Record<string, NodeRun>) {
  return graph.nodes.filter((node) => {
    if (runs[node.id]?.status !== "waiting") return false;
    return graph.edges
      .filter((edge) => edge.to === node.id)
      .every((edge) => runs[edge.from]?.status === "done");
  });
}

/** Depois de uma falha: os que dependem dela (direta ou indiretamente) não rodam. */
export function skipAfterFailure(graph: AgentGraph, runs: Record<string, NodeRun>) {
  const next = { ...runs };
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph.nodes) {
      if (next[node.id]?.status !== "waiting") continue;
      const blocked = graph.edges.some(
        (edge) =>
          edge.to === node.id && ["error", "skipped"].includes(next[edge.from]?.status ?? "idle"),
      );
      if (blocked) {
        next[node.id] = { status: "skipped", output: "" };
        changed = true;
      }
    }
  }
  return next;
}

export function finished(runs: Record<string, NodeRun>) {
  return Object.values(runs).every((run) => !["waiting", "running"].includes(run.status));
}

/** Profundidade de cada nó (coluna no layout automático). */
function depthOf(graph: AgentGraph) {
  const depth = new Map<string, number>();
  const visit = (id: string, trail: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (trail.has(id)) return 0;
    trail.add(id);
    const parents = graph.edges.filter((edge) => edge.to === id).map((edge) => edge.from);
    const value = parents.length ? Math.max(...parents.map((p) => visit(p, trail) + 1)) : 0;
    depth.set(id, value);
    return value;
  };
  for (const node of graph.nodes) visit(node.id, new Set());
  return depth;
}

/** Organiza os nós em colunas pela dependência (como o "arrange" do ComfyUI). */
export function autoLayout(graph: AgentGraph): AgentGraph {
  const depth = depthOf(graph);
  const rows = new Map<number, number>();
  const nodes = graph.nodes.map((node) => {
    const column = depth.get(node.id) ?? 0;
    const row = rows.get(column) ?? 0;
    rows.set(column, row + 1);
    return {
      ...node,
      x: 40 + column * (NODE_WIDTH + COLUMN_GAP),
      y: 40 + row * (NODE_HEIGHT + ROW_GAP),
    };
  });
  return { nodes, edges: graph.edges };
}

/** Plano da Groq → canvas (ids novos, ligações pelo "after"). */
export function planToGraph(steps: AgentPlanStep[]): AgentGraph {
  const ids = new Map(steps.map((step) => [step.id, newId("no")]));
  const nodes: AgentNode[] = steps.map((step) => ({
    id: ids.get(step.id)!,
    title: step.title,
    tool: step.tool,
    prompt: step.prompt,
    x: 0,
    y: 0,
  }));
  const edges: AgentEdge[] = steps.flatMap((step) =>
    step.after
      .filter((dep) => ids.has(dep))
      .map((dep) => ({ from: ids.get(dep)!, to: ids.get(step.id)! })),
  );
  return autoLayout({ nodes, edges });
}
