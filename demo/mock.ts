// Mocked Tauri bridge. Every command the frontend invokes (see src/lib/ipc.ts) is answered from fixtures,
// and the three backend events are emitted on timers so panels update the way they do in the real app.
import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import type { Driver, MoveExplanation, PriceBar, StressPoint } from "../src/lib/ipc";
import { ALERTS, buildCalendar, buildMetrics, buildNews, buildPrices, buildRiverMetrics, buildRiverStatus, buildRiverTimeline, buildStored, buildWeather, NOW, PLUGINS, SOURCES } from "./fixtures";

const params = new URLSearchParams(window.location.search);
const LS = "agri-demo:";
const read = (k: string): string | null => { try { return localStorage.getItem(LS + k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(LS + k, v); } catch { /* ignore */ } };

function moveDrivers(commodity: string, date: string, up: boolean, i: number): Driver[] {
  const name = { ZC: "corn", ZS: "soybeans", ZW: "wheat" }[commodity] ?? commodity;
  const at = `${date}T14:00:00Z`;
  const pool: Driver[][] = [
    [{ kind: "scheduled_event", title: "USDA WASDE · expected window", url: null, source: "Report calendar", at, label: "Likely driver", score: 0.82, reasons: ["Scheduled release fell on the same session", `Covers ${name}`] },
      { kind: "news", title: `Stocks estimate surprises the trade in ${name}`, url: "https://example.invalid/news/1", source: "Example Grain Wire", at, label: "Possible driver", score: 0.55, reasons: ["Published within a day of the move", `Mentions ${name}`, up ? "Wording points higher, matching the move" : "Wording points lower, matching the move"] }],
    [{ kind: "news", title: up ? `Dry spell trims yield outlook for ${name}` : `Rain relief lifts crop prospects for ${name}`, url: "https://example.invalid/news/2", source: "Heartland Ag Report", at, label: "Possible driver", score: 0.61, reasons: ["Published the evening before the move", up ? "Wording points higher, matching the move" : "Wording points lower, matching the move"] }],
    [{ kind: "news", title: `Weekly export sales for ${name} miss expectations`, url: "https://example.invalid/news/3", source: "Prairie Markets Daily", at, label: "Possible driver, low confidence", score: 0.31, reasons: ["Published on the same day", "Direction of the wording is unclear"] }],
  ];
  return pool[i % pool.length];
}

function movesFor(bars: PriceBar[], commodity: string, thresholdSd: number): MoveExplanation[] {
  const rets = bars.map((b, i) => (i === 0 ? 0 : Math.log(b.close / bars[i - 1].close)));
  const out: MoveExplanation[] = [];
  for (let i = 21; i < bars.length; i++) {
    const window = rets.slice(i - 20, i);
    const mean = window.reduce((a, b) => a + b, 0) / 20;
    const sd = Math.sqrt(window.reduce((a, b) => a + (b - mean) ** 2, 0) / 19);
    const z = (rets[i] - mean) / sd;
    if (Math.abs(z) < thresholdSd) continue;
    const drivers = moveDrivers(commodity, bars[i].period, rets[i] > 0, out.length);
    out.push({ move: { date: bars[i].period, previousDate: bars[i - 1].period, logReturn: rets[i], zScore: z }, label: drivers[0].label, drivers });
  }
  return out.reverse();
}

export function installMockBridge() {
  // The app calls Tauri's isTauri() to choose between its database and browser storage for workspaces.
  (window as unknown as { isTauri: boolean }).isTauri = true;

  const prices: Record<string, PriceBar[]> = { "price.ZC.close": buildPrices("ZC"), "price.ZS.close": buildPrices("ZS"), "price.ZW.close": buildPrices("ZW") };
  const metrics = { ...buildMetrics(), ...buildRiverMetrics() };
  const news = buildNews();
  const calendar = buildCalendar();
  const stored = buildStored(prices, metrics);
  let alerts = [...ALERTS];
  let plugins = [...PLUGINS];
  const workspaces: [string, string, string][] = JSON.parse(read("workspaces") ?? "[]");
  const settings: Record<string, string> = JSON.parse(read("settings") ?? "{}");
  if (!("profile" in settings) && !params.has("onboarding")) {
    settings.profile = JSON.stringify({ role: "trader", commodities: ["ZC", "ZS"], region: "ia" });
  }
  const persistWorkspaces = () => write("workspaces", JSON.stringify(workspaces));
  const sym = (s: unknown) => String(s).toUpperCase();

  mockIPC((cmd, payload) => {
    const a = (payload ?? {}) as Record<string, any>;
    switch (cmd) {
      case "get_series": return prices[a.seriesId] ?? [];
      case "list_sources": return SOURCES;
      case "refresh_source": case "refresh_weather": case "refresh_news": case "test_connection": case "set_source_enabled": return null;
      case "get_metric_series": return metrics[a.seriesId] ?? [];
      case "list_calendar_events": return calendar;
      case "get_weather_for_commodity": return buildWeather(sym(a.commodity));
      case "get_news_for_commodity": return news[sym(a.commodity)] ?? [];
      case "save_secret": case "save_plugin_secret": return null;
      case "get_secret_status": return true;
      case "list_workspaces": return workspaces;
      case "save_workspace": {
        const i = workspaces.findIndex(([id]) => id === a.id);
        if (i >= 0) workspaces[i] = [a.id, a.name, a.json]; else workspaces.push([a.id, a.name, a.json]);
        persistWorkspaces(); return null;
      }
      case "delete_workspace": { const i = workspaces.findIndex(([id]) => id === a.id); if (i >= 0) workspaces.splice(i, 1); persistWorkspaces(); return null; }
      case "explain_moves": return movesFor(prices[`price.${sym(a.commodity)}.close`] ?? [], sym(a.commodity), a.thresholdSd ?? 2.5);
      case "crop_stress_timeline": {
        const s = sym(a.commodity);
        const cond = metrics[`nass.${s.toLowerCase()}.condition.good_excellent`];
        const dry = metrics["drought.ia.D1"];
        const at = (series: typeof cond, period: string) => [...series].reverse().find((p) => p.period <= period)?.value ?? null;
        return (prices[`price.${s}.close`] ?? []).map((bar): StressPoint => {
          const c = at(cond, bar.period);
          return { date: bar.period, close: bar.close, condition: c, conditionLow: c === null ? null : c - 7, conditionHigh: c === null ? null : c + 7, drought: at(dry, bar.period) };
        });
      }
      case "get_river_status": return buildRiverStatus(String(a.gauge ?? "stlouis"));
      case "get_river_timeline": return buildRiverTimeline(String(a.gauge ?? "stlouis"), prices[`price.${sym(a.commodity)}.close`] ?? []);
      case "run_backtest": return { total: 14, detected: 12, topMatch: 8, missedDates: ["2026-03-11", "2026-04-02"], topMatchRate: 0.667 };
      case "list_alerts": return alerts;
      case "save_alert": alerts = [...alerts.filter((x) => x.id !== a.alert.id), { ...a.alert, enabled: true, triggered: false }]; return null;
      case "delete_alert": alerts = alerts.filter((x) => x.id !== a.id); return null;
      case "set_alert_enabled": alerts = alerts.map((x) => (x.id === a.id ? { ...x, enabled: a.enabled } : x)); return null;
      case "list_plugins": return plugins;
      case "preview_plugin": return { errors: [], summary: PLUGINS[1] };
      case "install_plugin": plugins = [...plugins.filter((p) => p.id !== PLUGINS[1].id), PLUGINS[1]]; return PLUGINS[1];
      case "remove_plugin": plugins = plugins.filter((p) => p.id !== a.id); return null;
      case "get_data_directory": return "~/AgriTerminal/data (demo)";
      case "list_series": return stored.map((s) => s.seriesId);
      case "list_stored_series": return stored;
      case "get_stored_rows": {
        const p = prices[a.seriesId];
        return p ? { kind: "price", rows: p } : { kind: "metric", rows: metrics[a.seriesId] ?? [] };
      }
      case "export_series_csv": return `~/AgriTerminal/data/exports/${a.seriesId}.csv`;
      case "export_workspace": return `~/AgriTerminal/data/exports/${a.id}.json`;
      case "get_setting": return settings[a.key] ?? null;
      case "set_setting": settings[a.key] = a.value; write("settings", JSON.stringify(settings)); return null;
      case "plugin:notification|is_permission_granted": return true;
      case "plugin:notification|request_permission": return "granted";
      case "plugin:notification|notify": return null;
      default:
        if (cmd.startsWith("plugin:event|")) return undefined;
        console.warn("[demo] unmocked command", cmd, payload);
        return null;
    }
  }, { shouldMockEvents: true });

  // Live feel: nudge today's corn bar every few seconds, as a refresh would, and report source activity.
  const tick = () => {
    for (const [id, bars] of Object.entries(prices)) {
      const last = bars[bars.length - 1];
      const drift = (Math.random() - 0.5) * 0.012 * last.close;
      last.close = Math.round((last.close + drift) * 10000) / 10000;
      last.high = Math.max(last.high, last.close); last.low = Math.min(last.low, last.close);
      last.revision += 1; last.fetchedAt = new Date().toISOString();
      void emit("data-updated", [id]);
    }
  };
  window.setInterval(tick, 6000);
  window.setInterval(() => void emit("source-status", "massive:ok"), 15000);

  (window as unknown as { __demo: unknown }).__demo = {
    fireAlert: () => emit("alert-fired", { id: "a1", symbol: "ZC", direction: "above", threshold: 4.5, close: 4.52, date: new Date(NOW).toISOString().slice(0, 10) }),
    reset: () => { Object.keys(localStorage).filter((k) => k.startsWith(LS) || k.startsWith("agri-terminal")).forEach((k) => localStorage.removeItem(k)); location.reload(); },
  };
}
