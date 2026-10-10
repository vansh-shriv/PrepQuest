# expect: WA
class Solution:
    def threeSum(self, nums):
        nums = sorted(nums)
        out = []
        n = len(nums)
        for i in range(n - 2):
            lo, hi = i + 1, n - 1
            while lo < hi:
                s = nums[i] + nums[lo] + nums[hi]
                if s == 0:
                    out.append([nums[i], nums[lo], nums[hi]])
                    lo += 1
                    hi -= 1
                elif s < 0:
                    lo += 1
                else:
                    hi -= 1
        return out
