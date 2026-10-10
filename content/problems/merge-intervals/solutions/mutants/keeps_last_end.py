# expect: WA
class Solution:
    def mergeIntervals(self, intervals):
        merged = []
        for start, end in sorted(intervals):
            if merged and start <= merged[-1][1]:
                merged[-1][1] = end
            else:
                merged.append([start, end])
        return merged
