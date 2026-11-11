import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { explainMoves, type Driver, type MoveExplanation } from "@/lib/ipc";
import { usePersistedValue } from "@/state/use-persisted-list";
import { useCrop } from "@/shell/crop";
import { EXPLAINER_TEXT } from "./explainer-text";
import { PanelHeader } from "./panel-header";
import { ShowAll, useShowAll } from "./show-all";

/** Moves this many standard deviations from normal are flagged, the same rule as the price chart markers. */
export const THRESHOLD_SD = 2;
/** Big moves listed before "Show all". */
const LISTED = 5;
const driverKey = (symbol: string, move: MoveExplanation, driver: Driver) => `${symbol}|${move.move.date}|${driver.kind}|${driver.title}`;

/** The flagged moves for the crop, newest first, shared with the chart's markers. */
export function useMoves(commodity: string) {
  return useQuery({ queryKey: ["moves", commodity, THRESHOLD_SD], queryFn: () => explainMoves(commodity, THRESHOLD_SD) });
}

export function describeMove(item: MoveExplanation) {
  return `${item.move.date} · ${item.move.logReturn >= 0 ? "▲" : "▼"} ${(item.move.logReturn * 100).toFixed(2)}% · ${Math.abs(item.move.zScore).toFixed(1)} SD`;
}

/** The newest flagged moves, each with its leading possible driver. Picking one opens all its drivers. */
export function BigMovesSection({ onSelect }: { onSelect: (date: string) => void }) {
  const commodity = useCrop((state) => state.crop);
  const moves = useMoves(commodity);
  const [dismissed] = usePersistedValue<string[]>("explainer.dismissed", []);
  const items = moves.data ?? [];
  const { shown, all, toggle } = useShowAll(items, LISTED);
  return (
    <div className="workspace-panel">
      <PanelHeader title="Big moves" kind="moves" />
      {moves.isError && <p className="panel-freshness" data-status="error">{String(moves.error)}</p>}
      {moves.data?.length === 0 && <p className="panel-freshness">{EXPLAINER_TEXT.noMoves}</p>}
      <ul className="compact-list">
        {shown.map((item) => {
          const lead = item.drivers.find((driver) => !dismissed.includes(driverKey(commodity, item, driver)));
          return (
            <li key={item.move.date}>
              <button type="button" className="compact-row" onClick={() => onSelect(item.move.date)}>
                <span className="compact-main" data-direction={item.move.logReturn >= 0 ? "up" : "down"}>{describeMove(item)}</span>
                <span className="compact-meta" title={lead?.title}>{lead ? `${lead.label.toLowerCase()}: ${lead.title}` : EXPLAINER_TEXT.none}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <ShowAll total={items.length} limit={LISTED} all={all} onToggle={toggle} noun="moves" />
    </div>
  );
}

function DriverRow({ driver, onDismiss }: { driver: Driver; onDismiss: () => void }) {
  return (
    <li className="driver-row">
      <div className="driver-head">
        <Badge variant={driver.label === "Likely driver" ? "secondary" : "outline"}>{driver.label.toUpperCase()}</Badge>
        <span className="driver-time">{new Date(driver.at).toLocaleString()} · {driver.source}</span>
      </div>
      {driver.url ? <a href={driver.url} target="_blank" rel="noreferrer">{driver.title}</a> : <span>{driver.title}</span>}
      <details>
        <summary>{EXPLAINER_TEXT.reasonsHeading}</summary>
        <ul>{driver.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      </details>
      <div className="driver-actions">
        <Button size="xs" variant="ghost" onClick={onDismiss}>{EXPLAINER_TEXT.dismiss}</Button>
      </div>
    </li>
  );
}

/** A side drawer with every possible driver of one flagged move, opened from Big moves or a chart marker. */
export function MoveDriversDrawer({ date, onClose }: { date: string | null; onClose: () => void }) {
  const commodity = useCrop((state) => state.crop);
  const moves = useMoves(commodity);
  const [dismissed, setDismissed] = usePersistedValue<string[]>("explainer.dismissed", []);
  const [notes, setNotes] = usePersistedValue<Record<string, string>>("explainer.notes", {});
  const item = moves.data?.find((candidate) => candidate.move.date === date);
  const keyOf = (driver: Driver) => (item ? driverKey(commodity, item, driver) : "");
  const visible = item?.drivers.filter((driver) => !dismissed.includes(keyOf(driver))) ?? [];
  const hidden = item?.drivers.filter((driver) => dismissed.includes(keyOf(driver))) ?? [];
  const noteKey = `${commodity}|${date}`;
  return (
    <Sheet open={!!item} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent className="move-drawer">
        {item && (
          <>
            <SheetHeader>
              <SheetTitle>{describeMove(item)}</SheetTitle>
              <SheetDescription>{EXPLAINER_TEXT.intro}</SheetDescription>
            </SheetHeader>
            <div className="move-drawer-body">
              {visible.length === 0 ? <p className="panel-freshness">{EXPLAINER_TEXT.none}</p> : (
                <ul className="driver-list">
                  {visible.map((driver) => <DriverRow key={keyOf(driver)} driver={driver} onDismiss={() => setDismissed([...dismissed, keyOf(driver)])} />)}
                </ul>
              )}
              {hidden.length > 0 && (
                <Button size="xs" variant="ghost" onClick={() => setDismissed(dismissed.filter((key) => !hidden.some((driver) => keyOf(driver) === key)))}>{EXPLAINER_TEXT.restore(hidden.length)}</Button>
              )}
              <Input key={noteKey} aria-label={`Note for ${item.move.date}`} placeholder={EXPLAINER_TEXT.notePlaceholder} defaultValue={notes[noteKey] ?? ""} onBlur={(event) => setNotes({ ...notes, [noteKey]: event.currentTarget.value })} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
