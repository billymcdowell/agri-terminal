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
    ["RIVER", { kind: "river", gauge: undefined }],
    ["river miss", { kind: "river", gauge: "MISS" }],
    ["RIVER St Louis", { kind: "river", gauge: "ST LOUIS" }],
    ["river timeline", { kind: "riverTimeline", gauge: undefined }],
    ["RIVER TIMELINE memphis", { kind: "riverTimeline", gauge: "MEMPHIS" }],
    ["MOVES", { kind: "moves" }],
    ["alerts", { kind: "alerts" }],
    ["settings", { kind: "settings" }],
    ["plugins", { kind: "plugins" }],
    ["RAW", { kind: "raw" }],
    ["raw data", { kind: "raw" }],
    ["HELP", { kind: "help" }],
    ["help cot", { kind: "help" }],
    ["?", { kind: "help" }],
    ["template Farmer", { kind: "template", id: "farmer" }],
    ["CROP CONDITION", { kind: "cropCondition" }],
    ["WX Iowa", { kind: "weather", region: "IOWA" }],
    ["DROUGHT Iowa", { kind: "drought", region: "IOWA" }],
    ["WS morning desk", { kind: "workspace", name: "morning desk" }],
  ])("parses %s", (input, expected) => expect(parseCommand(input)).toEqual(expected));
  it.each(["", "ZC COT extra", "WASDE CORN", "WX", "RAW PRICES"]) ("rejects %s", (input) => expect(parseCommand(input)).toBeNull());
});
