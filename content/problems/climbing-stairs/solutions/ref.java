class Solution {
    public long countWays(int n) {
        long a = 1, b = 1;
        for (int i = 0; i < n - 1; i++) { long t = a + b; a = b; b = t; }
        return b;
    }
}
