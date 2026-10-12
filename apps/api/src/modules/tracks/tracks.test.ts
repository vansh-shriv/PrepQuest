import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  PlanDto,
  StartTrackResponse,
  TrackCompareResponse,
  TrackDto,
  TracksResponse,
} from "@prepquest/shared";
import { seedBank, seedContent } from "../../test/content.js";
import {
  bearer,
  makeTestApp,
  signupAndLogin,
  verifyAllEmails,
  type TestApp,
} from "../../test/helpers.js";
import { resetLearning, solveProblem } from "../../test/solve.js";

let t: TestApp;
let ada: string;
let bob: string;

const SLUGS = [
  "two-sum",
  "valid-parentheses",
  "three-sum",
  "climbing-stairs",
  "edit-distance",
  "merge-intervals",
];

beforeAll(async () => {
  t = await makeTestApp();
  await seedContent(t, SLUGS);
  await seedBank(t);
  ada = (await signupAndLogin(t)).accessToken;
  bob = (await signupAndLogin(t, { email: "bob@example.com", handle: "bob_h" })).accessToken;
  await verifyAllEmails(t);
});
afterAll(() => t.close());
beforeEach(async () => {
  await resetLearning(t);
  t.app.ai.now = () => new Date();
});

const call = <T>(method: "GET" | "POST", url: string, token: string | null = ada) =>
  t.app
    .inject({ method, url: `/v1${url}`, ...(token ? { headers: bearer(token) } : {}) })
    .then((r) => ({ status: r.statusCode, body: r.json<T>() }));

describe("company tracks (P4)", () => {
  it("lists the curated packs with progress through each curated list", async () => {
    const r = await call<TracksResponse>("GET", "/tracks");
    expect(r.status).toBe(200);
    expect(r.body.tracks.map((x) => x.slug)).toContain("product-high-bar");
    expect(r.body.tracks.length).toBe(5);
    for (const track of r.body.tracks) {
      expect(track.total).toBeGreaterThan(0);
      expect(track).toMatchObject({ solved: 0, started: false });
    }
  });

  it("describes a track: process, heatmap, curated problems and the practice setup", async () => {
    const r = (await call<TrackDto>("GET", "/tracks/product-high-bar")).body;
    expect(r.process.length).toBeGreaterThan(2);
    expect(r.disclaimer).toMatch(/not an official/i);
    expect(r.heatmap[0]!.weight).toBeGreaterThanOrEqual(r.heatmap.at(-1)!.weight);
    expect(r.heatmap[0]!.heat).toBeGreaterThanOrEqual(4);
    expect(r.problems.length).toBeGreaterThan(0);
    expect(r.problems.every((p) => !p.solved)).toBe(true);
    expect(r.readiness.score).toBeNull();
    expect(r.interview.href).toBe("/interview/new?pack=product-high-bar");
    expect(r.interview.types).toContain("dsa");
    expect(r.planHref).toBe("/plan?pack=product-high-bar");
    expect(r.checklist.length).toBeGreaterThan(0);

    // the same learner sees the same list every time
    const again = (await call<TrackDto>("GET", "/tracks/product-high-bar")).body;
    expect(again.problems.map((p) => p.slug)).toEqual(r.problems.map((p) => p.slug));
  });

  it("solving a curated problem moves the track's progress", async () => {
    const before = (await call<TrackDto>("GET", "/tracks/product-high-bar")).body;
    const target = before.problems[0]!;
    await solveProblem(t, ada, target.slug);
    const after = (await call<TrackDto>("GET", "/tracks/product-high-bar")).body;
    expect(after.solved).toBe(1);
    expect(after.problems.find((p) => p.slug === target.slug)?.solved).toBe(true);
    // another learner is not affected
    expect((await call<TrackDto>("GET", "/tracks/product-high-bar", bob)).body.solved).toBe(0);
  });

  it("starting a track builds a plan around the company, and is safe to repeat", async () => {
    const r = await call<StartTrackResponse>("POST", "/tracks/it-services/start");
    expect(r.status).toBe(201);
    expect(r.body.planCreated).toBe(true);
    expect(r.body.track.started).toBe(true);
    const plan = (await call<{ plan: PlanDto }>("GET", "/me/plan")).body.plan;
    expect(plan.target).toBe("it-services");

    const again = await call<StartTrackResponse>("POST", "/tracks/it-services/start");
    expect(again.status).toBe(201);
    expect((await t.pool.query(`SELECT 1 FROM user_tracks`)).rowCount).toBe(1);
    expect(
      (await call<TracksResponse>("GET", "/tracks")).body.tracks.find(
        (x) => x.slug === "it-services",
      )?.started,
    ).toBe(true);
  });

  it("the overlap of two tracks is the plain set intersection of their curated lists", async () => {
    const a = (await call<TrackDto>("GET", "/tracks/product-high-bar")).body;
    const b = (await call<TrackDto>("GET", "/tracks/it-services")).body;
    const sa = new Set(a.problems.map((p) => p.slug));
    const sb = new Set(b.problems.map((p) => p.slug));
    const shared = [...sa].filter((s) => sb.has(s)).sort();

    const r = (
      await call<TrackCompareResponse>("GET", "/tracks/compare?a=product-high-bar&b=it-services")
    ).body;
    expect(r.shared.map((p) => p.slug)).toEqual(shared);
    expect(r.onlyA.map((p) => p.slug)).toEqual([...sa].filter((s) => !sb.has(s)).sort());
    expect(r.onlyB.map((p) => p.slug)).toEqual([...sb].filter((s) => !sa.has(s)).sort());
    expect(r.coversB).toBeCloseTo(shared.length / sb.size);
    expect(r.addForB).toHaveLength(r.onlyB.length);

    // what you already solved is not suggested for B
    if (r.onlyB[0]) {
      await solveProblem(t, ada, r.onlyB[0].slug);
      const after = (
        await call<TrackCompareResponse>("GET", "/tracks/compare?a=product-high-bar&b=it-services")
      ).body;
      expect(after.addForB).toHaveLength(r.onlyB.length - 1);
    }
  });

  it("hides unknown and unverified tracks and requires signing in", async () => {
    expect((await call("GET", "/tracks/nope")).status).toBe(404);
    expect((await call("POST", "/tracks/nope/start")).status).toBe(404);
    expect((await call("GET", "/tracks/compare?a=nope&b=it-services")).status).toBe(404);
    expect((await call("GET", "/tracks/compare?a=it-services")).status).toBe(422);
    await t.pool.query(
      `UPDATE company_packs SET provisional = true WHERE slug = 'fintech-systems'`,
    );
    try {
      expect((await call("GET", "/tracks/fintech-systems")).status).toBe(404);
      expect(
        (await call<TracksResponse>("GET", "/tracks")).body.tracks.map((x) => x.slug),
      ).not.toContain("fintech-systems");
    } finally {
      await t.pool.query(
        `UPDATE company_packs SET provisional = false WHERE slug = 'fintech-systems'`,
      );
    }
    expect((await call("GET", "/tracks", null)).status).toBe(401);
  });
});
