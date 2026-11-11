import { parseCommand } from "@/command-bar/grammar";
import { COMMODITIES, findRegion } from "@/lib/regions";
import { findGauge, GAUGES } from "@/lib/waterways";

/** The section a command goes to, and the state or gauge it names. */
export type CommandTarget = { kind: string; region?: string; gauge?: string };

export type CommandPlan =
  | { type: "settings" }
  /** Go to the page with this section, switching to the crop, state or gauge the command names. */
  | { type: "open"; params: CommandTarget; crop?: string }
  | { type: "error"; message: string };

export function planCommand(input: string): CommandPlan {
  const command = parseCommand(input);
  if (!command) return { type: "error", message: `Unrecognized command: ${input.trim() || "(empty)"}. Type HELP to see every command.` };
  const symbolCheck = (symbol: string) => (COMMODITIES.includes(symbol) ? undefined : `Unknown commodity ${symbol}. Try ${COMMODITIES.join(", ")}.`);
  switch (command.kind) {
    case "commodity":
    case "cot": {
      const message = symbolCheck(command.symbol);
      if (message) return { type: "error", message };
      return {
        type: "open",
        params: { kind: command.kind === "cot" ? "cot" : "market" },
        crop: command.symbol,
      };
    }
    case "cropCondition":
      return { type: "open", params: { kind: "crop-condition" } };
    case "wasde":
      return { type: "open", params: { kind: "wasde" } };
    case "stress":
      return { type: "open", params: { kind: "crop-stress" } };
    case "river":
    case "riverTimeline": {
      const gauge = command.gauge ? findGauge(command.gauge) : GAUGES[0];
      if (!gauge) return { type: "error", message: `Unknown river or gauge ${command.gauge}. Try ${GAUGES.map((item) => `RIVER ${item.id.toUpperCase()}`).join(", ")} or RIVER MISS.` };
      return command.kind === "river"
        ? { type: "open", params: { kind: "river", gauge: gauge.id } }
        : { type: "open", params: { kind: "river-timeline", gauge: gauge.id } };
    }
    case "help":
      return { type: "open", params: { kind: "help" } };
    case "settings":
      return { type: "settings" };
    case "alerts":
      return { type: "open", params: { kind: "alerts" } };
    case "moves":
      return { type: "open", params: { kind: "moves" } };
    case "calendar":
      return { type: "open", params: { kind: "calendar" } };
    case "news":
      return { type: "open", params: { kind: "news" } };
    case "weather":
      return { type: "open", params: { kind: "weather" } };
    case "drought": {
      const region = findRegion(command.region);
      if (!region) return { type: "error", message: `Unknown state ${command.region}. Use a state such as IOWA or IA.` };
      return { type: "open", params: { kind: "drought", region: region.id } };
    }
  }
}
