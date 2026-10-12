# expect: TLE
# Rescans both sides of every wall with plain loops: O(n^2) in interpreted code, so the largest
# test misses the limit by a wide margin on any machine (max() over slices ran in C and was too close).
class Solution:
    def trap(self, height):
        total = 0
        n = len(height)
        for i in range(n):
            left = 0
            for j in range(i + 1):
                if height[j] > left:
                    left = height[j]
            right = 0
            for j in range(i, n):
                if height[j] > right:
                    right = height[j]
            total += min(left, right) - height[i]
        return total
