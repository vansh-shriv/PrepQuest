class Solution {
public:
    string longestCommonPrefix(vector<string>& strs) {
        string prefix = strs[0];
        for (size_t k = 1; k < strs.size(); k++) {
            size_t i = 0;
            while (i < prefix.size() && i < strs[k].size() && prefix[i] == strs[k][i]) i++;
            prefix = prefix.substr(0, i);
        }
        return prefix;
    }
};
