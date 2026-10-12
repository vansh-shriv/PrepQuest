"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  Button,
  Checkbox,
  Chip,
  Input,
  LoadingBar,
  Select,
  Window,
  buttonClasses,
} from "@prepquest/ui";
import type { CompanyPackDto, GoalTemplateResponse, PlanDto, PlanTaskDto } from "@prepquest/shared";
import {
  dayLabel,
  minutesLabel,
  progressPercent,
  splitPlan,
  type DayGroup,
} from "@/features/planning/plan-view";
import { api, ApiError } from "@/lib/api";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "../auth/AuthCard";

const WEEKDAYS = [
  ["mon", "Mon"],
  ["tue", "Tue"],
  ["wed", "Wed"],
  ["thu", "Thu"],
  ["fri", "Fri"],
  ["sat", "Sat"],
  ["sun", "Sun"],
] as const;

const KIND_LABEL: Record<string, string> = {
  problem: "Problem",
  mock: "Mock interview",
  review: "Review",
  reading: "Your task",
  quiz: "Quiz",
};

/** The study plan (P1): generate it, work through today, move or lock tasks, and see what each update changed. */
export function PlanView() {
  const [plan, setPlan] = useState<PlanDto | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setPlan((await api<{ plan: PlanDto | null }>("/me/plan")).plan);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reach the server.");
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  if (error && plan === undefined) return <FormError message={error} />;
  if (plan === undefined) return <LoadingBar label="Loading your plan" />;
  if (plan === null || editing) {
    return (
      <div className="grid max-w-3xl gap-5">
        <h1 className="pq-font-display m-0 text-lg leading-relaxed">Study plan</h1>
        <PlanSetup
          existing={plan}
          onDone={(p) => {
            setPlan(p);
            setEditing(false);
          }}
          onCancel={plan ? () => setEditing(false) : undefined}
        />
      </div>
    );
  }
  return <Loaded plan={plan} onChange={setPlan} reload={load} onEdit={() => setEditing(true)} />;
}

function Loaded({
  plan,
  onChange,
  reload,
  onEdit,
}: {
  plan: PlanDto;
  onChange: (p: PlanDto) => void;
  reload: () => Promise<void>;
  onEdit: () => void;
}) {
  const [showPast, setShowPast] = useState(false);
  const [days, setDays] = useState(7);
  const replan = useSubmit(async () => {
    const r = await api<{ plan: PlanDto }>("/me/plan/replan", { method: "POST", json: {} });
    onChange(r.plan);
  });
  const split = splitPlan(plan.tasks, plan.today);
  const progress = progressPercent(plan.tasks);

  return (
    <div className="grid max-w-5xl gap-6" data-testid="plan">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="pq-font-display m-0 text-lg leading-relaxed">Study plan</h1>
          <p className="m-0 text-sm text-ink-soft">
            Version {plan.version}
            {plan.target !== "general" ? ` · aimed at ${plan.target.replace(/-/g, " ")}` : ""}
            {plan.placementDate ? ` · until ${plan.placementDate}` : " · next eight weeks"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Change settings
          </Button>
          <Button size="sm" loading={replan.pending} onClick={() => void replan.run()}>
            Update plan
          </Button>
        </div>
      </div>
      <FormError message={replan.error} />

      {plan.narrativeMd && <p className="m-0">{plan.narrativeMd}</p>}
      {plan.warnings.map((w) => (
        <p
          key={w}
          role="note"
          className="m-0 border-[3px] border-ink bg-sun px-3 py-2 text-[var(--on-coin)]"
          data-testid="plan-warning"
        >
          {w}
        </p>
      ))}

      <div className="grid gap-4 md:grid-cols-[1fr_320px]">
        <div className="grid content-start gap-5">
          <Window title="Phases" tone="sky">
            <ol className="m-0 grid list-none gap-2 p-0" aria-label="Plan phases">
              {plan.phases.map((p) => {
                const current = plan.today >= p.start && plan.today <= p.end;
                return (
                  <li key={p.name} className="flex flex-wrap items-center gap-2">
                    <Chip tone={current ? "easy" : undefined}>{p.label}</Chip>
                    <span className="text-sm text-ink-soft">
                      {p.start} to {p.end}
                    </span>
                    {current && <span className="text-sm">you are here</span>}
                  </li>
                );
              })}
            </ol>
            <div className="mt-3">
              <LoadingBar value={progress} size="sm" label={`${progress}% of the plan done`} />
            </div>
          </Window>

          {plan.lastDiff && plan.lastDiff.summary !== "No changes" && (
            <Window title="What changed" tone="olive" data-testid="plan-diff">
              <p className="mt-0">
                Last update ({plan.lastDiff.reason}): <strong>{plan.lastDiff.summary}</strong>
              </p>
              <details>
                <summary>Details</summary>
                <ul className="m-0 grid gap-1 pl-5 text-sm">
                  {plan.lastDiff.moved.map((m) => (
                    <li key={`m${m.key}`}>
                      Moved {m.title}: {m.from} to {m.to}
                    </li>
                  ))}
                  {plan.lastDiff.added.map((m) => (
                    <li key={`a${m.key}`}>
                      Added {m.title} on {m.date}
                    </li>
                  ))}
                  {plan.lastDiff.removed.map((m) => (
                    <li key={`r${m.key}`}>
                      Removed {m.title} ({m.date})
                    </li>
                  ))}
                </ul>
              </details>
            </Window>
          )}

          <div className="grid gap-4">
            <DayList
              title="Today"
              groups={split.today ? [split.today] : []}
              empty="Nothing planned for today. Enjoy the rest, or add a task."
              plan={plan}
              onChange={reload}
            />
            <DayList
              title="Coming up"
              groups={split.upcoming.slice(0, days)}
              plan={plan}
              onChange={reload}
            />
            {split.upcoming.length > days && (
              <div>
                <Button size="sm" variant="ghost" onClick={() => setDays((n) => n + 7)}>
                  Show more days
                </Button>
              </div>
            )}
            {split.past.length > 0 && (
              <div className="grid gap-3">
                <div>
                  <Button size="sm" variant="ghost" onClick={() => setShowPast((v) => !v)}>
                    {showPast ? "Hide earlier days" : "Show earlier days"}
                  </Button>
                </div>
                {showPast && (
                  <DayList title="Earlier" groups={split.past} plan={plan} onChange={reload} />
                )}
              </div>
            )}
          </div>
        </div>

        <div className="grid content-start gap-5">
          <AddTask plan={plan} onAdded={reload} />
          <GoalPicker />
        </div>
      </div>
    </div>
  );
}

function DayList({
  title,
  groups,
  empty,
  plan,
  onChange,
}: {
  title: string;
  groups: DayGroup[];
  empty?: string;
  plan: PlanDto;
  onChange: () => Promise<void>;
}) {
  if (groups.length === 0 && !empty) return null;
  return (
    <section className="grid gap-3" aria-label={title}>
      <h2 className="pq-font-display m-0 text-sm leading-relaxed">{title}</h2>
      {groups.length === 0 && <p className="m-0 text-ink-soft">{empty}</p>}
      {groups.map((g) => (
        <Window
          key={g.date}
          title={`${dayLabel(g.date, plan.today)} · ${minutesLabel(g.minutes)}`}
          tone={g.date === plan.today ? "sun" : "olive"}
        >
          <ul className="m-0 grid list-none gap-3 p-0">
            {g.tasks.map((t) => (
              <TaskRow key={t.id} task={t} today={plan.today} onChange={onChange} />
            ))}
          </ul>
        </Window>
      ))}
    </section>
  );
}

function TaskRow({
  task,
  today,
  onChange,
}: {
  task: PlanTaskDto;
  today: string;
  onChange: () => Promise<void>;
}) {
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState(task.date >= today ? task.date : today);
  const patch = useSubmit(async (body: Record<string, unknown>) => {
    await api(`/me/plan/tasks/${task.id}`, { method: "PATCH", json: body });
    setMoving(false);
    await onChange();
  });
  const done = task.status === "done";
  const skipped = task.status === "skipped";
  const past = task.date < today;

  return (
    <li className="grid gap-1" data-testid="plan-task" data-status={task.status}>
      <div className="flex flex-wrap items-start gap-3">
        <Checkbox
          label=""
          aria-label={`${done ? "Mark not done" : "Mark done"}: ${task.title}`}
          checked={done}
          disabled={patch.pending}
          onChange={(e) => void patch.run({ status: e.target.checked ? "done" : "todo" })}
        />
        <div className="grid min-w-0 flex-1 gap-1">
          <span className={skipped ? "line-through opacity-60" : done ? "opacity-70" : ""}>
            {task.href && !done ? (
              <Link href={task.href} className="font-bold underline">
                {task.title}
              </Link>
            ) : (
              <strong>{task.title}</strong>
            )}
          </span>
          <span className="flex flex-wrap items-center gap-2 text-sm">
            <Chip>{KIND_LABEL[task.kind] ?? task.kind}</Chip>
            <span>{minutesLabel(task.estMinutes)}</span>
            {task.locked && <Chip tone="info">locked</Chip>}
            {past && !done && !skipped && <Chip tone="hard">missed</Chip>}
          </span>
          {task.why && <span className="text-sm text-ink-soft">{task.why}</span>}
        </div>
        {!done && !skipped && (
          <span className="flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="ghost"
              aria-label={`${task.locked ? "Unlock" : "Lock"}: ${task.title}`}
              onClick={() => void patch.run({ locked: !task.locked })}
            >
              {task.locked ? "Unlock" : "Lock"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMoving((v) => !v)}>
              Move
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Skip: ${task.title}`}
              onClick={() => void patch.run({ status: "skipped" })}
            >
              Skip
            </Button>
          </span>
        )}
      </div>
      {moving && (
        <div className="flex flex-wrap items-end gap-2 pl-8">
          <Input
            label="Move to"
            type="date"
            min={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <Button size="sm" loading={patch.pending} onClick={() => void patch.run({ date })}>
            Move task
          </Button>
        </div>
      )}
      <FormError message={patch.error} />
    </li>
  );
}

function AddTask({ plan, onAdded }: { plan: PlanDto; onAdded: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(plan.today);
  const [minutes, setMinutes] = useState(30);
  const add = useSubmit(async () => {
    await api("/me/plan/tasks", { method: "POST", json: { title, date, estMinutes: minutes } });
    setTitle("");
    await onAdded();
  });
  return (
    <Window title="Add your own task" tone="blossom">
      <div className="grid gap-3">
        <Input
          label="Task"
          value={title}
          maxLength={120}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Input
          label="Day"
          type="date"
          min={plan.today}
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Input
          label="Minutes"
          type="number"
          min={5}
          max={240}
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
          helper="It is locked, so updates never move or drop it."
        />
        <FormError message={add.error} />
        <div>
          <Button
            size="sm"
            loading={add.pending}
            disabled={title.trim() === ""}
            onClick={() => void add.run()}
          >
            Add task
          </Button>
        </div>
      </div>
    </Window>
  );
}

function GoalPicker() {
  const [tpl, setTpl] = useState<GoalTemplateResponse | null>(null);
  useEffect(() => {
    api<GoalTemplateResponse>("/me/goals/template")
      .then(setTpl)
      .catch(() => undefined);
  }, []);
  const choose = useSubmit(async (preset: string) => {
    setTpl(
      await api<GoalTemplateResponse>("/me/goals/template", { method: "PUT", json: { preset } }),
    );
  });
  if (!tpl) return null;
  return (
    <Window title="Daily goals" tone="coin">
      <div className="grid gap-3">
        <Select
          label="Preset"
          value={tpl.preset}
          onChange={(e) => void choose.run(e.target.value)}
          helper="Finishing every goal earns a small XP bonus once a day."
        >
          {tpl.preset === "custom" && <option value="custom">Custom</option>}
          {tpl.presets.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </Select>
        <ul className="m-0 pl-5 text-sm">
          {tpl.items.map((i) => (
            <li key={i.type}>
              {i.type === "problems"
                ? `${i.target} problem${i.target === 1 ? "" : "s"} a day`
                : i.type === "xp"
                  ? `${i.target} XP a day`
                  : i.type === "interviews_week"
                    ? `${i.target} mock interview${i.target === 1 ? "" : "s"} a week`
                    : "Finish today's plan"}
            </li>
          ))}
        </ul>
        <FormError message={choose.error} />
      </div>
    </Window>
  );
}

function PlanSetup({
  existing,
  onDone,
  onCancel,
}: {
  existing: PlanDto | null;
  onDone: (p: PlanDto) => void;
  onCancel?: () => void;
}) {
  const inputs = existing?.inputs;
  const [placementDate, setPlacementDate] = useState(existing?.placementDate ?? "");
  const [hours, setHours] = useState(inputs ? inputs.defaultHours || 2 : 2);
  const [rest, setRest] = useState<string[]>(inputs?.restDays ?? []);
  const [mocks, setMocks] = useState(inputs?.mockPerWeek ?? 1);
  const [packSlug, setPackSlug] = useState(
    existing && existing.target !== "general" ? existing.target : "",
  );
  const [packs, setPacks] = useState<CompanyPackDto[]>([]);
  useEffect(() => {
    api<{ items: CompanyPackDto[] }>("/interview/company-packs")
      .then((r) => setPacks(r.items))
      .catch(() => undefined);
  }, []);

  const submit = useSubmit(async () => {
    const r = await api<{ plan: PlanDto }>("/me/plan", {
      method: "POST",
      json: {
        placementDate: placementDate || null,
        defaultHours: hours,
        hoursPerDay: {},
        restDays: rest,
        mockPerWeek: mocks,
        packSlug: packSlug || null,
      },
    });
    onDone(r.plan);
  });

  return (
    <Window title={existing ? "Plan settings" : "Build your plan"} tone="sky">
      <div className="grid gap-4">
        {!existing && (
          <p className="m-0">
            Tell us how much time you have. The plan starts with your weakest topics, adds mock
            interviews, and re-plans every night from what you actually did.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Placement or interview date (optional)"
            type="date"
            value={placementDate}
            onChange={(e) => setPlacementDate(e.target.value)}
            helper="Without a date the plan covers the next eight weeks."
          />
          <Input
            label="Hours per day"
            type="number"
            min={0}
            max={16}
            step={0.5}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          />
          <Select
            label="Mock interviews per week"
            value={String(mocks)}
            onChange={(e) => setMocks(Number(e.target.value))}
          >
            {[0, 1, 2, 3].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
          <Select
            label="Aim at a company profile"
            value={packSlug}
            onChange={(e) => setPackSlug(e.target.value)}
            helper="Shifts which topics come first. Practice profiles, not official processes."
          >
            <option value="">No target</option>
            {packs.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.title}
                {p.provisional ? " (unverified)" : ""}
              </option>
            ))}
          </Select>
        </div>
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="pq-label mb-1">Rest days</legend>
          <div className="flex flex-wrap gap-4">
            {WEEKDAYS.map(([key, label]) => (
              <Checkbox
                key={key}
                label={label}
                checked={rest.includes(key)}
                onChange={(e) =>
                  setRest((r) => (e.target.checked ? [...r, key] : r.filter((x) => x !== key)))
                }
              />
            ))}
          </div>
        </fieldset>
        <FormError message={submit.error} />
        {Object.values(submit.fields)[0] && (
          <FormError message={Object.values(submit.fields)[0] ?? null} />
        )}
        <div className="flex flex-wrap gap-3">
          <Button variant="accent" loading={submit.pending} onClick={() => void submit.run()}>
            {existing ? "Save and re-plan" : "Build my plan"}
          </Button>
          {onCancel ? (
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          ) : (
            <Link href="/analytics" className={buttonClasses({ variant: "ghost" })}>
              See my readiness first
            </Link>
          )}
        </div>
      </div>
    </Window>
  );
}
