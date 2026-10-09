#!/usr/bin/env python3
"""Reference driver for function-style problems (doc 12): reads canonical stdin, calls the reference
solution, prints the canonical return value. This is the executable definition of the I/O format
implemented by `packages/content/src/codec.ts`; the judge's per-language drivers must match it.

Usage: python harness.py <problem-dir> < input.in > output.out
"""
import importlib.util
import json
import sys


def split_type(t):
    dims = t.count("[]")
    return t.replace("[]", ""), dims


def parse_scalar(base, token):
    if base in ("int", "long"):
        return int(token)
    if base == "double":
        return float(token)
    if base == "bool":
        if token not in ("true", "false"):
            raise ValueError(f"bad bool {token!r}")
        return token == "true"
    return token  # string, raw


def format_scalar(base, value):
    if base in ("int", "long"):
        return str(int(value))
    if base == "double":
        return repr(float(value))
    if base == "bool":
        return "true" if value else "false"
    return str(value)


class Reader:
    def __init__(self, text):
        lines = text.split("\n")
        if lines and lines[-1] == "":
            lines.pop()
        self.lines = lines
        self.pos = 0

    def next(self):
        line = self.lines[self.pos]
        self.pos += 1
        return line


def read_value(reader, t):
    base, dims = split_type(t)
    if dims == 0:
        return parse_scalar(base, reader.next())
    n = int(reader.next())
    if dims == 1:
        if base == "string":
            return [reader.next() for _ in range(n)]
        line = reader.next()
        tokens = line.split(" ") if line != "" else []
        assert len(tokens) == n, f"expected {n} values, got {len(tokens)}"
        return [parse_scalar(base, tok) for tok in tokens]
    rows = []
    for _ in range(n):
        tokens = reader.next().split(" ")
        k = int(tokens[0])
        assert len(tokens) == k + 1, "bad row"
        rows.append([parse_scalar(base, tok) for tok in tokens[1:]])
    return rows


def format_value(t, value):
    base, dims = split_type(t)
    if dims == 0:
        return format_scalar(base, value) + "\n"
    if dims == 1:
        if base == "string":
            return f"{len(value)}\n" + "".join(format_scalar(base, v) + "\n" for v in value)
        return f"{len(value)}\n" + " ".join(format_scalar(base, v) for v in value) + "\n"
    out = f"{len(value)}\n"
    for row in value:
        out += " ".join([str(len(row))] + [format_scalar(base, v) for v in row]) + "\n"
    return out


def main():
    problem_dir = sys.argv[1]
    with open(f"{problem_dir}/signature.json", encoding="utf8") as f:
        signature = json.load(f)

    spec = importlib.util.spec_from_file_location("ref", f"{problem_dir}/solutions/ref.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    solution = module.Solution()

    # raw bytes in and out: Windows text mode would rewrite line endings and corrupt the format
    reader = Reader(sys.stdin.buffer.read().decode("utf8"))
    args = [read_value(reader, p["type"]) for p in signature["params"]]
    result = getattr(solution, signature["function"])(*args)
    sys.stdout.buffer.write(format_value(signature["returns"], result).encode("utf8"))


if __name__ == "__main__":
    main()
