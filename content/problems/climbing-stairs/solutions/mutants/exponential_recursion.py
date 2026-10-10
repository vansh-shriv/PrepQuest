# expect: TLE
class Solution:
    def countWays(self, n):
        def go(k):
            return 1 if k <= 1 else go(k - 1) + go(k - 2)
        return go(n)
