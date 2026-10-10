# expect: WA
class Solution:
    def maxSubarray(self, nums):
        best = cur = 0
        for x in nums:
            cur = max(0, cur + x)
            best = max(best, cur)
        return best
