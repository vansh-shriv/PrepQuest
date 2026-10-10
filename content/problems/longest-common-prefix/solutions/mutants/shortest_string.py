# expect: WA
class Solution:
    def longestCommonPrefix(self, strs):
        return min(strs, key=len)
