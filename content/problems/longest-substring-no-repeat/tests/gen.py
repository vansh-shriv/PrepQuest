import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))
from gentools import rarr, rint, run  # noqa: E402,F401

def make(rng, n):
    alpha = rng.choice(["ab", "abc", "abcdefgh", "abcdefghijklmnopqrstuvwxyz0123456789 "])
    return ["".join(rng.choice(alpha) for _ in range(n))]


run(make, small=8, medium=4, stress=2, sizes=(14, 400, 20000))
