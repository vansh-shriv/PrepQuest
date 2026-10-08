import { defineConfig } from "drizzle-kit";

// Schema lives in src/schema (TypeScript). Generate SQL migrations with `pnpm db:generate`;
// hand-written SQL (extensions, triggers) is added with `drizzle-kit generate --custom`.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./migrations",
});
