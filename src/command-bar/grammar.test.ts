import { describe, expect, it } from "vitest";
import { parseCommand } from "./grammar";

describe("command grammar", () => {
  it.each([
    ["ZC", { kind: "commodity", symbol: "ZC" }],
    ["zc cot", { kind: "cot", symbol: "ZC" }],
    ["WASDE", { kind: "wasde" }],
    ["CALENDAR", { kind: "calendar" }],
    ["NEWS", { kind: "news" }],
    ["stress", { kind: "stress" }],
    ["MOVES", { kind: "moves" }],
    ["alerts", { kind: "alerts" }],
    ["settings", { kind: "settings" }],
    ["plugins", { kind: "plugins" }],
    ["template Farmer", { kind: "template", id: "farmer" }],
    ["CROP CONDITION", { kind: "cropCondition" }],
    ["WX Iowa", { kind: "weather", region: "IOWA" }],
    ["DROUGHT Iowa", { kind: "drought", region: "IOWA" }],
    ["WS morning desk", { kind: "workspace", name: "morning desk" }],
  ])("parses %s", (input, expected) => expect(parseCommand(input)).toEqual(expected));
  it.each(["", "ZC COT extra", "WASDE CORN", "WX"]) ("rejects %s", (input) => expect(parseCommand(input)).toBeNull());
});
