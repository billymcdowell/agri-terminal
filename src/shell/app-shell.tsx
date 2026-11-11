import { useCallback, useEffect, useState } from "react";
import { RiSearchLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useSettingsScreen } from "@/settings/use-settings-screen";
import { usePersistedValue } from "@/state/use-persisted-list";
import { planCommand, type CommandPlan } from "./commands";
import { useCrop } from "./crop";
import { CropSwitcher } from "./crop-switcher";
import { PAGES, pageOf, SECTIONS, UTILITY_PAGES, useNavigation, type PageId } from "./navigation";
import { Onboarding, type Profile } from "./onboarding";
import { PageBody, useDroughtRegion, useRiverGauge, type MarketComponent } from "./pages";
import { useAlertNotifications, useCropPersistence, useDataUpdateInvalidation, usePagePersistence, useReleaseAlerts } from "./use-app-effects";

function SidebarLink({ id, label, shortcut, current, onGo }: { id: PageId; label: string; shortcut?: string; current: PageId; onGo: (page: PageId) => void }) {
  return (
    <li>
      <button type="button" className="app-nav-link" aria-current={current === id ? "page" : undefined} onClick={() => onGo(id)}>
        <span>{label}</span>
        {shortcut && <kbd aria-hidden="true">{shortcut}</kbd>}
      </button>
    </li>
  );
}

/** One window: five fixed pages in a sidebar, one crop switcher, and Settings and Help below the pages. */
export function AppShell({ Market }: { Market: MarketComponent }) {
  useDataUpdateInvalidation();
  useReleaseAlerts();
  useAlertNotifications();
  useCropPersistence();
  usePagePersistence();
  const page = useNavigation((state) => state.page);
  const go = useNavigation((state) => state.go);
  const [profile, setProfile, profileReady] = usePersistedValue<(Profile & { skipped?: boolean }) | null>("profile", null);
  const [, setDroughtRegion] = useDroughtRegion();
  const [, setGauge] = useRiverGauge();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [command, setCommand] = useState("");
  const [commandError, setCommandError] = useState("");

  const execute = useCallback((plan: CommandPlan) => {
    if (plan.type === "error") { setCommandError(plan.message); return; }
    if (plan.type === "settings") useSettingsScreen.getState().show();
    else {
      if (plan.crop) useCrop.getState().setCrop(plan.crop);
      if (plan.params.region) setDroughtRegion(plan.params.region);
      if (plan.params.gauge) setGauge(plan.params.gauge);
      go(pageOf(plan.params.kind));
    }
    setCommand(""); setCommandError(""); setPaletteOpen(false);
  }, [go, setDroughtRegion, setGauge]);

  const completeOnboarding = useCallback((chosen: Profile) => {
    setProfile(chosen);
    if (chosen.commodities[0]) useCrop.getState().setCrop(chosen.commodities[0]);
    // The Drought Monitor follows the new home state until a different state is picked on the page.
    setDroughtRegion(null);
    go("market");
  }, [go, setDroughtRegion, setProfile]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable);
      if (typing || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "/") { event.preventDefault(); setPaletteOpen(true); }
      else if (event.key === "?") { event.preventDefault(); go("help"); }
      else if (/^[1-5]$/.test(event.key)) { event.preventDefault(); go(PAGES[Number(event.key) - 1].id); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [go]);

  const current = PAGES.find((item) => item.id === page);
  const title = current?.label ?? UTILITY_PAGES.find((item) => item.id === page)?.label ?? "";

  return (
    <div className="app-shell">
      <nav className="app-sidebar" aria-label="Pages">
        <div className="app-brand">AgriTerminal</div>
        <ul className="app-nav">
          {PAGES.map((item, index) => <SidebarLink key={item.id} id={item.id} label={item.label} shortcut={String(index + 1)} current={page} onGo={go} />)}
        </ul>
        <ul className="app-nav app-nav-utility">
          {UTILITY_PAGES.map((item) => <SidebarLink key={item.id} id={item.id} label={item.label} shortcut={item.id === "help" ? "?" : undefined} current={page} onGo={go} />)}
        </ul>
      </nav>
      <div className="app-main">
        <header className="app-topbar">
          <CropSwitcher />
          <Button size="sm" variant="outline" onClick={() => setPaletteOpen(true)}><RiSearchLine aria-hidden="true" /> Go to… <kbd>/</kbd></Button>
        </header>
        <main className="app-page" aria-labelledby="page-title">
          <div className="page-heading">
            <h1 id="page-title">{title}</h1>
            {current && <p>{current.question}</p>}
          </div>
          <PageBody page={page} Market={Market} />
        </main>
      </div>
      <Onboarding
        open={profileReady && profile === null}
        onComplete={completeOnboarding}
        onSkip={() => setProfile({ commodities: ["ZC"], region: "ia", skipped: true })}
      />
      <CommandDialog open={paletteOpen} onOpenChange={(open) => { setPaletteOpen(open); if (!open) setCommandError(""); }} title="Go to" description="Go to a page or section, or type a command such as ZS COT.">
        <Command>
          <CommandInput
            aria-label="Command"
            value={command}
            onValueChange={(value) => { setCommand(value); setCommandError(""); }}
            placeholder="Go to a section, or type ZS COT, DROUGHT IOWA…"
            onKeyDown={(event) => {
              if (event.key !== "Enter" || !command.trim()) return;
              const plan = planCommand(command);
              // A typed command wins over whichever list item happens to be highlighted.
              if (plan.type !== "error" || !SECTIONS.some((section) => `${section.title} ${section.command}`.toLowerCase().includes(command.trim().toLowerCase()))) {
                event.preventDefault();
                event.stopPropagation();
                execute(plan);
              }
            }}
          />
          {commandError && <p role="alert" className="command-error">{commandError}</p>}
          <CommandList>
            <CommandEmpty>Nothing matches. Type HELP to see every command.</CommandEmpty>
            <CommandGroup heading="Sections">
              {SECTIONS.map((section) => (
                <CommandItem key={section.kind} value={`${section.title} ${section.command}`} onSelect={() => { go(section.page); setCommand(""); setPaletteOpen(false); }}>
                  {section.title}<span className="command-hint">{PAGES.find((item) => item.id === section.page)?.label}</span>
                </CommandItem>
              ))}
              <CommandItem value="settings preferences theme units data sources keys plugins export stored raw data" onSelect={() => execute({ type: "settings" })}>Settings<span className="command-hint">SETTINGS</span></CommandItem>
              <CommandItem value="help guide glossary commands" onSelect={() => execute(planCommand("HELP"))}>Help<span className="command-hint">?</span></CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </div>
  );
}
