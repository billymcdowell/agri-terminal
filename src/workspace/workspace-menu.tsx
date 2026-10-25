import { useState, type FormEvent } from "react";
import { RiAddLine, RiArrowDownSLine, RiDeleteBinLine, RiFileCopyLine } from "@remixicon/react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WorkspaceSummary } from "./saved-workspaces";

type NameMode = "copy" | "blank";

const NAME_DIALOG: Record<NameMode, { title: string; description: string; action: string }> = {
  copy: { title: "Save as new workspace", description: "Copies these panels and their layout into a new workspace and switches to it. Changes from now on are saved to the new one.", action: "Save workspace" },
  blank: { title: "New workspace", description: "Starts an empty workspace with a market panel.", action: "Create workspace" },
};

type Props = {
  currentId: string;
  currentName: string;
  saved: WorkspaceSummary[];
  onSwitch: (workspace: WorkspaceSummary) => void;
  onSaveAs: (name: string) => Promise<void>;
  onCreate: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
};

/** Switches between saved workspaces, saves the current layout under a new name, and deletes workspaces. */
export function WorkspaceMenu({ currentId, currentName, saved, onSwitch, onSaveAs, onCreate, onDelete }: Props) {
  const [mode, setMode] = useState<NameMode | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const openNameDialog = (next: NameMode) => { setMode(next); setName(next === "copy" ? `${currentName} copy` : ""); setError(""); };

  async function submitName(event: FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setError("Enter a name."); return; }
    if (saved.some((workspace) => workspace.name.toLowerCase() === trimmed.toLowerCase())) { setError(`A workspace called “${trimmed}” already exists.`); return; }
    setBusy(true);
    try { await (mode === "copy" ? onSaveAs : onCreate)(trimmed); setMode(null); }
    catch (cause) { setError(`Could not save: ${String(cause)}`); }
    finally { setBusy(false); }
  }

  async function confirmDelete() {
    setBusy(true);
    try { await onDelete(); setConfirmingDelete(false); }
    catch (cause) { setError(`Could not delete: ${String(cause)}`); }
    finally { setBusy(false); }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Workspaces" title="Switch, save or delete workspaces" />}>
          <RiArrowDownSLine />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="workspace-menu">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Saved workspaces</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={currentId}>
              {saved.map((workspace) => (
                <DropdownMenuRadioItem key={workspace.id} value={workspace.id} closeOnClick onClick={() => { if (workspace.id !== currentId) onSwitch(workspace); }}>
                  {workspace.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openNameDialog("copy")}><RiFileCopyLine /> Save as new workspace…</DropdownMenuItem>
          <DropdownMenuItem onClick={() => openNameDialog("blank")}><RiAddLine /> New workspace…</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={saved.length < 2} onClick={() => { setError(""); setConfirmingDelete(true); }}>
            <RiDeleteBinLine /> Delete “{currentName}”…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={mode !== null} onOpenChange={(open) => { if (!open) setMode(null); }}>
        <DialogContent>
          <form className="workspace-name-form" onSubmit={(event) => void submitName(event)}>
            <DialogHeader>
              <DialogTitle>{mode && NAME_DIALOG[mode].title}</DialogTitle>
              <DialogDescription>{mode && NAME_DIALOG[mode].description}</DialogDescription>
            </DialogHeader>
            <div className="workspace-name-field">
              <Label htmlFor="new-workspace-name">Name</Label>
              <Input id="new-workspace-name" autoFocus value={name} onChange={(event) => { setName(event.currentTarget.value); setError(""); }} aria-invalid={!!error} />
              {error && <p role="alert" className="workspace-menu-error">{error}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setMode(null)}>Cancel</Button>
              <Button type="submit" disabled={busy}>{mode && NAME_DIALOG[mode].action}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{currentName}”?</AlertDialogTitle>
            <AlertDialogDescription>Its saved layout is removed and you switch to another workspace. This can’t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          {error && <p role="alert" className="workspace-menu-error">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={busy} onClick={() => void confirmDelete()}>Delete workspace</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
