# expect: WA
class Solution:
    def moveZeroes(self, nums):
        zeros = [0] * nums.count(0)
        return zeros + [x for x in nums if x != 0]
