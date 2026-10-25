import { isTauri } from "@tauri-apps/api/core";
import { deleteWorkspace, listWorkspaces, saveWorkspace, type SavedWorkspace } from "@/lib/ipc";

/** A saved workspace without its layout. */
export type WorkspaceSummary = { id: string; name: string };

const LAYOUT_PREFIX = "agri-terminal-workspace:";
/** The web preview has no Tauri database, so it keeps workspace names here beside the layouts. */
const NAMES_KEY = "agri-terminal-workspace-names";

export const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "default";

/** An id for a new workspace called `name` that does not replace any of the `taken` ids. */
export function uniqueWorkspaceId(name: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = slugify(name);
  let id = base;
  for (let suffix = 2; used.has(id); suffix++) id = `${base}-${suffix}`;
  return id;
}

/** Adds or renames `workspace` in a list kept in name order, as the database lists them. */
export function upsertSummary(list: WorkspaceSummary[], workspace: WorkspaceSummary): WorkspaceSummary[] {
  return [...list.filter(({ id }) => id !== workspace.id), workspace].sort((a, b) => a.name.localeCompare(b.name));
}

export function readLocalLayout(id: string): string | undefined {
  try { return localStorage.getItem(LAYOUT_PREFIX + id) ?? undefined; } catch { return undefined; }
}

function localIds(): string[] {
  try { return Object.keys(localStorage).filter((key) => key.startsWith(LAYOUT_PREFIX)).map((key) => key.slice(LAYOUT_PREFIX.length)); } catch { return []; }
}

function readNames(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(NAMES_KEY) ?? "{}") as Record<string, string>; } catch { return {}; }
}

function writeNames(names: Record<string, string>) {
  try { localStorage.setItem(NAMES_KEY, JSON.stringify(names)); } catch { /* Storage can be unavailable. */ }
}

export async function listSavedWorkspaces(): Promise<SavedWorkspace[]> {
  if (isTauri()) return listWorkspaces();
  const names = readNames();
  return localIds()
    .flatMap((id): SavedWorkspace[] => { const json = readLocalLayout(id); return json ? [[id, names[id] ?? id, json]] : []; })
    .sort(([, a], [, b]) => a.localeCompare(b));
}

/** Saves a layout to the database. Local storage keeps a copy too, which is all the web preview has. */
export async function storeWorkspace(id: string, name: string, json: string): Promise<void> {
  try { localStorage.setItem(LAYOUT_PREFIX + id, json); } catch { /* Storage can be unavailable. */ }
  if (isTauri()) return saveWorkspace(id, name, json);
  writeNames({ ...readNames(), [id]: name });
}

export async function removeWorkspace(id: string): Promise<void> {
  // The local copy goes too, or reopening a workspace of the same name would bring the deleted layout back.
  try { localStorage.removeItem(LAYOUT_PREFIX + id); } catch { /* Storage can be unavailable. */ }
  if (isTauri()) return deleteWorkspace(id);
  const names = readNames();
  delete names[id];
  writeNames(names);
}
