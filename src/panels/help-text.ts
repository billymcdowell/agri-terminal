/**
 * All wording for the in-app guide: the HELP panel and each panel's About box. Written for someone
 * new to grain markets, so every term a panel shows is explained here in plain language.
 */

export type PanelGuide = {
  /** How to type it in the command bar, with its variations. */
  usage: string;
  /** One line for the list of panels. */
  oneLine: string;
  /** What the panel shows and why it matters. */
  summary: string;
  /** How to read what is on screen. */
  howToRead: string[];
  /** Labels on the panel and what each one means. */
  terms?: [string, string][];
};

/** Keyed by panel type. Every registered panel needs an entry; a test checks this. */
export const PANEL_GUIDES: Record<string, PanelGuide> = {
  market: {
    usage: "ZC, ZS or ZW",
    oneLine: "What a corn, soybean or wheat futures contract costs, day by day.",
    summary: "The daily price of a corn (ZC), soybean (ZS) or wheat (ZW) futures contract on the Chicago Board of Trade. This is the benchmark most U.S. grain is priced from: local elevators quote their bids as this price plus or minus an adjustment.",
    howToRead: [
      "Each candle is one trading day. The thick body runs from the opening price to the closing price, and the thin lines reach the day's high and low. Green candles closed higher than they opened; red ones closed lower.",
      "The large number is the latest closing price. The change beside it is against the previous day's close.",
      "Prices are U.S. dollars per bushel. Switch to dollars per metric tonne under SETTINGS.",
      "Arrows labelled with a number such as 2.4 SD mark unusually large one-day moves. Open MOVES to see what might have caused them.",
      "SIMULATED means you are looking at made-up demonstration prices for corn. Add a Massive key under Data sources to load real ones.",
      "1W, 1M and ALL change how much history the chart shows.",
    ],
  },
  cot: {
    usage: "ZC COT, ZS COT or ZW COT",
    oneLine: "Whether big groups of traders are betting on prices rising or falling.",
    summary: "Who holds futures positions, and on which side, from the weekly Commitments of Traders report by the U.S. Commodity Futures Trading Commission (CFTC). Traders watch it to see how crowded a bet has become: when funds are already heavily on one side, there are fewer left to keep pushing the price that way.",
    howToRead: [
      "Net is contracts betting on a rise (long) minus contracts betting on a fall (short). A positive number means the group is net long; a negative one means net short.",
      "One contract is 5,000 bushels, so 100,000 contracts is 500 million bushels.",
      "Period is the Tuesday the positions were counted. The report comes out the following Friday afternoon.",
      "Historical percentile compares this week with every stored week. 90th means the group's net position was at or below this level in 90% of those weeks, so it is close to the most long it has been; 10th means close to the most short.",
    ],
    terms: [
      ["Managed money", "Hedge funds and commodity trading advisers speculating on the price. Their buying and selling often drives short-term moves."],
      ["Producer / merchant", "Farmers, grain elevators, processors and exporters using futures to lock in prices for grain they grow, buy or sell. They are usually net short because they own physical grain."],
      ["Swap dealer", "Banks and dealers offsetting deals they made off the exchange, often with index funds that hold long positions."],
    ],
  },
  "crop-condition": {
    usage: "CROP CONDITION",
    oneLine: "How healthy this year's U.S. crop looks, and how far planting and harvest have got.",
    summary: "The weekly national Crop Progress report from the USDA National Agricultural Statistics Service (NASS), published Mondays at 4 p.m. Eastern from spring to late autumn. Local observers rate the crop in every state, and the ratings are combined into national shares. It needs a free NASS key under Data sources.",
    howToRead: [
      "The three condition rows add up to about 100% of the crop.",
      "A falling good / excellent share usually points to a smaller harvest, which tends to push prices up. A rising share tends to do the opposite.",
      "Planted and Harvested are the percent of this season's crop done so far.",
      "Out of season there is no new report, so the latest row can be months old.",
    ],
    terms: [
      ["Good / excellent", "Share of the crop in good or excellent shape. The most watched number in the report."],
      ["Fair", "Share in fair shape: neither strong nor seriously stressed."],
      ["Poor / very poor", "Share that is stressed, for example by drought, heat, flooding or disease."],
      ["Planted", "Percent of the expected area sown so far this season."],
      ["Harvested", "Percent of the crop harvested so far this season."],
    ],
  },
  wasde: {
    usage: "WASDE",
    oneLine: "How much grain the U.S. has, how much it uses, and what is left over.",
    summary: "The U.S. supply and demand balance sheet for the crop, from the USDA Foreign Agricultural Service (FAS) Production, Supply and Distribution database. It carries the official estimates USDA publishes each month in the WASDE report. It needs a free FAS key under Data sources.",
    howToRead: [
      "Read it top to bottom: beginning stocks plus production plus imports is the total supply; domestic consumption plus exports is the total use; what remains is ending stocks.",
      "Ending stocks are the headline. Smaller stocks mean a tighter market and usually higher prices; larger stocks usually mean lower prices.",
      "Values are in thousands of metric tons, so 380,000 is 380 million tonnes.",
      "Period is the marketing year the estimate is for. USDA revises each year's figures month by month until the year is over.",
    ],
    terms: [
      ["Beginning stocks", "Grain left over from the previous marketing year."],
      ["Production", "This year's harvest."],
      ["Imports", "Grain bought from other countries."],
      ["Domestic consumption", "Grain used at home: animal feed, food, ethanol for corn, and crushing into meal and oil for soybeans."],
      ["Exports", "Grain sold to other countries."],
      ["Ending stocks", "What is expected to be left at the end of the marketing year, also called carryout."],
    ],
  },
  drought: {
    usage: "DROUGHT and a state, such as DROUGHT IOWA or DROUGHT IA",
    oneLine: "How much of a growing state is dry or in drought this week.",
    summary: "The share of a state's area at each drought level, from the U.S. Drought Monitor by the National Drought Mitigation Center, USDA and NOAA. Maps describe conditions on Tuesday and are published on Thursday. Covers Iowa, Illinois, Nebraska, Minnesota, Indiana, Kansas, North Dakota, South Dakota and Ohio.",
    howToRead: [
      "Each row is the percent of the state at that level or worse, so the numbers shrink as you go down: D2 includes D3 and D4.",
      "D0 is not drought yet, only abnormally dry. D1 and above is drought.",
      "Drought spreading across growing states in summer can cut yields and support prices.",
      "Change the state with the panel settings button.",
    ],
    terms: [
      ["D0 · Abnormally dry", "Going into or coming out of drought: short-term dryness slowing planting or growth."],
      ["D1 · Moderate", "Some damage to crops and pastures."],
      ["D2 · Severe", "Crop or pasture losses are likely."],
      ["D3 · Extreme", "Major crop and pasture losses."],
      ["D4 · Exceptional", "Widespread crop and pasture losses."],
    ],
  },
  "crop-stress": {
    usage: "STRESS",
    oneLine: "Price, crop health and drought on one chart, to see how the market reacted.",
    summary: "Price, crop condition and drought lined up on one timeline, so you can see whether the market reacted as the crop got better or worse during the season.",
    howToRead: [
      "The left axis is the closing price; the right axis is percent.",
      "The solid green line is the share of the crop rated good or excellent. The shaded band is the range for the same week over the previous five years: a line below the band means the crop is in worse shape than usual for the time of year.",
      "The dashed line is the average share of the crop's main growing states in drought (D1 or worse).",
      "Each weekly value appears only from the day it was published, so the chart shows what was known at the time. Gaps mean there was no current report, for example in winter.",
    ],
  },
  river: {
    usage: "RIVER, RIVER MISS, RIVER ST LOUIS or RIVER MEMPHIS",
    oneLine: "Whether low water on the Mississippi is restricting barges, and what freight is doing.",
    summary: "A 0 to 100 river constraint score for a Mississippi gauge, with the river level, the National Weather Service forecast, the weekly USDA barge freight rate and grain moving through the locks. When the river runs low, barges must load lighter, so freight costs rise and the gap between Gulf and inland grain prices tends to widen. Pick the gauge in the panel settings.",
    howToRead: [
      "The score adds up three parts: how far the river is below its normal level (depth), how low the forecast goes over the next 7 days (forecast) and how far lock tonnage has fallen against the four weeks before (traffic). 0 to 39 is Normal, 40 to 69 Elevated, 70 and above High.",
      "PARTIAL means one part was missing or out of date, so the score was worked out from the others with their weights scaled up.",
      "River stage is the gauge reading in feet. It can be below zero: the zero is a fixed reference point, not the river bed. The five-year range is the same time of year in the previous five years.",
      "The restriction level is roughly where barges start loading lighter; the critical level is where restrictions become severe. These starting values are provisional.",
      "Barge freight is quoted as a percent of a 1976 benchmark tariff for that stretch of river. The dollar figure converts it to dollars per short ton.",
      "River effects usually show up more in freight, basis and spreads than in futures prices, so treat the score as a possible pressure, not a price call.",
      "Each part shows when it was published and fetched. Barge rates and lock tonnage come out on Thursdays in the USDA Grain Transportation Report.",
    ],
    terms: [
      ["Stage", "The height of the river at a gauge, in feet, above a fixed zero point."],
      ["Restriction level", "The stage below which barges usually have to carry less, set per gauge in config/waterways.json."],
      ["Percent of tariff", "How barge freight is quoted: a percentage of the 1976 benchmark rate for each origin. 500% at St. Louis is about $19.95 a short ton."],
      ["Lock tonnage", "Grain moving downriver through Mississippi Lock 27 and the Ohio River's Olmsted lock each week, from the Army Corps of Engineers."],
      ["Basis", "Cash price minus the futures price. Low water tends to weaken basis at river elevators and widen the gap to the Gulf."],
    ],
  },
  "river-timeline": {
    usage: "RIVER TIMELINE, or RIVER TIMELINE MEMPHIS",
    oneLine: "River level, forecast, barge freight and the constraint score beside the futures price.",
    summary: "The river stage against its five-year range, the lowest forecast stage, the restriction and critical levels, barge freight and the constraint score on one timeline with the futures close, to see how freight and prices behaved as the river fell or rose.",
    howToRead: [
      "The top chart shows the stage in feet (left axis) and the futures close (right axis). The shaded band is the stage range for the same days over the previous five years; the dashed line is the lowest stage forecast over the next 7 days.",
      "The bottom chart shows the constraint score (left, 0 to 100) and the barge rate in percent of tariff (right).",
      "Every value appears only from the day it was published, so the chart shows what was known at the time. A barge rate published on Thursday is not on Wednesday.",
      "1Y, 3Y and ALL change how much history is shown. The futures close follows the panel's link group.",
    ],
  },
  moves: {
    usage: "MOVES",
    oneLine: "Days the price moved unusually far, and news or reports that might explain why.",
    summary: "Days when the price moved much further than usual, each listed with scheduled reports and headlines that might explain it. Drivers are matched by timing, subject and direction; they are leads to check, not proof of cause.",
    howToRead: [
      "A day is flagged when its price change is larger than the chosen number of standard deviations (SD) of the previous 20 days' changes. A 2 SD move is roughly twice as big as a typical recent day, and happens about one day in twenty.",
      "The heading shows the date, the direction (▲ up, ▼ down), the percentage change and how many SD it was.",
      "Lower the sensitivity in the panel settings to see more, smaller moves; raise it to see only the biggest.",
      "Pin the drivers you agree with, dismiss the ones you do not, and add your own notes. All three are saved.",
    ],
    terms: [
      ["Likely driver", "A government report with a fixed release time came out between the previous close and this one."],
      ["Possible driver", "A report whose date is only an expected window, or one headline that clearly stands out from the rest."],
      ["Possible driver, low confidence", "Headlines that match on timing and wording only."],
      ["River event", "The river crossed a restriction or critical level, the river constraint score changed band, or barge freight jumped in the days before the move. River conditions show up more in freight, basis and spreads than in futures, so these are always low confidence."],
      ["No clear driver found", "Nothing in the cached calendar, news or river data lines up with the move."],
    ],
  },
  alerts: {
    usage: "ALERTS",
    oneLine: "A notification when a closing price crosses a level you choose, or the river runs low.",
    summary: "Notifications when a daily closing price crosses a level you set, for example corn closing at or above $4.50 a bushel, and built-in river alerts for each Mississippi gauge.",
    howToRead: [
      "Alerts are checked after each price update against the daily close, so they cannot fire during the trading day.",
      "An alert fires once per crossing, then re-arms after the price moves back across the level.",
      "River alerts fire when a gauge falls to its restriction or critical level, when the forecast reaches the restriction level within the forecast window, and each time the river constraint score moves up a band. Pause any you do not want.",
    ],
    terms: [
      ["ARMED", "Waiting for the close to cross your level."],
      ["TRIGGERED", "The close has crossed your level. It re-arms when the price moves back."],
      ["PAUSED", "Switched off until you resume it."],
    ],
  },
  "raw-data": {
    usage: "RAW",
    oneLine: "Every number the app has downloaded, exactly as stored.",
    summary: "Every row AgriTerminal has stored from each source, as a table or JSON. Use it to check exactly what was downloaded, when it was published and fetched, and whether a figure was later revised.",
    howToRead: [
      "Pick a source and one of its series; the newest period is listed first.",
      "period is the date the figure describes, releasedAt is when the agency published it, and fetchedAt is when AgriTerminal downloaded it.",
      "revision counts up when an agency changes a number it already published. The earlier value is kept, never overwritten.",
      "Prices are stored in U.S. dollars per bushel and times are in UTC.",
    ],
  },
  plugins: {
    usage: "PLUGINS",
    oneLine: "Add more data sources from plugin files.",
    summary: "Install and manage extra data sources described by plugin files. Each plugin lists the websites it will contact and the keys it uses before anything runs, and it cannot run code or read your files.",
    howToRead: [
      "Review the permissions shown for a plugin before installing or enabling it.",
      "The U.S. Drought Monitor source is a built-in plugin.",
    ],
  },
  settings: {
    usage: "SETTINGS",
    oneLine: "Theme, price units, report reminders, export and setup.",
    summary: "Your preferences, plus exports and setup. Choose dark or light, show prices per bushel or per metric tonne, choose how early to be reminded before a scheduled report, export any series as CSV or a workspace as a file, or run first-time setup again.",
    howToRead: [
      "Changing units only changes how prices are shown; stored prices stay in dollars per bushel.",
      "Exports are written to the app's data folder, which this panel can open for you.",
    ],
  },
  calendar: {
    usage: "CALENDAR",
    oneLine: "When the next government reports are due. Prices often jump when they come out.",
    summary: "When the next scheduled government reports are expected, in your local time. Markets often move sharply as these come out, so traders plan around them. Set a reminder lead time under SETTINGS.",
    howToRead: [
      "Contracts lists the commodities each report covers.",
      "Times come from a schedule kept in the app, and some are expected windows. Check the agency's own calendar before relying on one.",
    ],
    terms: [
      ["Commitments of Traders", "CFTC, weekly on Friday afternoon: trader positioning. See ZC COT."],
      ["Crop Progress", "USDA NASS, Mondays at 4 p.m. Eastern in season: crop condition and planting or harvest progress. See CROP CONDITION."],
      ["Export Sales", "USDA FAS, Thursday mornings: how much U.S. grain foreign buyers ordered last week."],
      ["WASDE", "USDA, monthly around the 10th at noon Eastern: the official supply and demand estimates. See WASDE."],
      ["Grain Transportation Report", "USDA AMS, Thursdays: barge freight rates, lock tonnage and other grain transport data. See RIVER."],
    ],
  },
  weather: {
    usage: "WX IOWA (shows every main growing state for the crop)",
    oneLine: "Forecasts for the main growing states of the selected crop.",
    summary: "The next forecast period for each main growing state of the selected crop, from Open-Meteo and the U.S. National Weather Service. Weather is the biggest unknown for a crop in the ground, so traders watch the forecast for growing areas closely.",
    howToRead: [
      "Each state appears once per provider, so you can compare the two forecasts.",
      "Temperature is in °C, rain (Precip) in millimetres, and wind in km/h. Valid is the time the forecast is for.",
      "Heat and dry weather matter most in July and August, when corn pollinates and soybeans fill their pods. For winter wheat, spring and early summer matter most.",
      "Change the crop with the selector at the top right to see different states.",
    ],
  },
  news: {
    usage: "NEWS",
    oneLine: "Recent headlines about the crop.",
    summary: "Recent headlines that mention the crop, from GDELT (a global news index) and USDA NASS news feeds. Only headlines and links are shown; click one to read the article at its source.",
    howToRead: [
      "Headlines refresh every 30 minutes while the panel is open, and stay available offline.",
      "MOVES uses these headlines to suggest possible drivers of big price moves.",
    ],
  },
  help: {
    usage: "HELP or ?",
    oneLine: "This guide: every command, what each panel shows, and a glossary.",
    summary: "Every command, what each panel shows and how to read it, what the status labels mean, and a glossary of market terms.",
    howToRead: ["Type in the search box to find a term or panel."],
  },
};

export const START_HERE = [
  "AgriTerminal puts U.S. grain market information side by side: prices, trader positioning, crop health, drought, weather, river conditions, supply and demand, news and report dates. Everything is saved on your computer, so it works offline.",
  "Press / to open the command bar, then type a command such as ZC for corn prices, or pick one from the list. Press ? any time to come back to this guide.",
  "Click the ⓘ button at the top of any panel for a plain-language explanation of what it shows.",
  "Panels with the same coloured LINK letter follow the same crop: change the crop in one and the others switch too. Click LINK to change the group or unlink a panel.",
  "Drag a panel's tab to rearrange the layout. It saves automatically; use the menu beside the workspace name to keep several layouts.",
  "Some data needs a key, added under Data sources on the price chart. Free without any key: demonstration corn prices, CFTC positioning, drought, weather, river conditions and news. Free key: USDA crop condition (NASS), supply and demand (FAS), and real futures prices (Massive).",
];

export const OTHER_COMMANDS: { usage: string; meaning: string }[] = [
  { usage: "WS name", meaning: "Switch to the workspace with that name, or start a new one with that name." },
  { usage: "HELP or ?", meaning: "Open this guide." },
];

export const SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "/", action: "Open the command bar" },
  { keys: "?", action: "Open this guide" },
  { keys: "Enter", action: "Run the typed command, or the highlighted one in the list" },
  { keys: "Alt+→ / Alt+←", action: "Move to the next or previous panel" },
  { keys: "Alt+P", action: "Pop the active panel out into its own window" },
  { keys: "Alt+W", action: "Close the active panel" },
];

export const SHORTCUT_NOTE = "On a Mac, Alt is the ⌥ Option key.";

/** The freshness and origin labels panels show beneath their data. */
export const STATUS_LABELS: [string, string][] = [
  ["OK · 3h old", "The source refreshed on schedule. The age is how long ago it last confirmed the data was current."],
  ["STALE", "No successful refresh for more than one and a half times the source's usual schedule (about 10 days for a weekly report), so the numbers may be out of date."],
  ["ERROR · CACHED OBSERVATIONS", "The last refresh failed, so you are seeing the most recent saved data. The reason follows the label."],
  ["WAITING · no data yet, or No cached data", "Nothing has been downloaded yet. Check whether the source needs a key under Data sources."],
  ["SIMULATED, DEMO", "Made-up corn prices bundled so you can try the app. They are not market quotes."],
  ["CBOT, LIVE", "Real daily prices from Massive for the Chicago Board of Trade contract."],
];

export const GLOSSARY: [string, string][] = [
  ["Balance sheet", "A table of a crop's supply (stocks, harvest, imports) against its use (consumption, exports). See WASDE."],
  ["Barge rate", "Freight for moving grain downriver by barge, quoted weekly by USDA as a percent of a 1976 benchmark tariff. See RIVER."],
  ["Basis", "The local cash price minus the futures price. It reflects local supply, demand and transport costs, such as barge freight when the river is low."],
  ["Bushel", "The unit U.S. grain is traded in. A bushel of corn weighs 56 lb (25.4 kg); soybeans and wheat weigh 60 lb (27.2 kg)."],
  ["CBOT", "Chicago Board of Trade, the exchange where U.S. corn, soybean and wheat futures trade. It is part of CME Group."],
  ["CFTC", "Commodity Futures Trading Commission, the U.S. regulator of futures markets. It publishes the Commitments of Traders report."],
  ["Close", "The last price of the trading day, used for the chart, alerts and flagged moves."],
  ["Commitments of Traders (COT)", "A weekly CFTC report of how many contracts each type of trader holds long and short. See ZC COT."],
  ["Continuous front month", "The contract nearest to expiry, switched to the next one as each expires so the price line is unbroken. There can be small jumps on the switch days."],
  ["Crop condition", "Weekly USDA ratings of the crop from very poor to excellent. See CROP CONDITION."],
  ["D0–D4", "U.S. Drought Monitor levels, from D0 abnormally dry to D4 exceptional drought. D1 and above is drought."],
  ["Ending stocks", "Grain expected to be left at the end of the marketing year, also called carryout. The headline number in a balance sheet."],
  ["Export sales", "Weekly USDA figures for how much U.S. grain foreign buyers ordered, a gauge of overseas demand."],
  ["FAS", "USDA Foreign Agricultural Service. Publishes the supply and demand database and export sales."],
  ["Futures contract", "An agreement to buy or sell a set amount of grain (5,000 bushels at CBOT) at an agreed price on a future date. Most are closed before delivery; the price works as the market's benchmark."],
  ["Hedger", "Someone who owns or needs physical grain, such as a farmer or processor, and uses futures to lock in a price."],
  ["Link group", "A coloured letter (A, B, C…) shared by panels that follow the same crop."],
  ["Lock", "A chamber that lifts or lowers barges past a dam. Weekly grain tonnage through the last locks on the Mississippi and Ohio shows how much grain is moving downriver."],
  ["Long", "Holding a position that gains when the price rises."],
  ["Managed money", "Hedge funds and trading advisers speculating on price, as counted in the COT report."],
  ["Marketing year", "The 12 months a crop is sold and used in, starting at harvest: September to August for U.S. corn and soybeans, June to May for wheat."],
  ["NASS", "USDA National Agricultural Statistics Service. Publishes Crop Progress and most U.S. crop statistics."],
  ["Net position", "Long contracts minus short contracts. Positive is net long, negative is net short."],
  ["OHLC candle", "Open, high, low and close for one day, drawn as a box (open to close) with lines to the high and low."],
  ["Percentile", "Where a value sits against its own history, from 0 (the lowest stored) to 100 (the highest)."],
  ["River constraint score", "AgriTerminal's 0 to 100 measure of how much low water is limiting barges at a gauge, from river depth, the forecast and lock traffic. See RIVER."],
  ["Short", "Holding a position that gains when the price falls."],
  ["Speculator", "A trader with no physical grain who aims to profit from price changes."],
  ["Stage", "The height of a river at a gauge, in feet above a fixed zero point. Low readings mean shallower water for barges."],
  ["Standard deviation (SD)", "How much prices usually move day to day. A 2 SD day moved about twice as far as a typical recent day."],
  ["Template", "A ready-made layout for a role: Farmer, Trader, Analyst or Student."],
  ["USDA", "United States Department of Agriculture, the source of most crop statistics in this app."],
  ["WASDE", "World Agricultural Supply and Demand Estimates: USDA's monthly forecast of supply and use, usually around the 10th at noon Eastern. Markets often move sharply on it."],
  ["Workspace", "A saved layout of panels. Keep several and switch with WS name or the menu beside the workspace name."],
  ["ZC, ZS, ZW", "Exchange symbols for corn, soybean and wheat (soft red winter) futures at CBOT."],
];

/** Case-insensitive match of a search query against any of the given texts. An empty query matches everything. */
export function matchesQuery(query: string, ...texts: string[]) {
  const needle = query.trim().toLowerCase();
  return !needle || texts.some((text) => text.toLowerCase().includes(needle));
}

/** Every text in a panel guide, for searching. */
export function guideTexts(title: string, guide: PanelGuide) {
  return [title, guide.usage, guide.oneLine, guide.summary, ...guide.howToRead, ...(guide.terms ?? []).flat()];
}
