"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Input, LoadingBar, Select, Sprite } from "@prepquest/ui";
import {
  isTerminal,
  type DiffLine,
  type SubmissionDetail,
  type SubmissionListResponse,
} from "@prepquest/shared";
import { api, ApiError } from "@/lib/api";
import { ResultPanel } from "@/components/problems/ResultPanel";
import { LANGUAGE_SHORT } from "@/components/problems/SubmissionHistory";
import { CodeLines } from "./CodeLines";
import { ComplexityPanel } from "@/components/review/ComplexityPanel";
import { ReviewPanel } from "@/components/review/ReviewPanel";

interface DiffResponse {
  before: { id: string; createdAt: string; verdict: string };
  after: { id: string; createdAt: string; verdict: string };
  lines: DiffLine[];
}

/** One submission (U2): verdict, per-test results, saved code, a note, and a diff against an earlier attempt. */
export function SubmissionDetailView({ id }: { id: string }) {
  const router = useRouter();
  const [sub, setSub] = useState<SubmissionDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [note, setNote] = useState("");
  const [noteState, setNoteState] = useState<"idle" | "saved" | "error">("idle");
  const [others, setOthers] = useState<SubmissionListResponse["items"]>([]);
  const [against, setAgainst] = useState("");
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    api<SubmissionDetail>(`/submissions/${id}`)
      .then(async (s) => {
        if (!alive) return;
        setSub(s);
        setNote(s.note ?? "");
        const list = await api<SubmissionListResponse>(
          `/me/submissions?problem=${s.problem.slug}&kind=all&limit=50`,
        );
        if (alive) setOthers(list.items.filter((o) => o.id !== id));
      })
      .catch((err: unknown) => {
        if (alive && err instanceof ApiError && err.status === 404) setMissing(true);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    if (!against) {
      setDiff(null);
      return;
    }
    let alive = true;
    api<DiffResponse>(`/submissions/${id}/diff?against=${against}`)
      .then((d) => alive && setDiff(d))
      .catch(() => alive && setDiff(null));
    return () => {
      alive = false;
    };
  }, [id, against]);

  if (missing) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
        <Sprite name="dino" scale={6} label="Dino" />
        <h1 className="pq-font-display m-0 text-base leading-relaxed">NOT FOUND</h1>
        <Link href="/submissions" className="underline">
          Back to submissions
        </Link>
      </div>
    );
  }
  if (!sub) return <LoadingBar label="Loading submission" />;

  const saveNote = async () => {
    if (note.trim() === (sub.note ?? "")) return;
    try {
      const saved = await api<{ note: string | null }>(`/submissions/${id}/note`, {
        method: "PATCH",
        json: { note: note.trim() === "" ? null : note.trim() },
      });
      setSub({ ...sub, note: saved.note });
      setNoteState("saved");
    } catch {
      setNoteState("error");
    }
  };

  const loadIntoEditor = () => {
    if (!sub.code) return;
    try {
      sessionStorage.setItem(
        `pq:load-code:${sub.problem.slug}`,
        JSON.stringify({ code: sub.code, language: sub.language }),
      );
    } catch {
      /* storage blocked: the editor just opens normally */
    }
    router.push(`/problems/${sub.problem.slug}`);
  };

  const copy = async () => {
    if (!sub.code) return;
    try {
      await navigator.clipboard.writeText(sub.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <header className="grid gap-1">
        <Link href="/submissions" className="pq-font-ui text-xs uppercase underline">
          All submissions
        </Link>
        <h1 className="pq-font-display m-0 text-base leading-relaxed">
          <Link href={`/problems/${sub.problem.slug}`} className="underline">
            {sub.problem.title}
          </Link>
        </h1>
        <p className="m-0 text-sm text-ink-soft">
          {LANGUAGE_SHORT[sub.language]} · {sub.kind === "run" ? "run" : "submission"} ·{" "}
          <time dateTime={sub.createdAt}>{new Date(sub.createdAt).toLocaleString()}</time>
        </p>
      </header>

      <ResultPanel
        state={{ phase: "done", kind: sub.kind, submission: sub, queuePosition: null, error: null }}
      />

      <section className="grid gap-2" aria-labelledby="note-h">
        <h2 id="note-h" className="pq-font-ui m-0 text-sm uppercase">
          Note
        </h2>
        <Input
          label="What did you learn from this attempt?"
          value={note}
          maxLength={500}
          onChange={(e) => {
            setNote(e.target.value);
            setNoteState("idle");
          }}
          onBlur={() => void saveNote()}
          helper={
            noteState === "saved"
              ? "Saved"
              : noteState === "error"
                ? "Couldn't save"
                : "Saved when you leave the box"
          }
        />
      </section>

      {sub.code !== undefined ? (
        <section className="grid gap-2" aria-labelledby="code-h">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="code-h" className="pq-font-ui m-0 text-sm uppercase">
              Your code
            </h2>
            <span className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => void copy()}>
                {copied ? "Copied" : "Copy"}
              </Button>
              <Button size="sm" onClick={loadIntoEditor}>
                Open in editor
              </Button>
            </span>
          </div>
          <pre
            className="m-0 max-h-96 overflow-auto bg-surface-alt p-3 text-sm"
            style={{ fontFamily: "var(--font-code)" }}
            tabIndex={0}
            aria-label="Submitted code"
          >
            {sub.code}
          </pre>
        </section>
      ) : null}

      {sub.code !== undefined && isTerminal(sub.verdict) ? (
        <>
          <ReviewPanel
            submissionId={id}
            slug={sub.problem.slug}
            language={sub.language}
            code={sub.code}
          />
          {sub.verdict !== "CE" && sub.verdict !== "IE" ? (
            <ComplexityPanel submissionId={id} />
          ) : null}
        </>
      ) : null}

      {others.length > 0 ? (
        <section className="grid gap-2" aria-labelledby="diff-h">
          <h2 id="diff-h" className="pq-font-ui m-0 text-sm uppercase">
            Compare
          </h2>
          <Select
            label="Compare with an earlier attempt"
            value={against}
            onChange={(e) => setAgainst(e.target.value)}
          >
            <option value="">Choose an attempt</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {new Date(o.createdAt).toLocaleString()} · {o.verdict} ·{" "}
                {LANGUAGE_SHORT[o.language]}
              </option>
            ))}
          </Select>
          {diff ? (
            <>
              <p className="m-0 text-sm text-ink-soft">
                Red lines were in the earlier attempt ({diff.before.verdict}); green lines are in
                this one ({diff.after.verdict}).
              </p>
              <CodeLines lines={diff.lines} />
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
