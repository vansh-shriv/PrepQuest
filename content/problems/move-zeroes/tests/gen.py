import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))
from gentools import rarr, rint, run  # noqa: E402,F401

def make(rng, n):
    n = max(n, 1)
    p = rng.choice([0.2, 0.5, 0.9])
    return [[0 if rng.random() < p else rng.choice([-5, -1, 1, 2, 7, 10**9]) for _ in range(n)]]


run(make, small=6, medium=3, stress=2, sizes=(10, 400, 20000))
