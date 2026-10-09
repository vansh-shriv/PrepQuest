import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests drive the real stack: web (built) + API + Postgres + Redis + Mailpit.
 * Prerequisites: `docker compose up -d postgres redis mailpit`, `pnpm db:migrate`, `pnpm build`.
 * Uses the locally installed Chrome (no browser download).
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  // CI machines and cold starts are slower than a warm laptop: give assertions room before failing
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm --filter @prepquest/api dev",
      url: "http://localhost:4000/v1/health",
      reuseExistingServer: true,
      timeout: 60_000,
      // the suite signs in many times from one IP and uses made-up passwords; keep it offline-safe
      env: {
        BREACH_CHECK: "off",
        RL_LOGIN_PER_10MIN: "1000",
        RL_AUTH_PER_MIN: "1000",
        RL_ANON_PER_MIN: "10000",
        RL_USER_PER_MIN: "10000",
      },
    },
    {
      command: "pnpm --filter @prepquest/web start",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
