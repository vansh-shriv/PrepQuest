class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        unordered_map<long long, int> seen;
        for (int j = 0; j < (int)nums.size(); j++) {
            auto it = seen.find((long long)target - nums[j]);
            if (it != seen.end()) return {it->second, j};
            seen[nums[j]] = j;
        }
        return {};
    }
};
