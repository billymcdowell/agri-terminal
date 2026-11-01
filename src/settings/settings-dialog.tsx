import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { exportSeriesCsv, exportWorkspace, getDataDirectory, listSeries, listWorkspaces } from "@/lib/ipc";
import { useTheme, type ThemeSetting } from "@/lib/theme";
import { UNIT_LABELS, type UnitSystem } from "@/lib/units";
import { usePersistedValue } from "@/state/use-persisted-list";
import { DataSources } from "./data-sources";
import { RawDataViewer } from "./raw-data-viewer";
import { useSettingsScreen, type SettingsSection } from "./use-settings-screen";

const THEME_LABELS: Record<ThemeSetting, string> = { dark: "Dark", light: "Light", system: "Match system" };
const SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "general", label: "General" },
  { id: "sources", label: "Data sources" },
  { id: "data", label: "Data and export" },
];

export function GeneralSettings() {
  const theme = useTheme((state) => state.setting);
  const setTheme = useTheme((state) => state.setSetting);
  const [units, setUnits] = usePersistedValue<UnitSystem>("units", "bushel");
  const [, setProfile] = usePersistedValue<unknown>("profile", null);
  const close = useSettingsScreen((state) => state.close);
  return (
    <>
      <section className="settings-group">
        <h3>Display</h3>
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
        </div>
        <p className="settings-note">Units only change how prices are shown; stored prices stay in U.S. dollars per bushel.</p>
      </section>
      <section className="settings-group">
        <h3>Setup</h3>
        <div><Button size="sm" variant="outline" onClick={() => { close(); setProfile(null); }}>Run first-time setup again</Button></div>
        <p className="settings-note">Choose a role, crops and home state again, and load a starting layout. This replaces the current layout.</p>
      </section>
    </>
  );
}

export function DataAndExport() {
  const directory = useQuery({ queryKey: ["data-directory"], queryFn: getDataDirectory });
  const series = useQuery({ queryKey: ["series-list"], queryFn: listSeries });
  const workspaces = useQuery({ queryKey: ["workspace-list"], queryFn: listWorkspaces });
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
    <>
      <section className="settings-group">
        <h3>Data folder</h3>
        <p className="settings-note"><code>{directory.data ?? "Unavailable outside the desktop app"}</code></p>
        <p className="settings-note">The database, logs, plugins, cache and exports live here. Keys are never stored in this folder.</p>
        {directory.data && <div><Button size="xs" variant="outline" onClick={() => void revealItemInDir(directory.data!)}>Show in file manager</Button></div>}
      </section>
      <section className="settings-group">
        <h3>Export</h3>
        <div className="schema-form">
          <div className="schema-field">
            <Label htmlFor="export-series">Series</Label>
            <NativeSelect size="sm" id="export-series" value={selectedSeries} onChange={(event) => setSeriesId(event.currentTarget.value)}>
              {series.data?.map((id) => <NativeSelectOption key={id} value={id}>{id}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <Button size="sm" disabled={!selectedSeries} onClick={() => run(() => exportSeriesCsv(selectedSeries))}>Export series as CSV</Button>
        </div>
        <div className="schema-form">
          <div className="schema-field">
            <Label htmlFor="export-workspace">Workspace</Label>
            <NativeSelect size="sm" id="export-workspace" value={selectedWorkspace} onChange={(event) => setWorkspaceId(event.currentTarget.value)}>
              {workspaces.data?.map(([id, name]) => <NativeSelectOption key={id} value={id}>{name}</NativeSelectOption>)}
            </NativeSelect>
          </div>
          <Button size="sm" disabled={!selectedWorkspace} onClick={() => run(() => exportWorkspace(selectedWorkspace))}>Export workspace</Button>
        </div>
        <p className="settings-note">A series export includes every stored revision with its source, release time and fetch time. Files are written to the data folder.</p>
        {exported && (
          <p role="status" className="source-success">
            Saved to <code>{exported}</code> <Button size="xs" variant="ghost" onClick={() => void revealItemInDir(exported)}>Show</Button>
          </p>
        )}
        {error && <p role="alert" className="source-error">{error}</p>}
      </section>
      <section className="settings-group">
        <h3>Stored data</h3>
        <p className="settings-note">Every row each source has stored, exactly as saved. Use it to check what was downloaded and when.</p>
        <RawDataViewer />
      </section>
    </>
  );
}

/** One screen for display preferences, every data source and key, and exports. */
export function SettingsDialog() {
  const { open, section, setSection, close } = useSettingsScreen();
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent className="settings-dialog">
        <DialogHeader className="settings-header">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Display, data sources and keys, and exports.</DialogDescription>
        </DialogHeader>
        <Tabs orientation="vertical" value={section} onValueChange={(value) => setSection(value as SettingsSection)} className="settings-tabs">
          <TabsList variant="line" className="settings-nav">
            {SECTIONS.map(({ id, label }) => <TabsTrigger key={id} value={id}>{label}</TabsTrigger>)}
          </TabsList>
          <TabsContent value="general" className="settings-body"><GeneralSettings /></TabsContent>
          <TabsContent value="sources" className="settings-body"><DataSources /></TabsContent>
          <TabsContent value="data" className="settings-body"><DataAndExport /></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
