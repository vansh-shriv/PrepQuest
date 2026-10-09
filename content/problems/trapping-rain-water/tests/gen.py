import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))
from gentools import rarr, rint, run  # noqa: E402,F401

def make(rng, n):
    kind = rng.random()
    if kind < 0.4:
        top = rng.choice([4, 20, 100000])
        return [rarr(rng, n, 0, top)]
    if kind < 0.7:
        # a few tall walls with noise between them
        h = [rng.randint(0, 50) for _ in range(n)]
        for _ in range(max(1, n // 100)):
            h[rng.randrange(n)] = rng.randint(1000, 100000)
        return [h]
    # smooth valleys
    h, cur = [], rng.randint(0, 1000)
    for _ in range(n):
        cur = max(0, min(100000, cur + rng.randint(-20, 20)))
        h.append(cur)
    return [h]


run(make, small=12, medium=5, stress=3, sizes=(14, 500, 20000))
