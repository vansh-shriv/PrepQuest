import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";

// Runs SQL against a throwaway in-memory SQLite database (sql.js, WebAssembly) inside a worker thread.
// Every call builds the dataset from scratch, so nothing persists between runs and nothing can reach the
// host: there is no file system, network or extension loading. A query that runs too long is killed by
// terminating the worker (the statement timeout).

export interface Dataset {
  schema: string;
  seed: string;
}

export interface QueryResult {
  ok: boolean;
  columns: string[];
  /** At most `maxRows` rows. Blobs are shown as text. */
  rows: Array<Array<string | number | null>>;
  /** More rows existed than were returned. */
  truncated: boolean;
  ms: number;
  error?: string;
  timedOut?: boolean;
}

export interface TableInfo {
  name: string;
  columns: Array<{ name: string; type: string; pk: boolean; notNull: boolean }>;
  rowCount: number;
  preview: Array<Array<string | number | null>>;
}

export const MAX_ROWS = 1000;
/** Time allowed for a query; building the dataset gets `SETUP_MS` on top. */
export const STATEMENT_MS = 3000;
const SETUP_MS = 2000;

const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const initSqlJs = require(workerData.base);
const cell = (v) => (v instanceof Uint8Array ? "[blob " + v.length + " bytes]" : v === undefined ? null : v);
(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  try {
    db.run(workerData.schema);
    db.run(workerData.seed);
    db.run("PRAGMA query_only = ON");
  } catch (e) {
    parentPort.postMessage({ setupError: String(e && e.message || e) });
    return;
  }
  if (workerData.mode === "describe") {
    const tables = [];
    const names = db.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    for (const [name] of (names[0] ? names[0].values : [])) {
      const info = db.exec('PRAGMA table_info("' + name + '")');
      const columns = (info[0] ? info[0].values : []).map((r) => ({ name: r[1], type: r[2], notNull: !!r[3], pk: !!r[5] }));
      const count = db.exec('SELECT count(*) FROM "' + name + '"')[0].values[0][0];
      const prev = db.exec('SELECT * FROM "' + name + '" LIMIT ' + workerData.maxRows);
      tables.push({ name, columns, rowCount: count, preview: prev[0] ? prev[0].values.map((r) => r.map(cell)) : [] });
    }
    parentPort.postMessage({ tables });
    return;
  }
  const started = Date.now();
  try {
    const stmt = db.prepare(workerData.query);
    const columns = stmt.getColumnNames();
    const rows = [];
    let truncated = false;
    while (stmt.step()) {
      if (rows.length >= workerData.maxRows) { truncated = true; break; }
      rows.push(stmt.get().map(cell));
    }
    stmt.free();
    parentPort.postMessage({ ok: true, columns, rows, truncated, ms: Date.now() - started });
  } catch (e) {
    parentPort.postMessage({ ok: false, columns: [], rows: [], truncated: false, ms: Date.now() - started, error: String(e && e.message || e) });
  }
})();
`;

// Resolve sql.js relative to this package, whichever way it is loaded (dist, tsx or vitest).
const base = createRequire(import.meta.url).resolve("sql.js");
const loaderPath = base;

function launch<T>(workerData: Record<string, unknown>, timeoutMs: number): Promise<T | "timeout"> {
  return new Promise((resolve) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { ...workerData, base: loaderPath },
      resourceLimits: { maxOldGenerationSizeMb: 192 },
    });
    let done = false;
    const finish = (v: T | "timeout") => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(v);
    };
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    worker.once("message", (m: T) => finish(m));
    worker.once("error", (e: Error) =>
      finish({
        ok: false,
        columns: [],
        rows: [],
        truncated: false,
        ms: 0,
        error: /memory/i.test(String(e)) ? "The query used too much memory." : String(e.message),
      } as T),
    );
  });
}

type RunMessage = QueryResult & { setupError?: string };

/** Runs one query on a fresh copy of the dataset. The query must already have passed the SQL guard. */
export async function runQuery(
  dataset: Dataset,
  query: string,
  opts: { maxRows?: number; timeoutMs?: number } = {},
): Promise<QueryResult> {
  const timeoutMs = opts.timeoutMs ?? STATEMENT_MS;
  const r = await launch<RunMessage>(
    { ...dataset, query, mode: "run", maxRows: opts.maxRows ?? MAX_ROWS },
    timeoutMs + SETUP_MS,
  );
  if (r === "timeout") {
    return {
      ok: false,
      columns: [],
      rows: [],
      truncated: false,
      ms: timeoutMs,
      timedOut: true,
      error: `The query took longer than ${timeoutMs / 1000} seconds and was stopped.`,
    };
  }
  if (r.setupError) {
    return { ok: false, columns: [], rows: [], truncated: false, ms: 0, error: r.setupError };
  }
  return r;
}

/** Tables, columns and a few rows of each, for the schema explorer. */
export async function describeDataset(dataset: Dataset, previewRows = 5): Promise<TableInfo[]> {
  const r = await launch<{ tables?: TableInfo[]; setupError?: string }>(
    { ...dataset, mode: "describe", maxRows: previewRows },
    STATEMENT_MS + SETUP_MS,
  );
  if (r === "timeout" || !r.tables) {
    throw new Error(
      r === "timeout" ? "dataset took too long to build" : (r.setupError ?? "failed"),
    );
  }
  return r.tables;
}
