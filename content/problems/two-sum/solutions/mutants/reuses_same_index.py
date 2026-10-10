# expect: WA
class Solution:
    def twoSum(self, nums, target):
        seen = {}
        for j, x in enumerate(nums):
            seen[x] = j
            if target - x in seen:
                return [seen[target - x], j]
        return []
