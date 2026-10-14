import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { NODE_TYPES } from "@prepquest/analytics-core";
import { findContentRoot, importDesign, loadDesign } from "@prepquest/content";
import {
  DESIGN_NODE_TYPES,
  type DesignCanvasFull,
  type DesignCanvasListItem,
  type DesignPromptDetail,
  type DesignPromptItem,
  type DesignReferenceDto,
} from "@prepquest/shared";
import {
  bearer,
  makeTestApp,
  signupAndLogin,
  verifyAllEmails,
  type TestApp,
} from "../../test/helpers.js";

let t: TestApp;
let ada: string;
let bob: string;
let carol: string;

beforeAll(async () => {
  t = await makeTestApp();
  await importDesign(t.db, await loadDesign(findContentRoot()));
  ada = (await signupAndLogin(t)).accessToken;
  bob = (await signupAndLogin(t, { email: "bob@example.com", handle: "bob_h" })).accessToken;
  await verifyAllEmails(t);
  // carol never verifies her email
  carol = (await signupAndLogin(t, { email: "carol@example.com", handle: "carol_h" })).accessToken;
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.pool.query("DELETE FROM design_canvases");
  await t.pool.query("DELETE FROM llm_usage");
  t.mock.overrides.clear();
  t.mock.calls.length = 0;
  (t.kv as unknown as { data: Map<string, unknown> }).data.clear();
});

const call = <T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  token: string | null,
  payload?: object,
) =>
  t.app
    .inject({
      method,
      url: `/v1${url}`,
      ...(token ? { headers: bearer(token) } : {}),
      ...(payload ? { payload } : {}),
    })
    .then((r) => ({
      status: r.statusCode,
      body: r.body ? r.json<T>() : (undefined as T),
    }));

const make = async (token = ada, slug = "url-shortener") => {
  const r = await call<DesignCanvasFull>("POST", "/design/canvases", token, { promptSlug: slug });
  expect(r.status).toBe(201);
  return r.body;
};

const node = (id: string, type: string, label: string, x = 0, y = 0) => ({ id, type, label, x, y });
const GOOD = {
  nodes: [
    node("c", "client", "Browser", 40, 40),
    node("s", "service", "Shortener service", 260, 40),
    node("d", "database", "Links database", 480, 40),
  ],
  edges: [
    { id: "e1", from: "c", to: "s", label: "HTTPS" },
    { id: "e2", from: "s", to: "d", label: "read and write" },
  ],
};
const save = (c: DesignCanvasFull, canvas: object = GOOD, panel: object = c.panel, token = ada) =>
  call<DesignCanvasFull>("PUT", `/design/canvases/${c.id}`, token, {
    canvas,
    panel,
    baseVersion: c.version,
  });

describe("the practice prompts", () => {
  it("lists the prompts and marks the ones a learner started", async () => {
    const before = await call<{ items: DesignPromptItem[] }>("GET", "/design/prompts", ada);
    expect(before.body.items.map((p) => p.slug).sort()).toEqual([
      "chat-app",
      "file-storage",
      "news-feed",
      "url-shortener",
    ]);
    expect(before.body.items.every((p) => !p.started)).toBe(true);
    await make();
    const after = await call<{ items: DesignPromptItem[] }>("GET", "/design/prompts", ada);
    expect(after.body.items.find((p) => p.slug === "url-shortener")!.started).toBe(true);
    // someone else's progress is not shown
    const other = await call<{ items: DesignPromptItem[] }>("GET", "/design/prompts", bob);
    expect(other.body.items.every((p) => !p.started)).toBe(true);
  });

  it("shows the statement and requirement questions but never the reference", async () => {
    const r = await call<DesignPromptDetail>("GET", "/design/prompts/url-shortener", ada);
    expect(r.status).toBe(200);
    expect(r.body.statementMd).toContain("bit.ly");
    expect(r.body.requirementHints.functional.length).toBeGreaterThan(1);
    expect(JSON.stringify(r.body)).not.toContain('"v3"');
    expect((await call("GET", "/design/prompts/nope", ada)).status).toBe(404);
    expect((await call("GET", "/design/prompts", null)).status).toBe(401);
  });
});

describe("canvases", () => {
  it("starts empty with the calculator's defaults, and answers with the automatic checks", async () => {
    const c = await make();
    expect(c).toMatchObject({ version: 1, reviewStatus: "none", review: null });
    expect(c.canvas).toEqual({ nodes: [], edges: [] });
    expect(c.panel.estimate.dau).toBe(1_000_000);
    expect(c.findings.map((f) => f.code)).toEqual(["empty"]);
  });

  it("saves with a new version and reports what the drawing lacks", async () => {
    const c = await make();
    const saved = await save(c);
    expect(saved.status).toBe(200);
    expect(saved.body.version).toBe(2);
    expect(saved.body.canvas.nodes).toHaveLength(3);
    const codes = saved.body.findings.map((f) => f.code);
    expect(codes).toContain("single-database");
    expect(codes).toContain("no-cache");
    // the stored copy is what comes back
    const again = await call<DesignCanvasFull>("GET", `/design/canvases/${c.id}`, ada);
    expect(again.body.canvas).toEqual(GOOD);
  });

  it("refuses a save made from an old version and says which version is stored", async () => {
    const c = await make();
    await save(c);
    const stale = await save(c); // still based on version 1
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      error: { code: "VERSION_CONFLICT", details: { version: 2 } },
    });
  });

  it("rejects drawings that make no sense", async () => {
    const c = await make();
    const dangling = await save(c, {
      nodes: [node("a", "service", "A")],
      edges: [{ id: "e", from: "a", to: "ghost", label: "" }],
    });
    expect(dangling.status).toBe(422);
    const twice = await save(c, {
      nodes: [node("a", "service", "A"), node("a", "cache", "B")],
      edges: [],
    });
    expect(twice.status).toBe(422);
    const type = await save(c, { nodes: [node("a", "spaceship", "A")], edges: [] });
    expect(type.status).toBe(422);
    const self = await save(c, {
      nodes: [node("a", "service", "A")],
      edges: [{ id: "e", from: "a", to: "a", label: "" }],
    });
    expect(self.status).toBe(422);
  });

  it("is private to its owner", async () => {
    const c = await make();
    expect((await call("GET", `/design/canvases/${c.id}`, bob)).status).toBe(404);
    expect((await save(c, GOOD, c.panel, bob)).status).toBe(404);
    expect((await call("DELETE", `/design/canvases/${c.id}`, bob)).status).toBe(404);
    expect((await call("POST", `/design/canvases/${c.id}/review`, bob)).status).toBe(404);
    const mine = await call<{ items: DesignCanvasListItem[] }>("GET", "/design/canvases", bob);
    expect(mine.body.items).toEqual([]);
  });

  it("lists, deletes, and caps how many a learner keeps", async () => {
    const c = await make();
    await save(c);
    const list = await call<{ items: DesignCanvasListItem[] }>("GET", "/design/canvases", ada);
    expect(list.body.items).toEqual([
      expect.objectContaining({ id: c.id, components: 3, reviewed: false, version: 2 }),
    ]);
    expect((await call("DELETE", `/design/canvases/${c.id}`, ada)).status).toBe(204);
    expect((await call("GET", `/design/canvases/${c.id}`, ada)).status).toBe(404);
    for (let i = 0; i < 20; i++) await make();
    const over = await call("POST", "/design/canvases", ada, { promptSlug: "chat-app" });
    expect(over.status).toBe(409);
  });

  it("uses the same component types as the editor", () => {
    expect([...DESIGN_NODE_TYPES]).toEqual([...NODE_TYPES]);
  });
});

describe("the review", () => {
  const panel = {
    functional: ["Create a short link", "Redirect a short link"],
    nonFunctional: ["Fast redirects", "Highly available"],
    apis: ["POST /links", "GET /{code}"],
    dataModel: "links(code pk, url, created_at, expires_at)",
    notes: "Read heavy: about 100 reads per write, so cache hot links.",
    estimate: { dau: 1_000_000, actionsPerUser: 10 },
  };
  const ready = async (id: string, token = ada) =>
    (await call<DesignCanvasFull>("GET", `/design/canvases/${id}`, token)).body;
  const ask = (id: string, token = ada) =>
    call<DesignCanvasFull>("POST", `/design/canvases/${id}/review`, token);

  it("needs a verified email and a drawing with at least two components", async () => {
    const mine = await make(carol);
    expect((await ask(mine.id, carol)).status).toBe(403);
    const empty = await make();
    const res = await ask(empty.id);
    expect(res.status).toBe(422);
  });

  it("scores the design, cites real components and asks five questions", async () => {
    const c = await make();
    await save(c, GOOD, panel);
    const res = await ask(c.id);
    expect(res.status).toBe(202);
    await t.idle();
    const done = await ready(c.id);
    expect(done.reviewStatus).toBe("ready");
    const review = done.review!;
    expect(Object.keys(review.scores).sort()).toEqual([
      "architecture",
      "communication",
      "data",
      "estimation",
      "requirements",
      "scalability",
      "tradeoffs",
    ]);
    expect(Object.values(review.scores).every((s) => s >= 1 && s <= 5)).toBe(true);
    expect(review.questions).toHaveLength(5);
    expect(review.version).toBe(2);
    const ids = new Set(GOOD.nodes.map((n) => n.id));
    expect(review.findings.length).toBeGreaterThan(0);
    for (const f of review.findings) for (const id of f.nodeIds) expect(ids.has(id)).toBe(true);
    // the single database is called out against that component
    expect(review.findings).toContainEqual(
      expect.objectContaining({ area: "spof", severity: "important", nodeIds: ["d"] }),
    );
  });

  it("sends the model the graph with ids, the panel and the capacity numbers", async () => {
    const c = await make();
    await save(c, GOOD, panel);
    await ask(c.id);
    await t.idle();
    const prompt = t.mock.calls.find((x) => x.task === "design_review")!.messages[0]!.content;
    expect(prompt).toContain("[s] service: Shortener service");
    expect(prompt).toContain("[s] Shortener service -> [d] Links database (read and write)");
    expect(prompt).toContain("Create a short link");
    expect(prompt).toContain("links(code pk, url");
    expect(prompt).toContain("average 115.74 requests/s");
    expect(prompt).toContain("single-database ::");
  });

  it("asks the model again when it cites a component that is not on the canvas", async () => {
    const bad = {
      summary: "Fine.",
      scores: {
        requirements: 3,
        estimation: 3,
        architecture: 3,
        data: 3,
        scalability: 3,
        tradeoffs: 3,
        communication: 3,
      },
      findings: [
        { area: "spof", severity: "important", message: "The cache dies.", nodeIds: ["ghost"] },
      ],
      questions: ["a?", "b????", "c????", "d????", "e????"].map((q) => `${q} question`),
    };
    t.mock.overrides.set("design_review", [JSON.stringify(bad)]);
    const c = await make();
    await save(c, GOOD, panel);
    await ask(c.id);
    await t.idle();
    const done = await ready(c.id);
    expect(done.reviewStatus).toBe("ready");
    expect(t.mock.calls.filter((x) => x.task === "design_review")).toHaveLength(2);
    expect(JSON.stringify(done.review)).not.toContain("ghost");
  });

  it("reports a failure plainly and can be asked again", async () => {
    t.mock.overrides.set("design_review", ["no", "no", "no"]);
    const c = await make();
    await save(c, GOOD, panel);
    await ask(c.id);
    await t.idle();
    const failed = await ready(c.id);
    expect(failed.reviewStatus).toBe("failed");
    expect(failed.reviewError).toContain("could not be written");
    await ask(c.id);
    await t.idle();
    expect((await ready(c.id)).reviewStatus).toBe("ready");
  });

  it("reports a review whose job was lost as failed", async () => {
    const c = await make();
    await save(c, GOOD, panel);
    await t.pool.query(
      "ALTER TABLE design_canvases DISABLE TRIGGER design_canvases_set_updated_at",
    );
    await t.pool.query(
      "UPDATE design_canvases SET review_status = 'pending', updated_at = now() - interval '10 minutes' WHERE id = $1",
      [c.id],
    );
    await t.pool.query("ALTER TABLE design_canvases ENABLE TRIGGER design_canvases_set_updated_at");
    const stale = await ready(c.id);
    expect(stale.reviewStatus).toBe("failed");
    expect(stale.reviewError).toContain("too long");
  });

  it("keeps the review of an older version while the drawing changes", async () => {
    const c = await make();
    const v2 = (await save(c, GOOD, panel)).body;
    await ask(c.id);
    await t.idle();
    const edited = await save(v2, {
      ...GOOD,
      nodes: [...GOOD.nodes, node("ca", "cache", "Cache", 700, 40)],
    });
    expect(edited.body.review!.version).toBe(2);
    expect(edited.body.version).toBe(3);
  });

  it("limits how many reviews can be started in a minute", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const c = await make();
      await save(c, GOOD, panel);
      ids.push(c.id);
    }
    for (const id of ids.slice(0, 3)) expect((await ask(id)).status).toBe(202);
    expect((await ask(ids[3]!)).status).toBe(429);
    await t.idle();
  });
});

describe("the reference designs", () => {
  it("open only after the learner has been reviewed on their own attempt", async () => {
    const locked = await call<{ error: { code: string } }>(
      "GET",
      "/design/prompts/url-shortener/reference",
      ada,
    );
    expect(locked.status).toBe(403);
    expect(locked.body.error.code).toBe("REFERENCE_LOCKED");

    const c = await make();
    await save(c);
    // a canvas that was never reviewed does not unlock it
    expect((await call("GET", "/design/prompts/url-shortener/reference", ada)).status).toBe(403);
    await call("POST", `/design/canvases/${c.id}/review`, ada);
    await t.idle();
    const open = await call<DesignReferenceDto>(
      "GET",
      "/design/prompts/url-shortener/reference",
      ada,
    );
    expect(open.status).toBe(200);
    expect(Object.keys(open.body)).toEqual(["v1", "v2", "v3"]);
    expect(open.body.v3.canvas.nodes.length).toBeGreaterThan(open.body.v1.canvas.nodes.length);

    // another learner's review does not open it for me
    expect((await call("GET", "/design/prompts/url-shortener/reference", bob)).status).toBe(403);
    // and a review of a different prompt does not either
    const other = await make(ada, "chat-app");
    await save(other);
    expect((await call("GET", "/design/prompts/news-feed/reference", ada)).status).toBe(403);
  });
});
