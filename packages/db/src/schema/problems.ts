import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { timestamps, tsvector } from "./columns.js";
import { users } from "./identity.js";

// Problem bank (D1, D2, D4, D5, X7). Doc 10 §2.2.

export const difficulty = pgEnum("difficulty", ["easy", "medium", "hard"]);
export const publishStatus = pgEnum("publish_status", [
  "draft",
  "in_review",
  "published",
  "archived",
]);

export interface ProblemExample {
  input: string;
  output: string;
  explanation?: string;
}

export const problems = pgTable(
  "problems",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    statementMd: text("statement_md").notNull(),
    constraintsMd: text("constraints_md"),
    difficulty: difficulty("difficulty").notNull(),
    examples: jsonb("examples").$type<ProblemExample[]>().notNull(),
    checker: text("checker").notNull().default("exact"),
    checkerConfig: jsonb("checker_config").$type<Record<string, unknown>>(),
    estMinutes: integer("est_minutes"),
    acceptanceRate: numeric("acceptance_rate", { precision: 5, scale: 2 }).notNull().default("0"),
    submissionsCount: integer("submissions_count").notNull().default(0),
    acceptedCount: integer("accepted_count").notNull().default(0),
    source: text("source"),
    license: text("license"),
    status: publishStatus("status").notNull().default("draft"),
    currentVersion: integer("current_version").notNull().default(1),
    /** Full-text vector (title weighted above statement), maintained by a trigger. */
    search: tsvector("search"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    check("problems_checker_check", sql`${t.checker} IN ('exact','tokens','float','special')`),
    index("problems_search_idx").using("gin", t.search),
    index("problems_title_trgm").using("gin", t.title.op("gin_trgm_ops")),
    index("problems_filter_idx").on(t.status, t.difficulty),
  ],
);

export const problemVersions = pgTable(
  "problem_versions",
  {
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    changedBy: uuid("changed_by").references(() => users.id, { onDelete: "set null" }),
    changeNote: text("change_note"),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.problemId, t.version] })],
);

export const tags = pgTable(
  "tags",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => tags.id),
    ...timestamps,
  },
  (t) => [check("tags_kind_check", sql`${t.kind} IN ('topic','pattern')`)],
);

export const problemTags = pgTable(
  "problem_tags",
  {
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.problemId, t.tagId] }),
    index("problem_tags_tag_idx").on(t.tagId),
  ],
);

export const companies = pgTable("companies", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  packId: uuid("pack_id"),
  ...timestamps,
});

export const problemCompanies = pgTable(
  "problem_companies",
  {
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    frequency: smallint("frequency").notNull().default(1),
    lastSeenYear: smallint("last_seen_year"),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.problemId, t.companyId] })],
);

/** Per-language limits and templates. `driverCode` is the hidden harness for function-style problems. */
export const problemLanguages = pgTable(
  "problem_languages",
  {
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    language: text("language").notNull(), // cpp | java | python
    timeLimitMs: integer("time_limit_ms").notNull(),
    memoryLimitKb: integer("memory_limit_kb").notNull(),
    starterCode: text("starter_code").notNull(),
    driverCode: text("driver_code"),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.problemId, t.language] })],
);

export const testCases = pgTable(
  "test_cases",
  {
    id: uuid("id").primaryKey(),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    ordinal: integer("ordinal").notNull(),
    kind: text("kind").notNull(),
    label: text("label"), // shown on failure: "edge: empty input"
    inputKey: text("input_key").notNull(), // object storage keys
    outputKey: text("output_key").notNull(),
    inputBytes: integer("input_bytes"),
    weight: integer("weight").notNull().default(1),
    ...timestamps,
  },
  (t) => [
    check("test_cases_kind_check", sql`${t.kind} IN ('sample','hidden','edge','stress')`),
    unique("test_cases_problem_version_ordinal_key").on(t.problemId, t.version, t.ordinal),
  ],
);

export const hints = pgTable(
  "hints",
  {
    id: uuid("id").primaryKey(),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    tier: smallint("tier").notNull(),
    bodyMd: text("body_md").notNull(),
    ...timestamps,
  },
  (t) => [
    check("hints_tier_check", sql`${t.tier} BETWEEN 1 AND 3`),
    unique("hints_problem_tier_key").on(t.problemId, t.tier),
  ],
);

export interface EditorialApproach {
  name: string;
  intuition: string;
  steps: string[];
  code: Record<string, string>;
  time: string;
  space: string;
  pitfalls?: string[];
}

export const editorials = pgTable("editorials", {
  id: uuid("id").primaryKey(),
  problemId: uuid("problem_id")
    .notNull()
    .unique()
    .references(() => problems.id, { onDelete: "cascade" }),
  approaches: jsonb("approaches").$type<EditorialApproach[]>().notNull(),
  talkTrackMd: text("talk_track_md"),
  relatedProblemIds: uuid("related_problem_ids").array(),
  ...timestamps,
});

export const sheets = pgTable(
  "sheets",
  {
    id: uuid("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    visibility: text("visibility").notNull().default("public"),
    companyId: uuid("company_id").references(() => companies.id),
    version: integer("version").notNull().default(1),
    ...timestamps,
  },
  (t) => [check("sheets_visibility_check", sql`${t.visibility} IN ('public','private')`)],
);

export const sheetProblems = pgTable(
  "sheet_problems",
  {
    sheetId: uuid("sheet_id")
      .notNull()
      .references(() => sheets.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id),
    section: text("section"),
    ordinal: integer("ordinal").notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.sheetId, t.problemId] })],
);
