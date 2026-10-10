# expect: WA
class Solution:
    def longestCommonPrefix(self, strs):
        prefix = strs[0]
        for s in strs[1:]:
            while prefix and not s.startswith(prefix[:1]):
                prefix = prefix[:-1]
        return prefix
