// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, PALETTES, readStoredTheme, resolveTheme, useTheme } from "./theme";

describe("theme", () => {
  afterEach(() => { localStorage.clear(); applyTheme("dark"); });

  it("resolves system to the OS preference and leaves explicit choices alone", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it("defaults to dark when nothing valid is stored", () => {
    expect(readStoredTheme()).toBe("dark");
    localStorage.setItem("agri-terminal-theme", "neon");
    expect(readStoredTheme()).toBe("dark");
    localStorage.setItem("agri-terminal-theme", "system");
    expect(readStoredTheme()).toBe("system");
  });
  it("switches the dark class and data-theme together and remembers the choice", () => {
    useTheme.getState().setSetting("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("agri-terminal-theme")).toBe("light");
    useTheme.getState().setSetting("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });
  it("gives both themes the same set of chart colors", () => {
    expect(Object.keys(PALETTES.light).sort()).toEqual(Object.keys(PALETTES.dark).sort());
    expect(PALETTES.light.chartBackground).not.toBe(PALETTES.dark.chartBackground);
  });
});
