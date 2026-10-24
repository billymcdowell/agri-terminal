import { useCallback, useEffect, useRef, useState } from "react";
import { createDockview, type DockviewApi, type IContentRenderer } from "dockview";
import { useQueryClient } from "@tanstack/react-query";
import "dockview/dist/styles/dockview.css";
import { RiAddLine, RiExternalLinkLine, RiSaveLine } from "@remixicon/react";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { listWorkspaces, saveWorkspace } from "@/lib/ipc";
import { registerBuiltInPanels, type MarketComponent } from "@/panels/register";
import { usePersistedValue } from "@/state/use-persisted-list";
import { planCommand, type CommandPlan } from "@/workspace/commands";
import { Onboarding } from "@/workspace/onboarding";
import { panelTitle } from "@/workspace/panel-title";
import { getTemplate, linkGroupTargets, planTemplate, TEMPLATES, type Profile } from "@/workspace/templates";
import { GROUP_COLORS, LINK_GROUPS, useLinkGroups } from "@/workspace/link-groups";
import { panelRootContent } from "@/workspace/panel-root";
import { getPanel, listPanels } from "@/workspace/registry";
import { openPopout } from "@/workspace/popout";
import { restoreWorkspace, serializeWorkspace } from "@/workspace/serialization";
import type { PanelApiLike, PanelParams } from "@/workspace/types";
import { useAlertNotifications, useDataUpdateInvalidation, useLinkGroupPersistence, useReleaseAlerts } from "@/workspace/use-workspace-effects";
import { createRoot, type Root } from "react-dom/client";

type Props = { MarketOverview: MarketComponent };

const AUTOSAVE_DELAY_MS = 700;
const LAST_WORKSPACE_KEY = "agri-terminal-workspace-id";
const DEFAULT_WORKSPACE = { id: "default", name: "Market overview" };
type DockLayout = Parameters<DockviewApi["fromJSON"]>[0];

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "default";

function PanelHost({ api, params, name }: { api: PanelApiLike; params: PanelParams; name: string }) {
  const definition = getPanel(params.kind ?? name);
  if (!definition) return <div className="workspace-panel"><p>Unknown panel type “{params.kind ?? name}”.</p></div>;
  const Component = definition.component;
  return <Component api={api} params={{ ...params, kind: definition.type }} />;
}

export function WorkspaceShell({ MarketOverview }: Props) {
  registerBuiltInPanels(MarketOverview);
  useDataUpdateInvalidation();
  useReleaseAlerts();
  useAlertNotifications();
  useLinkGroupPersistence();
  const [profile, setProfile, profileReady] = usePersistedValue<(Profile & { skipped?: boolean }) | null>("profile", null);
  const queryClient = useQueryClient();
  const dockApi = useRef<DockviewApi | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const restored = useRef(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const workspaceId = useRef(DEFAULT_WORKSPACE.id);
  const workspaceNameRef = useRef(DEFAULT_WORKSPACE.name);
  const [workspaceName, setWorkspaceName] = useState(DEFAULT_WORKSPACE.name);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [command, setCommand] = useState("");
  const [commandError, setCommandError] = useState("");
  const groups = useLinkGroups((state) => state.groups);
  const [savedWorkspaces, setSavedWorkspaces] = useState<string[]>([]);
  useEffect(() => {
    if (paletteOpen) void listWorkspaces().then((all) => setSavedWorkspaces(all.map(([, name]) => name))).catch(() => setSavedWorkspaces([]));
  }, [paletteOpen]);

  const saveLayout = useCallback(async () => {
    const api = dockApi.current;
    if (!api || !restored.current) return;
    const json = serializeWorkspace(api.toJSON());
    try { localStorage.setItem(`agri-terminal-workspace:${workspaceId.current}`, json); } catch { /* Storage can be unavailable. */ }
    try { await saveWorkspace(workspaceId.current, workspaceNameRef.current, json); } catch { /* The web preview has no Tauri backend. */ }
  }, []);

  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void saveLayout(), AUTOSAVE_DELAY_MS);
  }, [saveLayout]);

  const addPanel = useCallback((params: PanelParams) => {
    const api = dockApi.current;
    if (!api) return;
    const definition = getPanel(params.kind);
    if (!definition) return;
    const existing = api.panels.find((panel) => {
      const current = panel.params as Partial<PanelParams> | undefined;
      return (current?.kind ?? panel.api.component) === params.kind && (params.kind !== "drought" || current?.region === params.region);
    });
    if (existing) { existing.api.setActive(); return; }
    const merged = { ...definition.defaultConfig, ...params };
    api.addPanel({
      id: crypto.randomUUID(),
      component: "panel",
      title: panelTitle(merged),
      params: merged,
      position: api.panels.length ? { referencePanel: api.activePanel?.id ?? api.panels[0].id, direction: "right" } : undefined,
    });
  }, []);

  /** Replaces the dock with the named workspace's saved layout, or a fresh default when none is saved. */
  const loadWorkspace = useCallback(async (id: string, name: string) => {
    const api = dockApi.current;
    if (!api) return;
    restored.current = false;
    workspaceId.current = id;
    workspaceNameRef.current = name;
    setWorkspaceName(name);
    let json: string | undefined;
    try { json = (await listWorkspaces()).find(([savedId]) => savedId === id)?.[2]; } catch { /* Fall through to local storage. */ }
    try { json ??= localStorage.getItem(`agri-terminal-workspace:${id}`) ?? undefined; } catch { /* Storage can be unavailable. */ }
    let applied = false;
    if (json) {
      try { api.fromJSON(restoreWorkspace(json).layout as DockLayout); applied = true; } catch { applied = false; }
    }
    if (!applied) {
      api.clear();
      restored.current = true;
      addPanel({ kind: "market" });
    }
    restored.current = true;
    try { localStorage.setItem(LAST_WORKSPACE_KEY, id); } catch { /* Storage can be unavailable. */ }
  }, [addPanel]);

  useEffect(() => {
    if (!hostRef.current) return;
    const roots = new Set<Root>();
    const api = createDockview(hostRef.current, {
      className: "dockview-theme-abyss",
      createComponent: ({ name }): IContentRenderer => {
        const element = document.createElement("div");
        element.className = "workspace-panel-container";
        let root: Root | undefined;
        let current: PanelParams = { kind: name };
        let panelApi: PanelApiLike | undefined;
        const render = () => root?.render(panelRootContent(queryClient, <PanelHost api={panelApi!} params={current} name={name} />));
        return {
          element,
          init: ({ api: dockPanelApi, params }) => {
            panelApi = dockPanelApi;
            current = { kind: name, ...(params as Partial<PanelParams>) };
            root = createRoot(element);
            roots.add(root);
            render();
          },
          update: ({ params }) => { current = { ...current, ...(params as Partial<PanelParams>) }; render(); },
          dispose: () => { if (root) { root.unmount(); roots.delete(root); } },
        };
      },
    });
    dockApi.current = api;
    const layoutSubscription = api.onDidLayoutChange(scheduleSave);
    let lastId = DEFAULT_WORKSPACE.id;
    try { lastId = localStorage.getItem(LAST_WORKSPACE_KEY) ?? lastId; } catch { /* Storage can be unavailable. */ }
    void (async () => {
      const saved = await listWorkspaces().catch(() => []);
      const name = saved.find(([id]) => id === lastId)?.[1] ?? DEFAULT_WORKSPACE.name;
      await loadWorkspace(lastId, name);
    })();
    return () => {
      window.clearTimeout(saveTimer.current);
      layoutSubscription.dispose();
      api.dispose();
      roots.clear();
      dockApi.current = null;
      restored.current = false;
    };
  }, [queryClient, scheduleSave, loadWorkspace]);

  useEffect(() => {
    workspaceNameRef.current = workspaceName;
    if (restored.current) scheduleSave();
  }, [workspaceName, scheduleSave]);

  const cyclePanel = useCallback((delta: number) => {
    const api = dockApi.current;
    if (!api || !api.panels.length) return;
    const index = api.panels.findIndex((panel) => panel.id === api.activePanel?.id);
    api.panels[(index + delta + api.panels.length) % api.panels.length].api.setActive();
  }, []);

  /** Moves the active panel into its own window. */
  const popOutActive = useCallback(async () => {
    const panel = dockApi.current?.activePanel;
    if (!panel) return;
    const params = { ...(panel.params as Partial<PanelParams>), kind: (panel.params as Partial<PanelParams> | undefined)?.kind ?? panel.api.component } as PanelParams;
    try {
      await openPopout(params, panel.title ?? panelTitle(params));
      panel.api.close();
    } catch (error) {
      setCommandError(`Could not open a window: ${String(error)}`);
      setPaletteOpen(true);
    }
  }, []);

  /** Replaces the dock with a template's panels and points link groups at the profile's crops. */
  const applyTemplate = useCallback((templateId: string, chosen: Pick<Profile, "commodities" | "region">) => {
    const api = dockApi.current;
    const template = getTemplate(templateId);
    if (!api || !template) return;
    for (const [group, commodity] of Object.entries(linkGroupTargets(chosen.commodities))) useLinkGroups.getState().setCommodity(group, commodity);
    api.clear();
    const ids: string[] = [];
    for (const item of planTemplate(template, chosen)) {
      const id = crypto.randomUUID();
      ids.push(id);
      const merged = { ...getPanel(item.params.kind)?.defaultConfig, ...item.params };
      api.addPanel({
        id,
        component: "panel",
        title: panelTitle(merged),
        params: merged,
        position: item.position ? { referencePanel: ids[item.position.index], direction: item.position.direction } : undefined,
      });
    }
  }, []);

  const completeOnboarding = useCallback((chosen: Profile) => {
    setProfile(chosen);
    applyTemplate(chosen.role, chosen);
  }, [applyTemplate, setProfile]);

  const execute = useCallback(async (plan: CommandPlan) => {
    if (plan.type === "error") { setCommandError(plan.message); return; }
    if (plan.type === "workspace") {
      await saveLayout();
      // Match an existing workspace by display name first, so renamed workspaces can be switched to.
      const match = (await listWorkspaces().catch(() => [])).find(([id, name]) => id === slugify(plan.name) || name.toLowerCase() === plan.name.toLowerCase());
      await loadWorkspace(match?.[0] ?? slugify(plan.name), match?.[1] ?? plan.name);
    } else if (plan.type === "template") {
      applyTemplate(plan.id, profile ?? { commodities: ["ZC"], region: "ia" });
    } else {
      if (plan.retarget) useLinkGroups.getState().setCommodity(plan.retarget.group, plan.retarget.commodity);
      addPanel(plan.params);
    }
    setCommand(""); setCommandError(""); setPaletteOpen(false);
  }, [addPanel, applyTemplate, loadWorkspace, profile, saveLayout]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);
      if (event.key === "/" && !typing) { event.preventDefault(); setPaletteOpen(true); }
      else if (event.altKey && event.code === "ArrowRight") { event.preventDefault(); cyclePanel(1); }
      else if (event.altKey && event.code === "ArrowLeft") { event.preventDefault(); cyclePanel(-1); }
      else if (event.altKey && event.code === "KeyP") { event.preventDefault(); void popOutActive(); }
      else if (event.altKey && event.code === "KeyW") { event.preventDefault(); dockApi.current?.activePanel?.api.close(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cyclePanel, popOutActive]);

  return (
    <div className="workspace-shell dark">
      <div className="workspace-toolbar">
        <div>
          <span className="eyebrow">WORKSPACE</span>
          <Input aria-label="Workspace name" className="workspace-name-input" value={workspaceName} onChange={(event) => setWorkspaceName(event.currentTarget.value)} />
        </div>
        <div className="workspace-toolbar-actions">
          {LINK_GROUPS.map((group) => (
            <Badge key={group} variant="outline" aria-label={`Link group ${group} is ${groups[group].commodity}`}>
              <span aria-hidden="true" style={{ color: GROUP_COLORS[group] }}>●</span> {group} · {groups[group].commodity}
            </Badge>
          ))}
          <Button size="sm" variant="outline" onClick={() => void popOutActive()}><RiExternalLinkLine /> Pop out <kbd>⌥P</kbd></Button>
          <Button size="sm" variant="outline" onClick={() => setPaletteOpen(true)}><RiAddLine /> Add panel <kbd>/</kbd></Button>
          <Button size="sm" variant="secondary" onClick={() => void saveLayout()}><RiSaveLine /> Save</Button>
        </div>
      </div>
      <div className="dockview-host" ref={hostRef} />
      <Onboarding
        open={profileReady && profile === null}
        onComplete={completeOnboarding}
        onSkip={() => setProfile({ role: "student", commodities: ["ZC"], region: "ia", skipped: true })}
      />
      <CommandDialog open={paletteOpen} onOpenChange={(open) => { setPaletteOpen(open); if (!open) setCommandError(""); }} title="Command bar" description="Open a panel or switch workspace.">
        <Command>
          <CommandInput
            aria-label="Command"
            value={command}
            onValueChange={(value) => { setCommand(value); setCommandError(""); }}
            placeholder="ZC · ZC COT · WASDE · CROP CONDITION · DROUGHT IOWA · WX IOWA · NEWS · CALENDAR · WS name"
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !command.trim()) return;
              const plan = planCommand(command);
              // A typed command wins over whichever list item happens to be highlighted.
              if (plan.type !== "error" || !listPanels().some((panel) => `${panel.title} ${panel.command}`.toLowerCase().includes(command.trim().toLowerCase()))) {
                event.preventDefault();
                event.stopPropagation();
                void execute(plan);
              }
            }}
          />
          {commandError && <p role="alert" className="command-error">{commandError}</p>}
          <CommandList>
            <CommandEmpty>No matching command.</CommandEmpty>
            <CommandGroup heading="Panels">
              {listPanels().map((panel) => (
                <CommandItem key={panel.type} value={`${panel.title} ${panel.command}`} onSelect={() => void execute(planCommand(panel.command))}>
                  {panel.title}<span className="command-hint">{panel.command}</span>
                </CommandItem>
              ))}
              <CommandItem value="WS switch workspace" onSelect={() => setCommand("WS ")}>Switch workspace<span className="command-hint">WS name</span></CommandItem>
            </CommandGroup>
            <CommandGroup heading="Templates">
              {TEMPLATES.map((template) => (
                <CommandItem key={template.id} value={`template ${template.name} ${template.description}`} onSelect={() => void execute({ type: "template", id: template.id })}>
                  {template.name} template<span className="command-hint">TEMPLATE {template.id}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            {savedWorkspaces.length > 0 && (
              <CommandGroup heading="Workspaces">
                {savedWorkspaces.map((name) => (
                  <CommandItem key={name} value={`workspace ${name}`} onSelect={() => void execute({ type: "workspace", name })}>{name}<span className="command-hint">WS {name}</span></CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </div>
  );
}
