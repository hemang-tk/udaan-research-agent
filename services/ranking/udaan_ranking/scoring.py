"""Scoring & Truncation (Phase 3 §2.3): sigmoid normalization, the static
relevance floor, and top-K stratification."""

from __future__ import annotations

import math

# Absolute relevance floor for cross-encoder scores (Phase 3 §2.3).
RELEVANCE_FLOOR = 0.5
# Top candidates handed to Phase 4.
TOP_K = 20


def sigmoid(logit: float) -> float:
    return 1.0 / (1.0 + math.exp(-logit))


def stratify(scored: list[tuple[int, float]], *, apply_floor: bool) -> list[tuple[int, float]]:
    """Sort by score desc, optionally drop below the floor, take the top K."""
    ordered = sorted(scored, key=lambda pair: pair[1], reverse=True)
    if apply_floor:
        ordered = [pair for pair in ordered if pair[1] >= RELEVANCE_FLOOR]
    return ordered[:TOP_K]
