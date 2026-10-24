import { parseCommand } from "@/command-bar/grammar";
import { COMMODITIES, findRegion } from "@/lib/regions";
import type { PanelParams } from "./types";

export type CommandPlan =
  | { type: "workspace"; name: string }
  /** Open the panel, or bring forward an existing one of the same kind, and retarget the link group. */
  | { type: "open"; params: PanelParams; retarget?: { group: string; commodity: string } }
  | { type: "error"; message: string };

const DEFAULT_GROUP = "A";

export function planCommand(input: string): CommandPlan {
  const command = parseCommand(input);
  if (!command) return { type: "error", message: `Unrecognized command: ${input.trim() || "(empty)"}` };
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
    case "stress":
      return { type: "open", params: { kind: "crop-stress", linkGroup: DEFAULT_GROUP } };
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
