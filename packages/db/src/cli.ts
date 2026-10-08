import { createPool } from "./client.js";
import { migrate, resetDatabase } from "./migrate.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (copy .env.example to .env)");
  process.exit(1);
}

const pool = createPool(url, 2);
const command = process.argv[2];

try {
  if (command === "migrate") {
    const applied = await migrate(pool);
    console.log(applied.length ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
  } else if (command === "reset") {
    if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset in production");
    await resetDatabase(pool);
    console.log("Database reset and migrated.");
  } else {
    console.error("Usage: cli.ts <migrate|reset>");
    process.exitCode = 1;
  }
} finally {
  await pool.end();
}
