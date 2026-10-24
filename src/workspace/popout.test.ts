import { describe, expect, it } from "vitest";
import { popoutUrl, readPopout } from "./popout";

describe("pop-out urls", () => {
  it("round trips panel params through the query string", () => {
    const params = { kind: "drought", region: "ia", linkGroup: "A" };
    expect(readPopout(popoutUrl("index.html", params).replace("index.html", ""))).toEqual(params);
  });
  it("treats a missing or malformed parameter as the main window", () => {
    expect(readPopout("")).toBeNull();
    expect(readPopout("?popout=%7Bnot-json")).toBeNull();
    expect(readPopout(`?popout=${encodeURIComponent('{"title":"x"}')}`)).toBeNull();
  });
});
