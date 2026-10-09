import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))
from gentools import rarr, rint, run  # noqa: E402,F401

def make(rng, n):
    a = sorted(rarr(rng, rng.randint(0, n), -10**9, 10**9) if n > 20 else rarr(rng, rng.randint(0, n), -9, 9))
    b = sorted(rarr(rng, rng.randint(0, n), -10**9, 10**9) if n > 20 else rarr(rng, rng.randint(0, n), -9, 9))
    return [a, b]


run(make, small=6, medium=3, stress=2, sizes=(10, 400, 20000))
