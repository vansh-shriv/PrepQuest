# expect: WA
class Solution:
    def trap(self, height):
        best = 0
        total = 0
        for h in height:
            best = max(best, h)
            total += best - h
        return total
