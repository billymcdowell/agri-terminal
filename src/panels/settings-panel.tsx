import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { exportSeriesCsv, exportWorkspace, getDataDirectory, listSeries, listWorkspaces } from "@/lib/ipc";
import { useTheme, type ThemeSetting } from "@/lib/theme";
import { UNIT_LABELS, type UnitSystem } from "@/lib/units";
import { usePersistedValue } from "@/state/use-persisted-list";
import { DEFAULT_LEAD_HOURS, LEAD_HOUR_OPTIONS } from "@/workspace/release-alerts";
import type { PanelComponentProps } from "@/workspace/types";
import { PanelHeader } from "./panel-header";

const THEME_LABELS: Record<ThemeSetting, string> = { dark: "Dark", light: "Light", system: "Match system" };
const leadLabel = (hours: number) => (hours === 0 ? "Off" : `${hours} hour${hours === 1 ? "" : "s"} before`);

export function Preferences() {
  const theme = useTheme((state) => state.setting);
  const setTheme = useTheme((state) => state.setSetting);
  const [units, setUnits] = usePersistedValue<UnitSystem>("units", "bushel");
  const [leadHours, setLeadHours] = usePersistedValue<number>("release-alert-lead-hours", DEFAULT_LEAD_HOURS);
  return (
    <Card className="terminal-card">
      <CardHeader><CardTitle className="side-card-title">Preferences</CardTitle></CardHeader>
      <CardContent>
        <div className="schema-form">
          <div className="schema-field">
            <Label htmlFor="pref-theme">Theme</Label>
            <NativeSelect size="sm" id="pref-theme" value={theme} onChange={(event) => setTheme(event.currentTarget.value as ThemeSetting)}>
              {(Object.keys(THEME_LABELS) as ThemeSetting[]).map((key) => <NativeSelectOption key={key} value={key}>{THEME_LABELS[key]}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <div className="schema-field">
            <Label htmlFor="pref-units">Price units</Label>
            <NativeSelect size="sm" id="pref-units" value={units} onChange={(event) => setUnits(event.currentTarget.value as UnitSystem)}>
              {(Object.keys(UNIT_LABELS) as UnitSystem[]).map((key) => <NativeSelectOption key={key} value={key}>{UNIT_LABELS[key]}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <div className="schema-field">
            <Label htmlFor="pref-lead">Release alerts</Label>
            <NativeSelect size="sm" id="pref-lead" value={String(leadHours)} onChange={(event) => setLeadHours(Number(event.currentTarget.value))}>
              {LEAD_HOUR_OPTIONS.map((hours) => <NativeSelectOption key={hours} value={String(hours)}>{leadLabel(hours)}</NativeSelectOption>)}
            </NativeSelect>
          </div>
        </div>
        <p className="panel-freshness">Stored prices stay in USD per bushel; units only change how they are shown. Release alerts notify before a scheduled report.</p>
      </CardContent>
    </Card>
  );
}

export function SettingsPanel({ api, params }: PanelComponentProps) {
  const directory = useQuery({ queryKey: ["data-directory"], queryFn: getDataDirectory });
  const series = useQuery({ queryKey: ["series-list"], queryFn: listSeries });
  const workspaces = useQuery({ queryKey: ["workspace-list"], queryFn: listWorkspaces });
  const [, setProfile] = usePersistedValue<unknown>("profile", null);
  const [seriesId, setSeriesId] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [exported, setExported] = useState<string | null>(null);
  const [error, setError] = useState("");

  const run = (action: () => Promise<string>) => {
    setError("");
    action().then(setExported).catch((failure) => { setExported(null); setError(String(failure)); });
  };
  const selectedSeries = seriesId || series.data?.[0] || "";
  const selectedWorkspace = workspaceId || workspaces.data?.[0]?.[0] || "";

  return (
    <div className="workspace-panel">
      <PanelHeader eyebrow="SETTINGS" title="Settings and export" api={api} params={params} />
      <Preferences />
      <Card className="terminal-card">
        <CardHeader><CardTitle className="side-card-title">Data directory</CardTitle></CardHeader>
        <CardContent>
          <p className="panel-freshness"><code>{directory.data ?? "Unavailable outside the desktop app"}</code></p>
          <p className="panel-freshness">The database, logs, plugins, cache and exports live here. Keys are never stored in this folder; they stay in your operating system keychain.</p>
          {directory.data && <Button size="xs" variant="outline" onClick={() => void revealItemInDir(directory.data!)}>Show in file manager</Button>}
        </CardContent>
      </Card>
      <Card className="terminal-card">
        <CardHeader><CardTitle className="side-card-title">Export data to CSV</CardTitle></CardHeader>
        <CardContent>
          <div className="schema-form">
            <div className="schema-field">
              <Label htmlFor="export-series">Series</Label>
              <NativeSelect size="sm" id="export-series" value={selectedSeries} onChange={(event) => setSeriesId(event.currentTarget.value)}>
                {series.data?.map((id) => <NativeSelectOption key={id} value={id}>{id}</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <Button size="sm" disabled={!selectedSeries} onClick={() => run(() => exportSeriesCsv(selectedSeries))}>Export series</Button>
          </div>
          <p className="panel-freshness">Every stored revision is exported with its source, release time and fetch time.</p>
        </CardContent>
      </Card>
      <Card className="terminal-card">
        <CardHeader><CardTitle className="side-card-title">Export workspace</CardTitle></CardHeader>
        <CardContent>
          <div className="schema-form">
            <div className="schema-field">
              <Label htmlFor="export-workspace">Workspace</Label>
              <NativeSelect size="sm" id="export-workspace" value={selectedWorkspace} onChange={(event) => setWorkspaceId(event.currentTarget.value)}>
                {workspaces.data?.map(([id, name]) => <NativeSelectOption key={id} value={id}>{name}</NativeSelectOption>)}
              </NativeSelect>
            </div>
            <Button size="sm" disabled={!selectedWorkspace} onClick={() => run(() => exportWorkspace(selectedWorkspace))}>Export workspace</Button>
          </div>
        </CardContent>
      </Card>
      <Card className="terminal-card">
        <CardHeader><CardTitle className="side-card-title">Setup</CardTitle></CardHeader>
        <CardContent>
          <Button size="sm" variant="outline" onClick={() => setProfile(null)}>Run first-time setup again</Button>
          <p className="panel-freshness">Choose a role, crops and home state, and load a template workspace. This replaces the current layout.</p>
        </CardContent>
      </Card>
      {exported && (
        <p role="status" className="panel-freshness" data-status="ok">
          Saved to <code>{exported}</code> <Button size="xs" variant="ghost" onClick={() => void revealItemInDir(exported)}>Show</Button>
        </p>
      )}
      {error && <p role="alert" className="command-error">{error}</p>}
    </div>
  );
}
