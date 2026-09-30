import { describe, expect, it } from "vitest";

import type { Entry } from "../types";
import { browserReducer, recentOrder, type BrowserAction } from "./reducer";
import { entryOf, splitShown, workspaceTabs } from "./selectors";
import { DEFAULT_WORKSPACE_ID, initialState, type BrowserState } from "./state";

// 2.0: grupos de guias, workspaces e tela dividida.

const page = (url: string): Entry => ({ title: url, url, kind: "page" });

function apply(state: BrowserState, ...actions: BrowserAction[]): BrowserState {
  return actions.reduce(browserReducer, state);
}

/** Uma guia por página, no workspace ativo. */
function withPages(...urls: string[]): BrowserState {
  let state: BrowserState = { ...initialState, hydrated: true };
  urls.forEach((url, index) => {
    if (index > 0) state = browserReducer(state, { type: "tab/new" });
    state = browserReducer(state, { type: "nav/push", entry: page(url) });
  });
  return state;
}

const titles = (state: BrowserState) => workspaceTabs(state).map((tab) => entryOf(tab).title);
const groupOf = (state: BrowserState, title: string) =>
  state.tabs.find((tab) => entryOf(tab).title === title)?.groupId;
const idOf = (state: BrowserState, title: string) =>
  state.tabs.find((tab) => entryOf(tab).title === title)!.id;

describe("grupos de guias", () => {
  it("cria o grupo com as guias juntas, na posição da primeira, com uma cor livre", () => {
    let state = withPages("a", "b", "c", "d");
    state = apply(state, { type: "group/create", ids: [idOf(state, "b"), idOf(state, "d")] });
    expect(titles(state)).toEqual(["a", "b", "d", "c"]);
    expect(state.groups).toEqual([{ id: 1, title: "", color: "grey" }]);
    expect(groupOf(state, "b")).toBe(1);
    expect(groupOf(state, "d")).toBe(1);
    state = apply(state, { type: "group/create", ids: [idOf(state, "a")], title: "  Trabalho " });
    expect(state.groups[1]).toEqual({ id: 2, title: "Trabalho", color: "blue" });
  });

  it("nova guia à direita de uma agrupada entra no grupo; guia fixada sai dele", () => {
    let state = withPages("a", "b");
    state = apply(state, { type: "group/create", ids: [idOf(state, "a")] });
    state = apply(state, { type: "tab/new", rightOf: idOf(state, "a") });
    expect(state.tabs.find((tab) => tab.id === state.activeId)!.groupId).toBe(1);
    state = apply(state, { type: "tab/toggle-pin", id: idOf(state, "a") });
    expect(groupOf(state, "a")).toBeUndefined();
  });

  it("arrastar para entre duas guias do grupo entra nele; para fora, sai", () => {
    let state = withPages("a", "b", "c", "d");
    state = apply(state, { type: "group/create", ids: [idOf(state, "b"), idOf(state, "c")] });
    // "d" para a posição 2 (entre b e c).
    state = apply(state, { type: "tab/move", id: idOf(state, "d"), index: 2 });
    expect(titles(state)).toEqual(["a", "b", "d", "c"]);
    expect(groupOf(state, "d")).toBe(1);
    // "b" para o começo: sai do grupo.
    state = apply(state, { type: "tab/move", id: idOf(state, "b"), index: 0 });
    expect(groupOf(state, "b")).toBeUndefined();
  });

  it("recolher o grupo da guia ativa passa a ativa para fora dele; ativar reabre", () => {
    let state = withPages("a", "b", "c");
    state = apply(state, { type: "group/create", ids: [idOf(state, "b"), idOf(state, "c")] });
    expect(entryOf(state.tabs.find((tab) => tab.id === state.activeId)!).title).toBe("c");
    state = apply(state, { type: "group/update", groupId: 1, collapsed: true });
    expect(state.activeId).toBe(idOf(state, "a"));
    expect(state.groups[0]!.collapsed).toBe(true);
    state = apply(state, { type: "tab/activate", id: idOf(state, "b") });
    expect(state.groups[0]!.collapsed).toBe(false);
  });

  it("desagrupar mantém as guias; fechar o grupo fecha as guias; grupo vazio some", () => {
    let state = withPages("a", "b", "c");
    state = apply(state, { type: "group/create", ids: [idOf(state, "b"), idOf(state, "c")] });
    const ungrouped = apply(state, { type: "group/ungroup", groupId: 1 });
    expect(ungrouped.groups).toEqual([]);
    expect(titles(ungrouped)).toEqual(["a", "b", "c"]);
    const closed = apply(state, { type: "group/close", groupId: 1 });
    expect(titles(closed)).toEqual(["a"]);
    expect(closed.groups).toEqual([]);
    const left = apply(state, { type: "group/leave", id: idOf(state, "b") });
    expect(titles(left)).toEqual(["a", "c", "b"]);
    expect(groupOf(left, "b")).toBeUndefined();
  });
});

describe("workspaces", () => {
  it("criar abre o workspace novo com uma guia; a barra só mostra as dele", () => {
    let state = withPages("a", "b");
    state = apply(state, { type: "workspace/create", name: "Estudos", icon: "📚" });
    expect(state.workspaces.map((item) => item.name)).toEqual(["Pessoal", "Estudos"]);
    expect(state.activeWorkspaceId).toBe(2);
    expect(workspaceTabs(state)).toHaveLength(1);
    expect(entryOf(workspaceTabs(state)[0]!).kind).toBe("home");
    // Guia nova nasce no workspace ativo.
    state = apply(state, { type: "tab/new" }, { type: "nav/push", entry: page("e") });
    expect(titles(state)).toEqual(["Nova aba", "e"]);
  });

  it("trocar volta para a última guia usada no workspace", () => {
    let state = withPages("a", "b");
    state = apply(state, { type: "tab/activate", id: idOf(state, "a") });
    state = apply(state, { type: "workspace/create", name: "W", icon: "🗂️" });
    state = apply(state, { type: "workspace/switch", id: DEFAULT_WORKSPACE_ID });
    expect(state.activeId).toBe(idOf(state, "a"));
    state = apply(state, { type: "workspace/switch", id: 2 });
    expect(state.activeWorkspaceId).toBe(2);
  });

  it("Ctrl+Tab, Ctrl+1…9, fechar outras e fechar a última ficam no workspace", () => {
    let state = withPages("a", "b");
    state = apply(state, { type: "workspace/create", name: "W", icon: "🗂️" });
    state = apply(state, { type: "nav/push", entry: page("w1") });
    state = apply(state, { type: "tab/new" }, { type: "nav/push", entry: page("w2") });
    expect(
      recentOrder(state).map((id) => entryOf(state.tabs.find((t) => t.id === id)!).title),
    ).toEqual(["w2", "w1"]);
    expect(
      entryOf(
        apply(state, { type: "tab/activate-index", index: 0 }).tabs.find(
          (tab) => tab.id === apply(state, { type: "tab/activate-index", index: 0 }).activeId,
        )!,
      ).title,
    ).toBe("w1");
    const others = apply(state, { type: "tab/close-others", id: state.activeId });
    expect(titles(others)).toEqual(["w2"]);
    expect(others.tabs).toHaveLength(3);
    // Fechar a última guia do workspace cria uma guia nova nele (não pula para outro).
    let last = apply(others, { type: "tab/close", id: others.activeId });
    expect(last.activeWorkspaceId).toBe(2);
    expect(titles(last)).toEqual(["Nova aba"]);
    last = apply(last, { type: "workspace/switch", id: DEFAULT_WORKSPACE_ID });
    expect(titles(last)).toEqual(["a", "b"]);
  });

  it("mover a guia para outro workspace; apagar o workspace fecha as guias dele", () => {
    let state = withPages("a", "b");
    state = apply(state, { type: "workspace/create", name: "W", icon: "🗂️" });
    state = apply(state, { type: "workspace/switch", id: DEFAULT_WORKSPACE_ID });
    state = apply(state, { type: "tab/move-to-workspace", id: idOf(state, "b"), workspaceId: 2 });
    expect(titles(state)).toEqual(["a"]);
    expect(state.activeId).toBe(idOf(state, "a"));
    expect(workspaceTabs(state, 2).map((tab) => entryOf(tab).title)).toEqual(["Nova aba", "b"]);
    state = apply(state, { type: "workspace/remove", id: 2 });
    expect(state.workspaces).toHaveLength(1);
    expect(state.tabs.map((tab) => entryOf(tab).title)).toEqual(["a"]);
    // O padrão não pode ser apagado.
    expect(apply(state, { type: "workspace/remove", id: DEFAULT_WORKSPACE_ID })).toBe(state);
  });

  it("hydrate: workspace ou grupo inexistente cai no padrão; o ativo segue a guia ativa", () => {
    const state = apply(
      { ...initialState },
      {
        type: "hydrate",
        payload: {
          prefs: initialState.prefs,
          tabs: [
            { id: 1, history: [page("a")], index: 0, workspaceId: 9, groupId: 4 },
            { id: 2, history: [page("b")], index: 0, workspaceId: 3 },
          ],
          activeId: 2,
          links: null,
          closedTabs: [],
          bookmarks: null,
          groups: [],
          workspaces: [{ id: 3, name: "X", icon: "🗂️" }],
          split: null,
        },
      },
    );
    expect(state.workspaces.map((item) => item.id)).toEqual([1, 3]);
    expect(state.tabs[0]).toEqual({ id: 1, history: [page("a")], index: 0 });
    expect(state.activeWorkspaceId).toBe(3);
  });
});

describe("tela dividida", () => {
  it("abre com uma guia nova ao lado; aparece só com uma das duas ativa", () => {
    let state = withPages("a", "b");
    const b = state.activeId;
    state = apply(state, { type: "split/open" });
    expect(state.split).toEqual({ ids: [b, state.activeId], ratio: 0.5 });
    expect(splitShown(state)).not.toBeNull();
    state = apply(state, { type: "tab/activate", id: idOf(state, "a") });
    expect(splitShown(state)).toBeNull();
    state = apply(state, { type: "tab/activate", id: b });
    expect(splitShown(state)).not.toBeNull();
  });

  it("com uma guia escolhida, ela fica ao lado; fechar uma das duas desfaz", () => {
    let state = withPages("a", "b", "c");
    state = apply(state, { type: "split/open", id: idOf(state, "a") });
    expect(titles(state)).toEqual(["b", "c", "a"]);
    expect(state.split!.ids).toEqual([idOf(state, "c"), idOf(state, "a")]);
    state = apply(state, { type: "split/ratio", ratio: 0.95 });
    expect(state.split!.ratio).toBe(0.8);
    state = apply(state, { type: "split/swap" });
    expect(state.split!.ids).toEqual([idOf(state, "a"), idOf(state, "c")]);
    state = apply(state, { type: "tab/close", id: idOf(state, "a") });
    expect(state.split).toBeNull();
  });
});
