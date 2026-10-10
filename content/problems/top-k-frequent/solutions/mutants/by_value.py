# expect: WA
class Solution:
    def topKFrequent(self, nums, k):
        return sorted(set(nums))[:k]
