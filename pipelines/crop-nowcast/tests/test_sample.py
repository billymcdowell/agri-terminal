import csv
import json
from pathlib import Path

import pytest

from crop_nowcast.publish import sample
from crop_nowcast.publish.contract import is_sample, parse_time, validate_folder

SAMPLE = Path(__file__).parent.parent / "sample_output"


def files_under(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file() and path.name != "README.md"
    }


def test_committed_sample_matches_the_generator(tmp_path):
    sample.write_sample(tmp_path)
    assert files_under(tmp_path) == files_under(SAMPLE)


@pytest.mark.parametrize("folder", ["2026-08-11", "2026-08-18", "latest"])
def test_every_sample_folder_meets_the_contract(folder):
    assert validate_folder(SAMPLE / folder) == []


def test_latest_is_a_copy_of_the_newest_publish():
    assert files_under(SAMPLE / "latest") == files_under(SAMPLE / "2026-08-18")


def test_everything_is_marked_as_sample():
    for folder in ("2026-08-11", "2026-08-18"):
        for name in ("yield.csv", "acreage.csv"):
            with open(SAMPLE / folder / name, newline="", encoding="utf-8") as handle:
                assert all(is_sample(row["model_version"]) for row in csv.DictReader(handle))
        brief = json.loads((SAMPLE / folder / "brief.json").read_text(encoding="utf-8"))
        assert is_sample(brief["model_version"])
        assert brief["summary"].startswith("Sample data")


def rows(folder: str, name: str) -> list[dict[str, str]]:
    with open(SAMPLE / folder / name, newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def test_state_yields_have_no_usda_figure_before_august_crop_production():
    for row in rows("latest", "yield.csv"):
        published = parse_time(row["published_at"])
        crop_production = parse_time("2026-08-12T16:00:00Z")
        if row["geo"] != "US" and published < crop_production:
            assert row["usda_latest"] == "" and row["usda_vintage"] == ""
        else:
            assert row["usda_vintage"]
    vintages = {row["usda_vintage"] for row in rows("latest", "yield.csv") if row["geo"] == "US"}
    assert vintages == {"wasde-2026-06", "wasde-2026-07", "nass-crop-production-2026-08"}


def test_an_earlier_publish_holds_only_what_was_published_by_then():
    earlier = rows("2026-08-11", "yield.csv")
    assert max(row["published_at"] for row in earlier) == "2026-08-11T18:00:00Z"
    later = {(r["crop"], r["geo"], r["week_ending"]): r for r in rows("2026-08-18", "yield.csv")}
    # Past weeks are not restated, so the same rows appear unchanged in the next publish.
    for row in earlier:
        assert later[(row["crop"], row["geo"], row["week_ending"])] == row


def test_the_restated_wind_event_carries_its_new_publish_time():
    def wind(folder: str) -> dict:
        events = json.loads((SAMPLE / folder / "damage_events.json").read_text(encoding="utf-8"))
        return next(event for event in events if event["cause"] == "wind")

    first, restated = wind("2026-08-11"), wind("2026-08-18")
    assert first["id"] == restated["id"]
    assert (first["published_at"], restated["published_at"]) == (
        "2026-08-11T18:00:00Z",
        "2026-08-18T18:00:00Z",
    )
    assert first["affected_acres_p50"] != restated["affected_acres_p50"]


def test_release_labels_read_naturally():
    assert sample.release_label("wasde-2026-07") == "July 2026 WASDE"
    assert sample.release_label("nass-crop-production-2026-08") == "August 2026 Crop Production"


def test_write_sample_leaves_other_folders_alone(tmp_path):
    (tmp_path / "keep").mkdir()
    (tmp_path / "keep" / "file.txt").write_text("kept", encoding="utf-8")
    sample.write_sample(tmp_path)
    assert (tmp_path / "keep" / "file.txt").read_text(encoding="utf-8") == "kept"
