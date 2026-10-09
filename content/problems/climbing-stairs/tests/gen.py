import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))
from gentools import rarr, rint, run  # noqa: E402,F401

def make(rng, n):
    return [min(n, 90)]


run(make, small=6, medium=3, stress=0, sizes=(12, 60, 90))
