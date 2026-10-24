export type WorkspaceSnapshot = { version: 1; layout: unknown };
export function serializeWorkspace(layout: unknown): string {
  return JSON.stringify({ version: 1, layout } satisfies WorkspaceSnapshot);
}
export function restoreWorkspace(serialized: string): WorkspaceSnapshot {
  const value = JSON.parse(serialized) as Partial<WorkspaceSnapshot>;
  if (value.version !== 1 || !("layout" in value)) throw new Error("Unsupported workspace snapshot");
  return value as WorkspaceSnapshot;
}
