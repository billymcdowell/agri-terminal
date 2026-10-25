export type Command =
  | { kind: "commodity"; symbol: string }
  | { kind: "cot"; symbol: string }
  | { kind: "wasde" }
  | { kind: "weather"; region: string }
  | { kind: "drought"; region: string }
  | { kind: "calendar" }
  | { kind: "news" }
  | { kind: "cropCondition" }
  | { kind: "stress" }
  | { kind: "moves" }
  | { kind: "alerts" }
  | { kind: "settings" }
  | { kind: "plugins" }
  | { kind: "template"; id: string }
  | { kind: "workspace"; name: string };

const commodity = /^[A-Z]{2,3}$/;
export function parseCommand(input: string): Command | null {
  const parts = input.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const head = parts[0].toUpperCase();
  if (head === "WS" && parts.length > 1) return { kind: "workspace", name: parts.slice(1).join(" ") };
  if (head === "WASDE" && parts.length === 1) return { kind: "wasde" };
  if (head === "CALENDAR" && parts.length === 1) return { kind: "calendar" };
  if (head === "NEWS" && parts.length === 1) return { kind: "news" };
  if (head === "STRESS" && parts.length === 1) return { kind: "stress" };
  if (head === "TEMPLATE" && parts.length === 2) return { kind: "template", id: parts[1].toLowerCase() };
  if (head === "PLUGINS" && parts.length === 1) return { kind: "plugins" };
  if (head === "SETTINGS" && parts.length === 1) return { kind: "settings" };
  if (head === "ALERTS" && parts.length === 1) return { kind: "alerts" };
  if (head === "MOVES" && parts.length === 1) return { kind: "moves" };
  if (head === "CROP" && (parts.length === 1 || (parts.length === 2 && parts[1].toUpperCase() === "CONDITION"))) return { kind: "cropCondition" };
  if (head === "WX" && parts.length > 1) return { kind: "weather", region: parts.slice(1).join(" ").toUpperCase() };
  if (head === "WX") return null;
  if (head === "DROUGHT" && parts.length > 1) return { kind: "drought", region: parts.slice(1).join(" ").toUpperCase() };
  if (commodity.test(head) && parts.length === 1) return { kind: "commodity", symbol: head };
  if (commodity.test(head) && parts.length === 2 && parts[1].toUpperCase() === "COT") return { kind: "cot", symbol: head };
  return null;
}
