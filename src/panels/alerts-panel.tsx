import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { deleteAlert, listAlerts, listRiverAlerts, saveAlert, setAlertEnabled, setRiverAlertEnabled, type AlertFired, type PriceAlert, type RiverAlertRecord } from "@/lib/ipc";
import { COMMODITIES } from "@/lib/regions";
import { fromDisplayPrice, toDisplayPrice, UNIT_LABELS, useUnits, type UnitSystem } from "@/lib/units";
import { usePersistedValue } from "@/state/use-persisted-list";
import { DEFAULT_LEAD_HOURS, LEAD_HOUR_OPTIONS } from "@/shell/release-alerts";
import { PanelHeader } from "./panel-header";

const leadLabel = (hours: number) => (hours === 0 ? "Off" : `${hours} hour${hours === 1 ? "" : "s"} before`);

/** How early to be reminded before a scheduled report, or not at all. */
export function ReportReminders() {
  const [leadHours, setLeadHours] = usePersistedValue<number>("release-alert-lead-hours", DEFAULT_LEAD_HOURS);
  return (
    <div className="workspace-panel">
      <PanelHeader title="Report reminders" kind="alerts" subtitle="A notification before each scheduled report, when prices often move sharply." />
      <div className="schema-field section-body">
        <Label htmlFor="alert-lead">Remind me</Label>
        <NativeSelect size="sm" id="alert-lead" value={String(leadHours)} onChange={(event) => setLeadHours(Number(event.currentTarget.value))}>
          {LEAD_HOUR_OPTIONS.map((hours) => <NativeSelectOption key={hours} value={String(hours)}>{leadLabel(hours)}</NativeSelectOption>)}
        </NativeSelect>
      </div>
    </div>
  );
}

/** Alerts are stored in USD per bushel and shown in the user's chosen unit. */
export function describeAlert(alert: Pick<PriceAlert, "symbol" | "direction" | "threshold">, units: UnitSystem = "bushel") {
  return `${alert.symbol} at or ${alert.direction} ${toDisplayPrice(alert.threshold, alert.symbol, units).toFixed(2)} ${UNIT_LABELS[units]}`;
}

/** The system notification for a fired alert, in the user's chosen unit. */
export function alertNotification(fired: AlertFired, units: UnitSystem = "bushel") {
  const close = toDisplayPrice(fired.close, fired.symbol, units).toFixed(2);
  return { title: describeAlert(fired, units), body: `Latest close ${close} ${UNIT_LABELS[units]} on ${fired.date}.` };
}

const BAND_NAMES = ["NORMAL", "ELEVATED", "HIGH"];

/** The badge for a river alert: paused, armed, triggered, or the band the score has reached. */
export function riverAlertStatus(alert: Pick<RiverAlertRecord, "rule" | "enabled" | "state">) {
  if (!alert.enabled) return "PAUSED";
  if (alert.rule === "band_up") return alert.state > 0 ? `AT ${BAND_NAMES[alert.state] ?? "HIGH"}` : "ARMED";
  return alert.state > 0 ? "TRIGGERED" : "ARMED";
}

/** Parses the threshold field; returns null for anything that is not a positive price. */
export function parseThreshold(text: string): number | null {
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

/** Your own alerts on the daily close: add, pause, resume and delete. */
export function PriceAlertsSection() {
  const queryClient = useQueryClient();
  const units = useUnits();
  const alerts = useQuery({ queryKey: ["alerts"], queryFn: listAlerts });
  const [symbol, setSymbol] = useState("ZC");
  const [direction, setDirection] = useState<PriceAlert["direction"]>("above");
  const [threshold, setThreshold] = useState("");
  const [error, setError] = useState("");
  const run = (action: () => Promise<unknown>) => action().then(() => { setError(""); return queryClient.invalidateQueries({ queryKey: ["alerts"] }); }).catch((failure) => setError(String(failure)));

  const price = parseThreshold(threshold);
  return (
    <div className="workspace-panel">
      <PanelHeader title="Price alerts" kind="alerts" subtitle="A notification when a daily close crosses a level you choose." />
      <form className="schema-form section-body" onSubmit={(event) => { event.preventDefault(); if (price !== null) void run(async () => { await saveAlert({ id: crypto.randomUUID(), symbol, direction, threshold: fromDisplayPrice(price, symbol, units) }); setThreshold(""); }); }}>
        <div className="schema-field">
          <Label htmlFor="alert-symbol">Commodity</Label>
          <NativeSelect size="sm" id="alert-symbol" value={symbol} onChange={(event) => setSymbol(event.currentTarget.value)}>
            {COMMODITIES.map((item) => <NativeSelectOption key={item} value={item}>{item}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <div className="schema-field">
          <Label htmlFor="alert-direction">When the close is</Label>
          <NativeSelect size="sm" id="alert-direction" value={direction} onChange={(event) => setDirection(event.currentTarget.value as PriceAlert["direction"])}>
            <NativeSelectOption value="above">at or above</NativeSelectOption>
            <NativeSelectOption value="below">at or below</NativeSelectOption>
          </NativeSelect>
        </div>
        <div className="schema-field">
          <Label htmlFor="alert-threshold">Price ({UNIT_LABELS[units]})</Label>
          <Input id="alert-threshold" inputMode="decimal" value={threshold} onChange={(event) => setThreshold(event.currentTarget.value)} aria-invalid={threshold !== "" && price === null} />
        </div>
        <Button type="submit" size="sm" disabled={price === null}>Add alert</Button>
      </form>
      {error && <p role="alert" className="command-error">{error}</p>}
      {alerts.data?.length === 0 && <p className="panel-freshness">No alerts yet.</p>}
      <ul className="compact-list">
        {alerts.data?.map((alert) => (
          <li key={alert.id} className="alert-row">
            <Badge variant={alert.triggered ? "secondary" : "outline"}>{!alert.enabled ? "PAUSED" : alert.triggered ? "TRIGGERED" : "ARMED"}</Badge>
            <span className="alert-text">{describeAlert(alert, units)}</span>
            <Button size="xs" variant="ghost" onClick={() => void run(() => setAlertEnabled(alert.id, !alert.enabled))}>{alert.enabled ? "Pause" : "Resume"}</Button>
            <Button size="xs" variant="ghost" onClick={() => void run(() => deleteAlert(alert.id))}>Delete</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The built-in river alerts for every gauge; each can be paused. */
export function RiverAlertsSection() {
  const queryClient = useQueryClient();
  const riverAlerts = useQuery({ queryKey: ["river-alerts"], queryFn: listRiverAlerts });
  const [error, setError] = useState("");
  const toggle = (alert: RiverAlertRecord) => setRiverAlertEnabled(alert.id, !alert.enabled)
    .then(() => { setError(""); return queryClient.invalidateQueries({ queryKey: ["river-alerts"] }); })
    .catch((failure) => setError(String(failure)));
  return (
    <div className="workspace-panel">
      <PanelHeader title="River alerts" kind="alerts" subtitle="Built in for every gauge: low water, a low forecast, and the constraint score moving up a band." />
      {riverAlerts.isError && <p className="panel-freshness" data-status="error">{String(riverAlerts.error)}</p>}
      {error && <p role="alert" className="command-error">{error}</p>}
      <ul className="compact-list">
        {riverAlerts.data?.map((alert) => (
          <li key={alert.id} className="alert-row">
            <Badge variant={alert.enabled && alert.state > 0 ? "secondary" : "outline"}>{riverAlertStatus(alert)}</Badge>
            <span className="alert-text">{alert.description}</span>
            <Button size="xs" variant="ghost" onClick={() => void toggle(alert)}>{alert.enabled ? "Pause" : "Resume"}</Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
