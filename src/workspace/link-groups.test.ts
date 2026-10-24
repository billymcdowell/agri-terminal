import { afterEach, describe, expect, it } from "vitest";
import { nextLinkGroup, useLinkGroups } from "./link-groups";

describe("link groups", () => {
  afterEach(() => useLinkGroups.getState().setCommodity("A", "ZC"));

  it("propagates the selected commodity to every panel in a group", () => {
    useLinkGroups.getState().setCommodity("A", "ZW");
    expect(useLinkGroups.getState().groups.A.commodity).toBe("ZW");
    expect(useLinkGroups.getState().groups.B.commodity).toBe("ZS");
  });
  it("cycles A, B, C and then off", () => {
    expect(nextLinkGroup(undefined)).toBe("A");
    expect(nextLinkGroup("A")).toBe("B");
    expect(nextLinkGroup("C")).toBeUndefined();
  });
});
