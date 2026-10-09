MOD = 10**9 + 7


class Solution:
    def productExceptSelf(self, nums):
        n = len(nums)
        answer = [1] * n
        for i in range(1, n):
            answer[i] = answer[i - 1] * nums[i - 1] % MOD
        suffix = 1
        for i in range(n - 1, -1, -1):
            answer[i] = answer[i] * suffix % MOD
            suffix = suffix * nums[i] % MOD
        return answer
