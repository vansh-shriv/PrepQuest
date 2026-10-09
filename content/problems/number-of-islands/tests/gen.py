import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))
from gentools import rarr, rint, run  # noqa: E402,F401

def make(rng, n):
    rows = rng.randint(max(1, n // 2), n)
    cols = rng.randint(max(1, n // 2), n)
    density = rng.choice([0.2, 0.45, 0.6])
    return [["".join("1" if rng.random() < density else "0" for _ in range(cols)) for _ in range(rows)]]


run(make, small=8, medium=4, stress=2, sizes=(6, 40, 100), stress_label="stress: large grid")
