# expect: TLE
class Solution:
    def trap(self, height):
        total = 0
        n = len(height)
        for i in range(n):
            left = max(height[:i + 1])
            right = max(height[i:])
            total += min(left, right) - height[i]
        return total
