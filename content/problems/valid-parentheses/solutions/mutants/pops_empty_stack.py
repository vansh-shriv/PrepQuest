# expect: RE
class Solution:
    def isValid(self, s):
        pairs = {')': '(', ']': '[', '}': '{'}
        stack = []
        for ch in s:
            if ch in pairs:
                if stack.pop() != pairs[ch]:
                    return False
            else:
                stack.append(ch)
        return not stack
