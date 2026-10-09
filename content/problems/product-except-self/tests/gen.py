import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))
from gentools import rarr, rint, run  # noqa: E402,F401

def make(rng, n):
    n = max(n, 2)
    zero = rng.choice([0.0, 0.0, 0.05])
    return [[0 if rng.random() < zero else rng.randint(-10**6, 10**6) for _ in range(n)]]


run(make, small=8, medium=4, stress=2, sizes=(10, 400, 20000))
