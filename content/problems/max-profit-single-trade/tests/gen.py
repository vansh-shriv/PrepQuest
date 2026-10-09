import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))
from gentools import rarr, rint, run  # noqa: E402,F401

def make(rng, n):
    hi = rng.choice([10, 100, 1000000])
    return [rarr(rng, n, 0, hi)]


run(make, small=6, medium=3, stress=2, sizes=(10, 400, 20000))
