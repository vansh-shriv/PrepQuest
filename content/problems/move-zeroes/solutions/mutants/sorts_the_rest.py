# expect: WA
class Solution:
    def moveZeroes(self, nums):
        out = sorted(x for x in nums if x != 0)
        return out + [0] * (len(nums) - len(out))
