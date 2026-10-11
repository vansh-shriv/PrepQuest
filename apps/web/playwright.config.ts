import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests drive the real stack: web (built) + API + judge worker + Postgres + Redis + Mailpit.
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
    // a fake microphone and auto-granted permission prompts for the voice specs
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
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
        FF_VOICE: "true",
        RL_LOGIN_PER_10MIN: "1000",
        RL_AUTH_PER_MIN: "1000",
        RL_ANON_PER_MIN: "10000",
        RL_USER_PER_MIN: "10000",
      },
    },
    // E2E_EXTERNAL_JUDGE=1: a judge worker is already running (e.g. `docker compose --profile judge up -d judge`)
    ...(process.env.E2E_EXTERNAL_JUDGE
      ? []
      : [
          {
            // the judge worker has no HTTP port; wait for its ready log line instead
            command: "pnpm --filter @prepquest/judge dev",
            wait: { stdout: /judge ready/ },
            timeout: 60_000,
            env: { JUDGE_SANDBOX: "process", JUDGE_CONCURRENCY: "2" },
          },
        ]),
    {
      command: "pnpm --filter @prepquest/web start",
      url: "http://localhost:3000",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
