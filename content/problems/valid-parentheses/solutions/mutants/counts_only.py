# expect: WA
class Solution:
    def isValid(self, s):
        return s.count('(') == s.count(')') and s.count('[') == s.count(']') and s.count('{') == s.count('}')
