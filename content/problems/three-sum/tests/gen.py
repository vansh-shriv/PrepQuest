import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))
from gentools import rarr, rint, run  # noqa: E402,F401

def make(rng, n):
    lim = rng.choice([30, 400, 100000]) if n > 20 else 12
    return [rarr(rng, n, -lim, lim)]


run(make, small=10, medium=4, stress=3, sizes=(14, 300, 1500))
