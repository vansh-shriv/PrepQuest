# expect: WA
class Solution:
    def numIslands(self, grid):
        rows, cols = len(grid), len(grid[0])
        seen = set()
        count = 0
        for r in range(rows):
            for c in range(cols):
                if grid[r][c] == '1' and (r, c) not in seen:
                    count += 1
                    stack = [(r, c)]
                    seen.add((r, c))
                    while stack:
                        y, x = stack.pop()
                        for dy in (-1, 0, 1):
                            for dx in (-1, 0, 1):
                                ny, nx = y + dy, x + dx
                                if 0 <= ny < rows and 0 <= nx < cols and grid[ny][nx] == '1' and (ny, nx) not in seen:
                                    seen.add((ny, nx))
                                    stack.append((ny, nx))
        return count
