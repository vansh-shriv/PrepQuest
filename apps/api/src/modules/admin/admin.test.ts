import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { sql } from "drizzle-orm";
import { encodeInput, encodeOutput, signatureSchema } from "@prepquest/content";
import type {
  AdminProblemDetail,
  AdminProblemListItem,
  AuditEntry,
  UserRole,
  ValidationReport,
  VersionInfo,
} from "@prepquest/shared";
import { seedContent } from "../../test/content.js";
import { bearer, makeTestApp, signup, type TestApp } from "../../test/helpers.js";

let t: TestApp;
let editor: string;
let editor2: string;
let reviewer: string;
let reviewer2: string;
let plainUser: string;
let adminNoMfa: string;
const ids: Record<string, string> = {};

/** Creates an account, gives it a role, and signs in so the token carries that role. */
async function actingAs(role: UserRole, n: string): Promise<string> {
  const email = `${n}@example.com`;
  await signup(t, { email, handle: `h_${n}`.slice(0, 20), displayName: n });
  await t.db.execute(
    sql`UPDATE users SET role = ${role}, email_verified_at = now() WHERE email = ${email}`,
  );
  const res = await t.app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: { email, password: "correct-horse-battery" },
  });
  ids[n] = res.json().user.id;
  return res.json().accessToken as string;
}

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, ["two-sum"]);
  editor = await actingAs("content_editor", "editor1");
  editor2 = await actingAs("content_editor", "editor2");
  reviewer = await actingAs("reviewer", "reviewer1");
  reviewer2 = await actingAs("reviewer", "reviewer2");
  plainUser = await actingAs("user", "plain");
  adminNoMfa = await actingAs("admin", "admin1");
});
afterAll(() => t.close());

const call = (
  method: "GET" | "POST" | "PATCH",
  url: string,
  token: string | null,
  payload?: object,
) =>
  t.app.inject({
    method,
    url,
    ...(token ? { headers: bearer(token) } : {}),
    ...(payload ? { payload } : {}),
  });

const TWO_SUM_SIG = {
  function: "twoSum",
  params: [
    { name: "nums", type: "int[]" },
    { name: "target", type: "int" },
  ],
  returns: "int[]",
};
const sig = signatureSchema.parse(TWO_SUM_SIG);

const newProblem = (slug: string, extra: object = {}) => ({
  slug,
  title: `Problem ${slug}`,
  difficulty: "easy",
  statementMd:
    "Given an array and a target, return the positions of two numbers that add up to the target value.",
  constraintsMd: "- `2 <= nums.length <= 100`",
  topics: ["arrays"],
  patterns: [],
  estMinutes: 10,
  signature: TWO_SUM_SIG,
  ...extra,
});

/**
 * A valid test zip for the two-sum signature: `count` tests, the first `samples` of them samples (match
 * the number of examples on the problem), then hidden ones, one edge and two stress tests, all labelled.
 */
function testZip(
  count = 12,
  mutate: (files: Record<string, string>) => void = () => {},
  samples = 0,
): Uint8Array {
  const files: Record<string, string> = {};
  const manifest = [];
  for (let i = 1; i <= count; i++) {
    const a = i,
      b = i + 1;
    const kind =
      i <= samples ? "sample" : i > count - 2 ? "stress" : i === count - 2 ? "edge" : "hidden";
    const n = String(i).padStart(2, "0");
    files[`${n}.in`] = encodeInput(sig, [[a, b, 1000 + i], a + b]);
    files[`${n}.out`] = encodeOutput(sig, [0, 1]);
    manifest.push({ ordinal: i, kind, ...(kind === "hidden" ? {} : { label: `${kind} ${i}` }) });
  }
  files["manifest.json"] = JSON.stringify(manifest);
  mutate(files);
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([k, v]) => [k, new TextEncoder().encode(v)])),
  );
}

function upload(token: string, id: string, zip: Uint8Array | Buffer) {
  const boundary = "----pqtest";
  const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="tests.zip"\r\nContent-Type: application/zip\r\n\r\n`;
  const body = Buffer.concat([
    Buffer.from(head),
    Buffer.from(zip),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return t.app.inject({
    method: "POST",
    url: `/v1/admin/problems/${id}/tests/upload`,
    payload: body,
    headers: { ...bearer(token), "content-type": `multipart/form-data; boundary=${boundary}` },
  });
}

/** Creates a problem that passes every pre-publish check (as `token`). */
async function makeReadyProblem(token: string, slug: string): Promise<string> {
  const created = await call("POST", "/v1/admin/problems", token, newProblem(slug));
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json<AdminProblemDetail>().id;
  const patched = await call("PATCH", `/v1/admin/problems/${id}`, token, {
    examples: [{ input: "nums = [1, 2]\ntarget = 3", output: "[0, 1]", explanation: "1 + 2 = 3" }],
  });
  expect(patched.statusCode, patched.body).toBe(200);
  const up = await upload(
    token,
    id,
    testZip(13, () => {}, 1),
  ); // one example -> one leading sample
  expect(up.statusCode, up.body).toBe(200);
  return id;
}

// ================================================================ access

describe("access control", () => {
  it("rejects anonymous callers and ordinary users", async () => {
    expect((await call("GET", "/v1/admin/problems", null)).statusCode).toBe(401);
    const res = await call("GET", "/v1/admin/problems", plainUser);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FORBIDDEN");
  });

  it("lets editors and reviewers in", async () => {
    expect((await call("GET", "/v1/admin/problems", editor)).statusCode).toBe(200);
    expect((await call("GET", "/v1/admin/problems", reviewer)).statusCode).toBe(200);
  });

  it("requires 2FA for admins", async () => {
    const res = await call("GET", "/v1/admin/problems", adminNoMfa);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("MFA_REQUIRED");
  });

  it("keeps the audit log to reviewers and admins", async () => {
    expect((await call("GET", "/v1/admin/audit", editor)).statusCode).toBe(403);
    expect((await call("GET", "/v1/admin/audit", reviewer)).statusCode).toBe(200);
  });

  it("validates ids", async () => {
    expect((await call("GET", "/v1/admin/problems/not-a-uuid", reviewer)).statusCode).toBe(422);
    expect(
      (await call("GET", "/v1/admin/problems/0192f3a0-0000-7000-8000-00000000dead", reviewer))
        .statusCode,
    ).toBe(404);
  });
});

// ================================================================ create / list

describe("create and list", () => {
  it("creates a draft owned by the editor, with generated starters and the right permissions", async () => {
    const res = await call("POST", "/v1/admin/problems", editor, newProblem("my-first-problem"));
    expect(res.statusCode).toBe(201);
    const p = res.json<AdminProblemDetail>();
    expect(p).toMatchObject({
      slug: "my-first-problem",
      status: "draft",
      version: 1,
      createdBy: ids.editor1,
      tests: 0,
    });
    expect(p.starters.python).toContain(
      "def twoSum(self, nums: list[int], target: int) -> list[int]:",
    );
    expect(p.starters.java).toContain("public int[] twoSum(int[] nums, int target)");
    expect(p.limits).toEqual({ timeLimitMs: 1000, memoryLimitKb: 262144 });
    expect(p.permissions).toEqual({
      edit: true,
      uploadTests: true,
      submitReview: true,
      publish: false,
      archive: false,
    });
    ids.first = p.id;
    // drafts are invisible to the public
    expect((await call("GET", "/v1/problems/my-first-problem", null)).statusCode).toBe(404);
  });

  it("validates input and rejects duplicate slugs", async () => {
    const bad = await call(
      "POST",
      "/v1/admin/problems",
      editor,
      newProblem("Bad Slug", {
        topics: ["no-such-tag"],
        signature: { function: "x", params: [], returns: "int" },
      }),
    );
    expect(bad.statusCode).toBe(422);
    expect(
      (
        await call(
          "POST",
          "/v1/admin/problems",
          editor,
          newProblem("fresh-slug", { topics: ["no-such-tag"] }),
        )
      ).json().error.details.fields.topics,
    ).toMatch(/no-such-tag/);
    expect(
      (await call("POST", "/v1/admin/problems", editor, newProblem("my-first-problem"))).statusCode,
    ).toBe(409);
    expect(
      (await call("POST", "/v1/admin/problems", plainUser, newProblem("by-user"))).statusCode,
    ).toBe(403);
  });

  it("lists every status with test counts and supports filters", async () => {
    const all = (await call("GET", "/v1/admin/problems", reviewer)).json<{
      items: AdminProblemListItem[];
    }>().items;
    expect(all.map((i) => i.slug)).toEqual(expect.arrayContaining(["two-sum", "my-first-problem"]));
    expect(all.find((i) => i.slug === "two-sum")).toMatchObject({ status: "published", tests: 19 });
    const drafts = (await call("GET", "/v1/admin/problems?status=draft", reviewer)).json<{
      items: AdminProblemListItem[];
    }>().items;
    expect(drafts.every((i) => i.status === "draft")).toBe(true);
    const search = (await call("GET", "/v1/admin/problems?q=first", reviewer)).json<{
      items: AdminProblemListItem[];
    }>().items;
    expect(search.map((i) => i.slug)).toEqual(["my-first-problem"]);
    // LIKE wildcards in the search are literal
    expect((await call("GET", "/v1/admin/problems?q=%25", reviewer)).json().items).toEqual([]);
  });
});

// ================================================================ editing and versions

describe("editing", () => {
  it("lets an editor edit only their own drafts; reviewers can edit any non-archived problem", async () => {
    const own = await call("PATCH", `/v1/admin/problems/${ids.first}`, editor, {
      title: "A Better Title",
    });
    expect(own.statusCode).toBe(200);
    expect(own.json<AdminProblemDetail>().title).toBe("A Better Title");

    const other = await call("PATCH", `/v1/admin/problems/${ids.first}`, editor2, {
      title: "Hijacked",
    });
    expect(other.statusCode).toBe(403);
    expect(
      (await call("PATCH", `/v1/admin/problems/${ids.first}`, reviewer, { estMinutes: 20 }))
        .statusCode,
    ).toBe(200);

    // editors can't touch published problems
    const published = (await call("GET", "/v1/admin/problems?status=published", reviewer)).json<{
      items: AdminProblemListItem[];
    }>().items[0]!;
    expect(
      (await call("PATCH", `/v1/admin/problems/${published.id}`, editor, { title: "Nope nope" }))
        .statusCode,
    ).toBe(403);
  });

  it("creates a new version (copying the tests forward) when the statement changes, but not for a title change", async () => {
    const twoSum = (await call("GET", "/v1/admin/problems?q=two", reviewer))
      .json<{ items: AdminProblemListItem[] }>()
      .items.find((i) => i.slug === "two-sum")!;
    expect(twoSum.version).toBe(1);

    const retitled = await call("PATCH", `/v1/admin/problems/${twoSum.id}`, reviewer, {
      title: "Two Sum (renamed)",
      estMinutes: 12,
    });
    expect(retitled.json<AdminProblemDetail>().version).toBe(1);

    const edited = await call("PATCH", `/v1/admin/problems/${twoSum.id}`, reviewer, {
      statementMd:
        "Given an array of integers and a target, return the indices of the two numbers that sum to the target.",
      limits: { timeLimitMs: 1500, memoryLimitKb: 262144 },
    });
    const detail = edited.json<AdminProblemDetail>();
    expect(detail.version).toBe(2);
    expect(detail.tests).toBe(19); // tests carried over to the new version
    expect(detail.limits.timeLimitMs).toBe(1500);

    // per-language limits follow the documented multipliers
    const pub = (await call("GET", "/v1/problems/two-sum", null)).json();
    expect(pub.version).toBe(2);
    expect(
      pub.languages.map((l: { language: string; timeLimitMs: number }) => [
        l.language,
        l.timeLimitMs,
      ]),
    ).toEqual([
      ["cpp", 1500],
      ["java", 3300],
      ["python", 7500],
    ]);

    // old version rows still exist for old submissions
    const old = await t.pool.query(
      "SELECT count(*)::int AS n FROM test_cases WHERE problem_id = $1 AND version = 1",
      [twoSum.id],
    );
    expect(old.rows[0].n).toBe(19);

    const versions = (
      await call("GET", `/v1/admin/problems/${twoSum.id}/versions`, reviewer)
    ).json<{ items: VersionInfo[] }>().items;
    expect(versions.map((v) => [v.version, v.current])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(versions[0]).toMatchObject({ changeNote: "edited in admin", tests: 19 });
  });

  it("syncs tags and rejects unknown ones; validates example and limit shapes", async () => {
    const ok = await call("PATCH", `/v1/admin/problems/${ids.first}`, reviewer, {
      topics: ["arrays", "hashing"],
      patterns: ["prefix-sum"],
    });
    expect(ok.json<AdminProblemDetail>()).toMatchObject({
      topics: ["arrays", "hashing"],
      patterns: ["prefix-sum"],
    });
    expect(
      (await call("PATCH", `/v1/admin/problems/${ids.first}`, reviewer, { topics: ["nope"] }))
        .statusCode,
    ).toBe(422);
    expect(
      (
        await call("PATCH", `/v1/admin/problems/${ids.first}`, reviewer, {
          limits: { timeLimitMs: 5, memoryLimitKb: 1 },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      (
        await call("PATCH", `/v1/admin/problems/${ids.first}`, reviewer, {
          slug: "renamed",
          status: "published",
        })
      ).statusCode,
    ).toBe(422); // no mass assignment
  });
});

// ================================================================ tests upload

describe("test upload", () => {
  let draft: string;
  beforeAll(async () => {
    const res = await call("POST", "/v1/admin/problems", editor, newProblem("upload-target"));
    draft = res.json<AdminProblemDetail>().id;
  });

  const issuesOf = (res: {
    json: () => { error: { details?: { issues?: Array<{ message: string }> }; message: string } };
  }) => (res.json().error.details?.issues ?? []).map((i) => i.message).join(" | ");

  it("accepts a valid zip: stores the files, a new version and the rows", async () => {
    const res = await upload(editor, draft, testZip());
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ version: 2, tests: 12 });
    const detail = (
      await call("GET", `/v1/admin/problems/${draft}`, editor)
    ).json<AdminProblemDetail>();
    expect(detail).toMatchObject({ version: 2, tests: 12 });
    expect(detail.testCases[0]).toMatchObject({ ordinal: 1, kind: "hidden", label: null });
    expect(detail.testCases[11]).toMatchObject({ ordinal: 12, kind: "stress", label: "stress 12" });
    expect(await t.store.exists("problems/upload-target/v2/01.in")).toBe(true);
    expect((await t.store.get("problems/upload-target/v2/12.out")).toString()).toBe("2\n0 1\n");
  });

  it("rejects things that are not a zip, or not multipart", async () => {
    expect((await upload(editor, draft, Buffer.from("definitely not a zip"))).statusCode).toBe(422);
    const plain = await t.app.inject({
      method: "POST",
      url: `/v1/admin/problems/${draft}/tests/upload`,
      headers: bearer(editor),
      payload: { a: 1 },
    });
    expect(plain.statusCode).toBe(422);
  });

  it("names every problem it finds, stores nothing, and leaves the version alone", async () => {
    const before = (
      await call("GET", `/v1/admin/problems/${draft}`, editor)
    ).json<AdminProblemDetail>().version;

    const wrongFormat = await upload(
      editor,
      draft,
      testZip(12, (f) => {
        f["03.in"] = "3\n1 2\n5\n";
      }),
    );
    expect(wrongFormat.statusCode).toBe(422);
    expect(issuesOf(wrongFormat)).toMatch(/test 3: input does not match the signature/);

    const missingManifest = await upload(
      editor,
      draft,
      testZip(12, (f) => {
        delete f["manifest.json"];
      }),
    );
    expect(issuesOf(missingManifest)).toMatch(/manifest\.json is missing/);

    const missingOut = await upload(
      editor,
      draft,
      testZip(12, (f) => {
        delete f["05.out"];
      }),
    );
    expect(issuesOf(missingOut)).toMatch(/test 5: 05\.out is missing/);

    const stray = await upload(
      editor,
      draft,
      testZip(12, (f) => {
        f["notes.txt"] = "hi";
        f["99.in"] = "x";
      }),
    );
    expect(issuesOf(stray)).toMatch(/unexpected file "notes\.txt"/);
    expect(issuesOf(stray)).toMatch(/99\.in is not listed in manifest\.json/);

    const tooFew = await upload(editor, draft, testZip(6));
    expect(issuesOf(tooFew)).toMatch(/easy problems need at least 10 non-sample tests/);

    const badBytes = zipSync({
      "manifest.json": new TextEncoder().encode("[]"),
      "01.in": new Uint8Array([0xff, 0xfe, 0xfd]),
    });
    expect(issuesOf(await upload(editor, draft, badBytes))).toMatch(/01\.in is not valid UTF-8/);

    expect(
      (await call("GET", `/v1/admin/problems/${draft}`, editor)).json<AdminProblemDetail>().version,
    ).toBe(before);
    expect(await t.store.exists("problems/upload-target/v3/01.in")).toBe(false);
  });

  it("rejects zip bombs and oversized members before inflating them", async () => {
    const huge = zipSync({
      "manifest.json": new TextEncoder().encode("[]"),
      "01.in": new Uint8Array(6 * 1024 * 1024),
    }); // ~6 KB zipped, 6 MB inflated
    expect(huge.length).toBeLessThan(100_000);
    const res = await upload(editor, draft, huge);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/larger than 5 MB/);

    const many = Object.fromEntries(
      Array.from({ length: 450 }, (_, i) => [
        `${String(i).padStart(3, "0")}.in`,
        new Uint8Array(1),
      ]),
    );
    expect((await upload(editor, draft, zipSync(many))).json().error.message).toMatch(
      /more than 401 files/,
    );
  });

  it("enforces ownership: other editors are refused, reviewers may upload", async () => {
    expect((await upload(editor2, draft, testZip())).statusCode).toBe(403);
    expect((await upload(reviewer, draft, testZip())).statusCode).toBe(200);
  });

  it("needs a signature", async () => {
    const [noSig] = (
      await t.pool.query(
        `INSERT INTO problems (id, slug, title, statement_md, difficulty, examples, created_by, status)
       VALUES ('0192f3a0-0000-7000-8000-0000000000c1', 'legacy-no-signature', 'Legacy', 'x', 'easy', '[]', $1, 'draft') RETURNING id`,
        [ids.editor1],
      )
    ).rows;
    expect((await upload(editor, noSig.id, testZip())).statusCode).toBe(409);
  });
});

// ================================================================ validation

describe("validation report", () => {
  it("flags an unfinished draft and explains what's missing", async () => {
    const id = (
      await call(
        "POST",
        "/v1/admin/problems",
        editor,
        newProblem("unfinished", { statementMd: "short", constraintsMd: "" }),
      )
    ).json<AdminProblemDetail>().id;
    const report = (
      await call("GET", `/v1/admin/problems/${id}/validation`, editor)
    ).json<ValidationReport>();
    expect(report.ok).toBe(false);
    const status = Object.fromEntries(report.checks.map((c) => [c.id, c.status]));
    expect(status).toMatchObject({
      tags: "pass",
      statement: "fail",
      constraints: "fail",
      examples: "fail",
      signature: "pass",
      starters: "pass",
      tests: "fail",
      hints: "warn",
      reference: "skip",
      mutants: "skip",
    });
  });

  it("passes a complete problem (hints only warn; judge-dependent checks are skipped)", async () => {
    const id = await makeReadyProblem(editor, "complete-problem");
    const report = (
      await call("GET", `/v1/admin/problems/${id}/validation`, editor)
    ).json<ValidationReport>();
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.id === "tests")).toMatchObject({
      status: "pass",
      label: "Tests are valid (13 found)",
    });
  });

  it("notices when stored test data has gone missing", async () => {
    const id = await makeReadyProblem(editor, "lost-data");
    await t.store.delete("problems/lost-data/v3/04.in");
    const tests = (await call("GET", `/v1/admin/problems/${id}/validation`, editor))
      .json<ValidationReport>()
      .checks.find((c) => c.id === "tests")!;
    expect(tests.status).toBe("fail");
    expect(tests.detail).toMatch(/test 4: data missing from storage/);
  });
});

// ================================================================ workflow

describe("review workflow", () => {
  let id: string;

  it("blocks submitting an invalid problem, naming what to fix", async () => {
    const draft = (
      await call("POST", "/v1/admin/problems", editor, newProblem("workflow-problem"))
    ).json<AdminProblemDetail>().id;
    const res = await call("POST", `/v1/admin/problems/${draft}/submit-review`, editor);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(
      /Fix these first:.*Has at least one example.*Tests are valid/,
    );
    id = draft;
  });

  it("moves draft -> in_review -> published with separation of duties", async () => {
    const patched = await call("PATCH", `/v1/admin/problems/${id}`, editor, {
      examples: [{ input: "nums = [1, 2]\ntarget = 3", output: "[0, 1]" }],
    });
    expect(patched.statusCode, patched.body).toBe(200);
    const up = await upload(
      editor,
      id,
      testZip(13, () => {}, 1),
    ); // one example -> one leading sample
    expect(up.statusCode, up.body).toBe(200);

    const submitted = await call("POST", `/v1/admin/problems/${id}/submit-review`, editor);
    expect(submitted.statusCode, submitted.body).toBe(200);
    expect(submitted.json<AdminProblemDetail>()).toMatchObject({ status: "in_review" });
    expect(submitted.json<AdminProblemDetail>().permissions).toMatchObject({
      edit: false,
      publish: false,
    });

    // the author can't publish (not a reviewer); editors can't edit once it's in review
    expect((await call("POST", `/v1/admin/problems/${id}/publish`, editor)).statusCode).toBe(403);
    expect(
      (await call("PATCH", `/v1/admin/problems/${id}`, editor, { title: "Sneaky edit" }))
        .statusCode,
    ).toBe(403);
    expect((await call("GET", "/v1/problems/workflow-problem", null)).statusCode).toBe(404); // still hidden

    const published = await call("POST", `/v1/admin/problems/${id}/publish`, reviewer);
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json<AdminProblemDetail>().status).toBe("published");
    const live = await call("GET", "/v1/problems/workflow-problem", null);
    expect(live.statusCode).toBe(200);
    expect(live.json().title).toBe("Problem workflow-problem");
    const listed = (await call("GET", "/v1/problems?q=workflow", null)).json<{
      items: Array<{ slug: string }>;
    }>().items;
    expect(listed.map((i) => i.slug)).toContain("workflow-problem");
  });

  it("stops reviewers publishing their own problems unless self-publish is enabled", async () => {
    const own = await makeReadyProblem(reviewer, "reviewers-own");
    const blocked = await call("POST", `/v1/admin/problems/${own}/publish`, reviewer);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().error.message).toMatch(/can't publish your own/);
    expect((await call("POST", `/v1/admin/problems/${own}/publish`, reviewer2)).statusCode).toBe(
      200,
    );
  });

  it("allows self-publish when configured", async () => {
    const { permissionsFor } = await import("./service.js");
    const row = { status: "draft", createdBy: ids.reviewer1 } as Parameters<
      typeof permissionsFor
    >[2];
    const actor = { id: ids.reviewer1!, role: "reviewer" as const, ip: null };
    expect(permissionsFor({ allowSelfPublish: false }, actor, row).publish).toBe(false);
    expect(permissionsFor({ allowSelfPublish: true }, actor, row).publish).toBe(true);
  });

  it("requires a reason to archive, only for reviewers, and freezes the problem afterwards", async () => {
    expect((await call("POST", `/v1/admin/problems/${id}/archive`, reviewer, {})).statusCode).toBe(
      422,
    );
    expect(
      (await call("POST", `/v1/admin/problems/${id}/archive`, reviewer, { reason: "no" }))
        .statusCode,
    ).toBe(422);
    expect(
      (await call("POST", `/v1/admin/problems/${id}/archive`, editor, { reason: "I want it gone" }))
        .statusCode,
    ).toBe(403);

    const archived = await call("POST", `/v1/admin/problems/${id}/archive`, reviewer, {
      reason: "Replaced by a better problem",
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json<AdminProblemDetail>().status).toBe("archived");

    expect((await call("GET", "/v1/problems?q=workflow", null)).json().items).toEqual([]); // gone from lists
    expect((await call("GET", "/v1/problems/workflow-problem", null)).json().archived).toBe(true); // still reachable
    expect(
      (await call("PATCH", `/v1/admin/problems/${id}`, reviewer, { title: "Edited after archive" }))
        .statusCode,
    ).toBe(403);
    expect((await call("POST", `/v1/admin/problems/${id}/publish`, reviewer2)).statusCode).toBe(
      403,
    );
  });

  it("records every write in the audit log with actor, role, before/after and reason", async () => {
    const items = (await call("GET", `/v1/admin/audit?entityId=${id}`, reviewer)).json<{
      items: AuditEntry[];
    }>().items;
    const trail = [...items].reverse().map((e) => [e.action, e.actorRole]);
    expect(trail).toEqual([
      ["problem.create", "content_editor"],
      ["problem.update", "content_editor"],
      ["problem.tests.upload", "content_editor"],
      ["problem.submit-review", "content_editor"],
      ["problem.publish", "reviewer"],
      ["problem.archive", "reviewer"],
    ]);
    const archive = items[0]!;
    expect(archive).toMatchObject({
      reason: "Replaced by a better problem",
      before: { status: "published" },
      after: { status: "archived" },
      actorId: ids.reviewer1,
    });
    const upload = items.find((e) => e.action === "problem.tests.upload")!;
    expect(upload.before).toEqual({ version: 2 });
    expect(upload.after).toEqual({ version: 3, tests: 13 });
    // refused actions leave no trace of success
    expect(items.every((e) => !e.action.includes("denied"))).toBe(true);
  });
});
