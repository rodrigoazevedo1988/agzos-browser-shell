import { describe, expect, it, vi } from "vitest";

import {
  commandForKey,
  commands,
  runCommand,
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
  const ui = { focusOmnibox: vi.fn(), reload: vi.fn(), requestClose: vi.fn(), copy: vi.fn() };
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
    ["k", {}, "omnibox.focus"],
    ["D", { shift: true }, "tabs.bookmark-all"],
    ["N", { shift: true }, "tab.new-private"],
  ])("Ctrl+%s %o → %s", (value, extra, id) => {
    expect(commandForKey(key(value, extra))?.id).toBe(id);
  });

  it("ignora Alt, teclas sem modificador e Shift onde não existe", () => {
    expect(commandForKey(key("t", { alt: true }))).toBeUndefined();
    expect(
      commandForKey({ key: "t", ctrl: false, meta: false, shift: false, alt: false }),
    ).toBeUndefined();
    expect(commandForKey(key("w", { shift: true }))).toBeUndefined();
  });

  it("nenhum atalho aparece duas vezes", () => {
    const seen = commands.flatMap((command) =>
      (command.shortcuts ?? []).map((item) => `${item.shift ? "shift+" : ""}${item.key}`),
    );
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("rótulo do atalho segue a plataforma", () => {
    const reopen = commands.find((command) => command.id === "tab.reopen-closed")!;
    expect(shortcutLabel(reopen, false)).toBe("Ctrl+Shift+T");
    expect(shortcutLabel(reopen, true)).toBe("⌘ Shift T");
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
    expect(labels).toEqual(["Nova guia", "Reabrir guia fechada", "Mostrar guias horizontalmente"]);
    expect(groups.at(-1)).not.toBe("separator");
  });
});
