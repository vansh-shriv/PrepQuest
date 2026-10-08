import { createDatabase, newId, seedReferenceData, withTransaction } from "@prepquest/db";
import { parseServerEnv } from "@prepquest/shared";
import { hashPassword } from "../modules/auth/password.js";
import * as repo from "../modules/auth/repo.js";

/** Local-only demo data. Idempotent. Refuses to run in production. */
const env = parseServerEnv();
if (env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");

const DEMO = {
  email: "demo@prepquest.dev",
  password: "demo-password",
  handle: "demo",
  displayName: "Demo Player",
};

const db = createDatabase(env.DATABASE_URL, 2);
try {
  const { tags } = await seedReferenceData(db);
  console.log(`Tags: ${tags} inserted`);

  if (await repo.findUserByEmail(db, DEMO.email)) {
    console.log("Demo user already exists.");
  } else {
    const userId = newId();
    const passwordHash = await hashPassword(DEMO.password);
    await withTransaction(db, async (tx) => {
      await repo.insertUser(tx, {
        id: userId,
        email: DEMO.email,
        passwordHash,
        emailVerified: true,
      });
      await repo.insertProfile(tx, {
        userId,
        handle: DEMO.handle,
        displayName: DEMO.displayName,
      });
    });
    console.log(`Demo user created: ${DEMO.email} / ${DEMO.password}`);
  }
} finally {
  await db.$client.end();
}
