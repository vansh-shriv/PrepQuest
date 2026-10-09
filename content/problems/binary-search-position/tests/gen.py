import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))
from gentools import rarr, rint, run  # noqa: E402,F401

def make(rng, n):
    n = max(n, 1)
    a = sorted(rng.sample(range(-10**9, 10**9), n))
    t = rng.choice(a) if rng.random() < 0.5 else rng.randint(-10**9, 10**9)
    return [a, t]


run(make, small=6, medium=3, stress=2, sizes=(10, 400, 20000))
