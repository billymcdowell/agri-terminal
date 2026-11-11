import { useEffect, useState } from "react";
import { RiErrorWarningLine } from "@remixicon/react";
import { needsAttention } from "@/lib/freshness";
import { sourceRows } from "@/settings/data-sources";
import { useSettingsScreen } from "@/settings/use-settings-screen";
import { useSources } from "@/state/use-series";

/**
 * The one place a failing or out-of-date source is announced. Nothing shows while every source is
 * fine; otherwise a count that opens Settings › Data sources at just those sources.
 */
export function AttentionIndicator() {
  const sources = useSources();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const problems = sourceRows(sources.data ?? [], []).filter((row) => needsAttention(row.source, now));
  if (!problems.length) return null;
  const label = `${problems.length} data source${problems.length === 1 ? " needs" : "s need"} attention`;
  return (
    <button type="button" className="attention-indicator" aria-label={label} title={`${label}: ${problems.map((row) => row.source.name).join(", ")}`} onClick={() => useSettingsScreen.getState().show("sources", { problemsOnly: true })}>
      <RiErrorWarningLine aria-hidden="true" /> {problems.length}
    </button>
  );
}
