# expect: WA
class Solution:
    def coinChange(self, coins, amount):
        count = 0
        for c in sorted(coins, reverse=True):
            count += amount // c
            amount %= c
        return count if amount == 0 else -1
