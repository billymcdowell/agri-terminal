"""Writes the synthetic sample output the app is built against before any model exists.

Every value is invented: the estimates, the USDA figures and the damage events. Only the dates and
the USDA release times follow the real 2026 schedule, so the vintage rules can be exercised. Run
from pipelines/crop-nowcast:

    uv run python -m crop_nowcast.publish.sample sample_output
"""

from __future__ import annotations

import random
import shutil
import sys
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

from .contract import (
    ACREAGE_COLUMNS,
    CROPS,
    YIELD_COLUMNS,
    format_acres,
    format_time,
    format_yield,
    write_csv,
    write_json,
)

MODEL_VERSION = "sample-0.1.0"
SEED = 2026
# Tuesdays at 18:00 UTC, the day after Monday's Crop Progress report.
PUBLISHES = tuple(datetime(2026, 6, 16, 18, tzinfo=UTC) + timedelta(weeks=n) for n in range(10))
# Like the real data repository, each publish gets a folder; the sample keeps the last two.
DATED_FOLDERS = 2
GEOS = ("US", "IA", "IL", "NE", "MN", "IN", "OH", "SD", "ND", "KS", "MO")

# Invented round numbers in a plausible range. They are not USDA estimates.
YIELD_BASE = {
    "corn": {"US": 181, "IA": 200, "IL": 205, "NE": 190, "MN": 190, "IN": 195,
             "OH": 185, "SD": 160, "ND": 150, "KS": 135, "MO": 165},
    "soybeans": {"US": 52, "IA": 58, "IL": 63, "NE": 60, "MN": 50, "IN": 58,
                 "OH": 55, "SD": 46, "ND": 36, "KS": 40, "MO": 49},
}  # fmt: skip
ACRES_BASE = {
    "corn": {"US": 93_000_000, "IA": 13_000_000, "IL": 11_000_000, "NE": 10_000_000,
             "MN": 8_000_000, "IN": 5_300_000, "OH": 3_500_000, "SD": 6_000_000,
             "ND": 4_000_000, "KS": 6_000_000, "MO": 3_600_000},
    "soybeans": {"US": 84_000_000, "IA": 10_000_000, "IL": 10_500_000, "NE": 5_200_000,
                 "MN": 7_400_000, "IN": 5_800_000, "OH": 5_000_000, "SD": 5_300_000,
                 "ND": 6_500_000, "KS": 4_500_000, "MO": 5_700_000},
}  # fmt: skip


@dataclass(frozen=True)
class Release:
    id: str
    at: datetime
    national_only: bool


def _noon_eastern(month: int, day: int) -> datetime:
    """USDA reports come out at 12:00 Eastern, which is 16:00 UTC in summer."""
    return datetime(2026, month, day, 16, tzinfo=UTC)


YIELD_RELEASES = (
    Release("wasde-2026-05", _noon_eastern(5, 12), national_only=True),
    Release("wasde-2026-06", _noon_eastern(6, 11), national_only=True),
    Release("wasde-2026-07", _noon_eastern(7, 10), national_only=True),
    Release("nass-crop-production-2026-08", _noon_eastern(8, 12), national_only=False),
)
ACREAGE_RELEASES = (
    Release("nass-prospective-plantings-2026-03", _noon_eastern(3, 31), national_only=False),
    Release("nass-acreage-2026-06", _noon_eastern(6, 30), national_only=False),
    Release("nass-crop-production-2026-08", _noon_eastern(8, 12), national_only=False),
)

RELEASE_NAMES = {
    "wasde": "WASDE",
    "nass-crop-production": "Crop Production",
    "nass-prospective-plantings": "Prospective Plantings",
    "nass-acreage": "Acreage",
}
MONTHS = ("January February March April May June July August September October November "
          "December").split()  # fmt: skip


def _uniform(rng: random.Random, low: float, high: float) -> float:
    # Only random() is guaranteed to give the same sequence on every Python version.
    return low + (high - low) * rng.random()


def _latest_release(releases: tuple[Release, ...], geo: str, before: datetime) -> Release | None:
    usable = [r for r in releases if r.at < before and (geo == "US" or not r.national_only)]
    return usable[-1] if usable else None


def _usda_yield(release: Release, crop: str, geo: str) -> float:
    rng = random.Random(f"{SEED}-usda-yield-{release.id}-{crop}-{geo}")
    step = 3.0 if crop == "corn" else 1.0
    return round(YIELD_BASE[crop][geo] + _uniform(rng, -step, step), 1)


def _usda_acres(release: Release, crop: str, geo: str) -> float:
    rng = random.Random(f"{SEED}-usda-acres-{release.id}-{crop}-{geo}")
    return round(ACRES_BASE[crop][geo] * (1 + _uniform(rng, -0.03, 0.03)), -4)


def release_label(release_id: str) -> str:
    """`wasde-2026-07` as "July 2026 WASDE"."""
    report, year, month = release_id.rsplit("-", 2)
    return f"{MONTHS[int(month) - 1]} {year} {RELEASE_NAMES[report]}"


def yield_rows() -> list[dict[str, str]]:
    rows = []
    for crop in CROPS:
        for geo in GEOS:
            rng = random.Random(f"{SEED}-yield-{crop}-{geo}")
            base = YIELD_BASE[crop][geo]
            step, start, end = (1.5, 16.0, 6.0) if crop == "corn" else (0.5, 5.0, 2.0)
            p50 = float(base)
            for week, published in enumerate(PUBLISHES):
                p50 += _uniform(rng, -step, step)
                spread = start + (end - start) * week / (len(PUBLISHES) - 1)
                release = _latest_release(YIELD_RELEASES, geo, published)
                usda = _usda_yield(release, crop, geo) if release else None
                middle = round(p50, 1)
                rows.append({
                    "published_at": format_time(published),
                    "crop": crop,
                    "geo": geo,
                    "week_ending": (published.date() - timedelta(days=2)).isoformat(),
                    "p10": format_yield(middle - spread),
                    "p50": format_yield(middle),
                    "p90": format_yield(middle + 0.8 * spread),
                    "usda_latest": format_yield(usda) if usda is not None else "",
                    "usda_vintage": release.id if release else "",
                    "gap_p50": format_yield(middle - usda) if usda is not None else "",
                    "baseline_trend": format_yield(base),
                    "model_version": MODEL_VERSION,
                })  # fmt: skip
    return sorted(rows, key=lambda row: (row["week_ending"], row["crop"], GEOS.index(row["geo"])))


def acreage_rows() -> list[dict[str, str]]:
    rows = []
    for crop in CROPS:
        for geo in GEOS:
            rng = random.Random(f"{SEED}-acres-{crop}-{geo}")
            for week, published in enumerate(PUBLISHES):
                release = _latest_release(ACREAGE_RELEASES, geo, published)
                usda = _usda_acres(release, crop, geo) if release else None
                anchor = usda if usda is not None else ACRES_BASE[crop][geo]
                middle = round(anchor * (1 + _uniform(rng, -0.02, 0.02)), -4)
                share = 0.06 + (0.02 - 0.06) * week / (len(PUBLISHES) - 1)
                rows.append({
                    "published_at": format_time(published),
                    "crop": crop,
                    "geo": geo,
                    "week_ending": (published.date() - timedelta(days=2)).isoformat(),
                    "acres_p10": format_acres(round(middle * (1 - share), -4)),
                    "acres_p50": format_acres(middle),
                    "acres_p90": format_acres(round(middle * (1 + share), -4)),
                    "usda_latest": format_acres(usda) if usda is not None else "",
                    "usda_report": release.id if release else "",
                    "model_version": MODEL_VERSION,
                })  # fmt: skip
    return sorted(rows, key=lambda row: (row["week_ending"], row["crop"], GEOS.index(row["geo"])))


def _event(event_id: str, published: date, event_date: date, cause: str, states: list[str],
           middle: int, low: int, high: int, confidence: str) -> dict[str, Any]:  # fmt: skip
    return {
        "id": event_id,
        "published_at": format_time(datetime(published.year, published.month, published.day, 18,
                                             tzinfo=UTC)),
        "event_date": event_date.isoformat(),
        "cause": cause,
        "states": states,
        "crop": "corn",
        "affected_acres_p50": middle,
        "affected_acres_range": [low, high],
        "confidence": confidence,
        "storm_report_refs": [f"{event_id}-report-1", f"{event_id}-report-2"],
        "method": "Sample: invented for testing the app. No imagery was analysed.",
    }  # fmt: skip


# Every version of each event. The wind event is restated in the last publish, as a real one can be.
DAMAGE_EVENT_VERSIONS = (
    _event("sample-2026-07-14-ne-hail", date(2026, 7, 21), date(2026, 7, 14), "hail", ["NE"],
           80_000, 40_000, 150_000, "low"),
    _event("sample-2026-08-04-ia-wind", date(2026, 8, 11), date(2026, 8, 4), "wind", ["IA", "IL"],
           320_000, 180_000, 520_000, "low"),
    _event("sample-2026-08-04-ia-wind", date(2026, 8, 18), date(2026, 8, 4), "wind", ["IA", "IL"],
           290_000, 200_000, 410_000, "medium"),
)  # fmt: skip


def damage_events(as_of: datetime) -> list[dict[str, Any]]:
    """The newest version of each event published by `as_of`, oldest event first."""
    latest: dict[str, dict[str, Any]] = {}
    for event in DAMAGE_EVENT_VERSIONS:
        if event["published_at"] <= format_time(as_of):
            latest[event["id"]] = event
    return sorted(latest.values(), key=lambda event: (event["event_date"], event["id"]))


def brief(as_of: datetime, rows: list[dict[str, str]], events: list[dict[str, Any]]) -> dict:
    newest = {
        (row["crop"], row["geo"]): row for row in rows if row["published_at"] == format_time(as_of)
    }
    corn, soy = newest[("corn", "US")], newest[("soybeans", "US")]
    bullets = []
    for name, row in (("Corn", corn), ("Soybeans", soy)):
        if row["usda_latest"]:
            gap = float(row["gap_p50"])
            side = "above" if gap > 0 else "below" if gap < 0 else "level with"
            amount = f"{format_yield(abs(gap))} bu/acre " if gap else ""
            bullets.append(
                f"{name}: the sample estimate is {amount}{side} the "
                f"{release_label(row['usda_vintage'])} figure of {row['usda_latest']} bu/acre."
            )
    count = len(events)
    bullets.append(f"{count} sample damage event{'s' if count != 1 else ''} on record.")
    return {
        "published_at": format_time(as_of),
        "model_version": MODEL_VERSION,
        "ai_model": None,
        "summary": (
            f"Sample data, not a model result. For the week ending {corn['week_ending']}, the "
            f"sample model estimates U.S. corn yield at {corn['p50']} bu/acre (range "
            f"{corn['p10']} to {corn['p90']}) and soybeans at {soy['p50']} bu/acre (range "
            f"{soy['p10']} to {soy['p90']})."
        ),
        "bullets": bullets,
        "validated": True,
        "fallback_used": True,
    }


def model_card(as_of: datetime) -> dict[str, Any]:
    return {
        "published_at": format_time(as_of),
        "model_version": MODEL_VERSION,
        "crops": list(CROPS),
        "training_years": [],
        "features": [],
        "metrics": {},
        "limitations": [
            "Sample output: every value is invented for testing the app and is not a forecast."
        ],
    }


def write_folder(folder: Path, as_of: datetime) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    stamp = format_time(as_of)
    yields = [row for row in yield_rows() if row["published_at"] <= stamp]
    acres = [row for row in acreage_rows() if row["published_at"] <= stamp]
    events = damage_events(as_of)
    write_csv(folder / "yield.csv", YIELD_COLUMNS, yields)
    write_csv(folder / "acreage.csv", ACREAGE_COLUMNS, acres)
    write_json(folder / "damage_events.json", events)
    write_json(folder / "brief.json", brief(as_of, yields, events))
    write_json(folder / "model_card.json", model_card(as_of))


def _is_date(name: str) -> bool:
    try:
        return date.fromisoformat(name).isoformat() == name
    except ValueError:
        return False


def write_sample(root: Path) -> None:
    """Writes the dated folders and `latest/` under `root`, replacing any earlier sample folders."""
    root.mkdir(parents=True, exist_ok=True)
    for child in root.iterdir():
        if child.is_dir() and (child.name == "latest" or _is_date(child.name)):
            shutil.rmtree(child)
    for as_of in PUBLISHES[-DATED_FOLDERS:]:
        write_folder(root / as_of.date().isoformat(), as_of)
    write_folder(root / "latest", PUBLISHES[-1])


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python -m crop_nowcast.publish.sample <output folder>")
    write_sample(Path(sys.argv[1]))
