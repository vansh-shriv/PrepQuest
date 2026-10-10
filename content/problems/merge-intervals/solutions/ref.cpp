class Solution {
public:
    vector<vector<int>> mergeIntervals(vector<vector<int>>& intervals) {
        sort(intervals.begin(), intervals.end());
        vector<vector<int>> merged;
        for (auto& iv : intervals) {
            if (!merged.empty() && iv[0] <= merged.back()[1]) merged.back()[1] = max(merged.back()[1], iv[1]);
            else merged.push_back({iv[0], iv[1]});
        }
        return merged;
    }
};
