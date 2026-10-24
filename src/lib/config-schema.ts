/** The subset of JSON Schema that panel configuration forms understand. */
export type ConfigProperty =
  | { type: "string"; title: string; description?: string; enum?: string[]; enumLabels?: Record<string, string> }
  | { type: "number"; title: string; description?: string; minimum?: number; maximum?: number; multipleOf?: number }
  | { type: "boolean"; title: string; description?: string };

export type ConfigSchema = { type: "object"; properties: Record<string, ConfigProperty> };

export const LINK_GROUP_PROPERTY: ConfigProperty = {
  type: "string",
  title: "Link group",
  description: "Panels in the same group follow one commodity.",
  enum: ["", "A", "B", "C"],
  enumLabels: { "": "Not linked" },
};

/** Checks a value against its property so a form never writes something the panel cannot read. */
export function coerceValue(property: ConfigProperty, raw: string | boolean): string | number | boolean | null {
  if (property.type === "boolean") return Boolean(raw);
  if (property.type === "number") {
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    const bounded = Math.min(property.maximum ?? value, Math.max(property.minimum ?? value, value));
    return bounded;
  }
  const text = String(raw);
  if (property.enum && !property.enum.includes(text)) return null;
  return text;
}
