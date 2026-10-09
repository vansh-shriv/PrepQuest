from bisect import bisect_left


class Solution:
    def search(self, nums, target):
        i = bisect_left(nums, target)
        return i if i < len(nums) and nums[i] == target else -1
