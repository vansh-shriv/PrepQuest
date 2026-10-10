# expect: WA
class Solution:
    def productExceptSelf(self, nums):
        mod = 1000000007
        n = len(nums)
        out = [1] * n
        left = 1
        for i in range(n):
            out[i] = left
            left = int(left * nums[i] % mod) if left * nums[i] >= 0 else -((-left * nums[i]) % mod)
        right = 1
        for i in range(n - 1, -1, -1):
            out[i] = out[i] * right
            right = right * nums[i]
        return [x % mod if x >= 0 else -((-x) % mod) for x in out]
