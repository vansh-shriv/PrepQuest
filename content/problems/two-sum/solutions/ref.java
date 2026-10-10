import java.util.*;

class Solution {
    public int[] twoSum(int[] nums, int target) {
        Map<Long, Integer> seen = new HashMap<>();
        for (int j = 0; j < nums.length; j++) {
            Integer i = seen.get((long) target - nums[j]);
            if (i != null) return new int[] {i, j};
            seen.put((long) nums[j], j);
        }
        return new int[0];
    }
}
