import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))
from gentools import rarr, rint, run  # noqa: E402,F401

def make(rng, n):
    lo = rng.choice([-10000, -100, -10])
    return [rarr(rng, n, lo, 10000)]


run(make, small=8, medium=4, stress=2, sizes=(12, 400, 20000))
