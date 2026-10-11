"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Chip,
  Dialog,
  Input,
  LoadingBar,
  Textarea,
  Window,
  buttonClasses,
} from "@prepquest/ui";
import { RESUME_MAX_BYTES, type ResumeDto, type ResumeParsed } from "@prepquest/shared";
import { API_URL, ApiError, api, getAccessToken, refreshSession } from "@/lib/api";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "../auth/AuthCard";

const STATUS_TEXT: Record<ResumeDto["status"], string> = {
  uploaded: "Uploaded",
  parsing: "Reading...",
  needs_review: "Needs your review",
  ready: "Ready",
  failed: "Failed",
};
const STATUS_TONE = {
  uploaded: "info",
  parsing: "info",
  needs_review: "medium",
  ready: "easy",
  failed: "hard",
} as const;

async function upload(file: File): Promise<ResumeDto> {
  const send = async () => {
    const body = new FormData();
    body.append("file", file);
    return fetch(`${API_URL}/v1/resumes`, {
      method: "POST",
      body,
      credentials: "include",
      headers: getAccessToken() ? { authorization: `Bearer ${getAccessToken()}` } : {},
    });
  };
  let res = await send();
  if (res.status === 401 && (await refreshSession())) res = await send();
  const json = (await res.json()) as ResumeDto & { error?: { code: string; message: string } };
  if (!res.ok)
    throw new ApiError(
      res.status,
      json.error?.code ?? "UNKNOWN",
      json.error?.message ?? "Upload failed",
    );
  return json;
}

/** Resumes (I3): upload, check what we understood, fix it, confirm. Nothing is used until you confirm. */
export function ResumesView() {
  const [items, setItems] = useState<ResumeDto[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ResumeDto | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const res = await api<{ items: ResumeDto[] }>("/resumes");
    setItems(res.items);
  }, []);
  useEffect(() => {
    load().catch(() => setItems([]));
  }, [load]);

  // poll while anything is being read
  const busy = items?.some((r) => r.status === "parsing" || r.status === "uploaded");
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void load().catch(() => undefined), 1500);
    return () => clearInterval(t);
  }, [busy, load]);

  const up = useSubmit(async (file: File) => {
    if (file.size > RESUME_MAX_BYTES)
      throw new ApiError(422, "VALIDATION_FAILED", "The file is larger than 5 MB.");
    await upload(file);
    await load();
  });

  const remove = useSubmit(async () => {
    if (!deleting) return;
    await api(`/resumes/${deleting.id}`, { method: "DELETE" });
    setDeleting(null);
    await load();
  });

  const editingResume = items?.find((r) => r.id === editing) ?? null;

  return (
    <div className="grid max-w-4xl gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="pq-font-display m-0 text-lg leading-relaxed">Resumes</h1>
        <Link href="/interview" className="underline">
          Back to interviews
        </Link>
      </div>

      <Window title="Upload" tone="sky">
        <div className="grid gap-3">
          <p className="m-0">
            Upload a PDF or DOCX (up to 5 MB). We read it, show you what we understood, and only use
            it after you confirm. Your resume is stored encrypted-at-rest by the platform and can be
            deleted here at any time, with everything derived from it.
          </p>
          <input
            ref={input}
            type="file"
            accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            aria-label="Resume file"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void up.run(f);
              e.target.value = "";
            }}
          />
          <div>
            <Button variant="accent" loading={up.pending} onClick={() => input.current?.click()}>
              Choose a file
            </Button>
          </div>
          <FormError message={up.error} />
        </div>
      </Window>

      {items === null ? (
        <LoadingBar label="Loading" />
      ) : items.length === 0 ? (
        <p className="m-0">No resumes yet.</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0" aria-label="Your resumes">
          {items.map((r) => (
            <li
              key={r.id}
              className="pq-box flex flex-wrap items-center justify-between gap-3 bg-surface p-3"
              data-testid="resume-row"
            >
              <div className="grid gap-1">
                <strong>{r.label}</strong>
                <span className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                  <Chip tone={STATUS_TONE[r.status]}>{STATUS_TEXT[r.status]}</Chip>
                  {r.isDefault && <Chip tone="easy">default</Chip>}
                  {new Date(r.createdAt).toLocaleDateString()}
                </span>
                {r.status === "failed" && r.parseError && (
                  <span role="alert" className="text-sm text-danger">
                    ! {r.parseError}
                  </span>
                )}
              </div>
              <span className="flex flex-wrap gap-2">
                {(r.status === "needs_review" || r.status === "ready") && (
                  <Button
                    size="sm"
                    variant={r.status === "needs_review" ? "accent" : "ghost"}
                    onClick={() => setEditing(r.id)}
                  >
                    {r.status === "needs_review" ? "Review" : "View / edit"}
                  </Button>
                )}
                {r.status === "ready" && !r.isDefault && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void api(`/resumes/${r.id}/default`, { method: "PUT", json: {} }).then(load)
                    }
                  >
                    Make default
                  </Button>
                )}
                {r.status === "failed" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      void api(`/resumes/${r.id}/retry`, { method: "POST", json: {} }).then(load)
                    }
                  >
                    Retry
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setDeleting(r)}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {editingResume?.parsed && (
        <ResumeEditor
          key={editingResume.id}
          resume={editingResume}
          onDone={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}

      <Dialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this resume?"
        tone="danger"
      >
        <p className="mt-0">
          The file and everything we extracted from it are removed. Past interviews keep their
          transcripts.
        </p>
        <FormError message={remove.error} />
        <div className="flex gap-2">
          <Button variant="accent" loading={remove.pending} onClick={() => void remove.run()}>
            Delete
          </Button>
          <Button variant="ghost" onClick={() => setDeleting(null)}>
            Keep it
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

const lines = (v: string) =>
  v
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
const csv = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function ResumeEditor({ resume, onDone }: { resume: ResumeDto; onDone: () => Promise<void> }) {
  const [p, setP] = useState<ResumeParsed>(() => structuredClone(resume.parsed as ResumeParsed));
  const [label, setLabel] = useState(resume.label);
  const save = useSubmit(async (confirm: boolean) => {
    await api(`/resumes/${resume.id}/parsed`, {
      method: "PATCH",
      json: { parsed: p, label, confirm },
    });
    await onDone();
  });
  const setProject = (i: number, patch: Partial<ResumeParsed["projects"][number]>) =>
    setP((cur) => ({
      ...cur,
      projects: cur.projects.map((x, j) => (j === i ? { ...x, ...patch } : x)),
    }));
  const setExperience = (i: number, patch: Partial<ResumeParsed["experience"][number]>) =>
    setP((cur) => ({
      ...cur,
      experience: cur.experience.map((x, j) => (j === i ? { ...x, ...patch } : x)),
    }));

  return (
    <Window title={`Review: ${resume.label}`} tone="sun" data-testid="resume-editor">
      <div className="grid gap-5">
        <p className="m-0">
          This is what we understood. Fix anything that is wrong: interview questions are built from
          it. Names, emails and phone numbers are not used.
        </p>
        <Input
          label="Name for this resume"
          value={label}
          maxLength={80}
          onChange={(e) => setLabel(e.target.value)}
        />

        <section className="grid gap-3" aria-label="Projects">
          <h2 className="pq-font-ui m-0 text-base uppercase">Projects</h2>
          {p.projects.map((x, i) => (
            <div key={i} className="pq-box grid gap-3 bg-surface p-3">
              <Input
                label="Name"
                value={x.name}
                onChange={(e) => setProject(i, { name: e.target.value })}
              />
              <Textarea
                label="Summary"
                rows={2}
                value={x.summary}
                onChange={(e) => setProject(i, { summary: e.target.value })}
              />
              <Input
                label="Technologies (comma separated)"
                value={x.tech.join(", ")}
                onChange={(e) => setProject(i, { tech: csv(e.target.value) })}
              />
              <Textarea
                label="What you did (one per line)"
                rows={4}
                value={x.bullets.join("\n")}
                onChange={(e) => setProject(i, { bullets: lines(e.target.value) })}
              />
              <Input
                label="Numbers and results (comma separated)"
                value={x.metrics.join(", ")}
                onChange={(e) => setProject(i, { metrics: csv(e.target.value) })}
              />
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setP((cur) => ({ ...cur, projects: cur.projects.filter((_, j) => j !== i) }))
                  }
                >
                  Remove project
                </Button>
              </div>
            </div>
          ))}
          <div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setP((cur) => ({
                  ...cur,
                  projects: [
                    ...cur.projects,
                    { name: "", summary: "", tech: [], bullets: [], metrics: [] },
                  ],
                }))
              }
            >
              Add a project
            </Button>
          </div>
        </section>

        <section className="grid gap-3" aria-label="Experience">
          <h2 className="pq-font-ui m-0 text-base uppercase">Experience</h2>
          {p.experience.map((x, i) => (
            <div key={i} className="pq-box grid gap-3 bg-surface p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Company"
                  value={x.company}
                  onChange={(e) => setExperience(i, { company: e.target.value })}
                />
                <Input
                  label="Role"
                  value={x.role ?? ""}
                  onChange={(e) => setExperience(i, { role: e.target.value })}
                />
              </div>
              <Textarea
                label="What you did (one per line)"
                rows={3}
                value={x.bullets.join("\n")}
                onChange={(e) => setExperience(i, { bullets: lines(e.target.value) })}
              />
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setP((cur) => ({
                      ...cur,
                      experience: cur.experience.filter((_, j) => j !== i),
                    }))
                  }
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </section>

        <section className="grid gap-3" aria-label="Skills">
          <h2 className="pq-font-ui m-0 text-base uppercase">Skills and achievements</h2>
          {(["languages", "frameworks", "tools", "domains"] as const).map((k) => (
            <Input
              key={k}
              label={k[0]!.toUpperCase() + k.slice(1)}
              value={p.skills[k].join(", ")}
              onChange={(e) =>
                setP((cur) => ({ ...cur, skills: { ...cur.skills, [k]: csv(e.target.value) } }))
              }
            />
          ))}
          <Textarea
            label="Achievements (one per line)"
            rows={3}
            value={p.achievements.join("\n")}
            onChange={(e) => setP((cur) => ({ ...cur, achievements: lines(e.target.value) }))}
          />
        </section>

        {p.claims.length > 0 && (
          <section aria-label="Claims we will ask about">
            <h2 className="pq-font-ui m-0 mb-2 text-base uppercase">Claims we may probe</h2>
            <ul className="m-0 grid gap-1 pl-5 text-sm">
              {p.claims.map((c, i) => (
                <li key={i}>{c.text}</li>
              ))}
            </ul>
          </section>
        )}

        <FormError message={save.error} />
        {Object.entries(save.fields).map(([k, v]) => (
          <FormError key={k} message={`${k}: ${v}`} />
        ))}
        <div className="flex flex-wrap gap-3">
          <Button variant="accent" loading={save.pending} onClick={() => void save.run(true)}>
            {resume.status === "ready" ? "Save changes" : "Looks right, confirm"}
          </Button>
          {resume.status !== "ready" && (
            <Button variant="ghost" disabled={save.pending} onClick={() => void save.run(false)}>
              Save for later
            </Button>
          )}
          <Button variant="ghost" onClick={() => void onDone()}>
            Close
          </Button>
          <Link href="/interview/new?type=project" className={buttonClasses({ variant: "ghost" })}>
            Start a project interview
          </Link>
        </div>
      </div>
    </Window>
  );
}
