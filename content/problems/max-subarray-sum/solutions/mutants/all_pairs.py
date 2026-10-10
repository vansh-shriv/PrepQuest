# expect: TLE
class Solution:
    def maxSubarray(self, nums):
        best = nums[0]
        for i in range(len(nums)):
            total = 0
            for j in range(i, len(nums)):
                total += nums[j]
                if total > best:
                    best = total
        return best
