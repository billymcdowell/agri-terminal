# Crop nowcast pipeline

A weekly job that builds corn and soybean yield and acreage nowcasts, crop damage events and a short brief from public data, and publishes them as the files in [`docs/nowcast-data-contract.md`](../../docs/nowcast-data-contract.md). AgriTerminal reads the published files; it never runs this code. The plan is [`docs/Crop Nowcast Plan.md`](../../docs/Crop%20Nowcast%20Plan.md) and the source notes are [`docs/research/nowcast-sources.md`](../../docs/research/nowcast-sources.md).

## Layout

| Folder | Contents |
| --- | --- |
| `crop_nowcast/sources/` | Readers for each public source (from Phase 2) |
| `crop_nowcast/features/` | Features as known at each week, with no look-ahead (from Phase 2) |
| `crop_nowcast/models/` | Models, the trend baseline and backtests (from Phase 2) |
| `crop_nowcast/publish/` | The data contract: validation, file writers and the synthetic sample set |
| `crop_nowcast/ai/` | The weekly brief through Cloudflare AI Gateway (Phase 7) |
| `sample_output/` | Synthetic publish folders. Every value is invented |
| `tests/` | Tests, and recorded provider responses in `tests/fixtures/` |

## Running

Needs [uv](https://docs.astral.sh/uv/); it installs Python 3.12 if missing. From this folder:

```bash
uv sync
uv run ruff check
uv run ruff format --check
uv run pytest
```

Regenerate the sample output after changing the generator:

```bash
uv run python -m crop_nowcast.publish.sample sample_output
```

The GitHub Actions workflow `.github/workflows/crop-nowcast.yml` runs the same checks when started by hand. Nothing is scheduled or published yet.
