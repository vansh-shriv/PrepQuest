# expect: WA
class Solution:
    def containsDuplicate(self, nums):
        return any(nums[i] == nums[i + 1] for i in range(len(nums) - 1))
