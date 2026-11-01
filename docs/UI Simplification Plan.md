# AgriTerminal: UI Simplification Plan

*Review of the current interface and a plan to scale it back. Draft v0.1, November 1, 2026. Companion to the PRD and the main implementation plan.*

## 0. How to run this plan in Claude Code

Open the `agri-terminal` folder in Claude Code and paste:

> Read `docs/UI Simplification Plan.md` in full, then `README.md` and `docs/prd.md`. Create a branch `feature/ui-simplification`. Do Phase 1 only, then stop and report what changed, what you could not do, and anything in the plan that should change.

After each phase, review and then say "Do Phase N". Each phase ends with the full check suite passing and one commit on the branch. Claude Code should not push or open a PR unless asked.

## 1. Verdict

The data and analytics are good. The interface around them is built for someone who already knows how a Bloomberg terminal works, and it shows: before seeing a single useful number, a new user is asked to understand workspaces, role templates, link groups, a command grammar, docking, pop-out windows, per-panel settings and per-panel guides. Most of these are ways to *arrange* information rather than information itself.

The recommendation is to stop making the user build the screen. Replace the dockable workspace with **five fixed pages**, a **single crop switcher**, and **one Settings screen** that holds every data source and preference. That removes about a dozen concepts, every per-panel control (link chip, ⓘ, ⚙, crop dropdown), most of the top bar, and about 1,900 lines of workspace, command and panel-settings code (with their tests), without removing any data or analysis.

This deliberately changes two PRD principles ("Keyboard first" and "Configurable by default"). Section 6 lists what is traded away and how to bring it back later if real users ask.

## 2. What a user faces today

Reviewed in the demo build (`npm run dev`, then `/demo.html?onboarding=1`) at 1440×900, choosing Farmer in onboarding, then the Trader template, a new workspace, Data sources, Settings and Help.

### 2.1 Concepts to learn

The Help panel's *Start here* list is a good summary of the learning curve. To use the app a person needs:

| Concept | Where it shows up |
|---|---|
| Command bar and its grammar | `/`, *Add panel*, `ZC`, `ZC COT`, `WX IOWA`, `DROUGHT IOWA`, `RIVER TIMELINE MEMPHIS`, `TEMPLATE farmer`, `WS name` |
| Workspaces | Editable name field, workspace menu (switch, save as, new, delete), *Save* button, `WS`, workspace export in Settings |
| Role templates | Onboarding, `TEMPLATE`, Templates group in the command bar, *Run first-time setup again* |
| Link groups A, B, C | Toolbar badges, *LINK A* / *UNLINKED* chip on every panel, link group field in panel settings |
| Docking | Tabs, tab groups, split panes, drag to rearrange, close |
| Pop-out windows | *Pop out* button, `Alt+P` |
| Panel settings | ⚙ on some panels, a generated form |
| Panel guides | ⓘ on every panel, plus the separate Help panel |
| Data sources and keys | Data sources dialog inside the price chart, Plugins panel, Raw data panel, onboarding |
| Keyboard shortcuts | `/`, `?`, `Alt+←/→`, `Alt+W`, `Alt+P` |

### 2.2 Screen inventory

**Top bar:** workspace label and editable name, workspace menu, three link-group badges, *Pop out*, *Add panel*, *Help*, *Save*.

**Every panel header:** an ALL-CAPS eyebrow that repeats the tab title (*RIVER PANEL*, *COT PANEL*), the title, a link chip, ⓘ, sometimes ⚙, sometimes a crop dropdown.

**17 panel types in one flat list:** Price chart, COT positioning, Crop condition, Supply and demand, Drought Monitor, Crop stress timeline, River status, River timeline, Move explainer, Price alerts, Raw data, Plugins, Settings and export, Report calendar, Weather, Market news, Help.

**Counts on screen:** the Farmer layout's first view has 19 buttons, 8 badges, 11 cards and 19 footnote paragraphs. The Trader layout has 35 buttons and 15 cards.

### 2.3 Findings

1. **The price chart is an app inside the app.** `MarketOverview` in `src/App.tsx` renders its own brand bar (*AgriTerminal · MARKET DESK · GRAINS & OILSEEDS · LOCAL DATABASE · DEMO WORKSPACE*), a page heading (*Workspace / Overview · Market overview*), *Market snapshot* and *Data integrity* cards, and a status bar (*OFFLINE READY · OBSERVATIONS 120 · LOCAL · SQLITE · AG TERMINAL / 0.1*). With the workspace bar and the tab, the chart sits under four headers. In the Farmer layout the candles get a strip roughly 400×120 px. The last close appears three times, and the source status five ways (badge, freshness line, *LIVE*, *SYNCED*, status bar). Its main button has three labels depending on state (*Refresh prices*, *Reload cached*, *Add price key*).
2. **The price chart is also the odd one out.** It is the only panel without the standard header, so it has no crop dropdown. To see soybeans you type `ZS`, which also switches every other panel in link group A.
3. **Data sources live in four places, and not in Settings.** The Data sources dialog is reachable only from the price chart. It lists 13 sources with *Test connection*, *Refresh now* and *Pause* on each, three separate key fields, and two different *Save key* buttons: the footer one saves only the Massive key. The Plugins panel repeats two of those sources with *Turn on/off* and *Refresh now*. Raw data has a third source table. Onboarding has a fourth set of key fields.
4. **Link groups use three controls that don't agree.** The toolbar badges look like controls but do nothing. The panel chip cycles A → B → C → off on each click. The crop dropdown changes the group's crop. The chip appears on panels that have no crop (Settings, Help, Calendar, River status, Alerts, Raw data, Plugins), where it does nothing. Drought's settings form offers a link group although the panel ignores the crop.
5. **There are four ways to wipe the layout, and none of them asks first.** These are onboarding, `TEMPLATE name`, the Templates group in the command bar, and *Run first-time setup again*. Picking a template replaces the open workspace at once and keeps its old name.
6. **Workspace management is heavy for a single-user desktop app.** There is a *Save* button although the layout autosaves 700 ms after every change (`AUTOSAVE_DELAY_MS` in `src/workspace/shell.tsx`). The name field looks like a label. The default workspace and the price panel are both called *Market overview*.
7. **Adding a panel always splits the active one to the right.** After three additions the chart has a third of the screen, and the only fix is to learn drag-and-drop docking.
8. **Panels overlap.** River status and River timeline overlap. So do the Crop stress timeline (price, condition and drought) and the Price chart, Crop condition and Drought panels, and the chart's move markers and the Move explainer. Price and river alerts are in one panel, and release alerts are in Settings. Admin screens (Settings, Plugins, Raw data, Help) dock beside market views as if they were the same kind of thing.
9. **The command grammar has to be learned, and parts of it mislead.** `WX IOWA` ignores the state: the Weather panel always shows the crop's growing regions (`planCommand` in `src/workspace/commands.ts` drops the region). The command bar's placeholder is cut off in the dialog.
10. **Panel chrome repeats itself.** ⓘ shows a guide that duplicates the Help panel. ⚙ opens a generated form that, on most panels, contains only the link group.
11. **The panels are dense with jargon.** River cards read like *Depth 34.7 · Forecast 24.2 · Traffic not scored (points of 100)*. Tickers (ZC, ZS, ZW) appear where crop names would do. Method caveats are repeated as footnotes on the panels instead of being kept in Help.
12. **Onboarding asks a question that has no lasting meaning.** The role only picks a starting template. The Farmer layout then opens seven panels in four tab groups, and the first thing visible on the right is the river constraint score, not the weather. The dialog promises "three choices" and shows four sections.
13. **Keyboard-only features have no visible affordance** (`Alt+←/→`, `Alt+W`), and pop-outs add a second window model on top of docking.

Not user-facing, but part of the same weight: 50 of the 63 components in `src/components/ui` are not used by app code, and the app carries three layout and chart libraries (dockview, lightweight-charts, recharts).

## 3. Target design

### 3.1 Principles

1. **One window, fixed pages.** No docking and no layouts to manage.
2. **One crop at a time, chosen in one place.**
3. **One place for every setting and data source.**
4. **Every section says in one line what it shows.** Method detail lives in Help.
5. **Show each number once.** Show each source's freshness once per section.

### 3.2 Layout

```
┌───────────────────┬───────────────────────────────────────────────────────┐
│ AgriTerminal      │ [ Corn | Soybeans | Wheat ]        Go to…  /    ⚠ 1   │
│                   ├───────────────────────────────────────────────────────┤
│ ● Market          │ Corn  $4.81  +0.09 (+1.9%)  USD/bu     1W   1M   All  │
│   Crop & weather  │ ┌───────────────────────────────────────────────────┐ │
│   Supply & demand │ │                                                   │ │
│   River           │ │      price chart, ▲ ▼ markers on big moves        │ │
│   Alerts          │ │                                                   │ │
│                   │ └───────────────────────────────────────────────────┘ │
│                   │ Big moves           Next reports       Headlines      │
│                   │ Oct 19 ▲ 4.9%       Nov 2  COT         Export sales…  │
│                   │   likely: WASDE     Nov 4  Crop prog.  Harvest pace…  │
│ ────────────────  │                                                       │
│   Settings        │ Prices from Massive · updated 2h ago                  │
│   Help            │                                                       │
└───────────────────┴───────────────────────────────────────────────────────┘
```

- **Sidebar:** five pages, then Settings and Help. The app reopens on the last page and crop.
- **Crop switcher:** a segmented control in the top bar. Every page follows it. Crop names, with the ticker only in tooltips and Help.
- **Go to… (`/`):** fuzzy search over pages, crops, settings sections and help topics. No special syntax.
- **⚠ indicator:** appears only when a source is stale or failing, and opens Settings › Data sources filtered to the problems. This replaces the per-panel error text.
- **Demo prices:** a single banner on the Market page: "Showing sample corn prices. Add a free Massive key in Settings to see real prices."

### 3.3 Pages

| Page | Question it answers | Built from today's panels |
|---|---|---|
| **Market** | What is the price doing, and what moved it? | Price chart; Move explainer (a *Big moves* list, and a side drawer with the possible drivers when a move or chart marker is clicked); Report calendar (next five); Market news (latest five) |
| **Crop & weather** | How is the crop doing? | Crop stress timeline as the headline chart; Crop condition; Drought Monitor (home state, changeable inline); Weather |
| **Supply & demand** | Is there more or less grain than needed, and how are traders positioned? | Supply and demand balance sheet; COT positioning |
| **River** | Can grain get downriver, and what does it cost? | River status (score, stage, forecast, freight, traffic) with the River timeline chart below; gauge picker inline |
| **Alerts** | Tell me when something happens | Price alerts; river alerts; report reminders (lead time moves here from Settings) |
| **Settings** | | *General* (theme, units); *Data sources* (today's Data sources dialog and Plugins panel as one list: status, last update, key field when needed, and *Test*, *Refresh* and *Pause* in a row menu; *Add a source from a plugin file* at the end); *Data and export* (data folder, CSV export, the Raw data viewer); *Run setup again* |
| **Help** | | The Help panel, with *Start here* rewritten for the smaller set of concepts and the ⓘ guides merged in |

Each page should fit one 1440×900 screen with its main chart visible; secondary sections can collapse.

### 3.4 What goes, and what replaces it

| Remove | Why | Replaced by |
|---|---|---|
| Docking, tab groups, drag to rearrange (dockview) | Most people never arrange panels, and layouts degrade as panels are added | Fixed pages |
| Saved workspaces, workspace menu, name field, *Save*, workspace export, `WS` | Nothing left to save | The app remembers the last page and crop |
| Role templates, `TEMPLATE`, role step in onboarding | Pages are the same for everyone | Onboarding asks only for crops, home state and optional keys |
| Link groups A/B/C, link chips, toolbar badges, per-panel crop dropdowns | Three controls for one idea | One crop switcher |
| Pop-out windows, `Alt+P`, `Alt+←/→`, `Alt+W` | A second window model | Optional `1`–`5` shortcuts for pages |
| Panel ⚙ forms (`schema-form`, `config-schema`) | Mostly held only the link group | Inline pickers where a page needs one (state, gauge) |
| Panel ⓘ guides | Duplicate Help | A one-line subtitle per section, linking to its Help topic |
| Command grammar | Has to be learned, and parts of it mislead | Go to… search |
| Price panel's brand bar, page heading, *Market snapshot*, *Data integrity*, status bar | Repeat the price and status three to five times | One header line and one freshness line |
| Move explainer sensitivity in standard deviations | Jargon | Fixed at 2 SD, or a *Fewer / More moves* toggle |
| ALL-CAPS eyebrows and most footnotes | Noise | Sentence-case headings; caveats move to Help |

Undecided, for Phase 5: whether to keep the Move explainer's *pin* and *notes*. *Dismiss* stays.

## 4. Rules for this work

1. **No data or analysis is removed.** Every number visible today stays reachable. Only the arrangement, duplicate controls and duplicate text go.
2. **Delete, don't hide.** When a feature is removed, its code, tests, commands and help text go with it. Leave nothing behind a flag.
3. **Plain words.** Use crop names, sentence case, and one line of explanation per section. Use "possible driver" wording for the move explainer, as the PRD requires.
4. **Old saved layouts are ignored, not migrated.** Stored workspaces stay in SQLite untouched; the new shell simply stops reading them.
5. **Checks after every phase:** `npm run lint && npm test && npm run build`, plus the Rust checks in the README when backend code changes.
6. **Check it in the demo.** After each phase, walk the demo at 1440×900 and in light theme, and confirm nothing on screen is clipped or repeated.

## 5. Phases

Phases 1 and 2 are worth doing whatever is decided about the rest, because they survive either way.

### Phase 1: Strip the price chart (S)

- Remove the brand bar, page heading, *Market snapshot*, *Data integrity* and status bar from `MarketOverview`.
- Keep one header line (crop, last close, change, unit, range buttons), the chart with move markers, and one freshness line.
- Prices refresh in the background. Replace the three-label refresh button with the demo banner when no key is saved.
- **Done when** the chart fills its panel, and the price and status each appear once.

### Phase 2: One Settings screen (M)

- Build Settings as one screen with *General*, *Data sources*, *Data and export* and *Run setup again*. Until Phase 4 it opens as a full-window sheet from a gear in the top bar.
- Merge the Data sources dialog and the Plugins panel into one source list with a single key field per source that needs one.
- Move the Raw data viewer under *Data and export*. Move the release-alert lead time to the Alerts panel.
- Delete the Data sources dialog, and the Plugins, Raw data and Settings panel types with their commands.
- **Done when** every key, source action and preference is in Settings and nowhere else.

### Phase 3: One crop switcher (M)

- Add a Corn | Soybeans | Wheat control to the top bar, persisted, which every crop-aware view reads.
- Delete link groups (`link-groups.ts`, `link-sync.ts`, the persistence effect), link chips, toolbar badges and per-panel crop dropdowns.
- `ZC`, `ZS` and `ZW` in the command bar set the switcher until Phase 6 replaces the grammar.
- **Done when** there is exactly one way to change the crop.

### Phase 4: Fixed pages (L)

- Replace `WorkspaceShell` with a sidebar shell (the unused `sidebar` component in `src/components/ui` fits) and five page routes, plus Settings and Help.
- Delete dockview, saved workspaces, the workspace menu, *Save*, templates and `config/workspace-templates.json`, pop-outs, panel cycling shortcuts, `PanelHeader`'s ⚙ and link controls, `schema-form` and `config-schema`.
- Cut onboarding to crops, home state and optional keys. The first chosen crop sets the switcher.
- Remove the backend workspace commands (`list_workspaces`, `save_workspace`, `delete_workspace`, `export_workspace`) if nothing else uses them.
- **Done when** the app opens to the Market page with no layout to manage, and each page is reachable from the sidebar.

### Phase 5: Compose the pages (M)

- Rebuild each page from today's panel bodies as described in 3.3. Merge River status and River timeline into one page. Put the Crop stress chart above Crop condition, Drought and Weather.
- Move explainer: a *Big moves* list on Market, and a drawer with possible drivers opened from the list or from a chart marker. Decide on *pin* and *notes*.
- Add a one-line subtitle per section and remove the ⓘ guides.
- **Done when** each page fits one screen at 1440×900 with its main chart visible.

### Phase 6: Go to… search (S)

- `/` opens fuzzy search over pages, crops, Settings sections and Help topics.
- Delete `command-bar/grammar.ts` and `workspace/commands.ts`, or cut them down to crop and page aliases.
- **Done when** nothing in Help asks the user to learn a command.

### Phase 7: Words and visual pass (S)

- Sentence-case headings instead of eyebrows. Crop names instead of tickers. At most one footnote line per section, and the *⚠* indicator in place of per-panel error text.
- Rewrite Help's *Start here* for the new structure, and move method caveats (river thresholds, attribution limits) there.
- **Done when** a first-time user can say what every visible control does without opening Help.

### Phase 8: Clean up (S)

- Remove unused dependencies and the 50 unused UI components. Consider whether the river and stress timelines can use the same chart library as the price chart.
- Update the README's *Frontend* section, `demo/explainer`, its screenshots and the explainer video.
- Update PRD §5 principles, and the Phase 2 *Workspace shell* deliverables in the implementation plan, to match.

## 6. What this trades away

| Lost | Who misses it | If users ask for it later |
|---|---|---|
| Custom layouts | Analysts who want their own screen | Add one *My view* page built from the same sections, after real users ask |
| Two crops side by side (link groups A/B) | Farmers with two crops, spread traders | A *Compare with…* overlay on the Market chart |
| Pop-out windows | Multi-monitor users | A *Open in new window* action per page |
| Typed commands | Keyboard-heavy traders | Go to… keeps `/` fast; aliases can be added without a grammar |
| Role-specific starting layouts | People who liked a curated start | The Market page is the shared start |

## 7. Risks

| Risk | Mitigation |
|---|---|
| Pages grow long as sections are merged | Each page must fit one screen with its main chart visible; secondary sections collapse |
| The move explainer, a headline feature, becomes less visible once it is not its own panel | The *Big moves* list sits on the Market page by default |
| Early users lose saved layouts | v0.1 with few users; layouts stay in the database, and the new pages cover every panel |
| The demo, README and video describe the old UI | Phase 8 updates them |

## 8. Sizes

| Phase | Size |
|---|---|
| 1. Strip the price chart | S |
| 2. One Settings screen | M |
| 3. One crop switcher | M |
| 4. Fixed pages | L |
| 5. Compose the pages | M |
| 6. Go to… search | S |
| 7. Words and visual pass | S |
| 8. Clean up | S |
