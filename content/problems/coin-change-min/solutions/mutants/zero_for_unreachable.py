# expect: WA
class Solution:
    def coinChange(self, coins, amount):
        best = [10**9] * (amount + 1)
        best[0] = 0
        for a in range(1, amount + 1):
            for c in coins:
                if c <= a:
                    best[a] = min(best[a], best[a - c] + 1)
        return best[amount] if best[amount] < 10**9 else 0
