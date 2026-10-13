"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button, Chip, Input, LoadingBar, Select, Tabs, Textarea, Window } from "@prepquest/ui";
import type {
  ContestDetailDto,
  ContestListItem,
  ContestListResponse,
  ProblemListResponse,
} from "@prepquest/shared";
import { durationText, localInputValue, PHASE_LABEL } from "@/features/contest/contest-view";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "../auth/AuthCard";

/** Contests (D7): what is on, what is coming, what is over, and a form to run your own. */
export function ContestsHome() {
  const [data, setData] = useState<ContestListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<ContestListResponse>("/contests")
      .then(setData)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Couldn't reach the server."),
      );
  }, []);

  if (error) return <FormError message={error} />;
  if (!data) return <LoadingBar label="Loading contests" />;

  const by = (phase: ContestListItem["phase"]) => data.contests.filter((c) => c.phase === phase);
  const tab = (phase: ContestListItem["phase"], empty: string) => {
    const rows = by(phase);
    return rows.length === 0 ? (
      <p className="m-0 p-2" data-testid={`contests-${phase}-empty`}>
        {empty}
      </p>
    ) : (
      <ul className="m-0 grid list-none gap-2 p-2" data-testid={`contests-${phase}`}>
        {rows.map((c) => (
          <ContestRow key={c.slug} c={c} />
        ))}
      </ul>
    );
  };

  return (
    <div className="grid max-w-4xl gap-6" data-testid="contests">
      <div>
        <h1 className="pq-font-display m-0 text-lg leading-relaxed">Contests</h1>
        <p className="m-0 mt-2">
          Race the clock on real problems. Hints and editorials are off while you compete, and the
          standings follow every verdict. Missed one? Replay it as a virtual contest on your own
          clock.
        </p>
      </div>
      <Tabs
        aria-label="Contests"
        defaultId={by("running").length > 0 ? "running" : "upcoming"}
        items={[
          {
            id: "running",
            label: "Running",
            content: tab("running", "Nothing is running right now."),
          },
          {
            id: "upcoming",
            label: "Upcoming",
            content: tab("upcoming", "No contests are scheduled."),
          },
          { id: "past", label: "Past", content: tab("past", "No finished contests yet.") },
        ]}
      />
      <JoinByCode />
      <CreateContest />
    </div>
  );
}

function ContestRow({ c }: { c: ContestListItem }) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      <Link href={`/contests/${c.slug}`} className="underline">
        {c.title}
      </Link>
      <Chip tone={c.phase === "running" ? "easy" : "neutral"}>{PHASE_LABEL[c.phase]}</Chip>
      <Chip>{c.scoring === "icpc" ? "ICPC" : "points"}</Chip>
      {c.kind === "private" && <Chip tone="info">private</Chip>}
      <span className="text-sm text-ink-soft">
        {new Date(c.startsAt).toLocaleString()} · {durationText(c.durationMinutes)} ·{" "}
        {c.problemCount} problems · {c.participants} joined
      </span>
      {c.registered && <Chip tone="easy">registered</Chip>}
    </li>
  );
}

/** A private contest is found with its invite code: the page registers you after you confirm. */
function JoinByCode() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [code, setCode] = useState("");
  return (
    <Window title="Join a private contest" tone="sky">
      <form
        className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/contests/${slug.trim()}?code=${encodeURIComponent(code.trim())}`);
        }}
      >
        <Input
          label="Contest link name"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          helper="The last part of the link you were sent."
        />
        <Input label="Invite code" value={code} onChange={(e) => setCode(e.target.value)} />
        <Button type="submit" disabled={slug.trim() === "" || code.trim() === ""}>
          Open
        </Button>
      </form>
    </Window>
  );
}

function CreateContest() {
  const router = useRouter();
  const { user } = useAuth();
  const canPublic = user?.role === "reviewer" || user?.role === "admin";
  const [open, setOpen] = useState(false);
  const [problems, setProblems] = useState<ProblemListResponse["items"]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"private" | "weekly" | "oa">("private");
  const [scoring, setScoring] = useState<"icpc" | "points">("icpc");
  const [startsAt, setStartsAt] = useState(() => localInputValue(new Date(), 15));
  const [duration, setDuration] = useState(90);
  const [freeze, setFreeze] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    if (!open || problems.length > 0) return;
    api<ProblemListResponse>("/problems?limit=50")
      .then((r) => setProblems(r.items))
      .catch(() => undefined);
  }, [open, problems.length]);

  const create = useSubmit(async () => {
    const made = await api<ContestDetailDto>("/contests", {
      method: "POST",
      json: {
        title,
        ...(description ? { description } : {}),
        kind,
        scoring,
        startsAt: new Date(startsAt).toISOString(),
        durationMinutes: duration,
        freezeMinutes: freeze,
        problems: picked.map((slug) => ({ slug })),
      },
    });
    router.push(`/contests/${made.slug}`);
  });

  if (!open) {
    return (
      <div>
        <Button variant="accent" onClick={() => setOpen(true)}>
          Create a contest
        </Button>
      </div>
    );
  }
  return (
    <Window title="Create a contest" tone="sun">
      <form
        className="grid gap-4"
        data-testid="contest-form"
        onSubmit={(e) => {
          e.preventDefault();
          void create.run();
        }}
      >
        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={create.fields.title}
        />
        <Textarea
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="private">Private: invite code</option>
            {canPublic && <option value="weekly">Public weekly contest</option>}
            {canPublic && <option value="oa">Public company-style test</option>}
          </Select>
          <Select
            label="Scoring"
            value={scoring}
            onChange={(e) => setScoring(e.target.value as typeof scoring)}
          >
            <option value="icpc">ICPC: solved, then penalty</option>
            <option value="points">Points with time decay</option>
          </Select>
          <Input
            label="Starts"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
          />
          <Input
            label="Minutes"
            type="number"
            min={10}
            max={360}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          />
          <Input
            label="Freeze the standings for the last N minutes"
            type="number"
            min={0}
            max={60}
            value={freeze}
            onChange={(e) => setFreeze(Number(e.target.value))}
          />
        </div>
        <fieldset className="m-0 grid gap-1 border-0 p-0">
          <legend className="mb-1">Problems (1 to 8, in order)</legend>
          <div className="grid max-h-56 gap-1 overflow-auto" data-testid="contest-problem-picker">
            {problems.map((p) => (
              <label key={p.slug} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={picked.includes(p.slug)}
                  disabled={!picked.includes(p.slug) && picked.length >= 8}
                  onChange={() =>
                    setPicked((cur) =>
                      cur.includes(p.slug) ? cur.filter((x) => x !== p.slug) : [...cur, p.slug],
                    )
                  }
                />
                {p.title} <span className="text-sm text-ink-soft">{p.difficulty}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <FormError message={create.error} />
        <div className="flex gap-3">
          <Button
            type="submit"
            variant="accent"
            loading={create.pending}
            disabled={picked.length === 0}
          >
            Create
          </Button>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Window>
  );
}
