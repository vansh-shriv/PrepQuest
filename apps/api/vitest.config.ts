import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./src/test/global-setup.ts"],
    // integration tests share one Postgres database
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
