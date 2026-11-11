import json
import shutil
from pathlib import Path

import pytest

from crop_nowcast.publish.contract import (
    format_yield,
    parse_time,
    validate_folder,
)

SAMPLE = Path(__file__).parent.parent / "sample_output"


@pytest.fixture
def folder(tmp_path) -> Path:
    """A writable copy of a valid publish folder."""
    target = tmp_path / "2026-08-18"
    shutil.copytree(SAMPLE / "2026-08-18", target)
    return target


def edit_line(path: Path, line: int, old: str, new: str) -> None:
    lines = path.read_text(encoding="utf-8").split("\n")
    assert old in lines[line - 1], lines[line - 1]
    lines[line - 1] = lines[line - 1].replace(old, new, 1)
    path.write_text("\n".join(lines), encoding="utf-8")


def edit_json(path: Path, change) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    change(data)
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def problems_mentioning(folder: Path, text: str) -> list[str]:
    return [problem for problem in validate_folder(folder) if text in problem]


def test_times_must_be_utc_with_a_z():
    assert parse_time("2026-08-18T18:00:00Z").isoformat() == "2026-08-18T18:00:00+00:00"
    for bad in ("2026-08-18T18:00:00+00:00", "2026-08-18 18:00:00Z", "2026-08-18"):
        with pytest.raises(ValueError):
            parse_time(bad)


def test_yields_never_print_negative_zero():
    assert format_yield(-0.04) == "0.0"
    assert format_yield(-1.65) == "-1.6"
    assert format_yield(181.0) == "181.0"


def test_a_missing_file_is_reported(folder):
    (folder / "acreage.csv").unlink()
    assert "acreage.csv: missing" in validate_folder(folder)


def test_columns_must_match_exactly(folder):
    edit_line(folder / "yield.csv", 1, "gap_p50,", "")
    assert problems_mentioning(folder, "yield.csv: columns must be")


def test_ranges_must_be_ordered_and_the_gap_must_add_up(folder):
    # Line 2 is corn, US, week ending 2026-06-14: p10 163.8, p50 179.8, usda 180.6, gap -0.8.
    edit_line(folder / "yield.csv", 2, ",163.8,", ",199.9,")
    edit_line(folder / "yield.csv", 2, ",-0.8,", ",-0.7,")
    found = validate_folder(folder)
    assert "yield.csv line 2: p10, p50, p90 must be in increasing order" in found
    assert any("line 2, gap_p50" in problem and "-0.8" in problem for problem in found)


def test_usda_figures_and_their_release_go_together(folder):
    edit_line(folder / "yield.csv", 2, ",wasde-2026-06,", ",,")
    assert problems_mentioning(folder, "usda_latest and usda_vintage must be set together")


def test_a_usda_release_after_the_publish_is_look_ahead(folder):
    edit_line(folder / "yield.csv", 2, ",wasde-2026-06,", ",wasde-2026-09,")
    assert problems_mentioning(folder, "wasde-2026-09 was not released before")


def test_rows_need_a_known_crop_geography_and_a_sunday(folder):
    edit_line(folder / "acreage.csv", 2, ",corn,US,2026-06-14,", ",wheat,us,2026-06-15,")
    found = "\n".join(validate_folder(folder))
    assert 'crop: "wheat" must be corn or soybeans' in found
    assert 'geo: "us" must be US or a two-letter state code' in found
    assert "week_ending: 2026-06-15 is not a Sunday" in found


def test_a_repeated_key_is_reported(folder):
    lines = (folder / "yield.csv").read_text(encoding="utf-8").splitlines()
    (folder / "yield.csv").write_text("\n".join([*lines, lines[1]]) + "\n", encoding="utf-8")
    assert problems_mentioning(folder, "repeats corn, US, 2026-06-14")


def test_the_brief_must_belong_to_the_newest_publish(folder):
    edit_json(
        folder / "brief.json", lambda brief: brief.update(published_at="2026-08-11T18:00:00Z")
    )
    found = validate_folder(folder)
    assert any("must equal the newest published_at" in problem for problem in found)
    assert any("is not on the folder's date 2026-08-18" in problem for problem in found)
    assert "model_card.json: published_at must equal brief.json's" in found


def test_sample_briefs_must_say_so(folder):
    edit_json(folder / "brief.json", lambda brief: brief.update(summary="The model estimates."))
    assert "brief.json, summary: must say it is sample data" in validate_folder(folder)


def test_damage_events_are_checked_field_by_field(folder):
    def break_event(events):
        events[0].update(cause="drought", affected_acres_range=[900_000, 1], states=[])
        del events[0]["method"]
        events[1]["id"] = events[0]["id"]

    edit_json(folder / "damage_events.json", break_event)
    found = "\n".join(validate_folder(folder))
    for expected in (
        "event 0: missing method",
        "event 0, cause: must be one of hail, wind, flood",
        "event 0, states: must be a non-empty list",
        "event 0, affected_acres_range: must be [p10, p90]",
        "event 1, id: repeats sample-2026-07-14-ne-hail",
    ):
        assert expected in found
