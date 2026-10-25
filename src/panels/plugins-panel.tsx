import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { installPlugin, listPlugins, previewPlugin, refreshSource, removePlugin, savePluginSecret, setSourceEnabled, type PluginPreview, type PluginSummary } from "@/lib/ipc";
import { useSources } from "@/state/use-series";
import type { PanelComponentProps } from "@/workspace/types";
import { PanelHeader } from "./panel-header";
import { permissionLines } from "./plugin-text";

function PluginCard({ plugin, enabled, onChanged }: { plugin: PluginSummary; enabled: boolean | undefined; onChanged: () => void }) {
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const run = (action: () => Promise<unknown>, done: string) => action().then(() => { setMessage(done); onChanged(); }).catch((error) => setMessage(String(error)));

  if (plugin.errors.length) {
    return (
      <Card className="terminal-card">
        <CardHeader><CardTitle className="side-card-title">{plugin.name} · cannot load</CardTitle></CardHeader>
        <CardContent>
          <ul className="plugin-errors">{plugin.errors.map((error) => <li key={error}>{error}</li>)}</ul>
          <Button size="xs" variant="ghost" onClick={() => void run(() => removePlugin(plugin.id), "Removed.")}>Remove</Button>
        </CardContent>
      </Card>
    );
  }
  const missingSecret = plugin.secrets.some((secret) => !secret.configured);
  return (
    <Card className="terminal-card">
      <CardHeader>
        <CardTitle className="side-card-title">
          {plugin.name} <span className="driver-time">v{plugin.version}</span>{" "}
          <Badge variant="outline">{plugin.builtin ? "BUILT IN" : "INSTALLED"}</Badge>{" "}
          <Badge variant={enabled ? "secondary" : "outline"}>{enabled ? "ENABLED" : "OFF"}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {plugin.description && <p className="panel-freshness">{plugin.description}</p>}
        <ul className="plugin-permissions">{permissionLines(plugin).map((line) => <li key={line}>{line}</li>)}</ul>
        {plugin.licenseNote && <p className="panel-freshness">{plugin.licenseNote}</p>}
        {plugin.secrets.map((secret) => (
          <div className="schema-form" key={secret.name}>
            <div className="schema-field">
              <Label htmlFor={`${plugin.id}-${secret.name}`}>{secret.name} {secret.configured ? "(saved in keychain)" : "(required)"}</Label>
              <Input id={`${plugin.id}-${secret.name}`} type="password" autoComplete="off" value={secrets[secret.name] ?? ""} onChange={(event) => setSecrets({ ...secrets, [secret.name]: event.currentTarget.value })} />
            </div>
            <Button size="sm" variant="outline" disabled={!secrets[secret.name]?.trim()} onClick={() => void run(async () => { await savePluginSecret(plugin.id, secret.name, secrets[secret.name]); setSecrets({ ...secrets, [secret.name]: "" }); }, "Secret saved in the keychain.")}>Save secret</Button>
          </div>
        ))}
        <div className="driver-actions">
          <Button size="xs" variant="ghost" onClick={() => void run(() => setSourceEnabled(plugin.id, !enabled), enabled ? "Switched off." : "Switched on.")}>{enabled ? "Turn off" : "Turn on"}</Button>
          <Button size="xs" variant="ghost" disabled={!enabled || missingSecret} onClick={() => void run(() => refreshSource(plugin.id), "Refreshed.")}>Refresh now</Button>
          {!plugin.builtin && <Button size="xs" variant="ghost" onClick={() => void run(() => removePlugin(plugin.id), "Removed.")}>Remove</Button>}
        </div>
        {message && <p role="status" className="panel-freshness">{message}</p>}
      </CardContent>
    </Card>
  );
}

export function PluginsPanel({ api, params }: PanelComponentProps) {
  const queryClient = useQueryClient();
  const plugins = useQuery({ queryKey: ["plugins"], queryFn: listPlugins });
  const sources = useSources();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<PluginPreview | null>(null);
  const [error, setError] = useState("");
  const changed = () => { void queryClient.invalidateQueries({ queryKey: ["plugins"] }); void queryClient.invalidateQueries({ queryKey: ["sources"] }); };

  return (
    <div className="workspace-panel">
      <PanelHeader eyebrow="PLUGINS" title="Data source plugins" api={api} params={params} />
      <Card className="terminal-card">
        <CardHeader><CardTitle className="side-card-title">Install a plugin</CardTitle></CardHeader>
        <CardContent>
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
              <Button size="sm" onClick={() => void installPlugin(text).then(() => { setText(""); setPreview(null); changed(); }).catch((failure) => setError(String(failure)))}>Install (starts switched off)</Button>
            </div>
          )}
          {error && <p role="alert" className="command-error">{error}</p>}
        </CardContent>
      </Card>
      {plugins.data?.map((plugin) => (
        <PluginCard key={plugin.id} plugin={plugin} enabled={sources.data?.find((source) => source.sourceId === plugin.id)?.enabled} onChanged={changed} />
      ))}
    </div>
  );
}
