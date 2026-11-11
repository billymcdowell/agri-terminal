"""Readers for each public source (NASS, WASDE, Drought Monitor, gridMET, STAC, storm reports).

Each keeps the release time of what it reads, so features never use data before it was public.
Empty until Phase 2; see docs/research/nowcast-sources.md for what each source returns.
"""
