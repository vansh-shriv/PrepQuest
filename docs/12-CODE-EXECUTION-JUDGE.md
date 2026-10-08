# 12. Code Execution and Judge Design

Covers **D3**, **G1**, **X4** (empirical analyzer), **C1** (SQL runner), **X2** (fingerprints), and the sandbox security model.

## 1. Goals

1. Correct verdicts. 2. Strong isolation. 3. Low latency. 4. Horizontal scalability. 5. Fair resource use across users. 6. Reproducible results.

## 2. Components

```
API (dispatcher) ──enqueue──> Redis (BullMQ lanes) ──pull──> Judge Worker
                                                          │
                                  ┌───────────────────────┴───────────────────────┐
                                  │ Worker process (trusted, no user code)        │
                                  │  1. fetch problem+tests (object storage/cache)│
                                  │  2. prepare box dir (isolate --init)          │
                                  │  3. write source + driver                     │
                                  │  4. compile  (isolate --run, limits)          │
                                  │  5. for each test: run (isolate), capture     │
                                  │  6. check output (checker)                    │
                                  │  7. cleanup box (isolate --cleanup)           │
                                  │  8. publish progress/results                  │
                                  └───────────────────────────────────────────────┘
```

- Worker container: privileged only as needed for `isolate` (needs cgroups v2 delegation, user namespaces). Runs on **dedicated judge nodes**, separate from API/DB nodes.
- Worker has **no database credentials**. It talks to Redis (job + results) and object storage (read-only, signed URLs for test data). Results are written to the DB by a trusted **result-ingester** consuming a Redis stream.
- Each worker handles N concurrent runs where N = number of reserved cores (pin via `isolate --cg` + cpuset).

## 3. Language configuration

Stored as config (`packages/judge-core/languages.ts`) and DB `languages`:

| Lang                         | Compile                                       | Run                                            | Time multiplier                  | Memory base |
| ---------------------------- | --------------------------------------------- | ---------------------------------------------- | -------------------------------- | ----------- |
| C++17/20                     | `g++ -O2 -std=c++17 -pipe -o main main.cpp`   | `./main`                                       | 1x                               | 256 MB      |
| Java 17                      | `javac -encoding UTF-8 Main.java`             | `java -Xmx{mem} -Xss64m -XX:+UseSerialGC Main` | 2x + 0.3 s JVM startup allowance | 512 MB      |
| Python 3.11                  | none (optional `py_compile` for syntax check) | `python3 -S -B main.py`                        | 5x                               | 256 MB      |
| (P2) JavaScript, Go, Rust, C | per-language                                  |                                                |                                  |             |

Compile limits: 10 s wall, 512 MB, 64 procs; compiler output truncated at 16 KB; **no includes outside allowlist** (C++ `#include </etc/passwd>` style tricks blocked by sandbox filesystem view).

## 4. Sandbox model (`isolate`)

Per-run flags (illustrative):

```
isolate --cg -b <boxid> \
  --time=<cpu_s> --wall-time=<wall_s> --extra-time=0.5 \
  --mem=<kb> --cg-mem=<kb> --stack=<kb> \
  --fsize=<kb> --processes=<n> --open-files=<n> \
  --dir=/usr/lib=... (read-only runtime dirs) \
  --env=PATH=/usr/bin --stdin=input.txt --stdout=out.txt --stderr=err.txt \
  --meta=meta.txt --run -- ./main
```

Defaults:

| Limit             | Compile                                                                           | Run                                        |
| ----------------- | --------------------------------------------------------------------------------- | ------------------------------------------ |
| CPU time          | 10 s                                                                              | per problem × multiplier                   |
| Wall time         | 15 s                                                                              | CPU + 1 s (catches sleep/IO stalls)        |
| Memory (cgroup)   | 512 MB                                                                            | per problem (default 256 MB)               |
| Processes/threads | 64                                                                                | 1 (C++/Python), 16 for Java (JVM threads)  |
| Output size       | 16 KB                                                                             | 64 MB cap then OLE (stored tail only 4 KB) |
| File size         | 64 MB                                                                             | 1 MB                                       |
| Open files        | 64                                                                                | 32                                         |
| Network           | none (no net namespace interface)                                                 | none                                       |
| Filesystem        | box dir rw, system dirs ro, no `/proc` writes, no `/dev` except null/zero/urandom | same                                       |

Additional hardening:

- Container: rootless where feasible, `--cap-drop ALL` plus the minimal caps `isolate` needs, `seccomp` profile blocking `ptrace`, `mount`, `keyctl`, `bpf`, `perf_event_open`, `unshare` (outside isolate), `socket` families except AF_UNIX (for JVM if needed), `kexec`.
- AppArmor/SELinux profile for the worker container.
- Read-only root filesystem for the worker container; tmpfs for box area with size cap.
- Kernel: current LTS, cgroups v2, `kernel.unprivileged_userns_clone` managed deliberately; consider **gVisor/Firecracker** later for stronger isolation (ADR-002).
- No shared state between runs: new box per submission; `isolate --cleanup` always in `finally`.
- Randomized box IDs; user code can't see other boxes.
- Judge nodes have **egress firewall deny-all** except Redis, object storage, and monitoring endpoints.

## 5. Execution flow in detail

1. **Dispatch (API)**: validate size (≤ 64 KB source), language allowed, rate limits, user status, contest window if mode=contest. Create `submissions` row (QUEUED). Enqueue job `{submissionId, problemId, version, language, kind, tests: 'all'|'samples+custom', priority}`.
2. **Claim**: worker locks job (BullMQ lock, 2 min with renewal). Emits `COMPILING`.
3. **Prepare**: ensure test data cached locally (LRU on disk keyed by `problemId:version:checksum`). Write source (and hidden **driver** for function-style problems).
4. **Compile**: failure produces `CE` with trimmed compiler output (strip absolute paths).
5. **Run tests** sequentially (or parallel across cores for independent tests when worker has spare capacity; default sequential to keep timing stable):
   - Run with stdin from test input.
   - Read meta: status (`OK`, `RE`, `TO`, `SG`, `XX`), time, wall, max-rss, exit code, signal.
   - Map to verdict: `TO` → TLE; cgroup OOM or `SG` with SIGSEGV near memory limit → MLE (heuristics in doc below); other `RE`; output over cap → OLE.
   - If run OK, run **checker** (see 6).
6. **Stop policy**: for `submit`, stop at first non-AC (mark rest `SKIPPED`) unless contest mode is "full scoring"; for `run`, run all sample/custom tests and report each.
7. **Progress events** after each test: `{stage:'RUNNING', i, n}`.
8. **Finalize**: aggregate verdict (priority: CE > first failing test verdict > AC), max time and memory across tests, write to Redis stream `judge:results`; result-ingester persists, triggers events (XP, SRS, stats, contest standings, analytics invalidation).
9. **Cleanup** and ack job.

### Verdict heuristics

| Condition                                          | Verdict                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| Compile non-zero exit                              | CE                                                                 |
| isolate status TO (CPU or wall)                    | TLE                                                                |
| cgroup OOM kill flag set                           | MLE                                                                |
| Signal SIGSEGV/SIGABRT and max-rss ≥ 90% limit     | MLE (else RE)                                                      |
| Non-zero exit / other signal                       | RE (include signal name, last 2 KB stderr)                         |
| Output > cap                                       | OLE                                                                |
| Checker mismatch                                   | WA                                                                 |
| Judge infra error (isolate failure, missing files) | IE (never counted; auto-retry up to 2 times on a different worker) |

## 6. Checkers

| Type        | Behavior                                                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `exact`     | Normalize `\r\n`→`\n`, strip trailing whitespace per line and trailing blank lines, compare                                                                                         |
| `tokens`    | Whitespace-insensitive token-by-token compare                                                                                                                                       |
| `float`     | Token compare with absolute/relative epsilon (config, default 1e-6)                                                                                                                 |
| `unordered` | Compare sorted tokens/lines (e.g., set outputs)                                                                                                                                     |
| `special`   | Problem-specific checker program (testlib-style) run in sandbox with `(input, jury_output, contestant_output)`; returns AC/WA + message. Required when multiple valid answers exist |

Function-style problems (LeetCode-like): a **driver** parses input into arguments, calls user function, prints canonical output; drivers are generated per language from a problem signature schema (`packages/judge-core/drivers`). Supported param types: int, long, double, string, bool, arrays and 2D arrays of these, `ListNode`, `TreeNode`, `Node` (graph), `char[][]`, optional.

## 7. Queueing and fairness (G1)

- Lanes (priority): `contest` (P1) > `interview` (P2) > `practice-submit` (P3) > `practice-run` (P4) > `bulk` (P5: rejudge, complexity, validation).
- **Fair share**: within a lane, jobs grouped by user; scheduler picks round-robin across users (BullMQ groups or a custom weighted fair queue via Redis ZSET scoring = lane base + user's recent usage penalty).
- Worker concurrency = cores reserved; contest lane has **reserved capacity** (e.g., 30% of slots only usable by contest/interview during active contests).
- **Queue wait estimate** = (jobs ahead × moving average job time) / active slots, shown in UI.
- **Backpressure**: if wait > 20 s, API tightens per-user run rate and surfaces notice; if > 60 s, `JUDGE_BUSY` for new `run` jobs (submits still accepted).
- **Autoscale** (when on cloud VMs): scale out when avg wait > 10 s for 2 min; scale in after 10 min idle; drain on SIGTERM (finish current, stop pulling).
- **Dead-letter queue** after 3 failures; admin alert.

## 8. Test data management

- Stored in object storage as `problems/{id}/v{version}/tests/{n}.in|.out`; manifest with checksums.
- Worker local cache with LRU (e.g., 5 GB), verified via checksum.
- Hidden test content never sent to browser; only counts and optional label of first failure.
- **Validators** ensure inputs satisfy constraints; **reference solutions** produce outputs; at least one stress test at max constraints per problem; time limit derived from reference time × factor (default 3x reference, min 1 s).

## 9. Custom input runs

`run` kind compiles the same way but uses user-provided inputs; limits tighter (CPU 2 s cap or problem limit whichever smaller; input ≤ 256 KB); no checker, shows stdout/stderr.

## 10. Empirical complexity analyzer (X4)

1. After AC (required), user declares claimed time/space (optional).
2. Job `complexity-analyze` (bulk lane) uses problem's **scaling generator** (admin-provided) to create inputs at sizes `n ∈ {2^k}` within constraints (e.g., 1k to max, 8 to 12 points).
3. For each size, run the user's accepted code 3 times (take median CPU time using `isolate` meta, plus max-rss), skipping sizes beyond time limit × 3.
4. Fit models by least squares in log-log space:
   - Power-law exponent `k` for `t ≈ c·n^k` (slope), and separate fits for `n log n`, `log n`, `2^n`.
   - Choose best by adjusted R² with parsimony preference; compute confidence from R² and number of points.
5. Classification rule of thumb: slope < 0.15 → O(1) or O(log n); 0.85 to 1.15 → O(n) or O(n log n) (distinguish by comparing fits); 1.85 to 2.15 → O(n²); etc.
6. Memory analysis same way to estimate space complexity.
7. Output includes data points for the chart, best fit, claimed vs measured, caveats (noise at small n, JIT warm-up for Java, caching effects, input-dependent behavior), and static hints from AST (nested loop depth, recursion without memo).
   Static analysis: tree-sitter parse for loops/recursion; line numbers of deepest nesting.

## 11. SQL runner (C1)

- Engine: per-attempt **in-memory SQLite** or ephemeral PostgreSQL schema in a restricted role (choose SQLite for MVP due to simplicity).
- Load dataset from `schema_sql` + `seed_sql` into a fresh DB per run (≤ 50 ms for small datasets), run user query with **statement timeout 3 s**, row cap 1,000.
- For SELECT-only problems: allow only `SELECT`/`WITH`; parse statement with `sqlite3` authorizer or `pg_query` AST to reject DDL/DML/PRAGMA/ATTACH.
- Compare to expected: result set equality with configurable ordering, column name comparison optional, NULLs equal each other, numeric tolerance.
- Run inside the same judge sandbox (separate language "sql") for isolation from the API process.

## 12. Plagiarism fingerprints (X2)

After each `submit` AC in contest/interview mode, the ingester enqueues `integrity-scan`: normalize code (strip comments, normalize identifiers and literals, collapse whitespace), tokenize with tree-sitter, k-gram (k=5) winnowing hashes (window 4), store in `code_fingerprints` (GIN index). Similarity search compares against other submissions for the same problem within the contest and a corpus of reference solutions; flag if Jaccard ≥ 0.8 and code length ≥ threshold.

## 13. Observability for judge

Metrics: `judge_queue_depth{lane}`, `judge_wait_seconds`, `judge_run_seconds{lang}`, `judge_verdict_total{verdict}`, `judge_ie_total`, `judge_worker_slots_busy`, cache hit ratio for test data. Canary job every minute runs a known problem with known verdict (AC) and a known TLE program; mismatch triggers critical alert and worker drain.

## 14. Test plan for the judge (see doc 16)

- **Malicious program suite**: fork bomb, memory bomb, infinite loop, `/proc` and `/etc` reads, network calls, writing large files, stack overflow, signal tricks, `ptrace`, `mount`, symlink attacks, zombie processes, long stderr/stdout flood, time-measuring side channels. All must be contained with correct verdicts and zero host impact.
- **Determinism**: same code + test gives consistent verdict across workers (timing within tolerance).
- **Reference suite**: 150 seed problems × reference solutions in all languages = AC; known-wrong solutions = expected verdicts.
