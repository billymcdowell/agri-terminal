import { describe, expect, it } from "vitest";
import { restoreWorkspace, serializeWorkspace } from "./serialization";

describe("workspace serialization", () => {
  it("round trips a dock layout snapshot", () => {
    const layout = { panels: [{ id: "corn", component: "market", params: { commodity: "ZC" } }] };
    expect(restoreWorkspace(serializeWorkspace(layout))).toEqual({ version: 1, layout });
  });
  it("rejects unsupported snapshots", () => expect(() => restoreWorkspace('{"version":2,"layout":{}}')).toThrow());
});
