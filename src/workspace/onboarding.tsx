import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { saveSecret } from "@/lib/ipc";
import { COMMODITIES, REGIONS } from "@/lib/regions";
import { TEMPLATES, type Profile, type Role } from "./templates";

const COMMODITY_NAMES: Record<string, string> = { ZC: "Corn", ZS: "Soybeans", ZW: "Wheat" };

type OnboardingProps = { open: boolean; onComplete: (profile: Profile) => void; onSkip: () => void };

/** First-run setup. Keys are optional, so the app is useful the moment the user presses Start. */
export function Onboarding({ open, onComplete, onSkip }: OnboardingProps) {
  const [role, setRole] = useState<Role>("farmer");
  const [commodities, setCommodities] = useState<string[]>(["ZC"]);
  const [region, setRegion] = useState("ia");
  const [keys, setKeys] = useState({ nass: "", fas: "", massive: "" });
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  const toggle = (symbol: string) => setCommodities((current) => (current.includes(symbol) ? current.filter((item) => item !== symbol) : [...current, symbol]));

  const finish = () => onComplete({ role, commodities, region });

  async function start() {
    setBusy(true);
    setNote("");
    const saves: [keyof typeof keys, string, Promise<unknown>][] = [];
    if (keys.nass.trim()) saves.push(["nass", "USDA NASS", saveSecret("usda-nass", keys.nass)]);
    if (keys.fas.trim()) saves.push(["fas", "USDA FAS", saveSecret("usda-fas", keys.fas)]);
    if (keys.massive.trim()) saves.push(["massive", "Massive", saveSecret("massive", keys.massive)]);
    const results = await Promise.allSettled(saves.map(([, , promise]) => promise));
    setBusy(false);
    const failed = saves.flatMap(([, name], index) => {
      const result = results[index];
      return result.status === "rejected" ? [`${name} (${String(result.reason)})`] : [];
    });
    if (!failed.length) {
      finish();
      return;
    }
    // Completing closes this dialog, so stay open to say which keys failed. Saved keys are cleared
    // so Try again only retries the failures; Continue goes on without them.
    setKeys((current) => {
      const next = { ...current };
      saves.forEach(([field], index) => { if (results[index].status === "fulfilled") next[field] = ""; });
      return next;
    });
    setNote(`Could not save the key for ${failed.join(", ")}. Try again, or continue and add it later under Data sources.`);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onSkip(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set up your workspace</DialogTitle>
          <DialogDescription>Three choices and you are in. Data keys are optional and can be added any time.</DialogDescription>
        </DialogHeader>
        <fieldset className="onboarding-group">
          <legend>I am a</legend>
          {TEMPLATES.map((template) => (
            <label key={template.id} className="onboarding-role" data-selected={role === template.id}>
              <input type="radio" name="role" value={template.id} checked={role === template.id} onChange={() => setRole(template.id)} />
              <span><strong>{template.name}</strong><small>{template.description}</small></span>
            </label>
          ))}
        </fieldset>
        <fieldset className="onboarding-group onboarding-row">
          <legend>Crops I follow</legend>
          {COMMODITIES.map((symbol) => (
            <label key={symbol} className="schema-check">
              <input type="checkbox" checked={commodities.includes(symbol)} onChange={() => toggle(symbol)} />
              {COMMODITY_NAMES[symbol] ?? symbol}
            </label>
          ))}
        </fieldset>
        <div className="onboarding-group">
          <Label htmlFor="onboarding-region">Home state</Label>
          <NativeSelect id="onboarding-region" value={region} onChange={(event) => setRegion(event.currentTarget.value)}>
            {REGIONS.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}
          </NativeSelect>
        </div>
        <details className="onboarding-group">
          <summary>Optional: add data keys now</summary>
          <p className="schema-hint">Keys go to your operating system keychain. Without them the app shows free CFTC, drought, weather and news data plus demonstration prices.</p>
          {([["nass", "USDA NASS QuickStats key"], ["fas", "USDA FAS OpenData key"], ["massive", "Massive key"]] as const).map(([name, label]) => (
            <div key={name} className="schema-field">
              <Label htmlFor={`key-${name}`}>{label}</Label>
              <Input id={`key-${name}`} type="password" autoComplete="off" value={keys[name]} onChange={(event) => setKeys({ ...keys, [name]: event.currentTarget.value })} />
            </div>
          ))}
        </details>
        {note && <p role="alert" className="command-error">{note}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onSkip}>Skip for now</Button>
          {note && <Button variant="secondary" onClick={finish} disabled={busy || commodities.length === 0}>Continue without it</Button>}
          <Button onClick={() => void start()} disabled={busy || commodities.length === 0}>{busy ? "Saving…" : note ? "Try again" : "Start"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
