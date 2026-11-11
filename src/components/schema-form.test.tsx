// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigSchema } from "@/lib/config-schema";
import { SchemaForm } from "./schema-form";

const schema: ConfigSchema = {
  type: "object",
  properties: {
    gauge: { type: "string", title: "Gauge", enum: ["", "stl", "mem"], enumLabels: { "": "None" } },
    threshold: { type: "number", title: "Sensitivity", minimum: 1, maximum: 4, multipleOf: 0.5 },
  },
};

describe("SchemaForm", () => {
  afterEach(cleanup);
  it("renders a labelled control per property with the current values", () => {
    render(<SchemaForm schema={schema} values={{ gauge: "stl", threshold: 2 }} onChange={() => undefined} />);
    expect((screen.getByLabelText("Gauge") as HTMLSelectElement).value).toBe("stl");
    expect((screen.getByLabelText("Sensitivity") as HTMLInputElement).value).toBe("2");
    expect(screen.getByText("None")).toBeTruthy();
  });
  it("reports valid, clamped changes immediately", () => {
    const onChange = vi.fn();
    render(<SchemaForm schema={schema} values={{}} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Gauge"), { target: { value: "mem" } });
    fireEvent.change(screen.getByLabelText("Sensitivity"), { target: { value: "9" } });
    expect(onChange).toHaveBeenNthCalledWith(1, "gauge", "mem");
    expect(onChange).toHaveBeenNthCalledWith(2, "threshold", 4);
  });
});
