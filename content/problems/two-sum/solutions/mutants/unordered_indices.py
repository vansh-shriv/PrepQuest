# expect: WA
class Solution:
    def twoSum(self, nums, target):
        seen = {}
        for j, x in enumerate(nums):
            if target - x in seen:
                return [j, seen[target - x]]
            seen[x] = j
        return []
