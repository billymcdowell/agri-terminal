import type { PluginSummary } from "@/lib/ipc";

/** Plain-language permissions shown before a plugin is installed or enabled. */
export function permissionLines(plugin: Pick<PluginSummary, "hosts" | "secrets" | "series" | "cadence">): string[] {
  const lines = [`Connects to: ${plugin.hosts.join(", ")}`];
  lines.push(plugin.secrets.length ? `Uses keychain secrets: ${plugin.secrets.map((secret) => secret.name).join(", ")}` : "Uses no secrets");
  lines.push(`Refreshes ${plugin.cadence}`);
  lines.push(`Writes ${plugin.series.length} series: ${plugin.series.slice(0, 3).join(", ")}${plugin.series.length > 3 ? ", …" : ""}`);
  lines.push("Cannot run code, read files, or contact any other host");
  return lines;
}
