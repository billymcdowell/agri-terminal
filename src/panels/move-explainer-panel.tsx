import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { explainMoves, type Driver, type MoveExplanation } from "@/lib/ipc";
import { usePersistedValue } from "@/state/use-persisted-list";
import type { PanelComponentProps } from "@/workspace/types";
import { EXPLAINER_TEXT } from "./explainer-text";
import { PanelHeader, usePanelCommodity } from "./panel-header";

const THRESHOLDS = [1.5, 2, 2.5, 3];
/** Most recent flagged moves shown; older ones stay available through a higher threshold. */
const MAX_MOVES = 25;
const driverKey = (symbol: string, move: MoveExplanation, driver: Driver) => `${symbol}|${move.move.date}|${driver.kind}|${driver.title}`;

function DriverRow({ driver, pinned, onPin, onDismiss }: { driver: Driver; pinned: boolean; onPin: () => void; onDismiss: () => void }) {
  return (
    <li className="driver-row">
      <div className="driver-head">
        <Badge variant={driver.label === "Likely driver" ? "secondary" : "outline"}>{driver.label.toUpperCase()}</Badge>
        {pinned && <Badge variant="outline">PINNED</Badge>}
        <span className="driver-time">{new Date(driver.at).toLocaleString()} · {driver.source}</span>
      </div>
      {driver.url ? <a href={driver.url} target="_blank" rel="noreferrer">{driver.title}</a> : <span>{driver.title}</span>}
      <details>
        <summary>{EXPLAINER_TEXT.reasonsHeading}</summary>
        <ul>{driver.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      </details>
      <div className="driver-actions">
        <Button size="xs" variant="ghost" onClick={onPin}>{pinned ? EXPLAINER_TEXT.unpin : EXPLAINER_TEXT.pin}</Button>
        <Button size="xs" variant="ghost" onClick={onDismiss}>{EXPLAINER_TEXT.dismiss}</Button>
      </div>
    </li>
  );
}

export function MoveExplainerPanel({ api, params }: PanelComponentProps) {
  const { commodity, change } = usePanelCommodity(params, api);
  const [threshold, setThreshold] = useState(2);
  const moves = useQuery({ queryKey: ["moves", commodity, threshold], queryFn: () => explainMoves(commodity, threshold) });
  const [pinned, setPinned] = usePersistedValue<string[]>("explainer.pinned", []);
  const [dismissed, setDismissed] = usePersistedValue<string[]>("explainer.dismissed", []);
  const [notes, setNotes] = usePersistedValue<Record<string, string>>("explainer.notes", {});
  const toggle = (list: string[], key: string) => (list.includes(key) ? list.filter((item) => item !== key) : [...list, key]);
  const dismissedCount = (moves.data ?? []).reduce((total, item) => total + item.drivers.filter((driver) => dismissed.includes(driverKey(commodity, item, driver))).length, 0);

  return (
    <div className="workspace-panel">
      <PanelHeader eyebrow={EXPLAINER_TEXT.eyebrow} title={EXPLAINER_TEXT.heading(commodity)} api={api} params={params} commodity={commodity} onCommodityChange={change} />
      <p className="panel-freshness">{EXPLAINER_TEXT.intro}</p>
      <div className="explainer-controls">
        <label htmlFor="explainer-threshold">Sensitivity</label>
        <NativeSelect size="sm" id="explainer-threshold" value={threshold} onChange={(event) => setThreshold(Number(event.currentTarget.value))}>
          {THRESHOLDS.map((value) => <NativeSelectOption key={value} value={value}>{value} standard deviations</NativeSelectOption>)}
        </NativeSelect>
        {dismissedCount > 0 && <Button size="xs" variant="ghost" onClick={() => setDismissed([])}>{EXPLAINER_TEXT.restore(dismissedCount)}</Button>}
      </div>
      {moves.data?.length === 0 && <p className="panel-freshness">{EXPLAINER_TEXT.noMoves}</p>}
      {moves.isError && <p className="panel-freshness" data-status="error">{String(moves.error)}</p>}
      {moves.data?.slice(0, MAX_MOVES).map((item) => {
        const visible = item.drivers
          .filter((driver) => !dismissed.includes(driverKey(commodity, item, driver)))
          .sort((a, b) => Number(pinned.includes(driverKey(commodity, item, b))) - Number(pinned.includes(driverKey(commodity, item, a))));
        const noteKey = `${commodity}|${item.move.date}`;
        return (
          <Card className="terminal-card" key={item.move.date}>
            <CardHeader>
              <CardTitle className="side-card-title">
                {item.move.date} · {item.move.logReturn >= 0 ? "▲" : "▼"} {(item.move.logReturn * 100).toFixed(2)}% · {Math.abs(item.move.zScore).toFixed(1)} SD
              </CardTitle>
            </CardHeader>
            <CardContent>
              {visible.length === 0 ? (
                <p className="panel-freshness">{EXPLAINER_TEXT.none}</p>
              ) : (
                <ul className="driver-list">
                  {visible.map((driver) => {
                    const key = driverKey(commodity, item, driver);
                    return <DriverRow key={key} driver={driver} pinned={pinned.includes(key)} onPin={() => setPinned(toggle(pinned, key))} onDismiss={() => setDismissed([...dismissed, key])} />;
                  })}
                </ul>
              )}
              <Input aria-label={`Note for ${item.move.date}`} placeholder={EXPLAINER_TEXT.notePlaceholder} defaultValue={notes[noteKey] ?? ""} onBlur={(event) => setNotes({ ...notes, [noteKey]: event.currentTarget.value })} />
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
