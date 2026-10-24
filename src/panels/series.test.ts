import { describe, expect, it } from "vitest";
import { balanceSheetRows, cotRows, cropConditionRows, droughtRows } from "./series";

describe("panel series ids", () => {
  it("matches the identifiers the connectors write", () => {
    expect(cotRows("ZW")[0].seriesId).toBe("cot.ZW.managed_money_net");
    expect(cropConditionRows("ZC").map((row) => row.seriesId)).toContain("nass.zc.progress.planted");
    expect(balanceSheetRows("ZS")[5].seriesId).toBe("fas.zs.ending_stocks");
    expect(droughtRows("IA")[4].seriesId).toBe("drought.ia.D4");
  });
});
