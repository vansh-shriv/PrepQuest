class Solution:
    def maxProfit(self, prices):
        best = 0
        low = prices[0]
        for p in prices[1:]:
            best = max(best, p - low)
            low = min(low, p)
        return best
