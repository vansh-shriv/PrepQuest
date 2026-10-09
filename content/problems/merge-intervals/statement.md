Each interval is `[start, end]` with `start <= end`, and both ends are **included**. Two intervals overlap when they share at least one point, so `[1, 3]` and `[3, 5]` overlap and merge into `[1, 5]`.

Merge every group of overlapping intervals and return the resulting intervals sorted by `start`. The input is not necessarily sorted.
