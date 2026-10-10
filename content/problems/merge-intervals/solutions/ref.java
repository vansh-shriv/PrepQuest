import java.util.*;

class Solution {
    public int[][] mergeIntervals(int[][] intervals) {
        Arrays.sort(intervals, (p, q) -> p[0] != q[0] ? Integer.compare(p[0], q[0]) : Integer.compare(p[1], q[1]));
        List<int[]> merged = new ArrayList<>();
        for (int[] iv : intervals) {
            if (!merged.isEmpty() && iv[0] <= merged.get(merged.size() - 1)[1])
                merged.get(merged.size() - 1)[1] = Math.max(merged.get(merged.size() - 1)[1], iv[1]);
            else merged.add(new int[] {iv[0], iv[1]});
        }
        return merged.toArray(new int[0][]);
    }
}
