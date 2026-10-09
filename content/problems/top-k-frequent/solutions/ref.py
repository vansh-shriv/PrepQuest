from collections import Counter


class Solution:
    def topKFrequent(self, nums, k):
        counts = Counter(nums)
        ranked = sorted(counts, key=lambda v: (-counts[v], v))
        return ranked[:k]
