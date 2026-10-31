import { parseCommand } from "@/command-bar/grammar";
import { COMMODITIES, findRegion } from "@/lib/regions";
import { findGauge, GAUGES } from "@/lib/waterways";
import { getTemplate } from "./templates";
import type { PanelParams } from "./types";

export type CommandPlan =
  | { type: "workspace"; name: string }
  | { type: "template"; id: string }
  /** Open the panel, or bring forward an existing one of the same kind, and retarget the link group. */
  | { type: "open"; params: PanelParams; retarget?: { group: string; commodity: string } }
  | { type: "error"; message: string };

const DEFAULT_GROUP = "A";

export function planCommand(input: string): CommandPlan {
  const command = parseCommand(input);
  if (!command) return { type: "error", message: `Unrecognized command: ${input.trim() || "(empty)"}. Type HELP to see every command.` };
  const symbolCheck = (symbol: string) => (COMMODITIES.includes(symbol) ? undefined : `Unknown commodity ${symbol}. Try ${COMMODITIES.join(", ")}.`);
  switch (command.kind) {
    case "workspace":
      return { type: "workspace", name: command.name };
    case "commodity":
    case "cot": {
      const message = symbolCheck(command.symbol);
      if (message) return { type: "error", message };
      return {
        type: "open",
        params: { kind: command.kind === "cot" ? "cot" : "market", linkGroup: DEFAULT_GROUP },
        retarget: { group: DEFAULT_GROUP, commodity: command.symbol },
      };
    }
    case "cropCondition":
      return { type: "open", params: { kind: "crop-condition", linkGroup: DEFAULT_GROUP } };
    case "wasde":
      return { type: "open", params: { kind: "wasde", linkGroup: DEFAULT_GROUP } };
    case "template":
      return getTemplate(command.id) ? { type: "template", id: command.id } : { type: "error", message: `Unknown template ${command.id}. Try farmer, trader, analyst or student.` };
    case "stress":
      return { type: "open", params: { kind: "crop-stress", linkGroup: DEFAULT_GROUP } };
    case "river":
    case "riverTimeline": {
      const gauge = command.gauge ? findGauge(command.gauge) : GAUGES[0];
      if (!gauge) return { type: "error", message: `Unknown river or gauge ${command.gauge}. Try ${GAUGES.map((item) => `RIVER ${item.id.toUpperCase()}`).join(", ")} or RIVER MISS.` };
      return command.kind === "river"
        ? { type: "open", params: { kind: "river", gauge: gauge.id } }
        : { type: "open", params: { kind: "river-timeline", gauge: gauge.id, linkGroup: DEFAULT_GROUP } };
    }
    case "plugins":
      return { type: "open", params: { kind: "plugins" } };
    case "help":
      return { type: "open", params: { kind: "help" } };
    case "raw":
      return { type: "open", params: { kind: "raw-data" } };
    case "settings":
      return { type: "open", params: { kind: "settings" } };
    case "alerts":
      return { type: "open", params: { kind: "alerts" } };
    case "moves":
      return { type: "open", params: { kind: "moves", linkGroup: DEFAULT_GROUP } };
    case "calendar":
      return { type: "open", params: { kind: "calendar" } };
    case "news":
      return { type: "open", params: { kind: "news", linkGroup: DEFAULT_GROUP } };
    case "weather":
      return { type: "open", params: { kind: "weather", linkGroup: DEFAULT_GROUP } };
    case "drought": {
      const region = findRegion(command.region);
      if (!region) return { type: "error", message: `Unknown state ${command.region}. Use a state such as IOWA or IA.` };
      return { type: "open", params: { kind: "drought", region: region.id } };
    }
  }
}
