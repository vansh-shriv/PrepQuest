import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))
from gentools import rarr, rint, run  # noqa: E402,F401

def text(rng, length, alpha):
    return "".join(rng.choice(alpha) for _ in range(length))


def make(rng, n):
    alpha = rng.choice(["ab", "abc", "abcdefghijklmnopqrstuvwxyz"])
    a = text(rng, rng.randint(0, n), alpha)
    if rng.random() < 0.5:
        b = list(a)
        for _ in range(rng.randint(0, max(1, n // 5))):
            if b and rng.random() < 0.5:
                b[rng.randrange(len(b))] = rng.choice(alpha)
            elif rng.random() < 0.5:
                b.insert(rng.randint(0, len(b)), rng.choice(alpha))
            elif b:
                b.pop(rng.randrange(len(b)))
        return [a, "".join(b)]
    return [a, text(rng, rng.randint(0, n), alpha)]


run(make, small=12, medium=5, stress=3, sizes=(12, 200, 1000))
