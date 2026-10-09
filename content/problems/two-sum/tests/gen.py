import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))
from gentools import rarr, rint, run  # noqa: E402,F401

from collections import Counter


def pair_count(a, t):
    c = Counter(a)
    total = 0
    for v, k in c.items():
        w = t - v
        if v < w and w in c:
            total += k * c[w]
        elif v == w:
            total += k * (k - 1) // 2
    return total


def make(rng, n):
    n = max(n, 2)
    lim = 10**8 if n > 50 else 40
    while True:
        a = rarr(rng, n, -lim, lim)
        i, j = rng.sample(range(n), 2)
        t = a[i] + a[j]
        if pair_count(a, t) == 1:
            return [a, t]


run(make, small=6, medium=3, stress=2, sizes=(8, 300, 20000))
