import { describe, expect, it } from "vitest";
import { goToItems, goToScore } from "./go-to";

const best = (search: string) => goToItems()
  .map((item) => ({ item, score: goToScore(item.label, item.keywords, search) }))
  .filter(({ score }) => score > 0)
  .sort((a, b) => b.score - a.score)[0]?.item;

describe("Go to… search", () => {
  it("needs every typed word, and ranks a whole word in the name first", () => {
    expect(goToScore("River at Memphis, TN", ["Mississippi River"], "memphis")).toBe(1);
    expect(goToScore("Move explainer", ["Days the price moved"], "memphis")).toBe(0);
    expect(goToScore("COT positioning", ["Commitments of Traders"], "commitments")).toBeGreaterThan(0);
    expect(goToScore("Drought in Iowa", [], "drought texas")).toBe(0);
  });

  it("finds pages, crops by ticker, states, gauges, settings and glossary terms", () => {
    expect(best("memphis")?.target).toEqual({ type: "gauge", gauge: "memphis" });
    expect(best("zw")?.target).toEqual({ type: "crop", crop: "ZW" });
    expect(best("soybeans")?.target).toEqual({ type: "crop", crop: "ZS" });
    expect(best("drought nebraska")?.target).toEqual({ type: "drought", region: "ne" });
    expect(best("river")?.target).toEqual({ type: "page", page: "river" });
    expect(best("api key")?.target).toEqual({ type: "settings", section: "sources" });
    expect(best("ending stocks")?.target).toEqual({ type: "help", query: "Ending stocks" });
  });
});
