// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useCrop } from "./crop";
import { CropSwitcher } from "./crop-switcher";

describe("CropSwitcher", () => {
  afterEach(() => { cleanup(); useCrop.getState().setCrop("ZC"); });

  it("names crops in words and marks the chosen one", () => {
    render(<CropSwitcher />);
    expect(screen.getByRole("button", { name: "Corn" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Soybeans" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("sets the one crop every panel reads", () => {
    render(<CropSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: "Soybeans" }));
    expect(useCrop.getState().crop).toBe("ZS");
    expect(screen.getByRole("button", { name: "Soybeans" }).getAttribute("aria-pressed")).toBe("true");
  });
});
