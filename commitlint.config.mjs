// Conventional Commits (doc 09). Body and footer line length are not enforced so trailers fit.
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "body-max-line-length": [0],
    "footer-max-line-length": [0],
  },
};
