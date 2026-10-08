import { createDatabase } from "./client.js";
import { migrate, resetDatabase } from "./migrate.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (copy .env.example to .env)");
  process.exit(1);
}

const db = createDatabase(url, 2);
const command = process.argv[2];

try {
  if (command === "migrate") {
    await migrate(db);
    console.log("Database is up to date.");
  } else if (command === "reset") {
    if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset in production");
    await resetDatabase(db);
    console.log("Database reset and migrated.");
  } else {
    console.error("Usage: cli.ts <migrate|reset>");
    process.exitCode = 1;
  }
} finally {
  await db.$client.end();
}
