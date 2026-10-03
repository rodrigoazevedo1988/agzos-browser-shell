import {
  AlertTriangle,
  Check,
  LayoutGrid,
  Loader2,
  Play,
  Plus,
  Sparkles,
  Square,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { aiErrorText } from "@/features/ai/model";
import type { DesktopBridge, TerminalOpenResult } from "@/features/browser/desktop";
import { cn } from "@/lib/utils";
import {
  AGENT_TOOLS,
  NODE_WIDTH,
  autoLayout,
  agentToolLabel,
  finished,
  planToGraph,
  plainOutput,
  promptWithContext,
  readyNodes,
  skipAfterFailure,
  type NodeRun,
} from "./agents";
import { newId, reaches, type AgentGraph, type AgentNode } from "./config";

const PORT_Y = 21;
const OUTPUT_LIMIT = 200_000;

const STATUS_TEXT: Record<NodeRun["status"], string> = {
  idle: "",
  waiting: "Na fila",
  running: "Rodando…",
  done: "Concluído",
  error: "Falhou",
  skipped: "Pulado (etapa anterior falhou)",
};

function edgePath(x1: number, y1: number, x2: number, y2: number) {
  const bend = Math.max(60, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

/**
 * Modo agente (4.1.1): canvas de nós ligados, no estilo do ComfyUI. Cada nó é uma etapa
 * (CLI de IA numa aba própria, ou a Groq) e as ligações levam a saída de uma etapa para o
 * prompt da próxima. "Planejar com IA" monta o canvas a partir de um objetivo.
 */
export function AgentCanvas({
  desktop,
  graph,
  cwd,
  hidden,
  onGraph,
  onSession,
  onFocusSession,
  onClose,
}: {
  desktop: DesktopBridge;
  graph: AgentGraph;
  cwd: string;
  hidden: boolean;
  onGraph: (graph: AgentGraph) => void;
  onSession: (result: Extract<TerminalOpenResult, { ok: true }>, title: string) => void;
  onFocusSession: (id: number) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [runs, setRuns] = useState<Record<string, NodeRun>>({});
  const [running, setRunning] = useState(false);
  const [goal, setGoal] = useState("");
  const [planning, setPlanning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [link, setLink] = useState<{ from: string; x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const surface = useRef<HTMLDivElement>(null);
  const runsRef = useRef(runs);
  const graphRef = useRef(graph);
  graphRef.current = graph;
  const sessionNode = useRef(new Map<number, string>());
  const outputs = useRef(new Map<string, string>());
  const drag = useRef<
    | { kind: "pan"; x: number; y: number; vx: number; vy: number }
    | { kind: "node"; id: string; x: number; y: number; nx: number; ny: number }
    | null
  >(null);

  function updateRuns(next: Record<string, NodeRun>) {
    runsRef.current = next;
    setRuns(next);
  }

  function patchRun(id: string, patch: Partial<NodeRun>) {
    const current = runsRef.current[id] ?? { status: "idle", output: "" };
    updateRuns({ ...runsRef.current, [id]: { ...current, ...patch } });
  }
  const patchRef = useRef(patchRun);
  patchRef.current = patchRun;

  // Saída e fim das abas de agente.
  useEffect(() => {
    const offData = desktop.onTerminalData(({ id, data }) => {
      const node = sessionNode.current.get(id);
      if (!node) return;
      outputs.current.set(node, ((outputs.current.get(node) ?? "") + data).slice(-OUTPUT_LIMIT));
    });
    const offExit = desktop.onTerminalExit(({ id, exitCode }) => {
      const node = sessionNode.current.get(id);
      if (!node) return;
      sessionNode.current.delete(id);
      if (runsRef.current[node]?.status !== "running") return;
      const output = plainOutput(outputs.current.get(node) ?? "");
      patchRef.current(
        node,
        exitCode === 0
          ? { status: "done", output }
          : { status: "error", output, error: `Saiu com o código ${exitCode}.` },
      );
      pumpRef.current();
    });
    return () => {
      offData();
      offExit();
    };
  }, [desktop]);

  async function startNode(node: AgentNode) {
    const prompt = promptWithContext(node, graphRef.current, runsRef.current);
    patchRun(node.id, { status: "running", output: "" });
    if (node.tool === "groq") {
      const result = await desktop.agentGroq(prompt);
      if (runsRef.current[node.id]?.status !== "running") return;
      patchRun(
        node.id,
        result.ok
          ? { status: "done", output: result.text }
          : { status: "error", error: aiErrorText(result.error, result.retryAfter) },
      );
      pumpRef.current();
      return;
    }
    const result = await desktop.terminalOpenAgent({
      tool: node.tool,
      prompt,
      cwd,
      title: `⚙ ${node.title}`,
      cols: 120,
      rows: 30,
    });
    if (!result.ok) {
      patchRun(node.id, {
        status: "error",
        error:
          result.error === "no-tool"
            ? `${agentToolLabel(node.tool)} não está instalado (Lançador → Instalar CLIs de IA).`
            : result.error === "limit"
              ? "Limite de sessões do terminal nesta janela."
              : "Não foi possível iniciar a ferramenta.",
      });
      pumpRef.current();
      return;
    }
    sessionNode.current.set(result.id, node.id);
    outputs.current.set(node.id, "");
    patchRun(node.id, { session: result.id });
    onSession(result, node.title);
  }

  function pump() {
    let current = skipAfterFailure(graphRef.current, runsRef.current);
    if (current !== runsRef.current) updateRuns(current);
    for (const node of readyNodes(graphRef.current, current)) void startNode(node);
    current = runsRef.current;
    if (finished(current)) {
      setRunning(false);
      const failed = Object.values(current).filter((run) => run.status === "error").length;
      setMessage(failed ? `Terminou com ${failed} etapa(s) com falha.` : "Fluxo concluído.");
    }
  }
  const pumpRef = useRef(pump);
  pumpRef.current = pump;

  function run() {
    if (!graph.nodes.length) return;
    const empty = graph.nodes.find((node) => !node.prompt.trim());
    if (empty) {
      setMessage(`Escreva o pedido da etapa "${empty.title}".`);
      return;
    }
    outputs.current.clear();
    updateRuns(
      Object.fromEntries(graph.nodes.map((node) => [node.id, { status: "waiting", output: "" }])),
    );
    setRunning(true);
    setMessage(null);
    pumpRef.current();
  }

  function stop() {
    for (const [session] of sessionNode.current) void desktop.terminalKill(session);
    sessionNode.current.clear();
    const next: Record<string, NodeRun> = {};
    for (const [id, item] of Object.entries(runsRef.current)) {
      next[id] =
        item.status === "running"
          ? { ...item, status: "error", error: "Interrompido." }
          : item.status === "waiting"
            ? { ...item, status: "skipped" }
            : item;
    }
    updateRuns(next);
    setRunning(false);
    setMessage("Fluxo interrompido.");
  }

  async function plan() {
    const text = goal.trim();
    if (!text || planning) return;
    setPlanning(true);
    setMessage(null);
    const installed = await desktop.terminalTools(
      AGENT_TOOLS.filter((tool) => tool.cli).map((tool) =>
        tool.id === "kiro" ? "kiro-cli" : tool.id,
      ),
    );
    const tools = AGENT_TOOLS.filter(
      (tool) => !tool.cli || installed[tool.id === "kiro" ? "kiro-cli" : tool.id],
    ).map((tool) => tool.id);
    const result = await desktop.agentPlan(text, tools);
    setPlanning(false);
    if (!result.ok) {
      setMessage(
        result.error === "plan"
          ? "A IA não devolveu um plano válido. Tente descrever o objetivo de outro jeito."
          : result.error === "no-key"
            ? "Planejar usa a chave da Groq do Agzos AI: configure-a primeiro."
            : aiErrorText(result.error, "retryAfter" in result ? result.retryAfter : null),
      );
      return;
    }
    updateRuns({});
    onGraph(planToGraph(result.steps));
    setView({ x: 0, y: 0, scale: 1 });
  }

  function addNode() {
    const rect = surface.current?.getBoundingClientRect();
    const x = ((rect ? rect.width / 2 : 300) - view.x) / view.scale - NODE_WIDTH / 2;
    const y = ((rect ? rect.height / 2 : 200) - view.y) / view.scale - 60;
    const node: AgentNode = {
      id: newId("no"),
      title: `Etapa ${graph.nodes.length + 1}`,
      tool: "claude",
      prompt: "",
      x: Math.round(x + graph.nodes.length * 12),
      y: Math.round(y + graph.nodes.length * 12),
    };
    onGraph({ ...graph, nodes: [...graph.nodes, node] });
    setSelected(node.id);
  }

  const patchNode = (id: string, patch: Partial<AgentNode>) =>
    onGraph({
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
    });

  function removeNode(id: string) {
    onGraph({
      nodes: graph.nodes.filter((node) => node.id !== id),
      edges: graph.edges.filter((edge) => edge.from !== id && edge.to !== id),
    });
  }

  function connect(from: string, to: string) {
    if (from === to || graph.edges.some((edge) => edge.from === from && edge.to === to)) return;
    if (reaches(graph.edges, to, from)) {
      setMessage("Essa ligação faria um ciclo.");
      return;
    }
    onGraph({ ...graph, edges: [...graph.edges, { from, to }] });
  }

  /** Ponto da tela → coordenada do canvas. */
  function toCanvas(clientX: number, clientY: number) {
    const rect = surface.current!.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.x) / view.scale,
      y: (clientY - rect.top - view.y) / view.scale,
    };
  }

  function onSurfaceDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || event.target !== event.currentTarget) return;
    setSelected(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { kind: "pan", x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
  }

  function onSurfaceMove(event: ReactPointerEvent<HTMLDivElement>) {
    const current = drag.current;
    if (link) {
      const point = toCanvas(event.clientX, event.clientY);
      setLink({ ...link, x: point.x, y: point.y });
    }
    if (!current) return;
    if (current.kind === "pan") {
      setView((value) => ({
        ...value,
        x: current.vx + event.clientX - current.x,
        y: current.vy + event.clientY - current.y,
      }));
    } else {
      patchNode(current.id, {
        x: Math.round(current.nx + (event.clientX - current.x) / view.scale),
        y: Math.round(current.ny + (event.clientY - current.y) / view.scale),
      });
    }
  }

  function onSurfaceUp(event: ReactPointerEvent<HTMLDivElement>) {
    drag.current = null;
    if (link) {
      const target = (event.target as Element | null)?.closest?.("[data-port-in]");
      const to = target?.getAttribute("data-port-in");
      if (to) connect(link.from, to);
      setLink(null);
    }
  }

  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    if ((event.target as Element).closest("textarea")) return;
    const rect = surface.current!.getBoundingClientRect();
    const scale = Math.min(1.6, Math.max(0.35, view.scale * Math.exp(-event.deltaY * 0.0012)));
    const px = event.clientX - rect.left;
    const py = event.clientY - rect.top;
    setView({
      scale,
      x: px - ((px - view.x) * scale) / view.scale,
      y: py - ((py - view.y) * scale) / view.scale,
    });
  }

  const nodeOf = (id: string) => graph.nodes.find((node) => node.id === id);

  return (
    <div className="agent-canvas" hidden={hidden} role="region" aria-label="Modo agente">
      <div className="agent-toolbar">
        <form
          className="agent-goal"
          onSubmit={(event) => {
            event.preventDefault();
            void plan();
          }}
        >
          <input
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="Objetivo (ex.: criar a página de login com testes e revisar o código)"
            aria-label="Objetivo para os agentes"
            disabled={planning || running}
          />
          <button
            type="submit"
            disabled={!goal.trim() || planning || running}
            title="A Groq divide o objetivo em etapas com agentes"
          >
            {planning ? <Loader2 className="spin" /> : <Sparkles />} Planejar com IA
          </button>
        </form>
        <button type="button" onClick={addNode} disabled={running} title="Adicionar uma etapa">
          <Plus /> Nó
        </button>
        <button
          type="button"
          onClick={() => onGraph(autoLayout(graph))}
          disabled={!graph.nodes.length}
          title="Organizar os nós em colunas"
        >
          <LayoutGrid /> Organizar
        </button>
        {running ? (
          <button type="button" className="agent-stop" onClick={stop}>
            <Square /> Parar
          </button>
        ) : (
          <button
            type="button"
            className="agent-run"
            onClick={run}
            disabled={!graph.nodes.length}
            title="Rodar todas as etapas (as independentes em paralelo)"
          >
            <Play /> Executar
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            if (!graph.nodes.length || window.confirm("Apagar todos os nós do canvas?")) {
              onGraph({ nodes: [], edges: [] });
              updateRuns({});
            }
          }}
          disabled={running || !graph.nodes.length}
          title="Apagar o canvas"
        >
          <Trash2 />
        </button>
        <button
          type="button"
          onClick={onClose}
          title="Fechar o modo agente (Ctrl+Shift+G)"
          aria-label="Fechar o modo agente"
        >
          <X />
        </button>
      </div>
      {message && (
        <p className="agent-message" role="status">
          {message}{" "}
          <button type="button" className="link-button" onClick={() => setMessage(null)}>
            Fechar
          </button>
        </p>
      )}
      <div
        ref={surface}
        className="agent-surface"
        style={{
          backgroundPosition: `${view.x}px ${view.y}px`,
          backgroundSize: `${22 * view.scale}px ${22 * view.scale}px`,
        }}
        onPointerDown={onSurfaceDown}
        onPointerMove={onSurfaceMove}
        onPointerUp={onSurfaceUp}
        onWheel={onWheel}
      >
        {!graph.nodes.length && (
          <div className="agent-empty">
            <p>
              Descreva um objetivo e clique em <b>Planejar com IA</b>, ou monte o fluxo com
              <b> + Nó</b> e ligue a saída (●) de uma etapa à entrada da próxima.
            </p>
          </div>
        )}
        <div
          className="agent-layer"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          <svg className="agent-edges" aria-hidden="true">
            {graph.edges.map((edge) => {
              const from = nodeOf(edge.from);
              const to = nodeOf(edge.to);
              if (!from || !to) return null;
              const active =
                runs[edge.from]?.status === "done" && runs[edge.to]?.status === "running";
              return (
                <path
                  key={`${edge.from}-${edge.to}`}
                  className={cn("agent-edge", active && "active")}
                  d={edgePath(from.x + NODE_WIDTH, from.y + PORT_Y, to.x, to.y + PORT_Y)}
                  onClick={() =>
                    !running &&
                    onGraph({
                      ...graph,
                      edges: graph.edges.filter((item) => item !== edge),
                    })
                  }
                >
                  <title>Clique para remover a ligação</title>
                </path>
              );
            })}
            {link &&
              (() => {
                const from = nodeOf(link.from);
                return from ? (
                  <path
                    className="agent-edge drafting"
                    d={edgePath(from.x + NODE_WIDTH, from.y + PORT_Y, link.x, link.y)}
                  />
                ) : null;
              })()}
          </svg>
          {graph.nodes.map((node) => {
            const state = runs[node.id] ?? { status: "idle" as const, output: "" };
            const preview = (state.output || "").split("\n").slice(-6).join("\n");
            return (
              <article
                key={node.id}
                className={cn(
                  "agent-node",
                  `is-${state.status}`,
                  selected === node.id && "selected",
                )}
                style={{ left: node.x, top: node.y, width: NODE_WIDTH }}
                onPointerDown={() => setSelected(node.id)}
                aria-label={`Etapa ${node.title}`}
              >
                <header
                  onPointerDown={(event) => {
                    if ((event.target as Element).closest("input, select, button")) return;
                    surface.current?.setPointerCapture(event.pointerId);
                    drag.current = {
                      kind: "node",
                      id: node.id,
                      x: event.clientX,
                      y: event.clientY,
                      nx: node.x,
                      ny: node.y,
                    };
                  }}
                >
                  <span
                    className="agent-port in"
                    data-port-in={node.id}
                    title="Entrada: recebe a saída das etapas ligadas"
                  />
                  <input
                    value={node.title}
                    aria-label="Nome da etapa"
                    disabled={running}
                    onChange={(event) =>
                      patchNode(node.id, { title: event.target.value.slice(0, 60) })
                    }
                  />
                  <button
                    type="button"
                    aria-label={`Remover ${node.title}`}
                    disabled={running}
                    onClick={() => removeNode(node.id)}
                  >
                    <X />
                  </button>
                  <span
                    className="agent-port out"
                    title="Saída: arraste até a entrada de outra etapa"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      if (running) return;
                      surface.current?.setPointerCapture(event.pointerId);
                      const point = toCanvas(event.clientX, event.clientY);
                      setLink({ from: node.id, x: point.x, y: point.y });
                    }}
                  />
                </header>
                <select
                  value={node.tool}
                  aria-label="Ferramenta da etapa"
                  disabled={running}
                  onChange={(event) => patchNode(node.id, { tool: event.target.value })}
                >
                  {AGENT_TOOLS.map((tool) => (
                    <option key={tool.id} value={tool.id}>
                      {tool.label}
                    </option>
                  ))}
                </select>
                <textarea
                  value={node.prompt}
                  rows={3}
                  placeholder="O que esta etapa deve fazer…"
                  aria-label="Pedido da etapa"
                  disabled={running}
                  onChange={(event) =>
                    patchNode(node.id, { prompt: event.target.value.slice(0, 8000) })
                  }
                />
                {state.status !== "idle" && (
                  <footer>
                    <span className="agent-status">
                      {state.status === "running" ? (
                        <Loader2 className="spin" />
                      ) : state.status === "done" ? (
                        <Check />
                      ) : state.status === "error" ? (
                        <AlertTriangle />
                      ) : null}
                      {state.error ?? STATUS_TEXT[state.status]}
                    </span>
                    {state.status === "running" && state.session !== undefined && (
                      <button
                        type="button"
                        title="Ver a aba desta etapa no terminal"
                        onClick={() => onFocusSession(state.session!)}
                      >
                        <SquareTerminal /> Aba
                      </button>
                    )}
                    {preview && <pre>{preview}</pre>}
                  </footer>
                )}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
