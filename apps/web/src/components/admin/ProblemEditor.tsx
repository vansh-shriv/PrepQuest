"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, Chip, Dialog, Input, LoadingBar, Tabs, Textarea, Window } from "@prepquest/ui";
import {
  CONTENT_ROLES,
  type AdminProblemDetail,
  type AuditEntry,
  type TagFacets,
  type ValidationReport,
  type VersionInfo,
} from "@prepquest/shared";
import { api, ApiError, apiUpload } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSubmit } from "@/lib/use-submit";
import { Markdown } from "../problems/Markdown";
import { FormError } from "../auth/AuthCard";
import { STATUS_LABEL, STATUS_TONE } from "./AdminProblemList";
import { TagPicker } from "./TagPicker";

type Detail = AdminProblemDetail;
type OnSaved = (d: Detail) => void;

const CHECK_TONE = { pass: "easy", fail: "hard", warn: "medium", skip: "neutral" } as const;
const CHECK_TEXT = { pass: "pass", fail: "fail", warn: "warn", skip: "later" } as const;

// ---------------------------------------------------------------- tabs

function MetaTab({ d, onSaved }: { d: Detail; onSaved: OnSaved }) {
  const [facets, setFacets] = useState<TagFacets | null>(null);
  const [title, setTitle] = useState(d.title);
  const [difficulty, setDifficulty] = useState<string>(d.difficulty);
  const [estMinutes, setEstMinutes] = useState(String(d.estMinutes ?? ""));
  const [topics, setTopics] = useState(d.topics);
  const [patterns, setPatterns] = useState(d.patterns);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    void api<TagFacets>("/tags?all=1")
      .then(setFacets)
      .catch(() => setFacets({ topics: [], patterns: [] }));
  }, []);
  const { run, pending, error, fields } = useSubmit(async () => {
    onSaved(
      await api<Detail>(`/admin/problems/${d.id}`, {
        method: "PATCH",
        json: { title, difficulty, estMinutes: Number(estMinutes), topics, patterns },
      }),
    );
    setSaved(true);
  });
  const touch = () => setSaved(false);
  return (
    <form
      className="grid max-w-2xl gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <Input
        label="Title"
        value={title}
        onChange={(e) => {
          touch();
          setTitle(e.target.value);
        }}
        error={fields.title}
        disabled={!d.permissions.edit}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="pq-field">
          <span className="pq-label">Difficulty</span>
          <select
            className="pq-input pq-select"
            value={difficulty}
            disabled={!d.permissions.edit}
            onChange={(e) => {
              touch();
              setDifficulty(e.target.value);
            }}
          >
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </label>
        <Input
          label="Estimated minutes"
          inputMode="numeric"
          value={estMinutes}
          onChange={(e) => {
            touch();
            setEstMinutes(e.target.value);
          }}
          error={fields.estMinutes}
          disabled={!d.permissions.edit}
        />
      </div>
      <TagPicker
        label="Topics"
        options={(facets?.topics ?? []).map((t) => ({ slug: t.slug, name: t.name }))}
        value={topics}
        onChange={(v) => {
          touch();
          setTopics(v);
        }}
        error={fields.topics}
      />
      <TagPicker
        label="Patterns"
        options={(facets?.patterns ?? []).map((t) => ({ slug: t.slug, name: t.name }))}
        value={patterns}
        onChange={(v) => {
          touch();
          setPatterns(v);
        }}
      />
      <FormError message={error} />
      <div className="flex items-center gap-4">
        <Button type="submit" loading={pending} disabled={!d.permissions.edit}>
          Save
        </Button>
        {saved ? <span role="status">Saved!</span> : null}
      </div>
    </form>
  );
}

function StatementTab({ d, onSaved }: { d: Detail; onSaved: OnSaved }) {
  const [statement, setStatement] = useState(d.statementMd);
  const [constraints, setConstraints] = useState(d.constraintsMd ?? "");
  const [examples, setExamples] = useState(d.examples);
  const [preview, setPreview] = useState(false);
  const [saved, setSaved] = useState(false);
  const { run, pending, error } = useSubmit(async () => {
    onSaved(
      await api<Detail>(`/admin/problems/${d.id}`, {
        method: "PATCH",
        json: { statementMd: statement, constraintsMd: constraints, examples },
      }),
    );
    setSaved(true);
  });
  const edit = d.permissions.edit;
  const setExample = (i: number, patch: Partial<(typeof examples)[number]>) => {
    setSaved(false);
    setExamples((xs) => xs.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  };
  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="pq-font-ui m-0 text-sm uppercase">Statement (Markdown, math with $...$)</h2>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-pressed={preview}
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? "Edit" : "Preview"}
        </Button>
      </div>
      {preview ? (
        <div className="grid gap-4">
          <Markdown>{statement || "*Nothing yet.*"}</Markdown>
          <Markdown>{constraints}</Markdown>
        </div>
      ) : (
        <>
          <Textarea
            label="Statement"
            mono
            rows={10}
            value={statement}
            disabled={!edit}
            onChange={(e) => {
              setSaved(false);
              setStatement(e.target.value);
            }}
          />
          <Textarea
            label="Constraints"
            mono
            rows={4}
            value={constraints}
            disabled={!edit}
            onChange={(e) => {
              setSaved(false);
              setConstraints(e.target.value);
            }}
          />
        </>
      )}
      <section className="grid gap-3" aria-label="Examples">
        <h2 className="pq-font-ui m-0 text-sm uppercase">Examples ({examples.length}/5)</h2>
        {examples.map((x, i) => (
          <div key={i} className="grid gap-2 border-[3px] border-ink p-3">
            <Textarea
              label={`Example ${i + 1} input`}
              mono
              rows={2}
              value={x.input}
              disabled={!edit}
              onChange={(e) => setExample(i, { input: e.target.value })}
            />
            <Textarea
              label={`Example ${i + 1} output`}
              mono
              rows={1}
              value={x.output}
              disabled={!edit}
              onChange={(e) => setExample(i, { output: e.target.value })}
            />
            <Input
              label="Explanation (optional)"
              value={x.explanation ?? ""}
              disabled={!edit}
              onChange={(e) => setExample(i, { explanation: e.target.value })}
            />
            <div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={!edit || examples.length === 1}
                onClick={() => {
                  setSaved(false);
                  setExamples((xs) => xs.filter((_, k) => k !== i));
                }}
              >
                Remove example
              </Button>
            </div>
          </div>
        ))}
        <div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!edit || examples.length >= 5}
            onClick={() => {
              setSaved(false);
              setExamples((xs) => [...xs, { input: "", output: "" }]);
            }}
          >
            Add example
          </Button>
        </div>
      </section>
      <p className="m-0 text-sm text-ink-soft">
        Changing the statement or examples creates a new problem version.
      </p>
      <FormError message={error} />
      <div className="flex items-center gap-4">
        <Button type="submit" loading={pending} disabled={!edit}>
          Save
        </Button>
        {saved ? <span role="status">Saved!</span> : null}
      </div>
    </form>
  );
}

function StartersTab({ d, onSaved }: { d: Detail; onSaved: OnSaved }) {
  const [limits, setLimits] = useState({
    timeLimitMs: String(d.limits.timeLimitMs),
    memoryLimitKb: String(d.limits.memoryLimitKb),
  });
  const [starters, setStarters] = useState(d.starters);
  const [saved, setSaved] = useState(false);
  const { run, pending, error, fields } = useSubmit(async () => {
    onSaved(
      await api<Detail>(`/admin/problems/${d.id}`, {
        method: "PATCH",
        json: {
          limits: {
            timeLimitMs: Number(limits.timeLimitMs),
            memoryLimitKb: Number(limits.memoryLimitKb),
          },
          starters,
        },
      }),
    );
    setSaved(true);
  });
  const edit = d.permissions.edit;
  return (
    <form
      className="grid gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      <div className="grid max-w-xl gap-4 sm:grid-cols-2">
        <Input
          label="C++ time limit (ms)"
          inputMode="numeric"
          value={limits.timeLimitMs}
          disabled={!edit}
          error={fields["limits.timeLimitMs"]}
          onChange={(e) => {
            setSaved(false);
            setLimits((l) => ({ ...l, timeLimitMs: e.target.value }));
          }}
          helper="Java: 2x + 300 ms. Python: 5x."
        />
        <Input
          label="Memory limit (KB)"
          inputMode="numeric"
          value={limits.memoryLimitKb}
          disabled={!edit}
          error={fields["limits.memoryLimitKb"]}
          onChange={(e) => {
            setSaved(false);
            setLimits((l) => ({ ...l, memoryLimitKb: e.target.value }));
          }}
          helper="Java gets 2x."
        />
      </div>
      {(["cpp", "java", "python"] as const).map((lang) => (
        <Textarea
          key={lang}
          label={`Starter code: ${lang}`}
          mono
          rows={8}
          value={starters[lang]}
          disabled={!edit}
          onChange={(e) => {
            setSaved(false);
            setStarters((s) => ({ ...s, [lang]: e.target.value }));
          }}
        />
      ))}
      <FormError message={error} />
      <div className="flex items-center gap-4">
        <Button type="submit" loading={pending} disabled={!edit}>
          Save
        </Button>
        {saved ? <span role="status">Saved!</span> : null}
      </div>
    </form>
  );
}

function TestsTab({
  d,
  onSaved,
  onChanged,
}: {
  d: Detail;
  onSaved: OnSaved;
  onChanged: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [issues, setIssues] = useState<Array<{ level: string; message: string }>>([]);
  const [result, setResult] = useState<string | null>(null);
  const upload = useSubmit(async () => {
    if (!file) return;
    setIssues([]);
    setResult(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const r = await apiUpload<{ version: number; tests: number; warnings: string[] }>(
        `/admin/problems/${d.id}/tests/upload`,
        form,
      );
      setResult(
        `Uploaded ${r.tests} tests as version ${r.version}.${r.warnings.length ? ` Warnings: ${r.warnings.join("; ")}` : ""}`,
      );
      onSaved(await api<Detail>(`/admin/problems/${d.id}`));
      onChanged();
    } catch (err) {
      if (err instanceof ApiError) {
        const found = (
          err.details as { issues?: Array<{ level: string; message: string }> } | undefined
        )?.issues;
        if (found?.length) setIssues(found);
      }
      throw err;
    }
  });
  return (
    <div className="grid gap-5">
      <section className="grid gap-3">
        <h2 className="pq-font-ui m-0 text-sm uppercase">Upload tests</h2>
        <p className="m-0 text-sm text-ink-soft">
          A zip with <code>manifest.json</code> and numbered files <code>01.in</code>,{" "}
          <code>01.out</code>, ... in its root. Every input is checked against the function
          signature. A good zip replaces the tests with a new version.
        </p>
        <form
          className="grid max-w-xl gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void upload.run();
          }}
        >
          <label className="pq-field">
            <span className="pq-label">Zip file</span>
            <input
              type="file"
              accept=".zip,application/zip"
              disabled={!d.permissions.uploadTests}
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="pq-input"
              style={{ height: "auto", padding: 10 }}
            />
          </label>
          <FormError message={upload.error} />
          {issues.length ? (
            <ul className="m-0 list-none p-0" aria-label="Problems found in the zip">
              {issues.map((i, k) => (
                <li key={k} className="text-danger">
                  ! {i.message}
                </li>
              ))}
            </ul>
          ) : null}
          {result ? (
            <p role="status" className="m-0">
              {result}
            </p>
          ) : null}
          <div>
            <Button
              type="submit"
              loading={upload.pending}
              disabled={!file || !d.permissions.uploadTests}
            >
              Upload
            </Button>
          </div>
        </form>
      </section>
      <section className="grid gap-2">
        <h2 className="pq-font-ui m-0 text-sm uppercase">Current tests ({d.testCases.length})</h2>
        <div className="max-h-96 overflow-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="pq-sr-only">Tests of the current version</caption>
            <thead>
              <tr>
                {["#", "Kind", "Label", "Weight", "Input size"].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="pq-font-ui bg-olive px-2 py-1 text-xs uppercase text-[var(--on-olive)]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.testCases.map((t) => (
                <tr key={t.ordinal} className="border-b-2 border-ink">
                  <td className="px-2 py-1">{t.ordinal}</td>
                  <td className="px-2 py-1">{t.kind}</td>
                  <td className="px-2 py-1">{t.label ?? ""}</td>
                  <td className="px-2 py-1">{t.weight}</td>
                  <td className="px-2 py-1">{t.inputBytes !== null ? `${t.inputBytes} B` : ""}</td>
                </tr>
              ))}
              {d.testCases.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-2 py-4 text-center">
                    No tests yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function VersionsTab({ id, refreshKey }: { id: string; refreshKey: number }) {
  const [items, setItems] = useState<VersionInfo[] | null>(null);
  useEffect(() => {
    void api<{ items: VersionInfo[] }>(`/admin/problems/${id}/versions`).then((r) =>
      setItems(r.items),
    );
  }, [id, refreshKey]);
  if (!items) return <LoadingBar label="Loading" />;
  return (
    <ul className="m-0 grid list-none gap-2 p-0" aria-label="Versions">
      {items.map((v) => (
        <li key={v.version} className="flex flex-wrap items-center gap-3">
          <Chip tone={v.current ? "easy" : "neutral"}>
            v{v.version}
            {v.current ? " (current)" : ""}
          </Chip>
          <span>{v.changeNote ?? ""}</span>
          <span className="text-sm text-ink-soft">
            {v.tests !== null ? `${v.tests} tests, ` : ""}
            {new Date(v.createdAt).toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}

function AuditTab({ id, refreshKey }: { id: string; refreshKey: number }) {
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  useEffect(() => {
    void api<{ items: AuditEntry[] }>(`/admin/audit?entityId=${id}`).then((r) => setItems(r.items));
  }, [id, refreshKey]);
  if (!items) return <LoadingBar label="Loading" />;
  return (
    <ul className="m-0 grid list-none gap-2 p-0" aria-label="Audit log">
      {items.map((e) => (
        <li key={e.id} className="grid gap-0">
          <span>
            <strong>{e.action}</strong>{" "}
            <span className="text-sm text-ink-soft">
              by {e.actorRole}, {new Date(e.createdAt).toLocaleString()}
            </span>
          </span>
          {e.reason ? <span className="text-sm">Reason: {e.reason}</span> : null}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- editor

export function ProblemEditor({ id }: { id: string }) {
  const { user } = useAuth();
  const [d, setD] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [report, setReport] = useState<ValidationReport | null>(null);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [tick, setTick] = useState(0);

  const load = useCallback(async () => {
    try {
      setD(await api<Detail>(`/admin/problems/${id}`));
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.status === 404
          ? "That problem doesn't exist."
          : "Couldn't load the problem.",
      );
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const saved: OnSaved = (next) => {
    setD(next);
    setReport(null);
    setTick((t) => t + 1);
  };

  const validate = useSubmit(async () => {
    setReport(await api<ValidationReport>(`/admin/problems/${id}/validation`));
  });
  const step = useSubmit(async (action: "submit-review" | "publish" | "archive", body?: object) => {
    saved(
      await api<Detail>(`/admin/problems/${id}/${action}`, { method: "POST", json: body ?? {} }),
    );
    setArchiveOpen(false);
    setReason("");
  });

  if (loadError)
    return (
      <Window title="Error" tone="danger">
        {loadError}{" "}
        <Link href="/admin/problems" className="underline">
          Back to the list
        </Link>
      </Window>
    );
  if (!d) return <LoadingBar label="Loading" />;

  const canSeeAudit = user
    ? user.role !== "content_editor" && (CONTENT_ROLES as readonly string[]).includes(user.role)
    : false;
  const tabs = [
    { id: "meta", label: "Meta", content: <MetaTab d={d} onSaved={saved} /> },
    { id: "statement", label: "Statement", content: <StatementTab d={d} onSaved={saved} /> },
    { id: "starters", label: "Starters", content: <StartersTab d={d} onSaved={saved} /> },
    {
      id: "tests",
      label: "Tests",
      content: <TestsTab d={d} onSaved={saved} onChanged={() => setTick((t) => t + 1)} />,
    },
    { id: "versions", label: "Versions", content: <VersionsTab id={id} refreshKey={tick} /> },
    ...(canSeeAudit
      ? [{ id: "audit", label: "Audit", content: <AuditTab id={id} refreshKey={tick} /> }]
      : []),
  ];

  return (
    <div className="grid gap-6">
      <div>
        <Link href="/admin/problems" className="text-sm underline">
          All problems
        </Link>
        <h1 className="pq-font-display m-0 mt-2 text-base leading-relaxed">{d.title}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Chip tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Chip>
          <Chip>v{d.version}</Chip>
          <Chip>{d.slug}</Chip>
          <Chip>{d.tests} tests</Chip>
        </div>
      </div>

      <Window title="Workflow" tone="olive">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="ghost"
            loading={validate.pending}
            onClick={() => void validate.run()}
          >
            Run checks
          </Button>
          {d.permissions.submitReview ? (
            <Button size="sm" loading={step.pending} onClick={() => void step.run("submit-review")}>
              Submit for review
            </Button>
          ) : null}
          {d.permissions.publish ? (
            <Button
              size="sm"
              variant="accent"
              loading={step.pending}
              onClick={() => void step.run("publish")}
            >
              Publish
            </Button>
          ) : null}
          {d.permissions.archive ? (
            <Button size="sm" variant="danger" onClick={() => setArchiveOpen(true)}>
              Archive
            </Button>
          ) : null}
          {!d.permissions.edit && d.status === "in_review" ? (
            <span className="text-sm">Waiting for a reviewer.</span>
          ) : null}
        </div>
        <FormError message={step.error ?? validate.error} />
        {report ? (
          <ul className="m-0 mt-4 grid list-none gap-2 p-0" aria-label="Validation checks">
            {report.checks.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <Chip tone={CHECK_TONE[c.status]}>{CHECK_TEXT[c.status]}</Chip>
                <span>{c.label}</span>
                {c.detail ? <span className="text-sm text-ink-soft">({c.detail})</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
      </Window>

      <Tabs aria-label="Problem editor" items={tabs} />

      <Dialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title="Archive problem"
        tone="danger"
      >
        <p className="mt-0">
          Archived problems leave the lists but stay reachable for old submissions. A reason is
          recorded in the audit log.
        </p>
        <Textarea
          label="Reason"
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <FormError message={step.error} />
        <div className="mt-3 flex gap-3">
          <Button
            variant="danger"
            loading={step.pending}
            disabled={reason.trim().length < 5}
            onClick={() => void step.run("archive", { reason })}
          >
            Archive
          </Button>
          <Button variant="ghost" onClick={() => setArchiveOpen(false)}>
            Cancel
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
