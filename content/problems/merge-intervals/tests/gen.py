import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))
from gentools import rarr, rint, run  # noqa: E402,F401

def make(rng, n):
    span = 20 if n < 30 else 1000000
    out = []
    for _ in range(n):
        s = rng.randint(0, span)
        e = min(1000000, s + rng.randint(0, max(1, span // (4 if n < 30 else n // 2 + 1))))
        out.append([s, e])
    return [out]


run(make, small=8, medium=4, stress=2, sizes=(10, 500, 10000))
