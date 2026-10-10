# expect: WA
class Solution:
    def numIslands(self, grid):
        return sum(row.count('1') for row in grid)
