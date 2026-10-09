"""Helpers for problem test generators (`tests/gen.py`).

A generator defines `make(rng, n) -> args` (one JSON value per signature parameter) and calls `run`,
which prints a JSON list of cases for `pnpm content:build-tests`. Everything is seeded, so builds are
reproducible: the same gen.py always produces the same files.
"""
import json
import random
import sys


def rint(rng, lo, hi):
    return rng.randint(lo, hi)


def rarr(rng, n, lo, hi):
    return [rng.randint(lo, hi) for _ in range(n)]


def run(make, small=6, medium=3, stress=2, sizes=(8, 200, 20000), stress_label="stress: maximum input size"):
    """Print the generated cases.

    small   - number of small random cases; n is drawn from 1..sizes[0]
    medium  - number of mid-size cases; n is drawn from sizes[1]//2..sizes[1]
    stress  - number of max-size cases; n is sizes[2]
    """
    cases = []
    for i in range(small):
        rng = random.Random(f"small-{i}")
        cases.append({"kind": "hidden", "label": "random small", "args": make(rng, rng.randint(1, sizes[0]))})
    for i in range(medium):
        rng = random.Random(f"medium-{i}")
        cases.append(
            {"kind": "hidden", "label": "random medium", "args": make(rng, rng.randint(max(1, sizes[1] // 2), sizes[1]))}
        )
    for i in range(stress):
        rng = random.Random(f"stress-{i}")
        cases.append({"kind": "stress", "label": stress_label, "args": make(rng, sizes[2])})
    json.dump(cases, sys.stdout, separators=(",", ":"))
