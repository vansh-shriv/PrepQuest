import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "_lib"))
from gentools import rarr, rint, run  # noqa: E402,F401

def balanced(rng, k):
    out, stack, opened = [], [], 0
    while len(out) < 2 * k:
        must_close = len(stack) == 2 * k - len(out) or opened == k
        if stack and (must_close or rng.random() < 0.5):
            out.append(stack.pop())
        else:
            o, c = rng.choice(["()", "[]", "{}"])
            out.append(o)
            stack.append(c)
            opened += 1
    return "".join(out)


def make(rng, n):
    s = balanced(rng, max(1, n // 2))
    r = rng.random()
    if r < 0.4:
        i = rng.randrange(len(s))
        s = s[:i] + rng.choice("()[]{}") + s[i + 1:]
    elif r < 0.6:
        s = s[:-1] if len(s) > 1 else s + "("
    return [s]


run(make, small=6, medium=3, stress=2, sizes=(10, 300, 20000))
