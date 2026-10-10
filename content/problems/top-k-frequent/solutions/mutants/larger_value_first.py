# expect: WA
from collections import Counter

class Solution:
    def topKFrequent(self, nums, k):
        counts = Counter(nums)
        return sorted(counts, key=lambda v: (-counts[v], -v))[:k]
