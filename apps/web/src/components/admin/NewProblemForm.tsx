"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Input, Select } from "@prepquest/ui";
import { PARAM_TYPES, type AdminProblemDetail, type TagFacets } from "@prepquest/shared";
import { api } from "@/lib/api";
import { useSubmit } from "@/lib/use-submit";
import { FormError } from "../auth/AuthCard";
import { TagPicker } from "./TagPicker";

interface ParamRow {
  name: string;
  type: (typeof PARAM_TYPES)[number];
}

export function NewProblemForm() {
  const router = useRouter();
  const [facets, setFacets] = useState<TagFacets | null>(null);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [difficulty, setDifficulty] = useState("easy");
  const [estMinutes, setEstMinutes] = useState("15");
  const [topics, setTopics] = useState<string[]>([]);
  const [patterns, setPatterns] = useState<string[]>([]);
  const [fn, setFn] = useState("solve");
  const [params, setParams] = useState<ParamRow[]>([{ name: "nums", type: "int[]" }]);
  const [returns, setReturns] = useState<(typeof PARAM_TYPES)[number]>("int");

  useEffect(() => {
    // the public facets only list tags in use; admins need the full taxonomy
    void api<TagFacets>("/tags?all=1")
      .then(setFacets)
      .catch(() => setFacets({ topics: [], patterns: [] }));
  }, []);

  const { run, pending, error, fields } = useSubmit(async () => {
    const created = await api<AdminProblemDetail>("/admin/problems", {
      method: "POST",
      json: {
        slug,
        title,
        difficulty,
        estMinutes: Number(estMinutes),
        topics,
        patterns,
        signature: { function: fn, params, returns },
      },
    });
    router.push(`/admin/problems/${created.id}`);
  });

  const setParam = (i: number, patch: Partial<ParamRow>) =>
    setParams((rows) => rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run();
  };

  return (
    <form onSubmit={onSubmit} noValidate className="grid max-w-3xl gap-6">
      <h1 className="pq-font-display m-0 text-lg leading-relaxed">New problem</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          error={fields.title}
        />
        <Input
          label="Slug"
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
          error={fields.slug}
          helper="kebab-case, used in the URL"
        />
        <Select
          label="Difficulty"
          value={difficulty}
          onChange={(e) => setDifficulty(e.target.value)}
        >
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </Select>
        <Input
          label="Estimated minutes"
          inputMode="numeric"
          value={estMinutes}
          onChange={(e) => setEstMinutes(e.target.value)}
          error={fields.estMinutes}
        />
      </div>

      <TagPicker
        label="Topics"
        options={(facets?.topics ?? []).map((t) => ({ slug: t.slug, name: t.name }))}
        value={topics}
        onChange={setTopics}
        error={fields.topics}
      />
      <TagPicker
        label="Patterns"
        options={(facets?.patterns ?? []).map((t) => ({ slug: t.slug, name: t.name }))}
        value={patterns}
        onChange={setPatterns}
      />

      <fieldset className="m-0 grid gap-3 border-0 p-0">
        <legend className="pq-label mb-1 p-0">Function signature</legend>
        <p className="m-0 text-sm text-ink-soft">
          Tests are validated against this, and starter code and drivers are generated from it.
        </p>
        <Input
          label="Function name"
          value={fn}
          onChange={(e) => setFn(e.target.value)}
          error={fields["signature.function"]}
        />
        {params.map((p, i) => (
          <div key={i} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Input
              label={`Parameter ${i + 1} name`}
              value={p.name}
              onChange={(e) => setParam(i, { name: e.target.value })}
            />
            <Select
              label="Type"
              value={p.type}
              onChange={(e) => setParam(i, { type: e.target.value as ParamRow["type"] })}
            >
              {PARAM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={params.length === 1}
              onClick={() => setParams((rows) => rows.filter((_, k) => k !== i))}
            >
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={params.length >= 6}
            onClick={() =>
              setParams((rows) => [...rows, { name: `arg${rows.length + 1}`, type: "int" }])
            }
          >
            Add parameter
          </Button>
        </div>
        <Select
          label="Returns"
          value={returns}
          onChange={(e) => setReturns(e.target.value as ParamRow["type"])}
        >
          {PARAM_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Select>
      </fieldset>

      <FormError
        message={error ?? (Object.keys(fields).length ? "Check the highlighted fields." : null)}
      />
      <div>
        <Button type="submit" variant="accent" loading={pending}>
          Create draft
        </Button>
      </div>
    </form>
  );
}
