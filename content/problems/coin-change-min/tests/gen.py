import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))
from gentools import rarr, rint, run  # noqa: E402,F401

def make(rng, n):
    top = min(10000, max(2, n))
    count = rng.randint(1, min(12, top))
    coins = rng.sample(range(1, top + 1), count)
    return [coins, n]


run(make, small=8, medium=4, stress=2, sizes=(30, 600, 10000))
