import { defineConfig } from "vitest/config";

// Unit tests live next to the code under src/. Browser specs in e2e/ run with Playwright, not Vitest.
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
