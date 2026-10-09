import { createDatabase, newId, seedReferenceData, withTransaction } from "@prepquest/db";
import { parseServerEnv, type UserRole } from "@prepquest/shared";
import { hashPassword } from "../modules/auth/password.js";
import * as repo from "../modules/auth/repo.js";

/** Local-only demo data. Idempotent. Refuses to run in production. */
const env = parseServerEnv();
if (env.NODE_ENV === "production") throw new Error("Refusing to seed demo data in production");

const PASSWORD = "demo-password";
const DEMO_USERS: Array<{ email: string; handle: string; displayName: string; role: UserRole }> = [
  { email: "demo@prepquest.dev", handle: "demo", displayName: "Demo Player", role: "user" },
  // content workflow: editors write drafts, reviewers publish (authors can't publish their own work)
  {
    email: "editor@prepquest.dev",
    handle: "editor",
    displayName: "Demo Editor",
    role: "content_editor",
  },
  {
    email: "reviewer@prepquest.dev",
    handle: "reviewer",
    displayName: "Demo Reviewer",
    role: "reviewer",
  },
];

const db = createDatabase(env.DATABASE_URL, 2);
try {
  const { tags } = await seedReferenceData(db);
  console.log(`Tags: ${tags} inserted`);

  const passwordHash = await hashPassword(PASSWORD);
  for (const u of DEMO_USERS) {
    if (await repo.findUserByEmail(db, u.email)) {
      console.log(`${u.email} already exists`);
      continue;
    }
    const userId = newId();
    await withTransaction(db, async (tx) => {
      await repo.insertUser(tx, {
        id: userId,
        email: u.email,
        passwordHash,
        emailVerified: true,
        role: u.role,
      });
      await repo.insertProfile(tx, { userId, handle: u.handle, displayName: u.displayName });
    });
    console.log(`Created ${u.role}: ${u.email} / ${PASSWORD}`);
  }
} finally {
  await db.$client.end();
}
