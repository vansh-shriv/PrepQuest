import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))
from gentools import rarr, rint, run  # noqa: E402,F401

def make(rng, n):
    span = rng.choice([5, 50, 10000])
    nums = [rng.randint(-span, span) for _ in range(n)]
    distinct = len(set(nums))
    return [nums, rng.randint(1, distinct)]


run(make, small=8, medium=4, stress=2, sizes=(12, 400, 20000))
