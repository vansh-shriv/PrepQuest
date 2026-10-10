class Solution {
public:
    int minDistance(string& a, string& b) {
        vector<int> prev(b.size() + 1), cur(b.size() + 1);
        iota(prev.begin(), prev.end(), 0);
        for (size_t i = 1; i <= a.size(); i++) {
            cur[0] = i;
            for (size_t j = 1; j <= b.size(); j++) {
                if (a[i - 1] == b[j - 1]) cur[j] = prev[j - 1];
                else cur[j] = 1 + min({prev[j - 1], prev[j], cur[j - 1]});
            }
            swap(prev, cur);
        }
        return prev[b.size()];
    }
};
