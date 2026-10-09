import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))
from gentools import rarr, rint, run  # noqa: E402,F401

NOISE = " ,.;:!?-'()"


def make(rng, n):
    half = "".join(rng.choice("abcxyz0129") for _ in range(max(1, n // 2)))
    middle = rng.choice(["", "", rng.choice("abc")])
    core = half + middle + half[::-1]
    if rng.random() < 0.5:
        i = rng.randrange(len(core))
        other = rng.choice([c for c in "abcxyz0129" if c != core[i]])
        core = core[:i] + other + core[i + 1:]
    out = []
    for ch in core:
        if rng.random() < 0.3:
            out.append(rng.choice(NOISE))
        out.append(ch.upper() if rng.random() < 0.4 else ch)
    s = "".join(out).strip()
    return [s if s else "a"]


run(make, small=6, medium=3, stress=2, sizes=(10, 400, 20000))
