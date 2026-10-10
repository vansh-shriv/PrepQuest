# expect: WA
class Solution:
    def maxProfit(self, prices):
        return max(prices) - min(prices)
