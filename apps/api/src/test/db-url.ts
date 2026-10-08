/** Integration tests use their own database so they never touch dev data. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://prepquest:prepquest@localhost:5433/prepquest_test";

export function adminDatabaseUrl(testUrl: string): string {
  const url = new URL(testUrl);
  url.pathname = "/postgres";
  return url.toString();
}

export function databaseName(testUrl: string): string {
  return new URL(testUrl).pathname.replace(/^\//, "");
}
