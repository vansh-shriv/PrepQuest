# expect: WA
class Solution:
    def countWays(self, n):
        a, b = 1, 1
        for _ in range(n):
            a, b = b, a + b
        return b
