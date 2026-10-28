// Fictional data for the demo. Prices are a seeded random walk; nothing here is a market quote.
import type {
  AlertRecord, CalendarEvent, MetricPoint, NewsItem, PluginSummary, PriceBar, SourceStatus, StoredSeries, WeatherForecast,
} from "../src/lib/ipc";

const DAY = 86_400_000;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const iso = (ms: number) => new Date(ms).toISOString();
const day = (ms: number) => iso(ms).slice(0, 10);
export const NOW = Date.now();
const today = Date.UTC(new Date(NOW).getUTCFullYear(), new Date(NOW).getUTCMonth(), new Date(NOW).getUTCDate());

/** Weekdays, oldest first, ending on the last weekday before today. */
function tradingDays(count: number): number[] {
  const out: number[] = [];
  for (let t = today - DAY; out.length < count; t -= DAY) {
    const dow = new Date(t).getUTCDay();
    if (dow !== 0 && dow !== 6) out.unshift(t);
  }
  return out;
}

const BASE: Record<string, { start: number; vol: number; seed: number }> = {
  ZC: { start: 4.1, vol: 0.011, seed: 11 },
  ZS: { start: 10.4, vol: 0.010, seed: 23 },
  ZW: { start: 5.5, vol: 0.013, seed: 37 },
};
/** Offsets from the end of the series (in trading days) where a shock is injected, so the move explainer has something to explain. */
const SHOCKS: Record<string, Record<number, number>> = { ZC: { 9: 0.042, 31: -0.036, 58: 0.039 }, ZS: { 14: -0.04, 40: 0.037 }, ZW: { 6: 0.045, 27: -0.041 } };

export const PRICE_DAYS = tradingDays(120);

export function buildPrices(symbol: string): PriceBar[] {
  const { start, vol, seed } = BASE[symbol];
  const rand = rng(seed);
  let close = start;
  return PRICE_DAYS.map((t, i) => {
    const fromEnd = PRICE_DAYS.length - 1 - i;
    const shock = SHOCKS[symbol][fromEnd] ?? 0;
    const open = close;
    close = Math.max(1, close * (1 + (rand() - 0.49) * vol * 2 + shock));
    const high = Math.max(open, close) * (1 + rand() * 0.006);
    const low = Math.min(open, close) * (1 - rand() * 0.006);
    const r = (n: number) => Math.round(n * 10000) / 10000;
    return {
      seriesId: `price.${symbol}.close`, period: day(t), releasedAt: iso(t + 21 * 3600_000),
      open: r(open), high: r(high), low: r(low), close: r(close), unit: "USD/bu",
      sourceId: "massive", fetchedAt: iso(NOW - 3 * 3600_000), revision: 1,
    };
  });
}

const weekly = (count: number) => {
  const out: number[] = [];
  let t = today;
  while (new Date(t).getUTCDay() !== 5) t -= DAY;
  for (let i = 0; i < count; i++) { out.unshift(t); t -= 7 * DAY; }
  return out;
};

function metric(seriesId: string, times: number[], values: number[], unit: string, sourceId: string, hour = 19): MetricPoint[] {
  return times.map((t, i) => ({
    seriesId, period: day(t), releasedAt: iso(t + hour * 3600_000), value: values[i], unit, sourceId,
    fetchedAt: iso(NOW - 6 * 3600_000), revision: 1,
  }));
}

function wander(seed: number, n: number, start: number, step: number, lo = -Infinity, hi = Infinity) {
  const rand = rng(seed);
  const out: number[] = [];
  let v = start;
  for (let i = 0; i < n; i++) { v = Math.min(hi, Math.max(lo, v + (rand() - 0.5) * step)); out.push(Math.round(v * 10) / 10); }
  return out;
}

export function buildMetrics(): Record<string, MetricPoint[]> {
  const out: Record<string, MetricPoint[]> = {};
  const times = weekly(40);
  ["ZC", "ZS", "ZW"].forEach((sym, k) => {
    out[`cot.${sym}.managed_money_net`] = metric(`cot.${sym}.managed_money_net`, times, wander(5 + k, 40, 90_000 - k * 30_000, 28_000).map(Math.round), "contracts", "cftc-cot");
    out[`cot.${sym}.commercial_net`] = metric(`cot.${sym}.commercial_net`, times, wander(15 + k, 40, -110_000, 24_000).map(Math.round), "contracts", "cftc-cot");
    out[`cot.${sym}.swap_net`] = metric(`cot.${sym}.swap_net`, times, wander(25 + k, 40, 40_000, 9_000).map(Math.round), "contracts", "cftc-cot");
    const s = sym.toLowerCase();
    const ge = wander(35 + k, 40, 68, 3.5, 40, 82);
    out[`nass.${s}.condition.good_excellent`] = metric(`nass.${s}.condition.good_excellent`, times, ge, "%", "usda-nass", 20);
    out[`nass.${s}.condition.fair`] = metric(`nass.${s}.condition.fair`, times, ge.map((v) => Math.round((100 - v) * 0.7 * 10) / 10), "%", "usda-nass", 20);
    out[`nass.${s}.condition.poor_very_poor`] = metric(`nass.${s}.condition.poor_very_poor`, times, ge.map((v) => Math.round((100 - v) * 0.3 * 10) / 10), "%", "usda-nass", 20);
    out[`nass.${s}.progress.planted`] = metric(`nass.${s}.progress.planted`, times, times.map(() => 100), "%", "usda-nass", 20);
    out[`nass.${s}.progress.harvested`] = metric(`nass.${s}.progress.harvested`, times, times.map((_, i) => Math.max(0, Math.min(96, (i - 28) * 8))), "%", "usda-nass", 20);
    const fas: Record<string, number> = { beginning_stocks: 1360 - k * 200, production: 15200 - k * 11000, imports: 25, domestic_consumption: 12150 - k * 9000, exports: 2300 - k * 1500, ending_stocks: 1550 - k * 380 };
    for (const [name, v] of Object.entries(fas)) {
      out[`fas.${s}.${name}`] = metric(`fas.${s}.${name}`, [times[34], times[37]], [v - 40, v], "million bu", "usda-fas", 12);
    }
  });
  const states = ["ia", "il", "ne", "mn", "in", "ks", "nd", "sd", "oh"];
  states.forEach((st, k) => {
    const d0 = wander(60 + k, 40, 22 + k * 3, 8, 0, 80);
    d0.forEach(() => undefined);
    [["D0", 1], ["D1", 0.6], ["D2", 0.32], ["D3", 0.12], ["D4", 0.03]].forEach(([lvl, f]) => {
      out[`drought.${st}.${lvl}`] = metric(`drought.${st}.${lvl}`, times, d0.map((v) => Math.round(v * (f as number) * 10) / 10), "% of area", "drought-monitor", 13);
    });
  });
  return out;
}

export const SOURCES: SourceStatus[] = [
  ["massive", "Massive futures", 86400], ["cftc-cot", "CFTC Commitments of Traders", 604800], ["usda-nass", "USDA NASS crop condition", 604800],
  ["usda-fas", "USDA FAS balance sheets", 2592000], ["drought-monitor", "U.S. Drought Monitor", 604800], ["nws", "NWS forecasts", 21600],
  ["open-meteo", "Open-Meteo forecasts", 21600], ["gdelt", "GDELT headlines", 3600], ["usda-rss", "USDA RSS news", 3600],
].map(([sourceId, name, cadenceSeconds]) => ({
  sourceId: sourceId as string, name: name as string, state: "ok", lastOk: iso(NOW - 2 * 3600_000), error: null, isDemo: false,
  lastAttempt: iso(NOW - 2 * 3600_000), nextExpected: iso(NOW + (cadenceSeconds as number) * 1000 - 2 * 3600_000), enabled: true, cadenceSeconds: cadenceSeconds as number,
}));

export function buildStored(prices: Record<string, PriceBar[]>, metrics: Record<string, MetricPoint[]>): StoredSeries[] {
  const rows: StoredSeries[] = [];
  for (const [id, bars] of Object.entries(prices)) rows.push({ seriesId: id, sourceId: "massive", kind: "price", rows: bars.length, firstPeriod: bars[0].period, lastPeriod: bars[bars.length - 1].period, lastFetchedAt: bars[0].fetchedAt });
  for (const [id, pts] of Object.entries(metrics)) rows.push({ seriesId: id, sourceId: pts[0].sourceId, kind: "metric", rows: pts.length, firstPeriod: pts[0].period, lastPeriod: pts[pts.length - 1].period, lastFetchedAt: pts[0].fetchedAt });
  return rows;
}

export function buildCalendar(): CalendarEvent[] {
  const titles: [string, string, number, string][] = [
    ["COT", "CFTC Commitments of Traders · expected", 1.2, "ZC, ZS, ZW"],
    ["Export Sales", "USDA Export Sales · expected", 0.4, "ZC, ZS, ZW"],
    ["NASS", "USDA Crop Progress · expected", 3.1, "ZC, ZS, ZW"],
    ["WASDE", "USDA WASDE · expected window", 9.5, "ZC, ZS, ZW"],
    ["COT", "CFTC Commitments of Traders · expected", 8.2, "ZC, ZS, ZW"],
    ["Export Sales", "USDA Export Sales · expected", 7.4, "ZC, ZS, ZW"],
  ];
  return titles.map(([kind, title, d, commodity], i) => ({ id: `cal-${i}`, kind, title, commodity, scheduledAt: iso(NOW + d * DAY) })).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

export function buildNews(): Record<string, NewsItem[]> {
  const heads: Record<string, [string, string, number][]> = {
    ZC: [
      ["Export inspections for corn beat trade guesses for a third week", "Example Grain Wire", 0.3],
      ["Harvest pace in the western belt runs ahead of the five-year average", "USDA NASS News", 0.9],
      ["Ethanol grind edges higher as plants restart after maintenance", "Prairie Markets Daily", 1.6],
      ["Basis firms at river terminals on tight barge availability", "Example Grain Wire", 2.5],
      ["Dry spell trims late-season yield estimates in two growing states", "Heartland Ag Report", 3.4],
      ["Farmers hold bins open as storage bids narrow", "Prairie Markets Daily", 5.0],
      ["Fund positioning in corn turns net long for the first time since spring", "Example Grain Wire", 9.0],
      ["USDA trims planted area in a revised acreage note", "USDA NASS Reports", 31.0],
    ],
    ZS: [
      ["Crush margins widen on strong soybean oil demand", "Prairie Markets Daily", 0.5],
      ["China buying pace slows in weekly export sales", "Example Grain Wire", 1.1],
      ["Pod-fill rain arrives too late for some northern fields", "Heartland Ag Report", 2.2],
      ["River levels improve, easing soybean shipping costs", "Example Grain Wire", 4.0],
      ["Soybean harvest 62% complete, USDA says", "USDA NASS News", 6.0],
      ["Freight costs ease on the Gulf route", "Prairie Markets Daily", 14.0],
    ],
    ZW: [
      ["Winter wheat seedings begin under dry topsoil", "USDA NASS News", 0.7],
      ["Black Sea offers undercut U.S. wheat in key tenders", "Example Grain Wire", 1.4],
      ["Plains millers report steady protein premiums", "Heartland Ag Report", 3.0],
      ["Wheat exports lag last year's pace by 8%", "USDA NASS Reports", 5.5],
      ["Drought watch widens across the southern Plains", "Prairie Markets Daily", 27.0],
    ],
  };
  return Object.fromEntries(Object.entries(heads).map(([sym, items]) => [sym, items.map(([title, source, d], i): NewsItem => ({ title, source, publishedAt: iso(NOW - d * DAY), url: `https://example.invalid/${sym.toLowerCase()}/${i}`, commodity: sym }))]));
}

const REGION_META: Record<string, [string, number, number]> = {
  ia: ["Iowa", 42.0, -93.5], il: ["Illinois", 40.0, -89.0], ne: ["Nebraska", 41.5, -99.0], mn: ["Minnesota", 46.0, -94.0], in: ["Indiana", 40.0, -86.0],
  ks: ["Kansas", 38.5, -98.0], nd: ["North Dakota", 47.5, -100.5], sd: ["South Dakota", 44.5, -100.0], oh: ["Ohio", 40.5, -82.8],
};
const COMMODITY_REGIONS: Record<string, string[]> = { ZC: ["ia", "il", "ne", "mn", "in"], ZS: ["ia", "il", "ne", "mn", "in", "oh"], ZW: ["ks", "nd", "sd", "ne"] };
const SUMMARIES = ["Mostly sunny", "Partly cloudy", "Chance of showers", "Clear and cool", "Light rain late"];

export function buildWeather(commodity: string) {
  const rand = rng(commodity.charCodeAt(1) * 7);
  const forecasts: WeatherForecast[] = [];
  for (const id of COMMODITY_REGIONS[commodity] ?? []) {
    const [name, latitude, longitude] = REGION_META[id];
    for (const provider of ["nws", "open-meteo"]) {
      for (let p = 1; p <= 3; p++) {
        const wet = rand() > 0.6;
        forecasts.push({
          regionId: id, regionName: name, latitude, longitude, provider, validAt: iso(NOW + p * 12 * 3600_000),
          temperatureC: Math.round((11 + rand() * 9) * 10) / 10, precipitationMm: wet ? Math.round(rand() * 120) / 10 : 0,
          precipitationProbability: Math.round(wet ? 50 + rand() * 40 : rand() * 25), windKph: Math.round(8 + rand() * 18),
          relativeHumidity: Math.round(45 + rand() * 40), summary: SUMMARIES[Math.floor(rand() * SUMMARIES.length)],
        });
      }
    }
  }
  return { fetchedAt: iso(NOW - 40 * 60_000), forecasts };
}

export const ALERTS: AlertRecord[] = [
  { id: "a1", symbol: "ZC", direction: "above", threshold: 4.5, enabled: true, triggered: false },
  { id: "a2", symbol: "ZS", direction: "below", threshold: 10.0, enabled: true, triggered: false },
  { id: "a3", symbol: "ZW", direction: "above", threshold: 5.8, enabled: false, triggered: true },
];

export const PLUGINS: PluginSummary[] = [
  { id: "drought-monitor", name: "U.S. Drought Monitor", version: "1.0.0", description: "Weekly drought area by severity for each growing state.", licenseNote: "Public domain, U.S. government data", builtin: true, hosts: ["usdmdataservices.unl.edu"], secrets: [], series: ["drought.<state>.D0 … D4"], cadence: "weekly", errors: [] },
  { id: "example-elevator-basis", name: "Example elevator basis", version: "0.2.1", description: "Cash basis posted by a fictional co-op elevator.", licenseNote: "Example data, not for trading", builtin: false, hosts: ["basis.example.invalid"], secrets: [{ name: "api_key", configured: true }], series: ["basis.example.ZC"], cadence: "daily", errors: [] },
];
