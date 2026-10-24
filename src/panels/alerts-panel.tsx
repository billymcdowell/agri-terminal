import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { deleteAlert, listAlerts, saveAlert, setAlertEnabled, type PriceAlert } from "@/lib/ipc";
import { COMMODITIES } from "@/lib/regions";
import type { PanelComponentProps } from "@/workspace/types";
import { PanelHeader } from "./panel-header";

export function describeAlert(alert: Pick<PriceAlert, "symbol" | "direction" | "threshold">) {
  return `${alert.symbol} at or ${alert.direction} ${alert.threshold.toFixed(2)} USD/bu`;
}

/** Parses the threshold field; returns null for anything that is not a positive price. */
export function parseThreshold(text: string): number | null {
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function AlertsPanel({ api, params }: PanelComponentProps) {
  const queryClient = useQueryClient();
  const alerts = useQuery({ queryKey: ["alerts"], queryFn: listAlerts });
  const [symbol, setSymbol] = useState("ZC");
  const [direction, setDirection] = useState<PriceAlert["direction"]>("above");
  const [threshold, setThreshold] = useState("");
  const [error, setError] = useState("");
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["alerts"] });
  const run = (action: () => Promise<unknown>) => action().then(() => { setError(""); return refresh(); }).catch((failure) => setError(String(failure)));

  const price = parseThreshold(threshold);
  return (
    <div className="workspace-panel">
      <PanelHeader eyebrow="PRICE ALERTS" title="Alerts" api={api} params={params} />
      <Card className="terminal-card">
        <CardHeader><CardTitle className="side-card-title">New alert on the latest daily close</CardTitle></CardHeader>
        <CardContent>
          <form className="schema-form" onSubmit={(event) => { event.preventDefault(); if (price !== null) void run(async () => { await saveAlert({ id: crypto.randomUUID(), symbol, direction, threshold: price }); setThreshold(""); }); }}>
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
              <Label htmlFor="alert-threshold">Price (USD/bu)</Label>
              <Input id="alert-threshold" inputMode="decimal" value={threshold} onChange={(event) => setThreshold(event.currentTarget.value)} aria-invalid={threshold !== "" && price === null} />
            </div>
            <Button type="submit" size="sm" disabled={price === null}>Add alert</Button>
          </form>
          {error && <p role="alert" className="command-error">{error}</p>}
        </CardContent>
      </Card>
      <Card className="terminal-card">
        <CardHeader><CardTitle className="side-card-title">Your alerts</CardTitle></CardHeader>
        <CardContent>
          {alerts.data?.length === 0 && <p className="panel-freshness">No alerts yet. Alerts check after every price update and fire once per crossing.</p>}
          <ul className="driver-list">
            {alerts.data?.map((alert) => (
              <li key={alert.id} className="driver-row">
                <div className="driver-head">
                  <Badge variant={alert.triggered ? "secondary" : "outline"}>{!alert.enabled ? "PAUSED" : alert.triggered ? "TRIGGERED" : "ARMED"}</Badge>
                  <span>{describeAlert(alert)}</span>
                </div>
                <div className="driver-actions">
                  <Button size="xs" variant="ghost" onClick={() => void run(() => setAlertEnabled(alert.id, !alert.enabled))}>{alert.enabled ? "Pause" : "Resume"}</Button>
                  <Button size="xs" variant="ghost" onClick={() => void run(() => deleteAlert(alert.id))}>Delete</Button>
                </div>
              </li>
            ))}
          </ul>
          <p className="panel-freshness">Notifications use your system settings. Alerts use daily closes, so they cannot fire between data updates.</p>
        </CardContent>
      </Card>
    </div>
  );
}
