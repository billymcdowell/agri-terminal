import { describe, expect, it } from "vitest";
import { componentBreakdown, describeSensitivity, formatPercentChange, RIVER_TEXT, stagePosition } from "./river-text";

const BANNED = ["caused by", "because of", "due to", "driven by", "resulted in", "triggered by", "will rise", "will fall"];

describe("river wording", () => {
  it("never asserts cause or predicts prices", () => {
    const { title, timelineTitle, ...plain } = RIVER_TEXT;
    const strings = [...Object.values(plain), title("St. Louis, MO"), timelineTitle("Memphis, TN", "ZC")];
    for (const text of strings) for (const phrase of BANNED) expect(text.toLowerCase()).not.toContain(phrase);
  });
  it("places the stage against the thresholds", () => {
    const thresholds = { normal: 5, restriction: 1, critical: -3.5 };
    const at = (value: number) => stagePosition({ thresholds, stage: { value, period: "2026-10-31", releasedAt: "", fetchedAt: "", sourceId: "" } });
    expect(at(6)).toContain("At or above normal");
    expect(at(3.34)).toBe("2.34 ft above the restriction level (1.00 ft), below normal (5.00 ft).");
    expect(at(0)).toContain("below the restriction level");
    expect(at(-4)).toContain("critical level");
    expect(stagePosition({ thresholds, stage: null })).toBe("No current reading.");
  });
  it("describes the sensitivity with its fit", () => {
    expect(describeSensitivity({ beta: 43.775, rSquared: 0.0552, pairs: 308, horizonWeeks: 2 }))
      .toBe("+43.8% of tariff per ft deeper below the restriction level over 2 weeks · fit R² 0.06 from 308 pairs of weeks");
  });
  it("shows changes with a direction marker and the breakdown with missing parts", () => {
    expect(formatPercentChange(4.75)).toBe("▲ 4.8%");
    expect(formatPercentChange(-12)).toBe("▼ 12.0%");
    expect(formatPercentChange(null)).toBe("—");
    expect(componentBreakdown({ total: 50, band: "ELEVATED", partial: true, depth: { value: 0.5, weight: 5 / 7, points: 35.7 }, forecast: null, traffic: { value: 0.5, weight: 2 / 7, points: 14.3 } }))
      .toBe("Depth 35.7 · Forecast missing · Traffic 14.3");
  });
});
