"""The published nowcast files and their rules, from docs/nowcast-data-contract.md.

`validate_folder` reads one publish folder and returns every problem it finds, each naming the
file, the line or event, and the field, so a bad publish is stopped before it is uploaded. The
`write_*` and `format_*` helpers produce files in exactly the documented format.
"""

from __future__ import annotations

import csv
import io
import json
import re
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any

CROPS = ("corn", "soybeans")
STATES = frozenset(
    "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ "
    "NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split()
)
GEOS = STATES | {"US"}
CAUSES = ("hail", "wind", "flood")
CONFIDENCE = ("low", "medium", "high")
SAMPLE_PREFIX = "sample"
MAX_FILE_BYTES = 1024 * 1024

YIELD_COLUMNS = (
    "published_at",
    "crop",
    "geo",
    "week_ending",
    "p10",
    "p50",
    "p90",
    "usda_latest",
    "usda_vintage",
    "gap_p50",
    "baseline_trend",
    "model_version",
)
ACREAGE_COLUMNS = (
    "published_at",
    "crop",
    "geo",
    "week_ending",
    "acres_p10",
    "acres_p50",
    "acres_p90",
    "usda_latest",
    "usda_report",
    "model_version",
)
DAMAGE_EVENT_FIELDS = (
    "id",
    "published_at",
    "event_date",
    "cause",
    "states",
    "crop",
    "affected_acres_p50",
    "affected_acres_range",
    "confidence",
    "storm_report_refs",
    "method",
)
BRIEF_FIELDS = (
    "published_at",
    "model_version",
    "ai_model",
    "summary",
    "bullets",
    "validated",
    "fallback_used",
)
MODEL_CARD_FIELDS = (
    "published_at",
    "model_version",
    "crops",
    "training_years",
    "features",
    "metrics",
    "limitations",
)
FILES = ("yield.csv", "acreage.csv", "damage_events.json", "brief.json", "model_card.json")

_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_RELEASE_ID = re.compile(
    r"^(nass-crop-production|nass-prospective-plantings|nass-acreage|wasde)-(\d{4})-(0[1-9]|1[0-2])$"
)
_ONE_DECIMAL = re.compile(r"^-?\d+\.\d$")
_WHOLE = re.compile(r"^\d+$")


def parse_time(text: str) -> datetime:
    """Reads a contract time such as 2026-08-18T18:00:00Z."""
    if not isinstance(text, str) or not _TIME.match(text):
        raise ValueError(f'"{text}" is not a UTC time like 2026-08-18T18:00:00Z')
    return datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)


def format_time(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_date(text: str) -> date:
    if not isinstance(text, str) or not _DATE.match(text):
        raise ValueError(f'"{text}" is not a date like 2026-08-16')
    return date.fromisoformat(text)


def format_yield(value: float) -> str:
    """One decimal place, never "-0.0"."""
    text = f"{value:.1f}"
    return "0.0" if text == "-0.0" else text


def format_acres(value: float) -> str:
    return str(round(value))


def is_sample(model_version: str) -> bool:
    """A model version starting with "sample" marks invented data."""
    return model_version.startswith(SAMPLE_PREFIX)


def write_csv(path: Path, columns: Sequence[str], rows: Sequence[Mapping[str, str]]) -> None:
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    path.write_text(buffer.getvalue(), encoding="utf-8", newline="")


def write_json(path: Path, data: Any) -> None:
    text = json.dumps(data, indent=2, ensure_ascii=False) + "\n"
    path.write_text(text, encoding="utf-8", newline="")


def validate_folder(folder: Path) -> list[str]:
    """Every problem in one publish folder (a dated folder or `latest`), or an empty list."""
    problems: list[str] = []
    texts: dict[str, str] = {}
    for name in FILES:
        path = folder / name
        if not path.is_file():
            problems.append(f"{name}: missing")
            continue
        if path.stat().st_size > MAX_FILE_BYTES:
            problems.append(f"{name}: larger than {MAX_FILE_BYTES} bytes")
        texts[name] = path.read_text(encoding="utf-8")

    published: list[datetime] = []
    if "yield.csv" in texts:
        published += _check_estimates("yield.csv", texts["yield.csv"], problems)
    if "acreage.csv" in texts:
        published += _check_estimates("acreage.csv", texts["acreage.csv"], problems)
    if "damage_events.json" in texts:
        published += _check_damage_events(texts["damage_events.json"], problems)
    brief = _load_object("brief.json", texts.get("brief.json"), BRIEF_FIELDS, problems)
    card = _load_object(
        "model_card.json", texts.get("model_card.json"), MODEL_CARD_FIELDS, problems
    )
    if brief is not None:
        _check_brief(brief, problems)
    if card is not None:
        _check_model_card(card, problems)

    publish_time = _time_or_none(brief.get("published_at")) if brief else None
    if publish_time is not None:
        if published and max(published) != publish_time:
            problems.append(
                "brief.json: published_at must equal the newest published_at in the folder "
                f"({format_time(max(published))})"
            )
        if folder.name != "latest" and publish_time.date().isoformat() != folder.name:
            problems.append(
                f"brief.json: published_at {format_time(publish_time)} is not on the folder's "
                f"date {folder.name}"
            )
    if brief and card:
        if card.get("published_at") != brief.get("published_at"):
            problems.append("model_card.json: published_at must equal brief.json's")
        if card.get("model_version") != brief.get("model_version"):
            problems.append("model_card.json: model_version must equal brief.json's")
    return problems


def _time_or_none(value: Any) -> datetime | None:
    try:
        return parse_time(value)
    except ValueError:
        return None


def _check_estimates(name: str, text: str, problems: list[str]) -> list[datetime]:
    is_yield = name == "yield.csv"
    columns = YIELD_COLUMNS if is_yield else ACREAGE_COLUMNS
    reader = csv.DictReader(io.StringIO(text))
    if tuple(reader.fieldnames or ()) != columns:
        problems.append(f"{name}: columns must be {', '.join(columns)}, in that order")
        return []
    estimates = ("p10", "p50", "p90") if is_yield else ("acres_p10", "acres_p50", "acres_p90")
    release_column = "usda_vintage" if is_yield else "usda_report"
    number = _ONE_DECIMAL if is_yield else _WHOLE
    unit = "a number with one decimal place" if is_yield else "a whole number of acres"
    published: list[datetime] = []
    seen: set[tuple[str, str, str]] = set()
    for line, row in enumerate(reader, start=2):
        where = f"{name} line {line}"

        def bad(column: str, message: str, where: str = where) -> None:
            problems.append(f"{where}, {column}: {message}")

        if None in row or any(value is None for value in row.values()):
            problems.append(f"{where}: has the wrong number of fields")
            continue
        time = _time_or_none(row["published_at"])
        if time is None:
            bad(
                "published_at",
                f'"{row["published_at"]}" is not a UTC time like 2026-08-18T18:00:00Z',
            )
        else:
            published.append(time)
        if row["crop"] not in CROPS:
            bad("crop", f'"{row["crop"]}" must be corn or soybeans')
        if row["geo"] not in GEOS:
            bad("geo", f'"{row["geo"]}" must be US or a two-letter state code in capitals')
        try:
            week = parse_date(row["week_ending"])
            if week.weekday() != 6:
                bad("week_ending", f"{week} is not a Sunday")
            if time is not None and week >= time.date():
                bad("week_ending", "must be before the day it was published")
        except ValueError as error:
            bad("week_ending", str(error))
        key = (row["crop"], row["geo"], row["week_ending"])
        if key in seen:
            problems.append(f"{where}: repeats {', '.join(key)}")
        seen.add(key)
        if not row["model_version"]:
            bad("model_version", "must not be empty")

        values = []
        for column in estimates:
            if number.match(row[column]):
                values.append(float(row[column]))
            else:
                bad(column, f'"{row[column]}" must be {unit}')
        if len(values) == 3 and not values[0] <= values[1] <= values[2]:
            problems.append(f"{where}: {', '.join(estimates)} must be in increasing order")
        if is_yield and len(values) == 3 and not (0 < values[0] and values[2] < 400):
            problems.append(f"{where}: yields must be between 0 and 400 bu/acre")

        usda, release = row["usda_latest"], row[release_column]
        if bool(usda) != bool(release):
            problems.append(f"{where}: usda_latest and {release_column} must be set together")
        if usda and not number.match(usda):
            bad("usda_latest", f'"{usda}" must be {unit}')
        if release:
            match = _RELEASE_ID.match(release)
            if not match:
                bad(release_column, f'"{release}" is not a release id like wasde-2026-07')
            elif time is not None and (int(match[2]), int(match[3])) > (time.year, time.month):
                bad(release_column, f"{release} was not released before {row['published_at']}")
        if is_yield:
            gap = row["gap_p50"]
            if not usda:
                if gap:
                    bad("gap_p50", "must be empty when usda_latest is")
            elif _ONE_DECIMAL.match(usda) and len(values) == 3:
                expected = format_yield(values[1] - float(usda))
                if gap != expected:
                    bad("gap_p50", f'"{gap}" must be p50 - usda_latest, {expected}')
            if not _ONE_DECIMAL.match(row["baseline_trend"]):
                bad("baseline_trend", f'"{row["baseline_trend"]}" must be {unit}')
    return published


def _load_object(
    name: str, text: str | None, fields: Sequence[str], problems: list[str]
) -> dict[str, Any] | None:
    if text is None:
        return None
    try:
        data = json.loads(text)
    except json.JSONDecodeError as error:
        problems.append(f"{name}: not valid JSON ({error})")
        return None
    if not isinstance(data, dict):
        problems.append(f"{name}: must be a JSON object")
        return None
    _check_fields(name, data, fields, problems)
    return data


def _check_fields(
    where: str, data: Mapping[str, Any], fields: Sequence[str], problems: list[str]
) -> None:
    missing = [field for field in fields if field not in data]
    extra = [field for field in data if field not in fields]
    if missing:
        problems.append(f"{where}: missing {', '.join(missing)}")
    if extra:
        problems.append(f"{where}: unexpected {', '.join(extra)}")


def _is_text_list(value: Any) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def _is_number(value: Any) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def _check_damage_events(text: str, problems: list[str]) -> list[datetime]:
    name = "damage_events.json"
    try:
        events = json.loads(text)
    except json.JSONDecodeError as error:
        problems.append(f"{name}: not valid JSON ({error})")
        return []
    if not isinstance(events, list):
        problems.append(f"{name}: must be a JSON array")
        return []
    published: list[datetime] = []
    seen: set[str] = set()
    previous_date: date | None = None
    for index, event in enumerate(events):
        where = f"{name} event {index}"
        if not isinstance(event, dict):
            problems.append(f"{where}: must be a JSON object")
            continue
        _check_fields(where, event, DAMAGE_EVENT_FIELDS, problems)
        event_id = event.get("id")
        if not isinstance(event_id, str) or not event_id:
            problems.append(f"{where}, id: must be a non-empty string")
        elif event_id in seen:
            problems.append(f"{where}, id: repeats {event_id}")
        else:
            seen.add(event_id)
        time = _time_or_none(event.get("published_at"))
        if time is None:
            problems.append(f"{where}, published_at: must be a UTC time like 2026-08-18T18:00:00Z")
        else:
            published.append(time)
        try:
            day = parse_date(event.get("event_date"))
            if time is not None and day > time.date():
                problems.append(f"{where}, event_date: is after published_at")
            if previous_date is not None and day < previous_date:
                problems.append(f"{where}: events must be in event_date order, oldest first")
            previous_date = day
        except ValueError as error:
            problems.append(f"{where}, event_date: {error}")
        if event.get("cause") not in CAUSES:
            problems.append(f"{where}, cause: must be one of {', '.join(CAUSES)}")
        states = event.get("states")
        if not _is_text_list(states) or not states or not set(states) <= STATES:
            problems.append(f"{where}, states: must be a non-empty list of state codes")
        if event.get("crop") not in CROPS:
            problems.append(f"{where}, crop: must be corn or soybeans")
        middle, span = event.get("affected_acres_p50"), event.get("affected_acres_range")
        if not _is_number(middle) or middle < 0:
            problems.append(f"{where}, affected_acres_p50: must be a number of acres")
        elif (
            not isinstance(span, list)
            or len(span) != 2
            or not all(_is_number(value) for value in span)
            or not span[0] <= middle <= span[1]
        ):
            problems.append(
                f"{where}, affected_acres_range: must be [p10, p90] around affected_acres_p50"
            )
        if event.get("confidence") not in CONFIDENCE:
            problems.append(f"{where}, confidence: must be one of {', '.join(CONFIDENCE)}")
        if not _is_text_list(event.get("storm_report_refs")):
            problems.append(f"{where}, storm_report_refs: must be a list of strings")
        if not isinstance(event.get("method"), str) or not event.get("method"):
            problems.append(f"{where}, method: must describe how the area was estimated")
    return published


def _check_brief(brief: Mapping[str, Any], problems: list[str]) -> None:
    where = "brief.json"
    if _time_or_none(brief.get("published_at")) is None:
        problems.append(f"{where}, published_at: must be a UTC time like 2026-08-18T18:00:00Z")
    version = brief.get("model_version")
    if not isinstance(version, str) or not version:
        problems.append(f"{where}, model_version: must not be empty")
    if brief.get("ai_model") is not None and not isinstance(brief.get("ai_model"), str):
        problems.append(f"{where}, ai_model: must be a string or null")
    summary = brief.get("summary")
    if not isinstance(summary, str) or not summary:
        problems.append(f"{where}, summary: must not be empty")
    elif isinstance(version, str) and is_sample(version) and "sample" not in summary.lower():
        problems.append(f"{where}, summary: must say it is sample data")
    if not _is_text_list(brief.get("bullets")):
        problems.append(f"{where}, bullets: must be a list of strings")
    for flag in ("validated", "fallback_used"):
        if not isinstance(brief.get(flag), bool):
            problems.append(f"{where}, {flag}: must be true or false")


def _check_model_card(card: Mapping[str, Any], problems: list[str]) -> None:
    where = "model_card.json"
    crops = card.get("crops")
    if not _is_text_list(crops) or not set(crops) <= set(CROPS):
        problems.append(f"{where}, crops: must be a list of corn and soybeans")
    years = card.get("training_years")
    if not isinstance(years, list) or not all(
        isinstance(year, int) and not isinstance(year, bool) for year in years
    ):
        problems.append(f"{where}, training_years: must be a list of years")
    for field in ("features", "limitations"):
        if not _is_text_list(card.get(field)):
            problems.append(f"{where}, {field}: must be a list of strings")
    if not isinstance(card.get("metrics"), dict):
        problems.append(f"{where}, metrics: must be an object")
