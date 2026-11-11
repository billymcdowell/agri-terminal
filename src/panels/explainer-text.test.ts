import { describe, expect, it } from "vitest";
import { EXPLAINER_TEXT } from "./explainer-text";

const BANNED = ["caused by", "because of", "due to", "driven by", "resulted in", "triggered by"];

describe("move explainer wording", () => {
  it("never asserts cause", () => {
    const { restore, ...plain } = EXPLAINER_TEXT;
    const strings = [...Object.values(plain), restore(3)];
    for (const text of strings) for (const phrase of BANNED) expect(text.toLowerCase()).not.toContain(phrase);
  });
});
