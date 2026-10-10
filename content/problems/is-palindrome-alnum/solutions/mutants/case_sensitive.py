# expect: WA
class Solution:
    def isPalindrome(self, s):
        t = [c for c in s if c.isalnum()]
        return t == t[::-1]
