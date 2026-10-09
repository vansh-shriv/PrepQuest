class Solution:
    def numIslands(self, grid):
        rows, cols = len(grid), len(grid[0])
        seen = [[False] * cols for _ in range(rows)]
        count = 0
        for r in range(rows):
            for c in range(cols):
                if grid[r][c] == "1" and not seen[r][c]:
                    count += 1
                    seen[r][c] = True
                    stack = [(r, c)]
                    while stack:
                        y, x = stack.pop()
                        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                            ny, nx = y + dy, x + dx
                            if 0 <= ny < rows and 0 <= nx < cols and grid[ny][nx] == "1" and not seen[ny][nx]:
                                seen[ny][nx] = True
                                stack.append((ny, nx))
        return count
