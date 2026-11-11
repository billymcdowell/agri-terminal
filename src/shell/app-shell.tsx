import { useCallback, useEffect, useMemo, useState } from "react";
import { RiSearchLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useSettingsScreen } from "@/settings/use-settings-screen";
import { usePersistedValue } from "@/state/use-persisted-list";
import { useCrop } from "./crop";
import { CropSwitcher } from "./crop-switcher";
import { ALWAYS_SHOWN, goToItems, goToScore, type GoToGroup, type GoToTarget } from "./go-to";
import { PAGES, UTILITY_PAGES, useNavigation, type PageId } from "./navigation";
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
  const [search, setSearch] = useState("");
  const items = useMemo(goToItems, []);
  const groups = useMemo(() => [...new Set(items.map((item) => item.group))], [items]);

  /** Does what a Go to… result names, then closes the search. */
  const goTo = useCallback((target: GoToTarget) => {
    switch (target.type) {
      case "page": go(target.page); break;
      case "crop": useCrop.getState().setCrop(target.crop); break;
      case "settings": useSettingsScreen.getState().show(target.section); break;
      case "drought": setDroughtRegion(target.region); go("crop"); break;
      case "gauge": setGauge(target.gauge); go("river"); break;
      case "help": useNavigation.getState().openHelp(target.topic ?? null, target.query); break;
    }
    setSearch(""); setPaletteOpen(false);
  }, [go, setDroughtRegion, setGauge]);
  const searching = search.trim() !== "";
  const visibleGroups = groups.filter((group: GoToGroup) => searching || ALWAYS_SHOWN.includes(group));

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
      <CommandDialog open={paletteOpen} onOpenChange={(open) => { setPaletteOpen(open); if (!open) setSearch(""); }} title="Go to" description="Search pages, crops, sections, settings, states, gauges and Help.">
        <Command filter={(_value, text, keywords = []) => goToScore(keywords[0] ?? "", keywords.slice(1), text)}>
          <CommandInput aria-label="Search" value={search} onValueChange={setSearch} placeholder="Search pages, crops, sections, settings or Help…" />
          <CommandList>
            <CommandEmpty>Nothing matches “{search.trim()}”.</CommandEmpty>
            {visibleGroups.map((group) => (
              <CommandGroup key={group} heading={group}>
                {items.filter((item) => item.group === group).map((item) => (
                  <CommandItem key={item.id} value={item.id} keywords={[item.label, ...item.keywords]} onSelect={() => goTo(item.target)}>
                    {item.label}<span className="command-hint">{item.hint}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </div>
  );
}
