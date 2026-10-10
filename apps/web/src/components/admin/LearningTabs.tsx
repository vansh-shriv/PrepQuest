"use client";

import { useState } from "react";
import { Button, Input, Textarea } from "@prepquest/ui";
import type { AdminEditorial, AdminProblemDetail } from "@prepquest/shared";
import { api } from "@/lib/api";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "../auth/AuthCard";

type Detail = AdminProblemDetail;
type OnSaved = (d: Detail) => void;

const TIERS = [
  {
    tier: 1,
    name: "Nudge",
    help: "A question or observation about the structure. No technique names yet.",
  },
  { tier: 2, name: "Approach", help: "Names the technique and the key insight. No code." },
  { tier: 3, name: "Pseudocode", help: "Step by step, no language-specific code." },
] as const;

/** Three hint tiers (D4). Leave a tier empty to stop the list there; later tiers need the earlier ones. */
export function HintsTab({ d, onSaved }: { d: Detail; onSaved: OnSaved }) {
  const [texts, setTexts] = useState<string[]>(
    TIERS.map((t) => d.hints.find((h) => h.tier === t.tier)?.bodyMd ?? ""),
  );
  const [saved, setSaved] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const { run, pending, error } = useSubmit(async () => {
    const filled = texts.map((t) => t.trim());
    const firstGap = filled.findIndex((t) => t === "");
    const used = firstGap === -1 ? filled : filled.slice(0, firstGap);
    if (filled.slice(used.length).some((t) => t !== "")) {
      setOrderError("Fill the hints in order: a later hint needs the earlier ones.");
      return;
    }
    setOrderError(null);
    onSaved(
      await api<Detail>(`/admin/problems/${d.id}/hints`, {
        method: "PUT",
        json: { hints: used.map((bodyMd, i) => ({ tier: i + 1, bodyMd })) },
      }),
    );
    setSaved(true);
  });
  const edit = d.permissions.edit;
  return (
    <form
      className="grid max-w-3xl gap-5"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void run();
      }}
    >
      {TIERS.map((t, i) => (
        <Textarea
          key={t.tier}
          label={`Hint ${t.tier}: ${t.name}`}
          rows={4}
          value={texts[i] ?? ""}
          disabled={!edit}
          helper={t.help}
          onChange={(e) => {
            setSaved(false);
            setTexts((prev) => prev.map((x, k) => (k === i ? e.target.value : x)));
          }}
        />
      ))}
      <FormError message={orderError ?? error} />
      <div className="flex items-center gap-4">
        <Button type="submit" loading={pending} disabled={!edit}>
          Save hints
        </Button>
        {saved ? <span role="status">Saved!</span> : null}
      </div>
    </form>
  );
}

// ---------------------------------------------------------------- editorial

interface ApproachForm {
  name: string;
  intuition: string;
  steps: string;
  time: string;
  space: string;
  pitfalls: string;
  cpp: string;
  java: string;
  python: string;
}

const emptyApproach = (): ApproachForm => ({
  name: "",
  intuition: "",
  steps: "",
  time: "",
  space: "",
  pitfalls: "",
  cpp: "",
  java: "",
  python: "",
});

const lines = (s: string) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

function toForm(e: AdminEditorial | null): {
  approaches: ApproachForm[];
  talk: string;
  related: string;
} {
  if (!e) return { approaches: [emptyApproach()], talk: "", related: "" };
  return {
    approaches: e.approaches.map((a) => ({
      name: a.name,
      intuition: a.intuition,
      steps: a.steps.join("\n"),
      time: a.time,
      space: a.space,
      pitfalls: (a.pitfalls ?? []).join("\n"),
      cpp: a.code.cpp ?? "",
      java: a.code.java ?? "",
      python: a.code.python ?? "",
    })),
    talk: e.talkTrackMd ?? "",
    related: e.relatedSlugs.join(", "),
  };
}

/** Editorial (D5): approaches with intuition, steps, complexity, pitfalls and code per language. */
export function EditorialTab({ d, onSaved }: { d: Detail; onSaved: OnSaved }) {
  const initial = toForm(d.editorial);
  const [approaches, setApproaches] = useState<ApproachForm[]>(initial.approaches);
  const [talk, setTalk] = useState(initial.talk);
  const [related, setRelated] = useState(initial.related);
  const [saved, setSaved] = useState(false);
  const edit = d.permissions.edit;

  const change = (i: number, patch: Partial<ApproachForm>) => {
    setSaved(false);
    setApproaches((rows) => rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  };

  const save = useSubmit(async () => {
    onSaved(
      await api<Detail>(`/admin/problems/${d.id}/editorial`, {
        method: "PUT",
        json: {
          approaches: approaches.map((a) => ({
            name: a.name,
            intuition: a.intuition,
            steps: lines(a.steps),
            time: a.time,
            space: a.space,
            ...(lines(a.pitfalls).length ? { pitfalls: lines(a.pitfalls) } : {}),
            code: Object.fromEntries(
              (["cpp", "java", "python"] as const)
                .filter((l) => a[l].trim() !== "")
                .map((l) => [l, a[l]]),
            ),
          })),
          talkTrackMd: talk.trim() === "" ? null : talk,
          relatedSlugs: related
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      }),
    );
    setSaved(true);
  });
  const remove = useSubmit(async () => {
    onSaved(await api<Detail>(`/admin/problems/${d.id}/editorial`, { method: "DELETE" }));
    const empty = toForm(null);
    setApproaches(empty.approaches);
    setTalk("");
    setRelated("");
  });

  return (
    <form
      className="grid max-w-3xl gap-6"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save.run();
      }}
    >
      <p className="m-0 text-sm text-ink-soft">
        Players unlock the editorial after solving, viewing all hints, or giving up. Order
        approaches from simplest to best. Editorial changes don&apos;t create a new problem version.
      </p>
      {approaches.map((a, i) => (
        <fieldset key={i} className="pq-card pq-box grid gap-3" aria-label={`Approach ${i + 1}`}>
          <legend className="pq-font-ui text-sm uppercase">Approach {i + 1}</legend>
          <Input
            label="Name"
            value={a.name}
            disabled={!edit}
            onChange={(e) => change(i, { name: e.target.value })}
          />
          <Textarea
            label="Intuition"
            rows={3}
            value={a.intuition}
            disabled={!edit}
            onChange={(e) => change(i, { intuition: e.target.value })}
          />
          <Textarea
            label="Steps (one per line)"
            rows={4}
            value={a.steps}
            disabled={!edit}
            onChange={(e) => change(i, { steps: e.target.value })}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Time complexity"
              value={a.time}
              disabled={!edit}
              onChange={(e) => change(i, { time: e.target.value })}
            />
            <Input
              label="Space complexity"
              value={a.space}
              disabled={!edit}
              onChange={(e) => change(i, { space: e.target.value })}
            />
          </div>
          <Textarea
            label="Pitfalls (one per line, optional)"
            rows={3}
            value={a.pitfalls}
            disabled={!edit}
            onChange={(e) => change(i, { pitfalls: e.target.value })}
          />
          {(["python", "cpp", "java"] as const).map((lang) => (
            <Textarea
              key={lang}
              label={`Code: ${lang}`}
              mono
              rows={6}
              value={a[lang]}
              disabled={!edit}
              onChange={(e) => change(i, { [lang]: e.target.value })}
            />
          ))}
          {approaches.length > 1 ? (
            <div>
              <Button
                size="sm"
                variant="ghost"
                disabled={!edit}
                onClick={() => {
                  setSaved(false);
                  setApproaches((rows) => rows.filter((_, k) => k !== i));
                }}
              >
                Remove approach {i + 1}
              </Button>
            </div>
          ) : null}
        </fieldset>
      ))}
      <div>
        <Button
          size="sm"
          variant="ghost"
          disabled={!edit || approaches.length >= 5}
          onClick={() => setApproaches((rows) => [...rows, emptyApproach()])}
        >
          Add approach
        </Button>
      </div>
      <Textarea
        label="Interview talk track (optional)"
        rows={3}
        value={talk}
        disabled={!edit}
        onChange={(e) => {
          setSaved(false);
          setTalk(e.target.value);
        }}
      />
      <Input
        label="Related problems (slugs, comma separated)"
        value={related}
        disabled={!edit}
        onChange={(e) => {
          setSaved(false);
          setRelated(e.target.value);
        }}
      />
      <FormError message={save.error ?? remove.error} />
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" loading={save.pending} disabled={!edit}>
          Save editorial
        </Button>
        {d.editorial ? (
          <Button
            variant="ghost"
            loading={remove.pending}
            disabled={!edit}
            onClick={() => void remove.run()}
          >
            Delete editorial
          </Button>
        ) : null}
        {saved ? <span role="status">Saved!</span> : null}
      </div>
    </form>
  );
}
