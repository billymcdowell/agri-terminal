# Sample nowcast output

**Every value in these folders is invented.** They are a synthetic publish set in the format of `docs/nowcast-data-contract.md`, so the app can read nowcasts before any model exists. They are not forecasts and not USDA figures: only the dates and USDA release times follow the real 2026 schedule.

- `2026-08-11/` and `2026-08-18/` are two weekly publishes; `latest/` is a copy of the newest.
- Every row and document has `model_version` `sample-0.1.0`, and the brief says it is sample data.
- The wind damage event is restated in the 18 August publish, to exercise revisions.

The app's crop nowcast sources read `latest/` from this repository's `master` branch. They are named "(sample)" and start switched off.

Regenerate with `uv run python -m crop_nowcast.publish.sample sample_output` from `pipelines/crop-nowcast`. `tests/test_sample.py` fails if these files differ from what the generator writes.
