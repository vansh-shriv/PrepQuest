import java.util.*;

class Solution {
    public int numIslands(String[] grid) {
        int rows = grid.length, cols = grid[0].length(), count = 0;
        boolean[][] seen = new boolean[rows][cols];
        int[] dy = {1, -1, 0, 0}, dx = {0, 0, 1, -1};
        for (int r = 0; r < rows; r++)
            for (int c = 0; c < cols; c++) {
                if (grid[r].charAt(c) != '1' || seen[r][c]) continue;
                count++;
                seen[r][c] = true;
                Deque<int[]> stack = new ArrayDeque<>();
                stack.push(new int[] {r, c});
                while (!stack.isEmpty()) {
                    int[] p = stack.pop();
                    for (int d = 0; d < 4; d++) {
                        int ny = p[0] + dy[d], nx = p[1] + dx[d];
                        if (ny >= 0 && ny < rows && nx >= 0 && nx < cols && grid[ny].charAt(nx) == '1' && !seen[ny][nx]) {
                            seen[ny][nx] = true;
                            stack.push(new int[] {ny, nx});
                        }
                    }
                }
            }
        return count;
    }
}
