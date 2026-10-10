class Solution {
    public String longestCommonPrefix(String[] strs) {
        String prefix = strs[0];
        for (int k = 1; k < strs.length; k++) {
            int i = 0;
            while (i < prefix.length() && i < strs[k].length() && prefix.charAt(i) == strs[k].charAt(i)) i++;
            prefix = prefix.substring(0, i);
        }
        return prefix;
    }
}
