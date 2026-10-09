import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))
from gentools import rarr, rint, run  # noqa: E402,F401

def word(rng, length):
    return "".join(rng.choice("abc") for _ in range(length))


def make(rng, n):
    k = max(1, n)
    cap = 5 if n < 20 else 100
    prefix = word(rng, rng.randint(0, cap))
    return [[prefix + word(rng, rng.randint(0, cap)) for _ in range(k)]]


run(make, small=6, medium=3, stress=2, sizes=(8, 60, 200))
