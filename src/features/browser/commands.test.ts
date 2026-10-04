import { describe, expect, it, vi } from "vitest";

import {
  commandForKey,
  commands,
  isEnabled,
  runCommand,
  shortcutCombo,
  shortcutLabel,
  type CommandContext,
} from "./commands";
import { STRIP_MENU, TAB_MENU, buildMenu } from "./menus";
import { browserReducer } from "./store/reducer";
import { initialState, type BrowserState } from "./store/state";

const key = (
  value: string,
  extra: Partial<{ shift: boolean; alt: boolean; meta: boolean }> = {},
) => ({
  key: value,
  ctrl: !extra.meta,
  meta: Boolean(extra.meta),
  shift: Boolean(extra.shift),
  alt: Boolean(extra.alt),
});

function context(state: BrowserState = initialState, desktop = false) {
  const actions: unknown[] = [];
  const ui = {
    focusOmnibox: vi.fn(),
    reload: vi.fn(),
    requestClose: vi.fn(),
    copy: vi.fn(),
    step: vi.fn(),
    openFind: vi.fn(),
    toggleDownloads: vi.fn(),
    bookmarkPage: vi.fn(),
    bookmarkAllTabs: vi.fn(),
    pictureInPicture: vi.fn(),
    showWhatsNew: vi.fn(),
    openPalette: vi.fn(),
    editGroup: vi.fn(),
    openWorkspaces: vi.fn(),
    toggleSidebar: vi.fn(),
    toggleControl: vi.fn(),
    togglePorts: vi.fn(),
    capture: vi.fn(),
    toggleReader: vi.fn(),
    toggleNotes: vi.fn(),
    openScratchpad: vi.fn(),
    inspect: vi.fn(),
    openExtensions: vi.fn(),
  };
  const ctx: CommandContext = {
    state,
    dispatch: (action) => actions.push(action),
    desktop: desktop ? ({} as CommandContext["desktop"]) : null,
    ui,
  };
  return { ctx, actions, ui };
}

describe("atalhos", () => {
  it.each([
    ["t", {}, "tab.new"],
    ["T", { shift: true }, "tab.reopen-closed"],
    ["w", {}, "tab.close"],
    ["r", { meta: true }, "tab.reload"],
    ["l", {}, "omnibox.focus"],
    ["k", {}, "palette.open"],
    ["D", { shift: true }, "tabs.bookmark-all"],
    ["N", { shift: true }, "tab.new-private"],
    ["h", {}, "history.open"],
    ["y", { meta: true }, "history.open"],
    ["O", { shift: true }, "bookmarks.manager"],
    ["B", { shift: true }, "bookmarks.toggle-bar"],
  ])("Ctrl+%s %o → %s", (value, extra, id) => {
    expect(commandForKey(key(value, extra))?.id).toBe(id);
  });

  it("Ctrl com caractere de controle no Windows: usa a tecla física", () => {
    expect(
      commandForKey({
        key: "\u000f",
        code: "KeyO",
        ctrl: true,
        meta: false,
        shift: true,
        alt: false,
      })?.id,
    ).toBe("bookmarks.manager");
    expect(
      commandForKey({
        key: "Unidentified",
        code: "KeyH",
        ctrl: true,
        meta: false,
        shift: false,
        alt: false,
      })?.id,
    ).toBeUndefined();
    expect(
      commandForKey({ key: "", code: "Digit2", ctrl: true, meta: false, shift: false, alt: false })
        ?.id,
    ).toBe("tab.select-2");
  });

  it("ignora Alt, teclas sem modificador e Shift onde não existe", () => {
    expect(commandForKey(key("w", { alt: true }))).toBeUndefined();
    expect(
      commandForKey({ key: "t", ctrl: false, meta: false, shift: false, alt: false }),
    ).toBeUndefined();
    expect(commandForKey(key("w", { shift: true }))).toBeUndefined();
  });

  it.each([
    ["Tab", {}, "tab.switch-recent"],
    ["Tab", { shift: true }, "tab.switch-recent-back"],
    ["PageDown", {}, "tab.next"],
    ["PageUp", {}, "tab.previous"],
    ["1", {}, "tab.select-1"],
    ["8", {}, "tab.select-8"],
    ["9", {}, "tab.select-last"],
    ["[", { meta: true }, "nav.back"],
    ["]", { meta: true }, "nav.forward"],
    ["R", { shift: true }, "tab.reload-hard"],
    ["d", {}, "page.favorite"],
    ["f", {}, "page.find"],
    ["j", {}, "downloads.toggle"],
    ["=", {}, "zoom.in"],
    ["+", { shift: true }, "zoom.in"],
    ["-", {}, "zoom.out"],
    ["0", {}, "zoom.reset"],
  ])("Ctrl+%s %o → %s", (value, extra, id) => {
    expect(commandForKey(key(value, extra))?.id).toBe(id);
  });

  it.each([
    ["ArrowLeft", true, "nav.back"],
    ["ArrowRight", true, "nav.forward"],
    ["F5", false, "tab.reload"],
    ["F11", false, "window.fullscreen"],
  ])("%s sem Ctrl (Alt=%s) → %s", (value, alt, id) => {
    expect(commandForKey({ key: value, ctrl: false, meta: false, shift: false, alt })?.id).toBe(id);
  });

  it("Shift+F5 recarrega sem cache", () => {
    expect(
      commandForKey({ key: "F5", ctrl: false, meta: false, shift: true, alt: false })?.id,
    ).toBe("tab.reload-hard");
  });

  it("nenhum atalho aparece duas vezes", () => {
    const seen = commands.flatMap((command) => (command.shortcuts ?? []).map(shortcutCombo));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("o main repassa todos os atalhos do registro quando o foco está na página", async () => {
    const fs = await import("node:fs");
    const main = fs.readFileSync(new URL("../../../electron/main.cjs", import.meta.url), "utf8");
    const block = main.match(/FORWARDED_SHORTCUTS = new Set\(\[([\s\S]*?)\]\)/)![1]!;
    const forwarded = new Set([...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]));
    const combos = commands.flatMap((command) => (command.shortcuts ?? []).map(shortcutCombo));
    expect(combos.filter((combo) => !forwarded.has(combo))).toEqual([]);
    expect([...forwarded].filter((combo) => !combos.includes(combo!))).toEqual([]);
  });

  it("todo comando que o main dispara (menus nativos, barra do Mac) existe no registro", async () => {
    const fs = await import("node:fs");
    const main = fs.readFileSync(new URL("../../../electron/main.cjs", import.meta.url), "utf8");
    const ids = new Set(commands.map((command) => command.id as string));
    const used = [
      ...[...main.matchAll(/\baction\("([a-z0-9.-]+)"/g)].map((match) => match[1]!),
      ...[...main.matchAll(/\bcommand\("[^"]+", "([a-z0-9.-]+)"/g)].map((match) => match[1]!),
    ];
    expect(used.length).toBeGreaterThan(30);
    expect(used.filter((id) => !ids.has(id))).toEqual([]);
  });

  it("rótulos de teclas especiais", () => {
    const next = commands.find((command) => command.id === "tab.switch-recent")!;
    const back = commands.find((command) => command.id === "nav.back")!;
    expect(shortcutLabel(next, false)).toBe("Ctrl+Tab");
    expect(shortcutLabel(back, false)).toBe("Alt+←");
    expect(shortcutLabel(back, true)).toBe("⌥ ←");
  });

  it("rótulo do atalho segue a plataforma", () => {
    const reopen = commands.find((command) => command.id === "tab.reopen-closed")!;
    expect(shortcutLabel(reopen, false)).toBe("Ctrl+Shift+T");
    expect(shortcutLabel(reopen, true)).toBe("⌘ Shift T");
  });
});

describe("comandos da 1.5", () => {
  const withPage = browserReducer(initialState, {
    type: "nav/push",
    entry: { title: "Exemplo", url: "https://exemplo.com/", kind: "page" },
  });

  it("buscar, zoom e tela cheia só no desktop (na web a tecla fica com o navegador)", () => {
    for (const id of ["page.find", "zoom.in", "zoom.out", "zoom.reset", "window.fullscreen"]) {
      const command = commands.find((item) => item.id === id)!;
      expect(isEnabled(context(withPage, false).ctx, command)).toBe(false);
      expect(isEnabled(context(withPage, true).ctx, command)).toBe(true);
    }
    // Página inicial não tem o que buscar nem zoom.
    const find = commands.find((item) => item.id === "page.find")!;
    expect(isEnabled(context(initialState, true).ctx, find)).toBe(false);
  });

  it("zoom chama o bridge com a direção", () => {
    const zoom = vi.fn();
    const { ctx } = context(withPage, true);
    ctx.desktop = { zoom } as unknown as CommandContext["desktop"];
    runCommand(ctx, "zoom.in");
    runCommand(ctx, "zoom.out");
    runCommand(ctx, "zoom.reset");
    expect(zoom.mock.calls).toEqual([
      [1, 1],
      [1, -1],
      [1, 0],
    ]);
  });

  it("recarregar sem cache usa o bridge no desktop", () => {
    const reload = vi.fn();
    const { ctx, ui } = context(withPage, true);
    ctx.desktop = { reload } as unknown as CommandContext["desktop"];
    runCommand(ctx, "tab.reload-hard");
    expect(reload).toHaveBeenCalledWith(1, true);
    expect(ui.reload).not.toHaveBeenCalled();
  });

  it("guias por número e em sequência viram actions do reducer", () => {
    const { ctx, actions, ui } = context();
    runCommand(ctx, "tab.select-3");
    runCommand(ctx, "tab.select-last");
    runCommand(ctx, "tab.next");
    runCommand(ctx, "tab.switch-recent");
    runCommand(ctx, "nav.back");
    runCommand(ctx, "page.find");
    runCommand(ctx, "downloads.toggle");
    expect(actions).toEqual([
      { type: "tab/activate-index", index: 2 },
      { type: "tab/activate-index", index: -1 },
      { type: "tab/activate-relative", delta: 1 },
      { type: "switcher/step", delta: 1 },
    ]);
    expect(ui.step).toHaveBeenCalledWith(-1);
    expect(ui.openFind).not.toHaveBeenCalled();
    expect(ui.toggleDownloads).toHaveBeenCalled();
  });
});

describe("runCommand", () => {
  it("usa a aba ativa quando nenhuma é informada", () => {
    const { ctx, ui } = context();
    runCommand(ctx, "tab.close");
    expect(ui.requestClose).toHaveBeenCalledWith(1);
  });

  it("Ctrl+W fecha direto; pelo menu passa pela confirmação de aba fixada", () => {
    const { ctx, actions, ui } = context();
    runCommand(ctx, "tab.close", 1, "keyboard");
    expect(actions).toEqual([{ type: "tab/close", id: 1 }]);
    expect(ui.requestClose).not.toHaveBeenCalled();
    runCommand(ctx, "tab.close", 1);
    expect(ui.requestClose).toHaveBeenCalledWith(1);
  });

  it("não roda comando desabilitado", () => {
    const { ctx, actions } = context();
    expect(runCommand(ctx, "tab.reopen-closed")).toBe(false);
    expect(actions).toEqual([]);
  });

  it("ID desconhecido é ignorado", () => {
    const { ctx } = context();
    expect(runCommand(ctx, "nao-existe")).toBe(false);
  });

  it("IDs usados pelo menu nativo do Electron existem no registro", async () => {
    const fs = await import("node:fs");
    const main = fs.readFileSync(new URL("../../../electron/main.cjs", import.meta.url), "utf8");
    const ids = [...main.matchAll(/action\("([\w.-]+)"/g)].map((match) => match[1]);
    expect(ids.length).toBeGreaterThan(10);
    const known = new Set(commands.map((command) => command.id as string));
    expect(ids.filter((id) => !known.has(id!))).toEqual([]);
  });
});

describe("menus da versão web", () => {
  it("menu da aba reflete o estado (fixar/desfixar, som só no desktop)", () => {
    const pinned = browserReducer(initialState, { type: "tab/toggle-pin", id: 1 });
    const labels = (state: BrowserState, desktop: boolean) =>
      buildMenu(TAB_MENU, context(state, desktop).ctx, 1, false).flatMap((group) =>
        group === "separator" ? ["—"] : group.map((item) => item.label),
      );
    expect(labels(initialState, false)).toContain("Fixar");
    expect(labels(pinned, false)).toContain("Desfixar");
    const muted = browserReducer(initialState, { type: "tab/toggle-mute", id: 1 });
    expect(labels(muted, false)).not.toContain("Ativar som do site");
    expect(labels(muted, true)).toContain("Ativar som do site");
  });

  it("menu da barra oferece só a orientação que não está ativa", () => {
    const vertical = browserReducer(initialState, {
      type: "prefs/set",
      patch: { orientation: "vertical" },
    });
    const groups = buildMenu(STRIP_MENU, context(vertical).ctx, 1, false);
    const labels = groups.flatMap((group) =>
      group === "separator" ? [] : group.map((i) => i.label),
    );
    expect(labels).toEqual([
      "Nova guia",
      "Reabrir guia fechada",
      "Buscar comandos",
      "Dividir tela (nova guia ao lado)",
      "Workspaces",
      "Novo workspace…",
      "Ocultar painéis laterais",
      "Mostrar guias horizontalmente",
    ]);
    expect(groups.at(-1)).not.toBe("separator");
  });
});
