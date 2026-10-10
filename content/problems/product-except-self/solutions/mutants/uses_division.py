# expect: RE
class Solution:
    def productExceptSelf(self, nums):
        mod = 1000000007
        total = 1
        for x in nums:
            total = total * x
        return [(total // x) % mod for x in nums]
