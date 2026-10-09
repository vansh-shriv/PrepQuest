import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))
from gentools import rarr, rint, run  # noqa: E402,F401

def make(rng, n):
    n = max(n, 1)
    a = rng.sample(range(-10**9, 10**9), n)
    if n >= 2 and rng.random() < 0.5:
        i, j = rng.sample(range(n), 2)
        a[i] = a[j]
    return [a]


run(make, small=6, medium=3, stress=2, sizes=(10, 400, 20000))
