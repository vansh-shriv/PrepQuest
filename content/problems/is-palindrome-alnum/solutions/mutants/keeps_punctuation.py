# expect: WA
class Solution:
    def isPalindrome(self, s):
        t = s.lower()
        return t == t[::-1]
