# expect: WA
class Solution:
    def maxProfit(self, prices):
        low = prices[0]
        best = prices[1] - prices[0]
        for p in prices[1:]:
            best = max(best, p - low)
            low = min(low, p)
        return best
