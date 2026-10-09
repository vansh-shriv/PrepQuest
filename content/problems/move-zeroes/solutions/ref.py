class Solution:
    def moveZeroes(self, nums):
        nonzero = [x for x in nums if x != 0]
        return nonzero + [0] * (len(nums) - len(nonzero))
