import { useCallback, useEffect, useRef, useState } from "react";
import { createDockview, type DockviewApi, type IContentRenderer } from "dockview";
import { useQueryClient } from "@tanstack/react-query";
import "dockview/dist/styles/dockview.css";
import { RiAddLine, RiCheckLine, RiExternalLinkLine, RiQuestionLine, RiSaveLine } from "@remixicon/react";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { registerBuiltInPanels, type MarketComponent } from "@/panels/register";
import { usePersistedValue } from "@/state/use-persisted-list";
import { planCommand, type CommandPlan } from "@/workspace/commands";
import { onCommandRequest } from "@/workspace/command-events";
import { usePalette } from "@/lib/theme";
import { Onboarding } from "@/workspace/onboarding";
import { panelTitle } from "@/workspace/panel-title";
import { getTemplate, linkGroupTargets, planTemplate, TEMPLATES, type Profile } from "@/workspace/templates";
import { LINK_GROUPS, useLinkGroups } from "@/workspace/link-groups";
import { panelRootContent } from "@/workspace/panel-root";
import { getPanel, listPanels } from "@/workspace/registry";
import { openPopout } from "@/workspace/popout";
import { restoreWorkspace, serializeWorkspace } from "@/workspace/serialization";
import { listSavedWorkspaces, readLocalLayout, removeWorkspace, slugify, storeWorkspace, uniqueWorkspaceId, upsertSummary, type WorkspaceSummary } from "@/workspace/saved-workspaces";
import { WorkspaceMenu } from "@/workspace/workspace-menu";
import type { PanelApiLike, PanelParams } from "@/workspace/types";
import { useAlertNotifications, useDataUpdateInvalidation, useLinkGroupPersistence, useReleaseAlerts } from "@/workspace/use-workspace-effects";
import { createRoot, type Root } from "react-dom/client";

type Props = { MarketOverview: MarketComponent };

const AUTOSAVE_DELAY_MS = 700;
/** How long the Save button says “Saved” after a save. */
const SAVED_NOTICE_MS = 2000;
const LAST_WORKSPACE_KEY = "agri-terminal-workspace-id";
const DEFAULT_WORKSPACE = { id: "default", name: "Market overview" };
type DockLayout = Parameters<DockviewApi["fromJSON"]>[0];
type SaveStatus = { kind: "idle" } | { kind: "saved" } | { kind: "error"; message: string };

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
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(DEFAULT_WORKSPACE.id);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [command, setCommand] = useState("");
  const [commandError, setCommandError] = useState("");
  const groups = useLinkGroups((state) => state.groups);
  const palette = usePalette();
  const [savedWorkspaces, setSavedWorkspaces] = useState<WorkspaceSummary[]>([]);
  const refreshSavedWorkspaces = useCallback(async () => {
    const all = await listSavedWorkspaces().catch(() => []);
    setSavedWorkspaces(all.map(([id, name]) => ({ id, name })));
  }, []);
  useEffect(() => {
    if (paletteOpen) void refreshSavedWorkspaces();
  }, [paletteOpen, refreshSavedWorkspaces]);
  useEffect(() => {
    if (saveStatus.kind !== "saved") return;
    const timer = window.setTimeout(() => setSaveStatus({ kind: "idle" }), SAVED_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [saveStatus]);

  /** Writes the dock to the open workspace. Throws when the database refuses the write. */
  const saveLayout = useCallback(async () => {
    const api = dockApi.current;
    if (!api || !restored.current) return;
    // Read the target before awaiting, so a switch mid-save cannot write this layout under the next workspace.
    const workspace = { id: workspaceId.current, name: workspaceNameRef.current };
    await storeWorkspace(workspace.id, workspace.name, serializeWorkspace(api.toJSON()));
    setSavedWorkspaces((list) => upsertSummary(list, workspace));
  }, []);

  const scheduleSave = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveLayout().catch((error: unknown) => setSaveStatus({ kind: "error", message: `Autosave failed: ${String(error)}` }));
    }, AUTOSAVE_DELAY_MS);
  }, [saveLayout]);

  /** Saves straight away, cancelling any pending autosave, and reports the outcome on the Save button. */
  const saveNow = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    try {
      await saveLayout();
      setSaveStatus({ kind: "saved" });
    } catch (error) {
      setSaveStatus({ kind: "error", message: `Could not save: ${String(error)}` });
    }
  }, [saveLayout]);

  const addPanel = useCallback((params: PanelParams) => {
    const api = dockApi.current;
    if (!api) return;
    const definition = getPanel(params.kind);
    if (!definition) return;
    const existing = api.panels.find((panel) => {
      const current = panel.params as Partial<PanelParams> | undefined;
      return (current?.kind ?? panel.api.component) === params.kind
        && (params.kind !== "drought" || current?.region === params.region)
        && (!params.gauge || (current?.gauge ?? definition.defaultConfig.gauge) === params.gauge);
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

  /**
   * Replaces the dock with the named workspace's saved layout, or a fresh default when none is saved
   * or `fresh` is set. Returns a message for the user when a saved layout could not be restored.
   */
  const loadWorkspace = useCallback(async (id: string, name: string, fresh = false): Promise<string | undefined> => {
    const api = dockApi.current;
    if (!api) return;
    window.clearTimeout(saveTimer.current);
    restored.current = false;
    workspaceId.current = id;
    workspaceNameRef.current = name;
    setWorkspaceName(name);
    setActiveWorkspaceId(id);
    setSaveStatus({ kind: "idle" });
    let json: string | undefined;
    if (!fresh) {
      try { json = (await listSavedWorkspaces()).find(([savedId]) => savedId === id)?.[2]; } catch { /* Fall through to local storage. */ }
      json ??= readLocalLayout(id);
    }
    let applied = false;
    let problem: string | undefined;
    if (json) {
      try {
        api.fromJSON(restoreWorkspace(json).layout as DockLayout);
        applied = true;
      } catch (error) {
        // Autosave would write the default layout below over this id, so keep the unreadable one under another.
        const backupId = `${id}-unreadable-${Date.now()}`;
        const backupName = `${name} (unreadable copy)`;
        try { await storeWorkspace(backupId, backupName, json); } catch { /* Local storage still holds the copy. */ }
        problem = `Workspace “${name}” could not be restored (${String(error)}), so a default layout was opened. The saved layout was kept as “${backupName}”.`;
      }
    }
    if (!applied) {
      api.clear();
      restored.current = true;
      addPanel({ kind: "market" });
    }
    restored.current = true;
    try { localStorage.setItem(LAST_WORKSPACE_KEY, id); } catch { /* Storage can be unavailable. */ }
    return problem;
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
      const saved = await listSavedWorkspaces().catch(() => []);
      const name = saved.find(([id]) => id === lastId)?.[1] ?? DEFAULT_WORKSPACE.name;
      const problem = await loadWorkspace(lastId, name);
      await refreshSavedWorkspaces();
      if (problem) { setCommandError(problem); setPaletteOpen(true); }
    })();
    return () => {
      window.clearTimeout(saveTimer.current);
      layoutSubscription.dispose();
      api.dispose();
      roots.clear();
      dockApi.current = null;
      restored.current = false;
    };
  }, [queryClient, scheduleSave, loadWorkspace, refreshSavedWorkspaces]);

  useEffect(() => {
    workspaceNameRef.current = workspaceName;
    if (restored.current) scheduleSave();
  }, [workspaceName, scheduleSave]);

  /** Saves the open workspace, then opens another. Returns a message when the other could not be restored. */
  const switchWorkspace = useCallback(async (id: string, name: string, fresh = false) => {
    try { await saveLayout(); } catch (error) { setSaveStatus({ kind: "error", message: `Could not save before switching: ${String(error)}` }); }
    const problem = await loadWorkspace(id, name, fresh);
    await refreshSavedWorkspaces();
    return problem;
  }, [loadWorkspace, refreshSavedWorkspaces, saveLayout]);

  const openSavedWorkspace = useCallback(async ({ id, name }: WorkspaceSummary) => {
    const problem = await switchWorkspace(id, name);
    if (problem) { setCommandError(problem); setPaletteOpen(true); }
  }, [switchWorkspace]);

  /** Copies the dock into a new workspace called `name` and carries on in the copy. */
  const saveAsWorkspace = useCallback(async (name: string) => {
    window.clearTimeout(saveTimer.current);
    await saveLayout();
    const id = uniqueWorkspaceId(name, (await listSavedWorkspaces()).map(([savedId]) => savedId));
    workspaceId.current = id;
    workspaceNameRef.current = name;
    setWorkspaceName(name);
    setActiveWorkspaceId(id);
    await saveLayout();
    try { localStorage.setItem(LAST_WORKSPACE_KEY, id); } catch { /* Storage can be unavailable. */ }
    setSaveStatus({ kind: "saved" });
  }, [saveLayout]);

  const createWorkspace = useCallback(async (name: string) => {
    const id = uniqueWorkspaceId(name, (await listSavedWorkspaces()).map(([savedId]) => savedId));
    await switchWorkspace(id, name, true);
    await saveLayout();
  }, [saveLayout, switchWorkspace]);

  /** Deletes the open workspace and opens the first remaining one. */
  const deleteActiveWorkspace = useCallback(async () => {
    const id = workspaceId.current;
    window.clearTimeout(saveTimer.current);
    // Stop autosave from writing the workspace back while it is being removed.
    restored.current = false;
    try { await removeWorkspace(id); } catch (error) { restored.current = true; throw error; }
    const next = (await listSavedWorkspaces().catch(() => [])).find(([savedId]) => savedId !== id);
    const problem = next ? await loadWorkspace(next[0], next[1]) : await loadWorkspace(DEFAULT_WORKSPACE.id, DEFAULT_WORKSPACE.name, true);
    if (!next) await saveLayout();
    await refreshSavedWorkspaces();
    if (problem) { setCommandError(problem); setPaletteOpen(true); }
  }, [loadWorkspace, refreshSavedWorkspaces, saveLayout]);

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
      // Match an existing workspace by display name first, so renamed workspaces can be switched to.
      const saved = await listSavedWorkspaces().catch(() => []);
      const match = saved.find(([, name]) => name.toLowerCase() === plan.name.toLowerCase()) ?? saved.find(([id]) => id === slugify(plan.name));
      const problem = await switchWorkspace(match?.[0] ?? slugify(plan.name), match?.[1] ?? plan.name);
      if (problem) { setCommand(""); setCommandError(problem); return; }
    } else if (plan.type === "template") {
      applyTemplate(plan.id, profile ?? { commodities: ["ZC"], region: "ia" });
    } else {
      if (plan.retarget) useLinkGroups.getState().setCommodity(plan.retarget.group, plan.retarget.commodity);
      addPanel(plan.params);
    }
    setCommand(""); setCommandError(""); setPaletteOpen(false);
  }, [addPanel, applyTemplate, profile, switchWorkspace]);

  // Panels such as Help open other panels through the same path as the command bar.
  useEffect(() => onCommandRequest((text) => void execute(planCommand(text))), [execute]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);
      if (event.key === "/" && !typing) { event.preventDefault(); setPaletteOpen(true); }
      else if (event.key === "?" && !typing) { event.preventDefault(); void execute(planCommand("HELP")); }
      else if (event.altKey && event.code === "ArrowRight") { event.preventDefault(); cyclePanel(1); }
      else if (event.altKey && event.code === "ArrowLeft") { event.preventDefault(); cyclePanel(-1); }
      else if (event.altKey && event.code === "KeyP") { event.preventDefault(); void popOutActive(); }
      else if (event.altKey && event.code === "KeyW") { event.preventDefault(); dockApi.current?.activePanel?.api.close(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cyclePanel, execute, popOutActive]);

  return (
    <div className="workspace-shell">
      <div className="workspace-toolbar">
        <div>
          <span className="eyebrow">WORKSPACE</span>
          <div className="workspace-title">
            <Input aria-label="Workspace name" className="workspace-name-input" size={Math.max(workspaceName.length, 8)} value={workspaceName} onChange={(event) => setWorkspaceName(event.currentTarget.value)} />
            <WorkspaceMenu
              currentId={activeWorkspaceId}
              currentName={workspaceName}
              saved={savedWorkspaces}
              onSwitch={(workspace) => void openSavedWorkspace(workspace)}
              onSaveAs={saveAsWorkspace}
              onCreate={createWorkspace}
              onDelete={deleteActiveWorkspace}
            />
          </div>
        </div>
        <div className="workspace-toolbar-actions">
          {LINK_GROUPS.map((group) => (
            <Badge key={group} variant="outline" aria-label={`Link group ${group} is ${groups[group].commodity}`}>
              <span aria-hidden="true" style={{ color: palette.groups[group] }}>●</span> {group} · {groups[group].commodity}
            </Badge>
          ))}
          <Button size="sm" variant="outline" onClick={() => void popOutActive()}><RiExternalLinkLine /> Pop out <kbd>⌥P</kbd></Button>
          <Button size="sm" variant="outline" onClick={() => setPaletteOpen(true)}><RiAddLine /> Add panel <kbd>/</kbd></Button>
          <Button size="sm" variant="outline" onClick={() => void execute(planCommand("HELP"))}><RiQuestionLine /> Help <kbd>?</kbd></Button>
          {saveStatus.kind === "error" && <span role="alert" className="workspace-save-error" title={saveStatus.message}>{saveStatus.message}</span>}
          <Button size="sm" variant="secondary" onClick={() => void saveNow()}>
            {saveStatus.kind === "saved" ? <><RiCheckLine /> Saved</> : <><RiSaveLine /> Save</>}
          </Button>
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
            placeholder="Type a command such as ZC, ZC COT or DROUGHT IOWA · HELP lists them all"
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
            <CommandEmpty>No matching command. Type HELP to see every command.</CommandEmpty>
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
                {savedWorkspaces.map((workspace) => (
                  <CommandItem key={workspace.id} value={`workspace ${workspace.name} ${workspace.id}`} onSelect={() => { setPaletteOpen(false); void openSavedWorkspace(workspace); }}>
                    {workspace.name}{workspace.id === activeWorkspaceId && <RiCheckLine aria-label="Open" />}<span className="command-hint">WS {workspace.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </CommandDialog>
    </div>
  );
}
