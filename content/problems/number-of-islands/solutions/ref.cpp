class Solution {
public:
    int numIslands(vector<string>& grid) {
        int rows = grid.size(), cols = grid[0].size(), count = 0;
        vector<vector<bool>> seen(rows, vector<bool>(cols, false));
        for (int r = 0; r < rows; r++)
            for (int c = 0; c < cols; c++) {
                if (grid[r][c] != '1' || seen[r][c]) continue;
                count++;
                seen[r][c] = true;
                vector<pair<int, int>> stack(1, make_pair(r, c));
                while (!stack.empty()) {
                    int y = stack.back().first, x = stack.back().second;
                    stack.pop_back();
                    int dy[] = {1, -1, 0, 0}, dx[] = {0, 0, 1, -1};
                    for (int d = 0; d < 4; d++) {
                        int ny = y + dy[d], nx = x + dx[d];
                        if (ny >= 0 && ny < rows && nx >= 0 && nx < cols && grid[ny][nx] == '1' && !seen[ny][nx]) {
                            seen[ny][nx] = true;
                            stack.push_back(make_pair(ny, nx));
                        }
                    }
                }
            }
        return count;
    }
};
