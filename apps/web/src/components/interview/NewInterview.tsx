"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  Chip,
  Input,
  LoadingBar,
  Select,
  Textarea,
  Window,
  buttonClasses,
} from "@prepquest/ui";
import { INTERVIEW_TYPE_VALUES } from "@prepquest/shared";
import type {
  CompanyPackDto,
  InterviewPlanPreviewDto,
  InterviewSessionDto,
  InterviewTemplateDto,
  InterviewTypeValue,
  JdDto,
  ProblemListResponse,
  ResumeDto,
} from "@prepquest/shared";
import { PERSONA_HELP, PERSONA_LABEL } from "@/features/interview/format";
import { speechSupport } from "@/features/interview/voice/speech";
import { api, ApiError } from "@/lib/api";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "../auth/AuthCard";

interface Form {
  type: InterviewTypeValue;
  persona: "friendly" | "neutral" | "strict" | "rapid";
  mode: "text" | "mixed" | "voice";
  difficulty: number;
  minutes: number | null;
  hintBudget: number;
  interruptionLevel: "off" | "low" | "normal";
  realistic: boolean;
  adaptive: boolean;
  level: "intern" | "sde1" | "sde2";
  role: string;
  company: string;
  resumeId: string;
  jdId: string;
  problemSlugs: string[];
  packSlug: string;
}

const DEFAULT_FORM: Form = {
  type: "dsa",
  persona: "neutral",
  mode: "text",
  difficulty: 3,
  minutes: null,
  hintBudget: 2,
  interruptionLevel: "normal",
  realistic: true,
  adaptive: true,
  level: "sde1",
  role: "",
  company: "",
  resumeId: "",
  jdId: "",
  problemSlugs: [],
  packSlug: "",
};

const needsResume = (t: InterviewTypeValue) => t === "project" || t === "resume";

const bodyOf = (f: Form) => ({
  type: f.type,
  persona: f.persona,
  mode: f.mode,
  difficulty: f.difficulty,
  ...(f.minutes ? { minutes: f.minutes } : {}),
  hintBudget: f.type === "dsa" ? f.hintBudget : 0,
  ...(f.packSlug ? { packSlug: f.packSlug } : {}),
  interruptionLevel: f.interruptionLevel,
  realistic: f.realistic,
  adaptive: f.adaptive,
  level: f.level,
  role: f.role.trim() || null,
  company: f.company.trim() || null,
  ...((f.type === "project" || f.type === "resume") && f.resumeId ? { resumeId: f.resumeId } : {}),
  ...(f.jdId ? { jdId: f.jdId } : {}),
  ...(f.type === "dsa" && f.problemSlugs.length > 0 ? { problemSlugs: f.problemSlugs } : {}),
});

/** Interview setup: choose the type and persona, preview the plan, override its problems, start. */
export function NewInterview() {
  const router = useRouter();
  const params = useSearchParams();
  const [templates, setTemplates] = useState<InterviewTemplateDto[]>([]);
  const [resumes, setResumes] = useState<ResumeDto[] | null>(null);
  const [problems, setProblems] = useState<{ slug: string; title: string; difficulty: string }[]>(
    [],
  );
  const [form, setForm] = useState<Form>(() => ({
    ...DEFAULT_FORM,
    type: (INTERVIEW_TYPE_VALUES as readonly string[]).includes(params.get("type") ?? "")
      ? (params.get("type") as InterviewTypeValue)
      : "dsa",
    packSlug: params.get("pack") ?? "",
  }));
  const [preview, setPreview] = useState<InterviewPlanPreviewDto | null>(null);
  const [previewError, setPreviewError] = useState<{ code: string; message: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [reroll, setReroll] = useState(0);
  const [packs, setPacks] = useState<CompanyPackDto[]>([]);
  const [jd, setJd] = useState<JdDto | null>(null);
  const [jdText, setJdText] = useState("");
  const [voiceAllowed, setVoiceAllowed] = useState(false);
  const speech = useMemo(
    () => (typeof window === "undefined" ? null : speechSupport(window as never)),
    [],
  );

  const set = useCallback(
    <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value })),
    [],
  );

  useEffect(() => {
    api<{ items: InterviewTemplateDto[]; features?: { voice?: boolean } }>("/interview/templates")
      .then((r) => {
        setTemplates(r.items);
        setVoiceAllowed(Boolean(r.features?.voice));
      })
      .catch(() => undefined);
    api<{ items: CompanyPackDto[] }>("/interview/company-packs")
      .then((r) => setPacks(r.items))
      .catch(() => undefined);
    api<{ items: ResumeDto[] }>("/resumes")
      .then((r) => setResumes(r.items))
      .catch(() => setResumes([]));
    api<ProblemListResponse>("/problems?limit=50")
      .then((r) =>
        setProblems(
          r.items.map((p) => ({ slug: p.slug, title: p.title, difficulty: p.difficulty })),
        ),
      )
      .catch(() => undefined);
  }, []);

  const readyResumes = useMemo(
    () => (resumes ?? []).filter((r) => r.status === "ready"),
    [resumes],
  );
  // the default resume is preselected for project interviews
  useEffect(() => {
    if (needsResume(form.type) && !form.resumeId && readyResumes.length > 0) {
      set("resumeId", (readyResumes.find((r) => r.isDefault) ?? readyResumes[0])!.id);
    }
  }, [form.type, form.resumeId, readyResumes, set]);

  const template = templates.find((t) => t.type === form.type);

  // the plan preview follows the form (debounced); it never calls the model
  useEffect(() => {
    if (needsResume(form.type) && !form.resumeId) {
      setPreview(null);
      setPreviewError(
        resumes === null
          ? null
          : { code: "RESUME_REQUIRED", message: "This interview is built from your resume." },
      );
      return;
    }
    let alive = true;
    setPreviewing(true);
    const t = setTimeout(() => {
      api<InterviewPlanPreviewDto>("/interviews/plan", { method: "POST", json: bodyOf(form) })
        .then((p) => alive && (setPreview(p), setPreviewError(null)))
        .catch((err: unknown) => {
          if (!alive) return;
          setPreview(null);
          setPreviewError(
            err instanceof ApiError
              ? { code: err.code, message: err.message }
              : { code: "NETWORK", message: "Couldn't reach the server." },
          );
        })
        .finally(() => alive && setPreviewing(false));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [JSON.stringify(bodyOf(form)), reroll, resumes === null]);

  const analyze = useSubmit(async () => {
    const res = await api<JdDto>("/jds", {
      method: "POST",
      json: {
        text: jdText,
        company: form.company.trim() || null,
        role: form.role.trim() || null,
        resumeId: form.resumeId || null,
      },
    });
    setJd(res);
    set("jdId", res.id);
  });

  const create = useSubmit(async () => {
    const res = await api<{ session: InterviewSessionDto }>("/interviews", {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      json: bodyOf(form),
    });
    router.push(`/interview/${res.session.id}`);
  });

  const noResume = needsResume(form.type) && readyResumes.length === 0 && resumes !== null;

  return (
    <div className="grid max-w-5xl gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="pq-font-display m-0 text-lg leading-relaxed">New interview</h1>
        <Link href="/interview" className="underline">
          Back
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="grid content-start gap-5">
          <Window title="Round" tone="sky">
            <div className="grid gap-4">
              <fieldset className="m-0 grid gap-2 border-0 p-0">
                <legend className="pq-label mb-1">Type</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(templates.length > 0
                    ? templates
                    : ([
                        { type: "dsa", title: "DSA coding round", description: "" },
                        { type: "project", title: "Project deep-dive", description: "" },
                      ] as InterviewTemplateDto[])
                  ).map((t) => (
                    <label
                      key={t.type}
                      className="pq-box block cursor-pointer p-3 has-[:checked]:bg-sky-light has-[:checked]:text-[#1a1a1a]"
                    >
                      <input
                        type="radio"
                        name="type"
                        className="sr-only"
                        checked={form.type === t.type}
                        onChange={() =>
                          setForm((f) => ({ ...f, type: t.type, minutes: null, problemSlugs: [] }))
                        }
                      />
                      <strong className="block">{t.title}</strong>
                      <span className="text-sm">
                        {t.description}
                        {t.defaultMinutes ? ` ${t.defaultMinutes} min.` : ""}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              {needsResume(form.type) && (
                <div className="grid gap-2">
                  {noResume ? (
                    <p className="m-0">
                      You need a confirmed resume first.{" "}
                      <Link href="/resumes" className="underline">
                        Upload one
                      </Link>
                      .
                    </p>
                  ) : (
                    <Select
                      label="Resume"
                      value={form.resumeId}
                      onChange={(e) => set("resumeId", e.target.value)}
                    >
                      {readyResumes.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                          {r.isDefault ? " (default)" : ""}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label="Interviewer"
                  value={form.persona}
                  onChange={(e) => set("persona", e.target.value as Form["persona"])}
                  helper={PERSONA_HELP[form.persona]}
                >
                  {Object.entries(PERSONA_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
                {voiceAllowed && (
                  <Select
                    label="How you answer"
                    value={form.mode}
                    onChange={(e) => set("mode", e.target.value as Form["mode"])}
                    helper={
                      form.mode === "text"
                        ? "Type your answers."
                        : speech?.recognition
                          ? "Speak and type. Uses your browser's speech tools; audio is not stored."
                          : "This browser can't listen. You'll hear the interviewer and type your answers (Chrome or Edge can do both)."
                    }
                  >
                    <option value="text">Typing</option>
                    <option value="mixed">Voice and typing</option>
                    <option value="voice">Voice first</option>
                  </Select>
                )}
                <Select
                  label="Difficulty"
                  value={String(form.difficulty)}
                  onChange={(e) => set("difficulty", Number(e.target.value))}
                  helper="1 is gentle, 5 is a high bar. Adaptive mode moves it by one step."
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n} of 5
                    </option>
                  ))}
                </Select>
                <Select
                  label="Level"
                  value={form.level}
                  onChange={(e) => set("level", e.target.value as Form["level"])}
                >
                  <option value="intern">Intern</option>
                  <option value="sde1">SDE-1 / new grad</option>
                  <option value="sde2">SDE-2</option>
                </Select>
                <Input
                  label="Length (minutes)"
                  type="number"
                  inputMode="numeric"
                  min={template?.minMinutes}
                  max={template?.maxMinutes}
                  placeholder={String(template?.defaultMinutes ?? 45)}
                  value={form.minutes ?? ""}
                  onChange={(e) =>
                    set("minutes", e.target.value === "" ? null : Number(e.target.value))
                  }
                />
                <Input
                  label="Target role (optional)"
                  value={form.role}
                  maxLength={120}
                  onChange={(e) => set("role", e.target.value)}
                />
                <Select
                  label="Company pack"
                  value={form.packSlug}
                  onChange={(e) => set("packSlug", e.target.value)}
                  helper="A practice profile inspired by public patterns. Not an official or guaranteed process."
                >
                  <option value="">None (or inferred from the company below)</option>
                  {packs.map((p) => (
                    <option key={p.slug} value={p.slug}>
                      {p.title}
                      {p.provisional ? " (unverified)" : ""}
                    </option>
                  ))}
                </Select>
                <Input
                  label="Target company (optional)"
                  value={form.company}
                  maxLength={120}
                  onChange={(e) => set("company", e.target.value)}
                  helper="Used as a label. Practice style is inspired by public patterns, not official."
                />
              </div>

              <div className="grid gap-3">
                {form.type === "dsa" && (
                  <Select
                    label="Hint budget"
                    value={String(form.hintBudget)}
                    onChange={(e) => set("hintBudget", Number(e.target.value))}
                    helper="Hints are counted in your report. The limit is enforced by the server."
                  >
                    {[0, 1, 2, 3].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                )}
                <Select
                  label="Interruptions"
                  value={form.interruptionLevel}
                  onChange={(e) =>
                    set("interruptionLevel", e.target.value as Form["interruptionLevel"])
                  }
                >
                  <option value="off">Never</option>
                  <option value="low">Rarely</option>
                  <option value="normal">Normal</option>
                </Select>
                <Checkbox
                  label="Realistic mode"
                  helper="No pausing, like the real thing."
                  checked={form.realistic}
                  onChange={(e) => set("realistic", e.target.checked)}
                />
                {form.type === "dsa" && (
                  <Checkbox
                    label="Adaptive difficulty"
                    helper="The next problem gets easier or harder depending on how the first went."
                    checked={form.adaptive}
                    onChange={(e) => set("adaptive", e.target.checked)}
                  />
                )}
              </div>
            </div>
          </Window>

          <Window title="Job description (optional)" tone="olive">
            <div className="grid gap-3">
              <Textarea
                label="Paste the job description"
                rows={5}
                maxLength={20000}
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                helper="We extract the required skills and compare them with your resume. Questions lean toward what the job asks for."
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  loading={analyze.pending}
                  disabled={jdText.trim().length < 40 || (needsResume(form.type) && !form.resumeId)}
                  onClick={() => void analyze.run()}
                >
                  Analyze
                </Button>
                {jd && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => (setJd(null), set("jdId", ""), setJdText(""))}
                  >
                    Remove
                  </Button>
                )}
              </div>
              <FormError message={analyze.error} />
              {Object.values(analyze.fields)[0] && (
                <FormError message={Object.values(analyze.fields)[0] ?? null} />
              )}
              {jd?.analysis && (
                <div className="grid gap-2" data-testid="jd-analysis">
                  <p className="m-0 text-sm">The interviewer will keep these in mind:</p>
                  <div className="flex flex-wrap gap-2">
                    {jd.analysis.required.slice(0, 10).map((r) => (
                      <Chip key={r}>{r}</Chip>
                    ))}
                  </div>
                  {jd.gap && (jd.gap.missing.length > 0 || jd.gap.matched.length > 0) && (
                    <p className="m-0 text-sm text-ink-soft">
                      On your resume: {jd.gap.matched.length}. Not evident: {jd.gap.missing.length}
                      {jd.gap.missing.length > 0
                        ? ` (${jd.gap.missing.slice(0, 4).join(", ")})`
                        : ""}
                      .
                    </p>
                  )}
                </div>
              )}
            </div>
          </Window>
        </div>

        <div className="grid content-start gap-4">
          <Window title="Your plan" tone="sun" data-testid="plan-preview">
            {previewing && !preview && <LoadingBar label="Planning" />}
            {previewError && (
              <p role="alert" className="m-0 text-danger">
                ! {previewError.message}
              </p>
            )}
            {preview && (
              <div className="grid gap-4">
                <ol className="m-0 grid gap-1 pl-5" aria-label="Segments">
                  {preview.segments.map((s) => (
                    <li key={s.key}>
                      {s.name}: {Math.round((s.endMs - s.startMs) / 60_000)} min
                    </li>
                  ))}
                </ol>
                <div className="grid gap-2">
                  <strong>Questions</strong>
                  {preview.questions.map((q, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      {q.kind === "problem" ? (
                        <>
                          <Chip tone={q.difficulty}>{q.difficulty}</Chip>
                          <span>{q.title}</span>
                        </>
                      ) : (
                        <>
                          <Chip>{q.sourceRef}</Chip>
                          <span>{q.title}</span>
                        </>
                      )}
                    </div>
                  ))}
                  {preview.type !== "dsa" && (
                    <p className="m-0 text-sm text-ink-soft">
                      The exact questions are written when you start, and stay hidden until they are
                      asked.
                    </p>
                  )}
                </div>
                {form.type === "dsa" && (
                  <div className="grid gap-2">
                    {preview.questions.map((_, i) => (
                      <Select
                        key={i}
                        label={`Problem ${i + 1}`}
                        value={form.problemSlugs[i] ?? ""}
                        onChange={(e) => {
                          const next = [
                            ...(form.problemSlugs.length
                              ? form.problemSlugs
                              : preview.questions.map((q) => (q.kind === "problem" ? q.slug : ""))),
                          ];
                          next[i] = e.target.value;
                          set("problemSlugs", next.filter(Boolean));
                        }}
                      >
                        <option value="">Pick for me</option>
                        {problems.map((p) => (
                          <option key={p.slug} value={p.slug}>
                            {p.title} ({p.difficulty})
                          </option>
                        ))}
                      </Select>
                    ))}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => (set("problemSlugs", []), setReroll((n) => n + 1))}
                    >
                      Pick again
                    </Button>
                  </div>
                )}
                {preview.pack && (
                  <div className="grid gap-1" data-testid="pack-effects">
                    <strong>
                      {preview.pack.title}
                      {preview.pack.provisional ? " (unverified)" : ""}
                    </strong>
                    <ul className="m-0 grid gap-1 pl-5 text-sm">
                      {preview.packEffects.map((e) => (
                        <li key={e}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {!preview.pack && preview.packEffects.length > 0 && (
                  <p className="m-0 text-sm text-ink-soft">{preview.packEffects.join(" ")}</p>
                )}
                {preview.rubricWeights.length > 0 && (
                  <details>
                    <summary>How you are scored</summary>
                    <ul className="m-0 grid gap-1 pl-5 text-sm">
                      {preview.rubricWeights.map((w) => (
                        <li key={w.key}>
                          {w.name}: {w.weight}%
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {preview.warnings.map((w) => (
                  <p key={w} className="m-0 text-sm text-ink-soft">
                    {w}
                  </p>
                ))}
                {preview.note && <p className="m-0 text-sm text-ink-soft">{preview.note}</p>}
              </div>
            )}
          </Window>
          <FormError message={create.error} />
          <div className="flex flex-wrap gap-3">
            <Button
              variant="accent"
              loading={create.pending}
              disabled={!preview || noResume}
              onClick={() => void create.run()}
            >
              Start setup
            </Button>
            {noResume && (
              <Link href="/resumes" className={buttonClasses({ variant: "ghost" })}>
                Add a resume
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
