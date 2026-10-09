class Solution:
    def trap(self, height):
        lo, hi = 0, len(height) - 1
        left_max = right_max = 0
        water = 0
        while lo < hi:
            if height[lo] < height[hi]:
                left_max = max(left_max, height[lo])
                water += left_max - height[lo]
                lo += 1
            else:
                right_max = max(right_max, height[hi])
                water += right_max - height[hi]
                hi -= 1
        return water
