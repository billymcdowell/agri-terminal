// Fictional data for the demo. Prices are a seeded random walk; nothing here is a market quote.
import type {
  AlertRecord, CalendarEvent, MetricPoint, NewsItem, PluginSummary, PriceBar, RiverAlertRecord, RiverPoint, RiverStatus, SourceStatus, StoredSeries, WeatherForecast,
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
  ["usgs-river-stage", "USGS river stage", 86400], ["nwps-river-stage", "NWS river stage", 86400], ["nwps-river-forecast", "NWS river forecasts", 86400],
  ["usda-agtransport", "USDA AgTransport barge rates and locks", 86400],
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
    ["GTR", "USDA Grain Transportation Report · expected", 4.6, "ZC, ZS, ZW"],
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

// River panels. Stage follows a seasonal curve with its low in late autumn plus a random walk; freight
// and lock tonnage respond to how far the river is below normal. All of it is invented for the demo.
const DEMO_RIVER_SOURCE = "fictional demo data";
type DemoGauge = { normal: number; restriction: number; critical: number; mean: number; amp: number; seed: number; location: string; benchmark: number };
const DEMO_GAUGES: Record<string, DemoGauge> = {
  stlouis: { normal: 5, restriction: 1, critical: -3.5, mean: 9.5, amp: 8.5, seed: 71, location: "St. Louis", benchmark: 399 },
  memphis: { normal: 3, restriction: -5, critical: -10, mean: 7.5, amp: 12, seed: 83, location: "Cairo-Memphis", benchmark: 314 },
};
const RIVER_DAYS = 3 * 365;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

type DemoRiver = {
  days: number[]; stage: number[]; forecastMin: number[]; barge: (number | null)[]; tons: (number | null)[]; score: number[];
  gauge: DemoGauge; components: { depth: number; forecast: number; traffic: number }[];
};

function buildRiver(id: string): DemoRiver {
  const gauge = DEMO_GAUGES[id] ?? DEMO_GAUGES.stlouis;
  const rand = rng(gauge.seed);
  const days = Array.from({ length: RIVER_DAYS }, (_, i) => today - (RIVER_DAYS - 1 - i) * DAY);
  let walk = 0;
  const stage = days.map((t) => {
    const doy = (t - Date.UTC(new Date(t).getUTCFullYear(), 0, 1)) / DAY;
    walk = walk * 0.97 + (rand() - 0.5) * 1.2;
    return Math.round((gauge.mean - gauge.amp * Math.cos((2 * Math.PI * (doy - 300)) / 365) + walk) * 100) / 100;
  });
  const deficit = (level: number) => clamp01((gauge.normal - level) / (gauge.normal - gauge.critical));
  const forecastMin = stage.map((_, i) => Math.round((Math.min(...stage.slice(i + 1, i + 8).concat(stage[i])) - rand() * 0.4) * 100) / 100);
  const barge = days.map((t, i) => (new Date(t).getUTCDay() === 2 ? Math.round(300 + 520 * deficit(stage[i]) + rand() * 40) : null));
  const tons = days.map((t, i) => (new Date(t).getUTCDay() === 6 ? Math.round((520_000 * (1 - 0.45 * deficit(stage[i])) + rand() * 60_000) / 100) * 100 : null));
  const weekly = tons.map((v, i) => (v === null ? null : { i, v })).filter((x): x is { i: number; v: number } => x !== null);
  const components = days.map((_, i) => {
    const past = weekly.filter((w) => w.i <= i);
    const latest = past[past.length - 1];
    const before = past.slice(-5, -1);
    const average = before.length === 4 ? before.reduce((a, w) => a + w.v, 0) / 4 : 0;
    return { depth: deficit(stage[i]), forecast: deficit(forecastMin[i]), traffic: latest && average ? clamp01((average - latest.v) / average / 0.5) : 0 };
  });
  const score = components.map((c) => Math.round((50 * c.depth + 30 * c.forecast + 20 * c.traffic) * 10) / 10);
  return { days, stage, forecastMin, barge, tons, score, gauge, components };
}

const lastOf = <T,>(values: (T | null)[]) => { for (let i = values.length - 1; i >= 0; i--) if (values[i] !== null) return { i, v: values[i] as T }; return null; };

export function buildRiverStatus(id: string): RiverStatus {
  const r = buildRiver(id);
  const n = r.days.length - 1;
  const g = r.gauge;
  const input = (i: number, value: number, releaseHours: number) => ({ period: day(r.days[i]), value, releasedAt: iso(r.days[i] + releaseHours * 3600_000), fetchedAt: iso(NOW - 2 * 3600_000), sourceId: DEMO_RIVER_SOURCE });
  const sameDay = [1, 2].map((y) => r.stage[n - y * 365]).filter((v) => v !== undefined);
  const forecast = Array.from({ length: 7 }, (_, k) => ({ date: day(r.days[n] + (k + 1) * DAY), low: Math.round((r.stage[n] - 0.25 * (k + 1)) * 100) / 100 }));
  const barge = lastOf(r.barge)!;
  const previous = lastOf(r.barge.slice(0, barge.i))!;
  const tons = lastOf(r.tons)!;
  const before = r.tons.slice(0, tons.i).filter((v): v is number => v !== null).slice(-4);
  const average = before.reduce((a, v) => a + v, 0) / before.length;
  const c = r.components[n];
  const weight = (value: number, w: number) => ({ value, weight: w, points: value * w * 100 });
  const total = r.score[n];
  return {
    gaugeId: id, gaugeName: id === "memphis" ? "Memphis, TN" : "St. Louis, MO", riverName: "Mississippi River", unit: "ft",
    thresholds: { normal: g.normal, restriction: g.restriction, critical: g.critical }, provisional: true, asOf: iso(NOW),
    stage: input(n, r.stage[n], 16), stageBand: { low: Math.min(...sameDay), mean: sameDay.reduce((a, v) => a + v, 0) / sameDay.length, high: Math.max(...sameDay), years: sameDay.length },
    forecastIssuedAt: iso(today + 16 * 3600_000 - DAY), forecastFetchedAt: iso(NOW - 2 * 3600_000), forecast, forecastMin: Math.min(...forecast.map((f) => f.low)),
    restrictionForecastOn: r.stage[n] > g.restriction ? forecast.find((f) => f.low <= g.restriction)?.date ?? null : null,
    bargeRate: { latest: input(barge.i, barge.v, 66), previous: input(previous.i, previous.v, 66), changePercent: (barge.v / previous.v - 1) * 100, dollarsPerTon: (barge.v * g.benchmark) / 10_000, location: g.location },
    traffic: { week: day(r.days[tons.i]), tons: tons.v, averageTons: average, changePercent: (tons.v / average - 1) * 100, locks: id === "memphis" ? ["MS Locks 27", "OH Olmsted"] : ["MS Locks 27"], releasedAt: iso(r.days[tons.i] + 5 * DAY + 18 * 3600_000) },
    score: { total, band: total >= 70 ? "HIGH" : total >= 40 ? "ELEVATED" : "NORMAL", partial: false, depth: weight(c.depth, 0.5), forecast: weight(c.forecast, 0.3), traffic: weight(c.traffic, 0.2) },
  };
}

export function buildRiverTimeline(id: string, closes: PriceBar[]): RiverPoint[] {
  const r = buildRiver(id);
  const close = new Map(closes.map((bar) => [bar.period, bar.close]));
  let barge: number | null = null;
  return r.days.map((t, i) => {
    if (r.barge[i] !== null) barge = r.barge[i];
    const prior = [1, 2].map((y) => r.stage[i - y * 365]).filter((v) => v !== undefined);
    const s = r.score[i];
    return {
      date: day(t), close: close.get(day(t)) ?? null, stage: r.stage[i],
      stageLow: prior.length === 2 ? Math.min(...prior) : null, stageMean: prior.length === 2 ? (prior[0] + prior[1]) / 2 : null, stageHigh: prior.length === 2 ? Math.max(...prior) : null,
      forecastMin: r.forecastMin[i], bargeRate: barge, score: s, band: s >= 70 ? "HIGH" : s >= 40 ? "ELEVATED" : "NORMAL", partial: false, basisSpread: null,
    };
  });
}

/** River series for the raw data panel. */
export function buildRiverMetrics(): Record<string, MetricPoint[]> {
  const out: Record<string, MetricPoint[]> = {};
  for (const id of Object.keys(DEMO_GAUGES)) {
    const r = buildRiver(id);
    const recent = r.days.map((t, i) => ({ t, i })).slice(-120);
    out[`river.${id}.stage`] = metric(`river.${id}.stage`, recent.map((x) => x.t), recent.map((x) => r.stage[x.i]), "ft", DEMO_RIVER_SOURCE, 16);
    const weeks = (values: (number | null)[]) => recent.filter((x) => values[x.i] !== null);
    const location = id === "memphis" ? "cairo_memphis" : "stlouis";
    out[`river.barge_rate.${location}`] = metric(`river.barge_rate.${location}`, weeks(r.barge).map((x) => x.t), weeks(r.barge).map((x) => r.barge[x.i] as number), "percent_of_tariff", DEMO_RIVER_SOURCE, 66);
    if (id === "stlouis") out["river.locks.ms27.grain_tons"] = metric("river.locks.ms27.grain_tons", weeks(r.tons).map((x) => x.t), weeks(r.tons).map((x) => r.tons[x.i] as number), "short_tons", DEMO_RIVER_SOURCE, 138);
  }
  return out;
}

export const RIVER_ALERTS: RiverAlertRecord[] = [
  ["stlouis", "St. Louis, MO", "1.00", "-3.50"], ["memphis", "Memphis, TN", "-5.00", "-10.00"],
].flatMap(([id, name, restriction, critical]) => [
  { id: `river:${id}:below_restriction`, gaugeId: id, gaugeName: name, rule: "below_restriction" as const, description: `${name} stage at or below the ${restriction} ft restriction level`, enabled: true, state: 0 },
  { id: `river:${id}:below_critical`, gaugeId: id, gaugeName: name, rule: "below_critical" as const, description: `${name} stage at or below the ${critical} ft critical level`, enabled: true, state: 0 },
  { id: `river:${id}:forecast_restriction`, gaugeId: id, gaugeName: name, rule: "forecast_restriction" as const, description: `${name} forecast reaches the ${restriction} ft restriction level within 7 days`, enabled: true, state: id === "stlouis" ? 1 : 0 },
  { id: `river:${id}:band_up`, gaugeId: id, gaugeName: name, rule: "band_up" as const, description: `${name} river constraint score moves up a band`, enabled: true, state: 1 },
]);
