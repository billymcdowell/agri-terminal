import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RiMoreLine } from "@remixicon/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatAge, needsAttention } from "@/lib/freshness";
import { useSettingsScreen } from "./use-settings-screen";
import { getSecretStatus, installPlugin, listPlugins, previewPlugin, refreshSource, removePlugin, savePluginSecret, saveSecret, setSourceEnabled, testConnection, type PluginPreview, type PluginSummary, type SourceStatus } from "@/lib/ipc";
import { useSources } from "@/state/use-series";
import { permissionLines } from "./plugin-text";

/** The demonstration corn series is bundled with the app, not a source anyone manages. */
const HIDDEN_SOURCES = ["fixture-corn"];
/** Built-in sources that need a key, stored in the keychain under the source's id. Plugins list their own. */
const KEY_SOURCES = ["massive", "usda-nass", "usda-fas"];
/** What each built-in source feeds, in plain words. Other plugins describe themselves. */
const SOURCE_NOTES: Record<string, string> = {
  massive: "Daily corn, soybean and wheat futures prices for the price chart. Needs a free Massive key; the free Futures Basic plan is enough. A refresh takes about a minute because of the plan's rate limit.",
  "cftc-cot": "Weekly positions of large traders, for COT positioning. No key needed.",
  "usda-nass": "Weekly crop condition and progress. Needs a free USDA NASS QuickStats key.",
  "usda-fas": "Supply and demand balance sheets. Needs a free USDA FAS OpenData key.",
  "us-drought-monitor": "Weekly drought area by severity for each state, for Drought Monitor and the crop stress timeline. No key needed.",
  "usgs-river-stage": "Daily Mississippi river levels from USGS, for the river panels. No key needed.",
  "nwps-river-stage": "Daily river levels from the National Weather Service, for the river panels. No key needed.",
  "nwps-river-forecast": "River level forecasts from the National Weather Service, for the river panels. No key needed.",
  "usda-agtransport": "Weekly barge freight rates and lock traffic, for the river panels. No key needed.",
};

type SourceRowData = { source: SourceStatus; plugin?: PluginSummary };
type Status = { status: "ok" | "stale" | "error"; label: string };

/** Every source the user manages, the price source first, each with the plugin it comes from, if any. */
export function sourceRows(sources: SourceStatus[], plugins: PluginSummary[]): SourceRowData[] {
  const working = plugins.filter((plugin) => !plugin.errors.length);
  const rows: SourceRowData[] = sources
    .filter((source) => !HIDDEN_SOURCES.includes(source.sourceId))
    .map((source) => ({ source, plugin: working.find((plugin) => plugin.id === source.sourceId) }));
  // A plugin that is installed but not registered as a source yet still shows, switched off.
  for (const plugin of working) {
    if (rows.some((row) => row.source.sourceId === plugin.id)) continue;
    rows.push({ source: { sourceId: plugin.id, name: plugin.name, state: "idle", lastOk: null, error: null, isDemo: false, lastAttempt: null, nextExpected: null, enabled: false, cadenceSeconds: 0 }, plugin });
  }
  return rows.sort((a, b) => Number(b.source.sourceId === "massive") - Number(a.source.sourceId === "massive"));
}

/** One short status per source: paused, waiting for a key, failing, out of date, or how long since it last updated. */
export function sourceStatus(source: Pick<SourceStatus, "enabled" | "state" | "lastOk" | "cadenceSeconds">, missingKey: boolean, now: number): Status {
  if (!source.enabled) return { status: "stale", label: "Paused" };
  if (missingKey) return { status: "stale", label: "Needs a key" };
  if (source.state === "error") return { status: "error", label: "Last refresh failed" };
  if (source.lastOk && needsAttention({ ...source, lastOk: source.lastOk }, now)) return { status: "stale", label: `Out of date · updated ${formatAge(source.lastOk, now)}` };
  if (source.lastOk) return { status: "ok", label: `Updated ${formatAge(source.lastOk, now)}` };
  return { status: "stale", label: "Not loaded yet" };
}

function useRefreshSourceLists() {
  const queryClient = useQueryClient();
  return () => Promise.all(["sources", "plugins", "secret-status"].map((key) => queryClient.invalidateQueries({ queryKey: [key] })));
}

function SourceRow({ source, plugin, now }: SourceRowData & { now: number }) {
  const queryClient = useQueryClient();
  const refreshLists = useRefreshSourceLists();
  const builtInKey = !plugin && KEY_SOURCES.includes(source.sourceId);
  const keyStatus = useQuery({ queryKey: ["secret-status", source.sourceId], queryFn: () => getSecretStatus(source.sourceId), enabled: builtInKey });
  const secrets = plugin ? plugin.secrets : builtInKey ? [{ name: "key", configured: !!keyStatus.data }] : [];
  const missingKey = plugin ? plugin.secrets.some((secret) => !secret.configured) : builtInKey && keyStatus.data === false;
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function perform(doing: string, action: () => Promise<unknown>, done: string) {
    setBusy(doing);
    setMessage(null);
    try {
      await action();
      setMessage({ ok: true, text: done });
    } catch (error) {
      setMessage({ ok: false, text: String(error) });
    } finally {
      setBusy("");
      await refreshLists();
    }
  }
  const refresh = () => perform("Refreshing", async () => {
    await refreshSource(source.sourceId);
    await queryClient.invalidateQueries({ queryKey: ["series"] });
  }, "Refreshed.");
  const saveKey = (name: string) => perform("Saving the key", async () => {
    await (plugin ? savePluginSecret(plugin.id, name, values[name]) : saveSecret(source.sourceId, values[name]));
    setValues((current) => ({ ...current, [name]: "" }));
  }, "Key saved in your keychain.");

  const state: Status = busy ? { status: "stale", label: `${busy}…` } : sourceStatus(source, missingKey, now);
  const note = SOURCE_NOTES[source.sourceId] ?? plugin?.description;
  const canFetch = source.enabled && !missingKey && !busy;
  return (
    <li className="source-item">
      <div className="source-item-head">
        <span className="source-name">
          {source.name}
          {plugin && <Badge variant="outline">{plugin.builtin ? "BUILT-IN PLUGIN" : "PLUGIN"}</Badge>}
        </span>
        <span className="source-state" data-status={state.status}><i className="freshness-dot" aria-hidden="true" />{state.label}</span>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="icon-xs" variant="ghost" aria-label={`Actions for ${source.name}`} />}>
            <RiMoreLine />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem disabled={!canFetch} onClick={() => void refresh()}>Refresh now</DropdownMenuItem>
            <DropdownMenuItem disabled={!canFetch} onClick={() => void perform("Testing", () => testConnection(source.sourceId), "The connection works.")}>Test connection</DropdownMenuItem>
            <DropdownMenuItem disabled={!!busy} onClick={() => void perform(source.enabled ? "Pausing" : "Turning on", () => setSourceEnabled(source.sourceId, !source.enabled), source.enabled ? "Paused. It will not refresh until you turn it on." : "Turned on.")}>
              {source.enabled ? "Pause" : "Turn on"}
            </DropdownMenuItem>
            {plugin && !plugin.builtin && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={!!busy} onClick={() => void perform("Removing", () => removePlugin(plugin.id), "Removed.")}>Remove plugin</DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {note && <p className="source-note">{note}</p>}
      {secrets.map((secret) => (
        <div className="source-key" key={secret.name}>
          <Label htmlFor={`${source.sourceId}-${secret.name}`}>{plugin ? secret.name : "Key"}</Label>
          <Input
            id={`${source.sourceId}-${secret.name}`}
            aria-label={`${source.name} ${secret.name}`}
            type="password"
            autoComplete="off"
            value={values[secret.name] ?? ""}
            placeholder={secret.configured ? "Saved in your keychain" : "Paste your key"}
            onChange={(event) => setValues({ ...values, [secret.name]: event.currentTarget.value })}
          />
          <Button size="sm" variant="outline" disabled={!values[secret.name]?.trim() || !!busy} onClick={() => void saveKey(secret.name)}>Save key</Button>
        </div>
      ))}
      {plugin && (
        <details className="source-permissions">
          <summary>What this plugin can do</summary>
          <ul className="plugin-permissions">{permissionLines(plugin).map((line) => <li key={line}>{line}</li>)}</ul>
          {plugin.licenseNote && <p className="source-note">{plugin.licenseNote}</p>}
        </details>
      )}
      {message ? (
        <p role={message.ok ? "status" : "alert"} className={message.ok ? "source-success" : "source-error"}>{message.text}</p>
      ) : source.enabled && source.state === "error" && source.error ? (
        <p className="source-error">{source.error}</p>
      ) : null}
    </li>
  );
}

/** A plugin whose manifest no longer loads: its problems, and a way to remove it. */
function BrokenPluginRow({ plugin }: { plugin: PluginSummary }) {
  const refreshLists = useRefreshSourceLists();
  const [error, setError] = useState("");
  return (
    <li className="source-item">
      <div className="source-item-head">
        <span className="source-name">{plugin.name}<Badge variant="outline">PLUGIN</Badge></span>
        <span className="source-state" data-status="error"><i className="freshness-dot" aria-hidden="true" />Cannot load</span>
        <Button size="xs" variant="ghost" onClick={() => void removePlugin(plugin.id).then(refreshLists).catch((failure) => setError(String(failure)))}>Remove</Button>
      </div>
      <ul className="plugin-errors">{plugin.errors.map((item) => <li key={item}>{item}</li>)}</ul>
      {error && <p role="alert" className="source-error">{error}</p>}
    </li>
  );
}

function PluginInstaller() {
  const refreshLists = useRefreshSourceLists();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PluginPreview | null>(null);
  const [error, setError] = useState("");
  return (
    <details className="source-install">
      <summary>Add a source from a plugin file</summary>
      <p className="source-note">A plugin file (plugin.toml) describes another data source. Before anything runs you see the websites it will contact and the keys it uses, and it cannot run code or read your files.</p>
      <Label htmlFor="plugin-manifest">Paste a plugin.toml</Label>
      <textarea id="plugin-manifest" className="plugin-textarea" rows={6} spellCheck={false} value={text} onChange={(event) => { setText(event.currentTarget.value); setPreview(null); }} />
      <div className="driver-actions">
        <Button size="sm" variant="outline" disabled={!text.trim()} onClick={() => { setError(""); void previewPlugin(text).then(setPreview).catch((failure) => setError(String(failure))); }}>Review permissions</Button>
      </div>
      {preview?.errors.length ? <ul role="alert" className="plugin-errors">{preview.errors.map((item) => <li key={item}>{item}</li>)}</ul> : null}
      {preview?.summary && (
        <div className="plugin-review">
          <strong>{preview.summary.name} v{preview.summary.version}</strong>
          <ul className="plugin-permissions">{permissionLines(preview.summary).map((line) => <li key={line}>{line}</li>)}</ul>
          <Button size="sm" onClick={() => void installPlugin(text).then(() => { setText(""); setPreview(null); return refreshLists(); }).catch((failure) => setError(String(failure)))}>Install (starts switched off)</Button>
        </div>
      )}
      {error && <p role="alert" className="source-error">{error}</p>}
    </details>
  );
}

/** Every data source in one list: its status, its key when it needs one, and its actions. */
export function DataSources() {
  const sources = useSources();
  const plugins = useQuery({ queryKey: ["plugins"], queryFn: listPlugins });
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const problemsOnly = useSettingsScreen((state) => state.problemsOnly);
  const allRows = sourceRows(sources.data ?? [], plugins.data ?? []);
  const rows = problemsOnly ? allRows.filter((row) => needsAttention(row.source, now)) : allRows;
  const broken = problemsOnly ? [] : (plugins.data ?? []).filter((plugin) => plugin.errors.length);
  return (
    <div className="settings-sources">
      {problemsOnly ? (
        <p className="settings-intro" role="status">
          {rows.length === 0 ? "Every source is up to date now." : `${rows.length === 1 ? "This source is" : `These ${rows.length} sources are`} failing or out of date.`}{" "}
          <Button size="xs" variant="outline" onClick={() => useSettingsScreen.getState().showAllSources()}>Show all sources</Button>
        </p>
      ) : (
        <p className="settings-intro">Where AgriTerminal gets its data. Each source refreshes on its own schedule. Keys stay in your operating system's keychain, never in the app's files.</p>
      )}
      {sources.isError && <p role="alert" className="source-error">{String(sources.error)}</p>}
      <ul className="source-list">
        {rows.map((row) => <SourceRow key={row.source.sourceId} {...row} now={now} />)}
        {broken.map((plugin) => <BrokenPluginRow key={plugin.id} plugin={plugin} />)}
      </ul>
      {!problemsOnly && <PluginInstaller />}
    </div>
  );
}
