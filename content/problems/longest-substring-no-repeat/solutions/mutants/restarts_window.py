# expect: WA
class Solution:
    def lengthOfLongestSubstring(self, s):
        best = 0
        cur = set()
        for ch in s:
            if ch in cur:
                cur = set()
            cur.add(ch)
            best = max(best, len(cur))
        return best
